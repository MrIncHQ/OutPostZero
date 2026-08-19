import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DocumentAnnotationInput, DocumentDetails, DocumentFormat, DocumentLibraryState, DocumentMetadataUpdate,
  DocumentNoteInput, DocumentOperationResult, DocumentSearchResult, DocumentSummary,
} from '../shared/contracts';
import { DatabaseService } from './database-service';
import { PortablePathService } from './portable-path';
import { documentSearchTerms } from './ai-retrieval';

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.markdown', '.html', '.htm', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

function formatForExtension(extension: string): DocumentFormat | null {
  if (extension === '.pdf') return 'pdf';
  if (extension === '.txt') return 'text';
  if (extension === '.md' || extension === '.markdown') return 'markdown';
  if (extension === '.html' || extension === '.htm') return 'html';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)) return 'image';
  return null;
}

function cleanTitle(fileName: string): string {
  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled document';
}

function safeFileName(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const stem = path.basename(fileName, path.extname(fileName)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 120) || 'document';
  return `${stem}${extension}`;
}

function normalizeLabels(values: string[] | undefined): string[] | undefined {
  if (!values) return undefined;
  return [...new Set(values.map((value) => value.trim().replace(/\s+/g, ' ').slice(0, 48)).filter((value) => value.length > 0))].slice(0, 40);
}

function editDistance(left: string, right: string): number {
  if (left.length === right.length) {
    for (let index = 0; index < left.length - 1; index += 1) {
      if (left[index] === right[index + 1] && left[index + 1] === right[index]
        && `${left.slice(0, index)}${left[index + 1]}${left[index]}${left.slice(index + 2)}` === right) return 1;
    }
  }
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0]; row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = row[rightIndex];
      row[rightIndex] = Math.min(row[rightIndex] + 1, row[rightIndex - 1] + 1, diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[right.length];
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex').toUpperCase();
}

function stripHtml(source: string): string {
  return source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}

function textPages(text: string, charactersPerPage = 5000): Array<{ page: number; text: string }> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const pages: Array<{ page: number; text: string }> = [];
  for (let offset = 0; offset < normalized.length; offset += charactersPerPage) pages.push({ page: pages.length + 1, text: normalized.slice(offset, offset + charactersPerPage) });
  return pages;
}

export class DocumentService {
  constructor(private readonly database: DatabaseService, private readonly paths: PortablePathService) {}

  private requireDocument(documentId: string): DocumentSummary {
    if (!/^[A-F0-9]{24}$/i.test(documentId)) throw new Error('Document identifier is invalid.');
    const document = this.database.document(documentId);
    if (!document) throw new Error('Document was not found on this drive.');
    return document;
  }

  filePath(documentId: string): string {
    return this.paths.resolve(this.requireDocument(documentId).relativePath);
  }

  library(): DocumentLibraryState {
    const documents = this.database.documents();
    return {
      documents,
      collections: [...new Set(documents.flatMap((document) => document.collections))].sort(),
      tags: [...new Set(documents.flatMap((document) => document.tags))].sort(),
    };
  }

  details(documentId: string): DocumentDetails {
    const document = this.requireDocument(documentId);
    return {
      ...document,
      readerUrl: `outpost-doc://document/${document.id}/${encodeURIComponent(document.fileName)}`,
      bookmarks: this.database.documentBookmarks(document.id),
      notes: this.database.documentNotes(document.id),
      annotations: this.database.documentAnnotations(document.id),
    };
  }

