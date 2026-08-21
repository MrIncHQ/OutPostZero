import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AiSource, KiwixCatalogEntry, KiwixCatalogOption, KiwixCatalogOptionsResult, KiwixCatalogResult, KiwixDownloadStatus, LibraryOperationResult, ModuleSummary, OfflineLibraryStatus, ZimContentSummary } from '../shared/contracts';
import { MODULE_PACKAGE_PUBLIC_KEY } from './module-trust';
import { DatabaseService } from './database-service';
import { KIWIX_PACKAGE } from './kiwix-package';
import { PortablePathService } from './portable-path';
import { documentSearchTerms } from './ai-retrieval';

interface PackageFile { path: string; size: number; sha256: string }
interface DownloadFile extends PackageFile { url: string }
interface KiwixManifest {
  schemaVersion: 1;
  id: 'library-engine';
  name: string;
  version: string;
  platform: 'win32';
  architecture: 'x64';
  license: string;
  networkPolicy: 'loopback-only';
  ownedDirectory: 'Modules/Installed/kiwix-engine';
  sharedContentDirectory: 'Content/ZIM';
  executable: 'kiwix-serve.exe';
  archive: DownloadFile;
  files: PackageFile[];
  sampleContent: DownloadFile & { title: string };
}
interface ActiveKiwix { child: ChildProcess; pid: number; port: number; startedAt: string; stopping: boolean }
type FetchLike = typeof globalThis.fetch;
interface CatalogRecord extends KiwixCatalogEntry { meta4Url: string }
interface MetalinkRecord { fileName: string; size: number; sha256: string; downloadUrl: string }
interface ParsedCatalog { entries: Array<Omit<CatalogRecord, 'installed'>>; totalResults: number; startIndex: number; itemsPerPage: number }

function decodeXml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function xmlText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${tag}>`, 'i'));
  return match ? decodeXml(match[1].trim().replace(/<[^>]+>/g, '')) : '';
}

function xmlAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}="([^"]*)"`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function safeZimFileName(value: string): string {
  const decoded = decodeURIComponent(value);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.zim$/i.test(decoded)) throw new Error('Kiwix catalog returned an unsafe ZIM filename.');
  return decoded;
}

function plainKiwixText(value: string): string {
  return decodeXml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

export function parseKiwixSearchXml(xml: string): Array<{ title: string; link: string; excerpt: string }> {
  const results: Array<{ title: string; link: string; excerpt: string }> = [];
  for (const tag of ['item', 'entry']) {
    for (const match of xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'))) {
      const block = match[1]; const title = plainKiwixText(xmlText(block, 'title'));
      const linkTag = block.match(/<link\b[^>]*>/i)?.[0] ?? ''; const link = xmlAttribute(linkTag, 'href') || plainKiwixText(xmlText(block, 'link'));
      const excerpt = plainKiwixText(xmlText(block, 'description') || xmlText(block, 'summary') || xmlText(block, 'content'));
      if (title && link && !results.some((result) => result.link === link)) results.push({ title, link, excerpt });
    }
  }
  return results;
}

export function buildAiSearchQueries(query: string): string[] {
  const tokens = documentSearchTerms(query);
  if (!tokens.length) return [];
  const queries = [tokens.join(' ')];
  const hasSkinning = tokens.some((token) => ['skin', 'skinning', 'dress', 'dressing'].includes(token));
  const gameAnimal = tokens.find((token) => ['deer', 'elk', 'moose', 'game', 'animal'].includes(token));
  if (hasSkinning && gameAnimal) queries.push(`field dressing ${gameAnimal}`, `butchering ${gameAnimal}`);
  if (tokens.length > 3) queries.push(tokens.slice(-3).join(' '));
  return [...new Set(queries)].slice(0, 3);
}

function zimName(fileName: string): string {
  return path.basename(fileName, '.zim').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ /g, '_').replace(/\+/g, 'plus');
}

function zimLanguage(fileName: string): string {
  return path.basename(fileName, '.zim').match(/_([a-z]{2,3})_/i)?.[1].toLowerCase() ?? `single:${zimName(fileName)}`;
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function parseKiwixNavigation(xml: string, kind: 'language' | 'category'): KiwixCatalogOption[] {
  const options: KiwixCatalogOption[] = [];
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1];
    const id = kind === 'language' ? xmlText(block, 'language') : xmlText(block, 'title');
    const label = xmlText(block, 'title');
    if ((kind === 'language' ? /^[a-z]{3}$/i : /^[A-Za-z0-9_-]{1,64}$/).test(id) && label) {
      options.push({ id, label, count: positiveInteger(xmlText(block, 'count')) });
    }
  }
  return options.sort((left, right) => left.label.localeCompare(right.label));
}

