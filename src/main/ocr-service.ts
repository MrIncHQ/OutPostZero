import fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import english from '@tesseract.js-data/eng';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import type { DocumentDetails, OcrOperationResult, OcrProgress } from '../shared/contracts';
import { DatabaseService } from './database-service';
import { DocumentService } from './document-service';
import { PortablePathService } from './portable-path';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;
const MAX_RENDER_PIXELS = 12_000_000;
const OCR_CHECKPOINT_PAGES = 10;

interface ActiveOcr {
  cancelled: boolean;
  worker?: Worker;
}

function idle(documentId: string): OcrProgress {
  return { documentId, state: 'idle', currentPage: 0, totalPages: 0, percent: 0, message: 'OCR is ready.' };
}

export class OcrService {
  private readonly active = new Map<string, ActiveOcr>();
  private readonly progress = new Map<string, OcrProgress>();

  constructor(
    private readonly database: DatabaseService,
    private readonly paths: PortablePathService,
    private readonly documents: DocumentService,
  ) {}

  status(documentId: string): OcrProgress {
    return this.progress.get(documentId) ?? idle(documentId);
  }

  hasActiveJobs(): boolean {
    return this.active.size > 0;
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((documentId) => this.cancel(documentId)));
  }

  async cancel(documentId: string): Promise<OcrProgress> {
    const active = this.active.get(documentId);
    if (!active) return this.status(documentId);
    active.cancelled = true;
    if (active.worker) await active.worker.terminate().catch(() => undefined);
    const current = this.status(documentId);
    const next: OcrProgress = { ...current, state: 'cancelled', message: 'OCR was cancelled. Completed page batches and existing indexed text were kept.' };
    this.progress.set(documentId, next);
    this.database.setDocumentOcrStatus(documentId, 'not-run');
    return next;
  }

  private setProgress(documentId: string, update: Partial<OcrProgress>): OcrProgress {
    const next = { ...this.status(documentId), ...update, documentId };
    this.progress.set(documentId, next);
    return next;
  }

  private async openPdfRenderer(filePath: string): Promise<{ render(pageNumber: number): Promise<Buffer>; close(): Promise<void> }> {
    const pdfjs = await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs') as {
      getDocument: (options: Record<string, unknown>) => { promise: Promise<{ numPages: number; getPage: (page: number) => Promise<Record<string, unknown>> }>; destroy: () => Promise<void> };
    };
    const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)), useSystemFonts: true, disableFontFace: true, isEvalSupported: false });
    const pdf = await task.promise;
    return {
      render: async (pageNumber: number) => {
        const page = await pdf.getPage(pageNumber) as { getViewport: (options: { scale: number }) => { width: number; height: number }; render: (options: Record<string, unknown>) => { promise: Promise<void> } };
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2.25, Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, base.width * base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        return canvas.toBuffer('image/png');
      },
      close: () => task.destroy(),
    };
  }

  async run(documentId: string): Promise<OcrOperationResult> {
    const document = this.documents.details(documentId);
    if (!['image', 'pdf'].includes(document.format)) throw new Error('OCR is available for images and PDF documents.');
    if (this.active.has(documentId)) throw new Error('OCR is already running for this document.');
    const active: ActiveOcr = { cancelled: false };
    let pdfRenderer: { render(pageNumber: number): Promise<Buffer>; close(): Promise<void> } | undefined;
    this.active.set(documentId, active);
    this.database.setDocumentOcrStatus(documentId, 'running');
    const originalPages = this.database.documentPages(documentId);
    const originalText = new Map(originalPages.map((page) => [page.page, page.text.trim()]));
    const totalPages = document.format === 'image' ? 1 : Math.max(1, document.pageCount);
    const pagesToRecognize = document.format === 'image'
      ? [1]
      : Array.from({ length: totalPages }, (_, index) => index + 1).filter((page) => !originalText.get(page));
    this.setProgress(documentId, { state: 'preparing', currentPage: 0, totalPages: pagesToRecognize.length, percent: 0, message: pagesToRecognize.length ? 'Preparing the local OCR engine...' : 'Every PDF page already contains searchable text.' });

    try {
      if (!pagesToRecognize.length) {
        this.database.setDocumentOcrStatus(documentId, 'complete');
        const progress = this.setProgress(documentId, { state: 'complete', percent: 100, message: 'No OCR was needed; every page already has searchable text.' });
        return { ok: true, message: progress.message, document: this.documents.details(documentId), progress };
      }

      const imageFile = document.format === 'image' ? fs.readFileSync(this.documents.filePath(documentId)) : undefined;
      pdfRenderer = document.format === 'pdf' ? await this.openPdfRenderer(this.documents.filePath(documentId)) : undefined;
      if (active.cancelled) throw new Error('OCR_CANCELLED');

      let currentPage = 0;
      const worker = await createWorker('eng', OEM.LSTM_ONLY, {
        langPath: english.langPath,
        gzip: english.gzip,
        cachePath: this.paths.ensureDirectory('Cache/OCR'),
        cacheMethod: 'none',
        logger: (message) => {
          const pageFraction = Math.max(0, Math.min(1, Number(message.progress) || 0));
          this.setProgress(documentId, { state: 'recognizing', currentPage, totalPages: pagesToRecognize.length, percent: Math.min(99, Math.round(((Math.max(0, currentPage - 1) + pageFraction) / pagesToRecognize.length) * 100)), message: `Page ${Math.max(1, currentPage)} of ${pagesToRecognize.length}: ${message.status.replace(/_/g, ' ')}` });
        },
      });
      active.worker = worker;
      let checkpoint: Array<{ page: number; text: string }> = [];
      const saveCheckpoint = () => {
        if (!checkpoint.length) return;
        this.database.mergeDocumentPages(documentId, checkpoint, totalPages);
        checkpoint = [];
      };
      try {
        for (let index = 0; index < pagesToRecognize.length; index += 1) {
          if (active.cancelled) throw new Error('OCR_CANCELLED');
          const pageNumber = pagesToRecognize[index];
          currentPage = index + 1;
          this.setProgress(documentId, { state: 'recognizing', currentPage, percent: Math.round(index / pagesToRecognize.length * 100), message: `Recognizing page ${currentPage} of ${pagesToRecognize.length}...` });
          const image = imageFile ?? await pdfRenderer!.render(pageNumber);
          const result = await worker.recognize(image, { rotateAuto: true });
          checkpoint.push({ page: pageNumber, text: result.data.text.replace(/\r\n/g, '\n').trim() });
          if (checkpoint.length >= OCR_CHECKPOINT_PAGES) saveCheckpoint();
        }
        saveCheckpoint();
      } finally {
        await worker.terminate().catch(() => undefined);
        active.worker = undefined;
      }
      if (active.cancelled) throw new Error('OCR_CANCELLED');

      this.database.setDocumentOcrStatus(documentId, 'complete');
      const progress = this.setProgress(documentId, { state: 'complete', currentPage: pagesToRecognize.length, totalPages: pagesToRecognize.length, percent: 100, message: `${pagesToRecognize.length} page${pagesToRecognize.length === 1 ? '' : 's'} recognized and added to document search.` });
      return { ok: true, message: progress.message, document: this.documents.details(documentId), progress };
    } catch (error) {
      if (active.cancelled || (error instanceof Error && error.message === 'OCR_CANCELLED')) {
        this.database.setDocumentOcrStatus(documentId, 'not-run');
        const progress = this.setProgress(documentId, { state: 'cancelled', message: 'OCR was cancelled. Completed page batches and existing indexed text were kept.' });
        return { ok: false, message: progress.message, document: this.documents.details(documentId), progress };
      }
      const message = error instanceof Error ? error.message.slice(0, 500) : 'OCR failed.';
      this.database.setDocumentOcrStatus(documentId, 'error', message);
      const progress = this.setProgress(documentId, { state: 'error', message });
      return { ok: false, message, document: this.documents.details(documentId), progress };
    } finally {
      await pdfRenderer?.close().catch(() => undefined);
      await active.worker?.terminate().catch(() => undefined);
      this.active.delete(documentId);
    }
  }
}