  async reconcile(indexNew = true): Promise<DocumentOperationResult> {
    const roots = [this.paths.ensureDirectory('Content/PDFs'), this.paths.ensureDirectory('Content/Documents')];
    const seen = new Set<string>();
    const indexQueue: string[] = [];
    const walk = async (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(candidate);
        else if (entry.isFile()) {
          const extension = path.extname(entry.name).toLowerCase();
          const format = formatForExtension(extension);
          if (!format || !SUPPORTED_EXTENSIONS.has(extension)) continue;
          const relativePath = path.relative(this.paths.root, candidate).replace(/\\/g, '/');
          seen.add(relativePath.toLowerCase());
          const stats = fs.statSync(candidate);
          const modifiedAt = stats.mtime.toISOString();
          const existing = this.database.documentByRelativePath(relativePath);
          if (existing && existing.size === stats.size && existing.modifiedAt === modifiedAt) continue;
          const sha256 = await sha256File(candidate);
          const id = crypto.createHash('sha256').update(relativePath.toLowerCase()).digest('hex').slice(0, 24).toUpperCase();
          this.database.upsertDocument({ id, relativePath, sha256, title: cleanTitle(entry.name), fileName: entry.name, format, size: stats.size, modifiedAt, addedAt: existing?.addedAt ?? new Date().toISOString() });
          indexQueue.push(id);
        }
      }
    };
    for (const root of roots) await walk(root);
    for (const document of this.database.documents()) {
      if (!seen.has(document.relativePath.toLowerCase()) && !fs.existsSync(this.paths.resolve(document.relativePath))) this.database.removeDocument(document.id);
      else if (indexNew && document.indexStatus === 'not-indexed') indexQueue.push(document.id);
    }
    if (indexNew) for (const documentId of [...new Set(indexQueue)]) await this.indexDocument(documentId);
    return { ok: true, message: `${this.library().documents.length} supported document${this.library().documents.length === 1 ? '' : 's'} ready on this drive.`, library: this.library() };
  }

  async importFiles(sourcePaths: string[]): Promise<DocumentOperationResult> {
    let imported = 0;
    let duplicate = 0;
    for (const sourcePath of sourcePaths.slice(0, 200)) {
      const resolved = path.resolve(sourcePath);
      const stats = fs.statSync(resolved);
      if (!stats.isFile()) continue;
      const extension = path.extname(resolved).toLowerCase();
      const format = formatForExtension(extension);
      if (!format) continue;
      const sha256 = await sha256File(resolved);
      if (this.database.documentByHash(sha256)) { duplicate += 1; continue; }
      const destinationRoot = format === 'pdf' ? this.paths.ensureDirectory('Content/PDFs') : this.paths.ensureDirectory('Content/Documents');
      const cleanName = safeFileName(path.basename(resolved));
      let destination = path.join(destinationRoot, cleanName);
      if (fs.existsSync(destination)) destination = path.join(destinationRoot, `${path.basename(cleanName, extension)}-${sha256.slice(0, 8).toLowerCase()}${extension}`);
      fs.copyFileSync(resolved, destination, fs.constants.COPYFILE_EXCL);
      imported += 1;
    }
    const result = await this.reconcile(true);
    return { ...result, message: imported ? `Imported and indexed ${imported} document${imported === 1 ? '' : 's'}${duplicate ? `; ${duplicate} duplicate${duplicate === 1 ? '' : 's'} skipped` : ''}.` : duplicate ? `${duplicate} selected document${duplicate === 1 ? ' is' : 's are'} already in the library.` : 'No supported documents were selected.' };
  }

  private async indexDocument(documentId: string): Promise<void> {
    const document = this.requireDocument(documentId);
    this.database.setDocumentIndexStatus(document.id, 'indexing');
    try {
      let pages: Array<{ page: number; text: string }> = [];
      let pageCount = 1;
      const filePath = this.filePath(document.id);
      if (document.format === 'pdf') {
        const pdfjs = await dynamicImport('pdfjs-dist/legacy/build/pdf.mjs') as { getDocument: (options: Record<string, unknown>) => { promise: Promise<{ numPages: number; getPage: (page: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> }> }>; destroy: () => Promise<void> } };
        const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(filePath)), useSystemFonts: true, disableFontFace: true, isEvalSupported: false });
        const pdf = await task.promise;
        pageCount = pdf.numPages;
        try {
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            const text = content.items.map((item) => `${item.str ?? ''}${item.hasEOL ? '\n' : ' '}`).join('').replace(/[ \t]+/g, ' ').trim();
            pages.push({ page: pageNumber, text });
          }
        } finally { await task.destroy(); }
      } else if (document.format === 'text' || document.format === 'markdown' || document.format === 'html') {
        const source = fs.readFileSync(filePath, 'utf8');
        pages = textPages(document.format === 'html' ? stripHtml(source) : source);
        pageCount = Math.max(1, pages.length);
      }
      this.database.replaceDocumentPages(document.id, pages, pageCount);
    } catch (error) {
      this.database.setDocumentIndexStatus(document.id, 'error', error instanceof Error ? error.message.slice(0, 500) : 'Indexing failed.');
    }
  }

  text(documentId: string): string {
    const document = this.requireDocument(documentId);
    if (!['text', 'markdown', 'html'].includes(document.format)) return '';
    return this.database.documentText(document.id);
  }

  search(query: string): DocumentSearchResult[] {
    const tokens = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 12) ?? [];
    if (!tokens.length) return [];
    const ftsQuery = tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' AND ');
    return this.database.searchDocumentPages(ftsQuery);
  }

  suggestTerms(tokens: string[], limitPerToken = 1): Record<string, string[]> {
    const vocabulary = new Set(this.library().documents.flatMap((document) => `${document.title} ${document.tags.join(' ')} ${document.collections.join(' ')}`.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,24}/gu) ?? []));
    return Object.fromEntries(tokens.map((token) => {
      const normalized = token.toLocaleLowerCase();
      if (!/^[\p{L}\p{N}]{5,24}$/u.test(normalized)) return [token, []];
      const maximumDistance = normalized.length >= 7 ? 2 : 1;
      const suggestions = [...vocabulary].filter((candidate) => candidate[0] === normalized[0] && Math.abs(candidate.length - normalized.length) <= maximumDistance)
        .map((candidate) => ({ candidate, distance: editDistance(normalized, candidate) }))
        .filter((item) => item.distance > 0 && item.distance <= maximumDistance)
        .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate)).slice(0, limitPerToken).map((item) => item.candidate);
      return [token, suggestions];
    }));
  }

  aiContext(documentId: string, page: number, query: string, maximumCharacters = 4_000): string {
    const terms = documentSearchTerms(query);
    const pages = this.database.documentPageRange(documentId, Math.max(1, page - 1), page + 1);
    const current = pages.find((entry) => entry.page === page)?.text.trim() ?? '';
    const lower = current.toLocaleLowerCase();
    const hit = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0).sort((left, right) => left - right)[0] ?? 0;
    const currentBudget = Math.min(2_800, maximumCharacters); const start = Math.max(0, Math.min(hit - Math.floor(currentBudget / 3), Math.max(0, current.length - currentBudget)));
    const focused = current.slice(start, start + currentBudget).trim();
    const previous = pages.find((entry) => entry.page === page - 1)?.text.trim().slice(-500) ?? '';
    const next = pages.find((entry) => entry.page === page + 1)?.text.trim().slice(0, 500) ?? '';
    return [[page - 1, previous], [page, focused], [page + 1, next]].filter(([, text]) => Boolean(text)).map(([number, text]) => `Page ${number}: ${text}`).join('\n\n').slice(0, maximumCharacters);
  }

  updateMetadata(documentId: string, update: DocumentMetadataUpdate): DocumentDetails {
    const document = this.requireDocument(documentId);
    const currentPage = update.currentPage === undefined ? undefined : Math.max(1, Math.min(document.pageCount || Number.MAX_SAFE_INTEGER, Math.floor(update.currentPage)));
    this.database.updateDocumentMetadata(document.id, { favorite: update.favorite, currentPage, tags: normalizeLabels(update.tags), collections: normalizeLabels(update.collections) });
    return this.details(document.id);
  }

  remove(documentId: string): DocumentOperationResult {
    const document = this.requireDocument(documentId);
    fs.rmSync(this.filePath(document.id), { force: false });
    this.database.removeDocument(document.id);
    return { ok: true, message: `${document.title} was removed and freed ${document.size.toLocaleString()} bytes.`, library: this.library() };
  }

  addBookmark(documentId: string, page: number, label: string): DocumentDetails {
    const document = this.requireDocument(documentId);
    this.database.addDocumentBookmark(document.id, Math.max(1, Math.floor(page)), label.trim().slice(0, 80) || `Page ${page}`);
    return this.details(document.id);
  }

  removeBookmark(documentId: string, bookmarkId: string): DocumentDetails {
    const document = this.requireDocument(documentId);
    this.database.removeDocumentBookmark(document.id, bookmarkId);
    return this.details(document.id);
  }

  saveNote(documentId: string, note: DocumentNoteInput): DocumentDetails {
    const document = this.requireDocument(documentId);
    if (note.id && !/^[0-9a-f-]{36}$/i.test(note.id)) throw new Error('Note identifier is invalid.');
    this.database.saveDocumentNote(document.id, { id: note.id, page: Math.max(1, Math.floor(note.page)), title: note.title.trim().slice(0, 100) || 'Note', body: note.body.trim().slice(0, 20_000) });
    return this.details(document.id);
  }

  removeNote(documentId: string, noteId: string): DocumentDetails {
    const document = this.requireDocument(documentId);
    this.database.removeDocumentNote(document.id, noteId);
    return this.details(document.id);
  }

  saveAnnotation(documentId: string, annotation: DocumentAnnotationInput): DocumentDetails {
    const document = this.requireDocument(documentId);
    if (annotation.id && !/^[0-9a-f-]{36}$/i.test(annotation.id)) throw new Error('Annotation identifier is invalid.');
    const color = /^#[A-F0-9]{6}$/i.test(annotation.color) ? annotation.color.toUpperCase() : '#E0A44F';
    this.database.saveDocumentAnnotation(document.id, { id: annotation.id, page: Math.max(1, Math.floor(annotation.page)), kind: annotation.kind === 'comment' ? 'comment' : 'highlight', color, text: annotation.text.trim().slice(0, 5000) });
    return this.details(document.id);
  }

  removeAnnotation(documentId: string, annotationId: string): DocumentDetails {
    const document = this.requireDocument(documentId);
    this.database.removeDocumentAnnotation(document.id, annotationId);
    return this.details(document.id);
  }
}