export function parseKiwixCatalogFeed(xml: string): ParsedCatalog {
  const records: Array<Omit<CatalogRecord, 'installed'>> = [];
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    try {
      const block = match[1];
      const link = [...block.matchAll(/<link\b[^>]*\/?>/gi)].map((candidate) => candidate[0])
        .find((candidate) => xmlAttribute(candidate, 'rel') === 'http://opds-spec.org/acquisition/open-access'
          && xmlAttribute(candidate, 'type') === 'application/x-zim');
      if (!link) continue;
      const meta4Url = xmlAttribute(link, 'href');
      const url = new URL(meta4Url);
      if (url.protocol !== 'https:' || url.hostname !== 'lb.download.kiwix.org' || !url.pathname.endsWith('.zim.meta4')) continue;
      const downloadBytes = Number(xmlAttribute(link, 'length'));
      const id = xmlText(block, 'id').replace(/^urn:uuid:/i, '');
      if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || !Number.isSafeInteger(downloadBytes) || downloadBytes <= 0) continue;
      records.push({
        id,
        archiveName: xmlText(block, 'name') || id,
        title: xmlText(block, 'title') || xmlText(block, 'name'),
        summary: xmlText(block, 'summary'),
        language: xmlText(block, 'language'),
        flavour: xmlText(block, 'flavour'),
        category: xmlText(block, 'category'),
        releaseDate: xmlText(block, 'issued') || xmlText(block, 'updated'),
        downloadBytes,
        fileName: safeZimFileName(path.basename(url.pathname, '.meta4')),
        meta4Url: url.toString(),
        articleCount: positiveInteger(xmlText(block, 'articleCount')),
        mediaCount: positiveInteger(xmlText(block, 'mediaCount')),
      });
    } catch { /* Ignore malformed catalog entries without losing valid results. */ }
  }
  return {
    entries: records,
    totalResults: positiveInteger(xmlText(xml, 'totalResults')) || records.length,
    startIndex: positiveInteger(xmlText(xml, 'startIndex')),
    itemsPerPage: positiveInteger(xmlText(xml, 'itemsPerPage')) || records.length,
  };
}

export function parseKiwixCatalog(xml: string): Array<Omit<CatalogRecord, 'installed'>> { return parseKiwixCatalogFeed(xml).entries; }

export function parseKiwixMetalink(xml: string, sourceUrl: string): MetalinkRecord {
  const fileTag = xml.match(/<file\b[^>]*>/i)?.[0];
  const size = Number(xmlText(xml, 'size'));
  const shaTag = [...xml.matchAll(/<hash\b[^>]*>[\s\S]*?<\/hash>/gi)].map((candidate) => candidate[0])
    .find((candidate) => xmlAttribute(candidate, 'type').toLowerCase() === 'sha-256');
  const sha256 = shaTag ? shaTag.replace(/<[^>]+>/g, '').trim().toUpperCase() : '';
  if (!fileTag || !Number.isSafeInteger(size) || size <= 0 || !/^[A-F0-9]{64}$/.test(sha256)) {
    throw new Error('Kiwix download metadata is incomplete.');
  }
  const metaUrl = new URL(sourceUrl);
  if (metaUrl.protocol !== 'https:' || metaUrl.hostname !== 'lb.download.kiwix.org' || !metaUrl.pathname.endsWith('.meta4')) {
    throw new Error('Kiwix download metadata source is not allowed.');
  }
  metaUrl.pathname = metaUrl.pathname.slice(0, -'.meta4'.length);
  return { fileName: safeZimFileName(xmlAttribute(fileTag, 'name')), size, sha256, downloadUrl: metaUrl.toString() };
}

function hashBuffer(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

export async function hashFile(filePath: string, onProgress?: (verifiedBytes: number, totalBytes: number) => void): Promise<string> {
  const hash = crypto.createHash('sha256');
  const totalBytes = fs.statSync(filePath).size;
  let verifiedBytes = 0;
  let lastReportedAt = 0;
  onProgress?.(0, totalBytes);
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk as Buffer);
    verifiedBytes += (chunk as Buffer).length;
    const now = Date.now();
    if (verifiedBytes === totalBytes || now - lastReportedAt >= 100) {
      onProgress?.(verifiedBytes, totalBytes);
      lastReportedAt = now;
    }
  }
  return hash.digest('hex').toUpperCase();
}

interface LiveDownloadOptions {
  fetchImpl: typeof globalThis.fetch;
  url: string;
  filePath: string;
  totalBytes: number;
  offset: number;
  signal: AbortSignal;
  segmentBytes?: number;
  connections?: number;
  onProgress?: (downloadedBytes: number, mode: 'parallel' | 'single' | 'resume-hash') => void;
}

