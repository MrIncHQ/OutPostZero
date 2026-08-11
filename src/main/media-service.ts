import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { MediaItem, MediaKind, MediaMetadataUpdate, MediaOperationResult, MediaState } from '../shared/contracts';
import { PortablePathService, isWithinRoot } from './portable-path';

interface StoredMediaItem extends Omit<MediaItem, 'readerUrl'> {}
interface MediaIndex { schemaVersion: 1; scannedAt: string | null; items: StoredMediaItem[]; }

const EXTENSIONS: Record<string, MediaKind> = {
  '.mp4': 'video', '.m4v': 'video', '.webm': 'video', '.mov': 'video',
  '.mp3': 'audio', '.m4a': 'audio', '.aac': 'audio', '.wav': 'audio', '.ogg': 'audio', '.flac': 'audio',
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image', '.webp': 'image', '.bmp': 'image',
};

function cleanList(value: string[] | undefined): string[] | undefined {
  return value ? [...new Set(value.map((item) => item.trim()).filter(Boolean))].slice(0, 40) : undefined;
}

function safeTitle(fileName: string): string {
  return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export class MediaService {
  private readonly contentRoot: string;
  private readonly statePath: string;

  constructor(private readonly paths: PortablePathService) {
    this.contentRoot = paths.ensureDirectory('Content/Media');
    this.statePath = paths.resolve('Data/Media/library.json');
  }

  private load(): MediaIndex {
    try {
      const value = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Partial<MediaIndex>;
      if (value.schemaVersion === 1 && Array.isArray(value.items)) return { schemaVersion: 1, scannedAt: value.scannedAt ?? null, items: value.items } as MediaIndex;
    } catch { /* First use or recoverable metadata damage. */ }
    return { schemaVersion: 1, scannedAt: null, items: [] };
  }

  private save(index: MediaIndex): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, this.statePath);
  }

  private expose(item: StoredMediaItem): MediaItem {
    return { ...item, readerUrl: `outpost-media://file/${item.id}/${encodeURIComponent(item.fileName)}` };
  }

  state(query = ''): MediaState {
    const index = this.load();
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const items = index.items.filter((item) => {
      const haystack = [item.title, item.fileName, item.kind, ...item.tags, ...item.collections].join(' ').toLocaleLowerCase();
      return words.every((word) => haystack.includes(word));
    }).sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.addedAt.localeCompare(a.addedAt));
    return { scannedAt: index.scannedAt, items: items.map((item) => this.expose(item)) };
  }

  private walk(directory: string): string[] {
    const files: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...this.walk(candidate));
      else if (entry.isFile() && EXTENSIONS[path.extname(entry.name).toLocaleLowerCase()]) files.push(candidate);
    }
    return files;
  }

  reconcile(): MediaOperationResult {
    const index = this.load();
    const previous = new Map(index.items.map((item) => [item.relativePath.toLocaleLowerCase(), item]));
    const now = new Date().toISOString();
    const items = this.walk(this.contentRoot).map((filePath): StoredMediaItem => {
      const relativePath = path.relative(this.paths.root, filePath).replace(/\\/g, '/');
      const stat = fs.statSync(filePath);
      const existing = previous.get(relativePath.toLocaleLowerCase());
      return {
        id: existing?.id ?? crypto.createHash('sha256').update(relativePath.toLocaleLowerCase()).digest('hex').slice(0, 20),
        title: existing?.title ?? safeTitle(filePath), fileName: path.basename(filePath), relativePath,
        kind: EXTENSIONS[path.extname(filePath).toLocaleLowerCase()], size: stat.size,
        modifiedAt: stat.mtime.toISOString(), addedAt: existing?.addedAt ?? now,
        favorite: existing?.favorite ?? false, tags: existing?.tags ?? [], collections: existing?.collections ?? [],
        playbackSeconds: existing?.playbackSeconds ?? 0, durationSeconds: existing?.durationSeconds ?? null,
      };
    });
    this.save({ schemaVersion: 1, scannedAt: now, items });
    return { ok: true, message: `${items.length} media ${items.length === 1 ? 'file' : 'files'} ready on this drive.`, state: this.state() };
  }

  importFiles(sourcePaths: string[]): MediaOperationResult {
    let imported = 0;
    for (const sourcePath of sourcePaths) {
      const kind = EXTENSIONS[path.extname(sourcePath).toLocaleLowerCase()];
      if (!kind || !fs.statSync(sourcePath).isFile()) continue;
      const parsed = path.parse(sourcePath); let target = path.join(this.contentRoot, parsed.base); let suffix = 2;
      while (fs.existsSync(target)) { target = path.join(this.contentRoot, `${parsed.name} (${suffix})${parsed.ext}`); suffix += 1; }
      fs.copyFileSync(sourcePath, target, fs.constants.COPYFILE_EXCL); imported += 1;
    }
    const result = this.reconcile();
    return { ...result, message: imported ? `${imported} media ${imported === 1 ? 'file was' : 'files were'} copied onto this drive.` : 'No supported media files were selected.' };
  }

  update(id: string, update: MediaMetadataUpdate): MediaState {
    const index = this.load(); const item = index.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error('Media item was not found.');
    if (update.title !== undefined) item.title = update.title.trim().slice(0, 160) || safeTitle(item.fileName);
    if (update.favorite !== undefined) item.favorite = update.favorite;
    if (update.tags) item.tags = cleanList(update.tags) ?? [];
    if (update.collections) item.collections = cleanList(update.collections) ?? [];
    if (update.playbackSeconds !== undefined && Number.isFinite(update.playbackSeconds)) item.playbackSeconds = Math.max(0, update.playbackSeconds);
    if (update.durationSeconds !== undefined && Number.isFinite(update.durationSeconds)) item.durationSeconds = Math.max(0, update.durationSeconds);
    this.save(index); return this.state();
  }

  remove(id: string): MediaOperationResult {
    const index = this.load(); const item = index.items.find((candidate) => candidate.id === id);
    if (!item) throw new Error('Media item was not found.');
    const target = this.paths.resolve(item.relativePath);
    if (!isWithinRoot(this.contentRoot, target)) throw new Error('Media path is outside the managed library.');
    if (fs.existsSync(target)) fs.unlinkSync(target);
    index.items = index.items.filter((candidate) => candidate.id !== id); this.save(index);
    return { ok: true, message: `${item.title} was deleted from this drive.`, state: this.state() };
  }

  filePath(id: string): string {
    const item = this.load().items.find((candidate) => candidate.id === id);
    if (!item) throw new Error('Media item was not found.');
    const target = this.paths.resolve(item.relativePath);
    if (!isWithinRoot(this.contentRoot, target) || !fs.statSync(target).isFile()) throw new Error('Media file is unavailable.');
    return target;
  }
}