/** Downloads ordered ranges concurrently, writes sequentially, and computes the official whole-file hash without a second disk pass. */
export async function downloadWithLiveSha256(options: LiveDownloadOptions): Promise<{ sha256: string; connections: number }> {
  const segmentBytes = Math.max(1024, options.segmentBytes ?? 32 * 1024 * 1024);
  const connections = Math.max(1, Math.min(4, options.connections ?? 3));
  let offset = options.offset; let hash = crypto.createHash('sha256');
  if (offset > 0) {
    let hashed = 0;
    for await (const chunk of fs.createReadStream(options.filePath, { start: 0, end: offset - 1, highWaterMark: 4 * 1024 * 1024 })) {
      hash.update(chunk as Buffer); hashed += (chunk as Buffer).length; options.onProgress?.(hashed, 'resume-hash');
    }
    if (hashed !== offset) throw new Error('The saved partial Kiwix download changed while it was being prepared.');
  }
  if (offset === options.totalBytes) return { sha256: hash.digest('hex').toUpperCase(), connections: 0 };

  const rangeHeaders = (start: number, end: number) => ({ 'User-Agent': 'Outpost-Zero-Kiwix', 'Accept-Encoding': 'identity', Range: `bytes=${start}-${end}` });
  const firstEnd = Math.min(options.totalBytes - 1, offset + segmentBytes - 1);
  let first = await options.fetchImpl(options.url, { signal: options.signal, cache: 'no-store', headers: rangeHeaders(offset, firstEnd) });
  if (first.status !== 206) {
    if (first.status !== 200 || offset > 0) {
      await first.body?.cancel();
      offset = 0; hash = crypto.createHash('sha256'); fs.truncateSync(options.filePath, 0);
      first = await options.fetchImpl(options.url, { signal: options.signal, cache: 'no-store', headers: { 'User-Agent': 'Outpost-Zero-Kiwix', 'Accept-Encoding': 'identity' } });
    }
    if (!first.ok || !first.body) throw new Error(`Kiwix download returned HTTP ${first.status}.`);
    let downloaded = offset;
    const progress = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
      hash.update(chunk); downloaded += chunk.length; options.onProgress?.(downloaded, 'single'); callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(first.body as never), progress, fs.createWriteStream(options.filePath, { flags: offset ? 'a' : 'w', highWaterMark: 4 * 1024 * 1024 }));
    if (downloaded !== options.totalBytes) throw new Error(`Kiwix download size mismatch: expected ${options.totalBytes}, received ${downloaded}.`);
    return { sha256: hash.digest('hex').toUpperCase(), connections: 1 };
  }

  const readRange = async (response: Response, start: number, end: number): Promise<Buffer> => {
    if (response.status !== 206) { await response.body?.cancel(); throw new Error('Kiwix server stopped supporting accelerated range downloads. Retry to resume safely.'); }
    const buffer = Buffer.from(await response.arrayBuffer()); const expected = end - start + 1;
    if (buffer.length !== expected) throw new Error(`Kiwix range size mismatch at byte ${start}.`);
    const contentRange = response.headers.get('content-range');
    if (contentRange && contentRange.toLowerCase() !== `bytes ${start}-${end}/${options.totalBytes}`.toLowerCase()) throw new Error(`Kiwix returned an unexpected byte range at ${start}.`);
    return buffer;
  };
  const handle = await fs.promises.open(options.filePath, offset ? 'a' : 'w');
  try {
    let nextOffset = offset; let firstResponse: Response | null = first;
    while (nextOffset < options.totalBytes) {
      const ranges: Array<{ start: number; end: number; promise: Promise<Buffer> }> = [];
      for (let index = 0; index < connections && nextOffset < options.totalBytes; index += 1) {
        const start = nextOffset; const end = Math.min(options.totalBytes - 1, start + segmentBytes - 1); nextOffset = end + 1;
        if (firstResponse) { const response = firstResponse; firstResponse = null; ranges.push({ start, end, promise: readRange(response, start, end) }); }
        else ranges.push({ start, end, promise: options.fetchImpl(options.url, { signal: options.signal, cache: 'no-store', headers: rangeHeaders(start, end) }).then((response) => readRange(response, start, end)) });
      }
      const buffers = await Promise.all(ranges.map((range) => range.promise));
      for (let index = 0; index < buffers.length; index += 1) {
        const buffer = buffers[index]; await handle.write(buffer); hash.update(buffer); offset += buffer.length; options.onProgress?.(offset, 'parallel');
      }
    }
  } finally { await handle.close(); }
  if (offset !== options.totalBytes) throw new Error(`Kiwix download size mismatch: expected ${options.totalBytes}, received ${offset}.`);
  return { sha256: hash.digest('hex').toUpperCase(), connections };
}

function validateHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(value)) throw new Error('Kiwix package hash is invalid.');
  return value.toUpperCase();
}

export function validateKiwixPackagePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) throw new Error(`Kiwix package path is invalid: ${relativePath}`);
  const segments = relativePath.split('/');
  if (segments.length !== 1 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Kiwix package path is not a root file: ${relativePath}`);
  }
  return relativePath;
}

function parseFile(value: unknown): PackageFile {
  if (!value || typeof value !== 'object') throw new Error('Kiwix package file metadata is invalid.');
  const file = value as Partial<PackageFile>;
  if (typeof file.path !== 'string' || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error('Kiwix package file metadata is invalid.');
  }
  return { path: validateKiwixPackagePath(file.path), size: file.size, sha256: validateHash(file.sha256) };
}

function parseDownload(value: unknown): DownloadFile {
  const file = parseFile(value);
  const candidate = value as Partial<DownloadFile>;
  if (typeof candidate.url !== 'string') throw new Error('Kiwix download URL is invalid.');
  const url = new URL(candidate.url);
  if (url.protocol !== 'https:' || !['download.kiwix.org', 'raw.githubusercontent.com'].includes(url.hostname)) {
    throw new Error('Kiwix download host is not allowed.');
  }
  return { ...file, url: url.toString() };
}

export function verifyKiwixPackage(raw: unknown, publicKey = MODULE_PACKAGE_PUBLIC_KEY): KiwixManifest {
  if (!raw || typeof raw !== 'object') throw new Error('Kiwix package envelope is invalid.');
  const envelope = raw as { schemaVersion?: unknown; signedPayload?: unknown; signature?: unknown };
  if (envelope.schemaVersion !== 1 || typeof envelope.signedPayload !== 'string' || typeof envelope.signature !== 'string') {
    throw new Error('Kiwix package envelope is invalid.');
  }
  const signedPayload = Buffer.from(envelope.signedPayload, 'base64');
  if (!crypto.verify(null, signedPayload, publicKey, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Kiwix package signature verification failed.');
  }
  const rawManifest = JSON.parse(signedPayload.toString('utf8')) as Partial<KiwixManifest>;
  if (rawManifest.schemaVersion !== 1 || rawManifest.id !== 'library-engine' || typeof rawManifest.name !== 'string'
    || typeof rawManifest.version !== 'string' || rawManifest.platform !== 'win32' || rawManifest.architecture !== 'x64'
    || rawManifest.networkPolicy !== 'loopback-only' || rawManifest.ownedDirectory !== 'Modules/Installed/kiwix-engine'
    || rawManifest.sharedContentDirectory !== 'Content/ZIM' || rawManifest.executable !== 'kiwix-serve.exe'
    || typeof rawManifest.license !== 'string' || !Array.isArray(rawManifest.files) || !rawManifest.archive || !rawManifest.sampleContent) {
    throw new Error('Signed Kiwix package manifest is invalid.');
  }
  const files = rawManifest.files.map(parseFile);
  if (new Set(files.map((file) => file.path.toLowerCase())).size !== files.length
    || !files.some((file) => file.path.toLowerCase() === 'kiwix-serve.exe')) {
    throw new Error('Kiwix package file list is incomplete or duplicated.');
  }
  const sample = parseDownload(rawManifest.sampleContent);
  if (typeof rawManifest.sampleContent.title !== 'string' || sample.path !== 'openzim-small.zim') throw new Error('Kiwix sample metadata is invalid.');
  return {
    schemaVersion: 1, id: 'library-engine', name: rawManifest.name, version: rawManifest.version,
    platform: 'win32', architecture: 'x64', license: rawManifest.license, networkPolicy: 'loopback-only',
    ownedDirectory: 'Modules/Installed/kiwix-engine', sharedContentDirectory: 'Content/ZIM', executable: 'kiwix-serve.exe',
    archive: parseDownload(rawManifest.archive), files, sampleContent: { ...sample, title: rawManifest.sampleContent.title },
  };
}

function run(command: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Process timed out: ${path.basename(command)}`)); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} failed with code ${code ?? 'unknown'}: ${stderr || stdout}`));
    });
  });
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate a loopback port.')); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

export class KiwixService {
  private active: ActiveKiwix | null = null;
  private startPromise: Promise<{ ok: boolean; message: string }> | null = null;
  private lastError: string | null = null;
  private catalog = new Map<string, CatalogRecord>();
  private catalogFetchedAt: string | null = null;
  private catalogOptions: KiwixCatalogOptionsResult | null = null;
  private downloadAbort: AbortController | null = null;
  private currentDownload: KiwixDownloadStatus = { state: 'idle', downloadedBytes: 0, totalBytes: 0, message: 'No Kiwix download is active.' };

  constructor(
    private readonly database: DatabaseService,
    private readonly paths: PortablePathService,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly packageEnvelope: unknown = KIWIX_PACKAGE,
    private readonly verificationKey: string = MODULE_PACKAGE_PUBLIC_KEY,
  ) {}

  private manifest(): KiwixManifest { return verifyKiwixPackage(this.packageEnvelope, this.verificationKey); }

  summary(): ModuleSummary {
    const record = this.database.moduleRecords().find((candidate) => candidate.moduleId === 'library-engine');
    return {
      id: 'library-engine', name: 'Offline Library Engine',
      description: 'Kiwix-powered ZIM browsing, contained on this drive and served only over loopback.',
      status: this.active ? 'running' : this.lastError ? 'error' : record ? 'installed' : 'available', optional: true,
      version: record?.version ?? this.manifest().version, pid: this.active?.pid, port: this.active?.port,
      startedAt: this.active?.startedAt, health: this.active ? 'healthy' : this.lastError ? 'unhealthy' : 'stopped',
      logPath: this.paths.resolve('Logs/Modules/library-engine.log'),
    };
  }

  scan(): ZimContentSummary[] {
    const root = this.paths.ensureDirectory('Content/ZIM');
    const content: ZimContentSummary[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(candidate);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zim')) {
          const relativePath = path.relative(this.paths.root, candidate).replace(/\\/g, '/');
          const stem = path.basename(entry.name, path.extname(entry.name));
          content.push({
            id: hashBuffer(Buffer.from(relativePath.toLowerCase())).slice(0, 16),
            name: stem.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
            fileName: entry.name,
            relativePath,
            size: fs.statSync(candidate).size,
          });
        }
      }
    };
    walk(root);
    return content.sort((left, right) => left.name.localeCompare(right.name));
  }

  status(): OfflineLibraryStatus {
    const record = this.database.moduleRecords().find((candidate) => candidate.moduleId === 'library-engine');
    return {
      engineInstalled: Boolean(record), engineVersion: record?.version ?? null, running: Boolean(this.active),
      pid: this.active?.pid, port: this.active?.port,
      serverUrl: this.active ? `http://127.0.0.1:${this.active.port}/` : undefined,
      content: this.scan(),
    };
  }

  async searchForAi(query: string, limit = 4): Promise<AiSource[]> {
    const queries = buildAiSearchQueries(query.trim().slice(0, 300)); const installed = this.scan();
    if (!queries.length || limit < 1 || !installed.length) return [];
    if (!this.active) { const started = await this.start(); if (!started.ok || !this.active) return []; }
    const base = new URL(`http://127.0.0.1:${this.active.port}/`);
    const groups = new Map<string, ZimContentSummary[]>();
    for (const content of installed) { const language = zimLanguage(content.fileName); groups.set(language, [...(groups.get(language) ?? []), content]); }
    const searchableGroups = [...groups.values()].sort((left, right) => right.length - left.length).slice(0, 3);
    const batches = await Promise.all(queries.flatMap((pattern) => searchableGroups.map(async (contents) => {
      try {
        const endpoint = new URL('/search', base); endpoint.searchParams.set('pattern', pattern); endpoint.searchParams.set('pageLength', String(Math.max(6, limit * 2))); endpoint.searchParams.set('format', 'xml');
        for (const content of contents) endpoint.searchParams.append('books.name', zimName(content.fileName));
        const response = await this.fetchImpl(endpoint, { signal: AbortSignal.timeout(5_000) }); if (!response.ok) return [];
        return parseKiwixSearchXml(await response.text());
      } catch { return []; /* A ZIM or language group may not contain a full-text index. */ }
    })));
    const byName = new Map(installed.map((content) => [zimName(content.fileName), content.name]));
    const terms = queries.flatMap((value) => value.split(' '));
    const originalTerms = documentSearchTerms(query); const requiredCoverage = Math.min(2, originalTerms.length);
    const unique = new Map<string, { title: string; link: string; excerpt: string; library: string; score: number; coverage: number }>();
    for (const candidate of batches.flat()) {
      if (unique.has(candidate.link)) continue;
      const name = decodeURIComponent(candidate.link.match(/^\/content\/([^/]+)/)?.[1] ?? '');
      const haystack = `${candidate.title} ${candidate.excerpt}`.toLocaleLowerCase(); const title = candidate.title.toLocaleLowerCase();
      const matched = [...new Set(terms.filter((term) => haystack.includes(term)))];
      const score = matched.reduce((total, term) => total + (title.includes(term) ? 8 : 1), 0);
      unique.set(candidate.link, { ...candidate, library: byName.get(name) ?? 'Installed library', score, coverage: matched.length });
    }
    const candidates = [...unique.values()].filter((candidate) => candidate.coverage >= requiredCoverage).sort((left, right) => right.score - left.score).slice(0, limit);
    const sources = await Promise.all(candidates.map(async (candidate): Promise<AiSource | null> => {
      let excerpt = candidate.excerpt;
      try {
        const article = new URL(candidate.link, base); if (article.origin === base.origin) {
          const response = await this.fetchImpl(article, { signal: AbortSignal.timeout(2_500) });
          if (response.ok && (response.headers.get('content-type') ?? '').includes('text/html')) excerpt = plainKiwixText(await response.text()).slice(0, 3500) || excerpt;
        }
      } catch { /* Search snippet remains useful when an article cannot be expanded. */ }
      const target = new URL(candidate.link, base);
      const articlePath = target.origin === base.origin && target.pathname.startsWith('/content/') ? `${target.pathname}${target.search}${target.hash}` : undefined;
      return excerpt ? { id: crypto.createHash('sha256').update(`${candidate.library}\0${candidate.link}`).digest('hex').slice(0, 16), kind: 'kiwix', title: candidate.title, location: `Kiwix · ${candidate.library}`, excerpt: excerpt.slice(0, 3500), articlePath } : null;
    }));
    return sources.filter((source): source is AiSource => source !== null);
  }

  async removeContent(contentId: string): Promise<LibraryOperationResult> {
    if (!/^[A-F0-9]{16}$/i.test(contentId)) return this.result(false, 'Library content identifier is invalid.');
    const content = this.scan().find((item) => item.id.toLowerCase() === contentId.toLowerCase());
    if (!content) return this.result(false, 'That offline library is no longer present on this drive.');
    const wasRunning = Boolean(this.active);
    if (wasRunning) await this.stop(true);
    try {
      fs.rmSync(this.paths.resolve(content.relativePath), { force: false });
    } catch (error) {
      if (wasRunning) await this.start();
      return this.result(false, error instanceof Error ? `Could not remove ${content.name}: ${error.message}` : `Could not remove ${content.name}.`);
    }
    const remaining = this.scan();
    if (wasRunning && remaining.length) {
      const restarted = await this.start();
      if (!restarted.ok) return this.result(true, `${content.name} was removed, but the offline reader could not restart: ${restarted.message}`);
    }
    return this.result(true, `${content.name} was removed from this drive and freed ${content.size.toLocaleString()} bytes.`);
  }

  private result(ok: boolean, message: string): LibraryOperationResult { return { ok, message, status: this.status() }; }

  async fetchCatalogOptions(): Promise<KiwixCatalogOptionsResult> {
    if (this.catalogOptions?.ok) return this.catalogOptions;
    try {
      const [languageResponse, categoryResponse] = await Promise.all([
        this.fetchImpl('https://library.kiwix.org/catalog/v2/languages', { signal: AbortSignal.timeout(30_000), cache: 'no-store', headers: { Accept: 'application/atom+xml', 'User-Agent': 'Outpost-Zero-Kiwix' } }),
        this.fetchImpl('https://library.kiwix.org/catalog/v2/categories', { signal: AbortSignal.timeout(30_000), cache: 'no-store', headers: { Accept: 'application/atom+xml', 'User-Agent': 'Outpost-Zero-Kiwix' } }),
      ]);
      if (!languageResponse.ok || !categoryResponse.ok) throw new Error(`Kiwix catalog navigation returned HTTP ${languageResponse.ok ? categoryResponse.status : languageResponse.status}.`);
      const [languageXml, categoryXml] = await Promise.all([languageResponse.text(), categoryResponse.text()]);
      const languages = parseKiwixNavigation(languageXml, 'language');
      const categories = parseKiwixNavigation(categoryXml, 'category');
      if (!languages.length || !categories.length) throw new Error('Kiwix catalog navigation is empty.');
      this.catalogOptions = { ok: true, message: `${languages.length} languages and ${categories.length} content categories available.`, languages, categories };
    } catch (error) {
      this.catalogOptions = { ok: false, message: error instanceof Error ? error.message : 'Could not load Kiwix catalog choices.', languages: [], categories: [] };
    }
    return this.catalogOptions;
  }

  async fetchCatalog(query = '', language = 'eng', category = 'wikipedia', startIndex = 0): Promise<KiwixCatalogResult> {
    try {
      const cleanQuery = query.trim().slice(0, 80);
      const cleanLanguage = /^[a-z]{3}$/i.test(language.trim()) ? language.trim().toLowerCase() : 'eng';
      const cleanCategory = /^[A-Za-z0-9_-]{1,64}$/.test(category.trim()) ? category.trim() : 'wikipedia';
      const cleanStart = Number.isSafeInteger(startIndex) ? Math.max(0, startIndex) : 0;
      const endpoint = new URL('https://library.kiwix.org/catalog/v2/entries');
      endpoint.searchParams.set('count', '48');
      endpoint.searchParams.set('start', String(cleanStart));
      endpoint.searchParams.set('lang', cleanLanguage);
      endpoint.searchParams.set('category', cleanCategory);
      if (cleanQuery) endpoint.searchParams.set('q', cleanQuery);
      const response = await this.fetchImpl(endpoint, { signal: AbortSignal.timeout(30_000), cache: 'no-store', headers: { Accept: 'application/atom+xml', 'User-Agent': 'Outpost-Zero-Kiwix' } });
      if (!response.ok) throw new Error(`Kiwix catalog returned HTTP ${response.status}.`);
      const parsed = parseKiwixCatalogFeed(await response.text());
      const records = parsed.entries;
      const installed = new Set(this.scan().map((item) => item.fileName.toLowerCase()));
      this.catalog.clear();
      for (const record of records) this.catalog.set(record.id, { ...record, installed: installed.has(record.fileName.toLowerCase()) });
      this.catalogFetchedAt = new Date().toISOString();
      let freeBytes: number | null = null;
      try { const disk = fs.statfsSync(this.paths.root); freeBytes = disk.bavail * disk.bsize; } catch { /* Drive capacity can be unavailable. */ }
      return { ok: true, message: records.length ? `${parsed.totalResults} current Kiwix editions match these choices.` : 'No current Kiwix editions match these choices.', fetchedAt: this.catalogFetchedAt, entries: [...this.catalog.values()].map(({ meta4Url: _, ...entry }) => entry), freeBytes, totalResults: parsed.totalResults, startIndex: parsed.startIndex, itemsPerPage: parsed.itemsPerPage };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Could not load the Kiwix catalog.', fetchedAt: this.catalogFetchedAt, entries: [], freeBytes: null, totalResults: 0, startIndex: 0, itemsPerPage: 48 };
    }
  }

  downloadStatus(): KiwixDownloadStatus { return { ...this.currentDownload }; }

  cancelDownload(): KiwixDownloadStatus {
    if (this.downloadAbort) {
      this.currentDownload = { ...this.currentDownload, state: 'cancelled', message: 'Download paused. Its partial file was kept for resume.' };
      this.downloadAbort.abort();
    }
    return this.downloadStatus();
  }

  async downloadCatalogEntry(entryId: string): Promise<LibraryOperationResult> {
    const entry = this.catalog.get(entryId);
    if (!entry) return this.result(false, 'Refresh the Kiwix catalog and choose an available archive.');
    if (this.downloadAbort) return this.result(false, 'Another Kiwix download is already active.');
    const controller = new AbortController();
    this.downloadAbort = controller;
    this.currentDownload = { state: 'downloading', entryId, title: entry.title, fileName: entry.fileName, downloadedBytes: 0, totalBytes: entry.downloadBytes, message: 'Loading verified download metadata...' };
    try {
      const metadataResponse = await this.fetchImpl(entry.meta4Url, { signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/metalink4+xml', 'User-Agent': 'Outpost-Zero-Kiwix' } });
      if (!metadataResponse.ok) throw new Error(`Kiwix metadata returned HTTP ${metadataResponse.status}.`);
      const metadata = parseKiwixMetalink(await metadataResponse.text(), entry.meta4Url);
      if (metadata.fileName !== entry.fileName) throw new Error('Kiwix catalog filename does not match its download metadata.');
      let destination = this.paths.resolve(`Content/ZIM/${metadata.fileName}`);
      if (fs.existsSync(destination) && fs.statSync(destination).size === metadata.size && await hashFile(destination) === metadata.sha256) {
        entry.installed = true;
        this.currentDownload = { ...this.currentDownload, state: 'complete', downloadedBytes: metadata.size, totalBytes: metadata.size, message: `${entry.title} is already installed and verified.` };
        return this.result(true, this.currentDownload.message);
      }
      if (fs.existsSync(destination)) {
        const stem = path.basename(metadata.fileName, '.zim');
        destination = this.paths.resolve(`Content/ZIM/${stem}-verified-${metadata.sha256.slice(0, 8).toLowerCase()}.zim`);
        if (fs.existsSync(destination) && fs.statSync(destination).size === metadata.size && await hashFile(destination) === metadata.sha256) {
          entry.installed = true;
          this.currentDownload = { ...this.currentDownload, state: 'complete', downloadedBytes: metadata.size, totalBytes: metadata.size, message: `${entry.title} is already installed and verified. The same-named user file was kept.` };
          return this.result(true, this.currentDownload.message);
        }
      }
      const stagingRoot = this.paths.ensureDirectory('Downloads/Kiwix');
      const partial = path.join(stagingRoot, `${metadata.fileName}.part`);
      let offset = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
      if (offset > metadata.size) { fs.rmSync(partial, { force: true }); offset = 0; }
      try {
        const disk = fs.statfsSync(this.paths.root);
        if (disk.bavail * disk.bsize < metadata.size - offset + 64 * 1024 * 1024) throw new Error(`Not enough free space. This download needs ${metadata.size - offset} more bytes plus a safety margin.`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Not enough free space')) throw error;
      }
      this.currentDownload = {
        ...this.currentDownload,
        downloadedBytes: offset,
        totalBytes: metadata.size,
        verifiedBytes: offset ? 0 : undefined,
        message: offset
          ? 'Authenticating the saved portion before an accelerated resume...'
          : 'Starting an accelerated, authenticated download...',
      };
      const transfer = await downloadWithLiveSha256({
        fetchImpl: this.fetchImpl,
        url: metadata.downloadUrl,
        filePath: partial,
        totalBytes: metadata.size,
        offset,
        signal: controller.signal,
        connections: 3,
        onProgress: (processedBytes, mode) => {
          if (mode === 'resume-hash') {
            this.currentDownload = {
              ...this.currentDownload,
              downloadedBytes: offset,
              verifiedBytes: processedBytes,
              message: 'Authenticating the saved portion before an accelerated resume...',
            };
            return;
          }
          this.currentDownload = {
            ...this.currentDownload,
            state: 'downloading',
            downloadedBytes: processedBytes,
            verifiedBytes: processedBytes,
            message: mode === 'parallel'
              ? 'Downloading and authenticating live with up to 3 secure connections...'
              : 'Downloading and authenticating live with one secure connection...',
          };
        },
      });
      this.currentDownload = {
        ...this.currentDownload,
        state: 'verifying',
        downloadedBytes: metadata.size,
        verifiedBytes: metadata.size,
        message: 'Finalizing live SHA-256 authentication...',
      };
      if (transfer.sha256 !== metadata.sha256) throw new Error('Kiwix download failed SHA-256 verification. The partial file was kept for retry.');
      const wasRunning = Boolean(this.active);
      if (wasRunning) await this.stop(true);
      if (fs.existsSync(destination)) throw new Error('A different file appeared at the verified download destination. It was not overwritten.');
      fs.renameSync(partial, destination);
      entry.installed = true;
      if (wasRunning) await this.start();
      this.currentDownload = { ...this.currentDownload, state: 'complete', downloadedBytes: metadata.size, verifiedBytes: metadata.size, totalBytes: metadata.size, message: `${entry.title} downloaded and authenticated during transfer, then added to the offline library.` };
      return this.result(true, this.currentDownload.message);
    } catch (error) {
      if (controller.signal.aborted) {
        this.currentDownload = { ...this.currentDownload, state: 'cancelled', message: 'Download paused. Choose it again to resume.' };
        return this.result(false, this.currentDownload.message);
      }
      const message = error instanceof Error ? error.message : 'Kiwix content download failed.';
      this.currentDownload = { ...this.currentDownload, state: 'error', message };
      return this.result(false, message);
    } finally {
      if (this.downloadAbort === controller) this.downloadAbort = null;
    }
  }

  private async download(file: DownloadFile, destination: string): Promise<void> {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination) && fs.statSync(destination).size === file.size && await hashFile(destination) === file.sha256) return;
    const temporary = `${destination}.download`;
    try {
      const response = await this.fetchImpl(file.url, { signal: AbortSignal.timeout(300_000), cache: 'no-store', headers: { 'User-Agent': 'Outpost-Zero-Kiwix' } });
      if (!response.ok || !response.body) throw new Error(`Kiwix download returned HTTP ${response.status}.`);
      await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(temporary));
      if (fs.statSync(temporary).size !== file.size || await hashFile(temporary) !== file.sha256) throw new Error(`Downloaded Kiwix file failed verification: ${file.path}`);
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  async install(): Promise<{ ok: boolean; message: string }> {
    const manifest = this.manifest();
    if (process.platform !== manifest.platform || process.arch !== manifest.architecture) return { ok: false, message: 'This Kiwix engine package supports Windows x64 only.' };
    const packagePath = this.paths.resolve(`Modules/Packages/${manifest.archive.path}`);
    const target = this.paths.resolve('Modules/Installed/kiwix-engine');
    let staging: string | undefined;
    let rollback: string | undefined;
    let placed = false;
    try {
      const installBytes = manifest.archive.size + manifest.files.reduce((sum, file) => sum + file.size, 0) + 50 * 1024 * 1024;
      try {
        const disk = fs.statfsSync(this.paths.root);
        if (disk.bavail * disk.bsize < installBytes) throw new Error(`Kiwix installation requires at least ${Math.ceil(installBytes / 1024 / 1024)} MB free.`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Kiwix installation requires')) throw error;
      }
      await this.stop(true);
      await this.download(manifest.archive, packagePath);
      staging = this.paths.resolve(`Modules/Staging/kiwix-engine-${crypto.randomUUID()}`);
      fs.mkdirSync(staging, { recursive: true });
      const extractor = this.paths.resolve('resources/Extract_Kiwix.ps1');
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', extractor,
        '-PortableRoot', this.paths.root, '-ArchivePath', packagePath, '-StagingRoot', staging], this.paths.root, 120_000);
      const stagedFiles = fs.readdirSync(staging, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
      const expectedFiles = manifest.files.map((file) => file.path).sort();
      if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) throw new Error('Extracted Kiwix package contains unexpected files.');
      for (const file of manifest.files) {
        const staged = path.join(staging, file.path);
        if (fs.statSync(staged).size !== file.size || await hashFile(staged) !== file.sha256) throw new Error(`Extracted Kiwix file failed verification: ${file.path}`);
      }
      if (fs.existsSync(target)) {
        rollback = this.paths.resolve(`Modules/Staging/kiwix-engine-rollback-${crypto.randomUUID()}`);
        fs.renameSync(target, rollback);
      }
      fs.renameSync(staging, target);
      placed = true;
      staging = undefined;
      const version = await run(path.join(target, manifest.executable), ['--version'], target);
      if (!`${version.stdout}\n${version.stderr}`.includes(`kiwix-tools ${manifest.version}`)) throw new Error('Installed Kiwix engine reported an unexpected version.');
      this.database.setModuleInstalled('library-engine', manifest.version);
      this.lastError = null;
      if (rollback && fs.existsSync(rollback)) fs.rmSync(rollback, { recursive: true, force: true });
      return { ok: true, message: `Kiwix Tools ${manifest.version} installed and verified on this drive.` };
    } catch (error) {
      if (placed && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      if (rollback && fs.existsSync(rollback)) fs.renameSync(rollback, target);
      if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : 'Kiwix installation failed.';
      this.lastError = message;
      return { ok: false, message };
    }
  }

  repair(): Promise<{ ok: boolean; message: string }> { return this.install(); }

  async installSample(): Promise<LibraryOperationResult> {
    try {
      const sample = this.manifest().sampleContent;
      let destination = this.paths.resolve(`Content/ZIM/${sample.path}`);
      if (fs.existsSync(destination) && fs.statSync(destination).size === sample.size && await hashFile(destination) === sample.sha256) {
        return this.result(true, `${sample.title} is already installed and verified.`);
      }
      if (fs.existsSync(destination) && (fs.statSync(destination).size !== sample.size || await hashFile(destination) !== sample.sha256)) {
        destination = this.paths.resolve(`Content/ZIM/openzim-small-${sample.sha256.slice(0, 8).toLowerCase()}.zim`);
      }
      const staged = this.paths.resolve(`Downloads/${path.basename(destination)}.staging`);
      await this.download(sample, staged);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (!fs.existsSync(destination)) fs.renameSync(staged, destination);
      else if (fs.existsSync(staged)) fs.rmSync(staged, { force: true });
      return this.result(true, `${sample.title} downloaded and verified.`);
    } catch (error) {
      return this.result(false, error instanceof Error ? error.message : 'Sample ZIM download failed.');
    }
  }

  async start(): Promise<{ ok: boolean; message: string }> {
    if (this.startPromise) return this.startPromise;
    const starting = this.startProcess();
    this.startPromise = starting;
    try { return await starting; }
    finally { if (this.startPromise === starting) this.startPromise = null; }
  }

  private async startProcess(): Promise<{ ok: boolean; message: string }> {
    if (this.active) return { ok: true, message: 'Offline Library Engine is already running.' };
    const record = this.database.moduleRecords().find((candidate) => candidate.moduleId === 'library-engine');
    if (!record) return { ok: false, message: 'Install the Offline Library Engine first.' };
    const content = this.scan();
    if (content.length === 0) return { ok: false, message: 'Add at least one ZIM file to Content/ZIM before starting Kiwix.' };
    const executable = this.paths.resolve('Modules/Installed/kiwix-engine/kiwix-serve.exe');
    if (!fs.existsSync(executable)) return { ok: false, message: 'Kiwix engine files are missing. Repair the module.' };
    const port = await availablePort();
    const logPath = this.paths.resolve('Logs/Modules/library-engine.log');
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    const args = ['--address=127.0.0.1', `--port=${port}`, '--blockexternal', '--threads=8', `--attachToProcess=${process.pid}`,
      ...content.map((item) => this.paths.resolve(item.relativePath))];
    const child = spawn(executable, args, {
      cwd: path.dirname(executable), shell: false, windowsHide: true,
      env: { ...process.env, TEMP: this.paths.resolve('Temp'), TMP: this.paths.resolve('Temp'), TMPDIR: this.paths.resolve('Temp') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!child.pid) return { ok: false, message: 'Kiwix process could not be created.' };
    const entry: ActiveKiwix = { child, pid: child.pid, port, startedAt: new Date().toISOString(), stopping: false };
    this.active = entry;
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once('exit', (code) => {
      log.end(`${new Date().toISOString()} Kiwix exited with code ${code ?? 'unknown'}\n`);
      if (this.active === entry) this.active = null;
      if (!entry.stopping) this.lastError = `Kiwix exited unexpectedly with code ${code ?? 'unknown'}.`;
    });
    try {
      let ready = false;
      const startupDeadline = Date.now() + 90_000;
      while (Date.now() < startupDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (child.exitCode !== null) break;
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000), cache: 'no-store' });
          if (response.ok) { ready = true; break; }
        } catch { /* Continue polling until startup deadline. */ }
      }
      if (!ready) throw new Error('Kiwix did not become healthy on loopback within 90 seconds. Check the module log or repair the engine.');
      this.lastError = null;
      return { ok: true, message: `Kiwix is serving ${content.length} ZIM file${content.length === 1 ? '' : 's'} on 127.0.0.1:${port}.` };
    } catch (error) {
      await this.stop(true);
      const message = error instanceof Error ? error.message : 'Kiwix failed to start.';
      this.lastError = message;
      return { ok: false, message };
    }
  }

  async stop(quiet = false): Promise<{ ok: boolean; message: string }> {
    const entry = this.active;
    if (!entry) return { ok: true, message: quiet ? '' : 'Offline Library Engine is already stopped.' };
    entry.stopping = true;
    await new Promise<void>((resolve) => {
      let complete = false;
      const finish = () => { if (!complete) { complete = true; resolve(); } };
      const timeout = setTimeout(() => { if (entry.child.exitCode === null) entry.child.kill(); finish(); }, 4000);
      entry.child.once('exit', () => { clearTimeout(timeout); finish(); });
      entry.child.kill();
    });
    if (this.active === entry) this.active = null;
    if (!quiet) this.lastError = null;
    return { ok: true, message: quiet ? '' : 'Offline Library Engine stopped.' };
  }

  async shutdown(): Promise<void> {
    this.cancelDownload();
    await this.stop(true);
  }

  async uninstall(): Promise<{ ok: boolean; message: string }> {
    await this.stop(true);
    const manifest = this.manifest();
    const target = this.paths.resolve('Modules/Installed/kiwix-engine');
    const archive = this.paths.resolve(`Modules/Packages/${manifest.archive.path}`);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
    this.database.removeModule('library-engine');
    this.lastError = null;
    return { ok: true, message: 'Kiwix engine removed. All ZIM libraries in Content/ZIM were kept.' };
  }

  hasRunningProcess(): boolean { return Boolean(this.active); }
}
