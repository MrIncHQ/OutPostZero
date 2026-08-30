import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import type {
  NatureCatalogEntry, NatureDownloadStatus, NatureOperationResult, NaturePackManifest, NaturePackSummary,
  NatureSightingInput, NatureSpeciesDetails, NatureSpeciesSummary, NatureState,
} from '../shared/contracts';
import type { DatabaseService } from './database-service';
import type { PortablePathService } from './portable-path';
import { UPDATE_PUBLIC_KEY } from './update-trust';

const PACK_SCHEMA_VERSION = 1;
const MAX_QUERY_TOKENS = 12;
const MAX_PACK_BYTES = 64 * 1024 * 1024 * 1024;
const CATALOG_URL = 'https://raw.githubusercontent.com/MrIncHQ/OutPostZero/main/Nature/catalog.json';

interface NatureCatalogPayload { schemaVersion: 1; publishedAt: string; entries: NatureCatalogEntry[] }

function catalogEntry(raw: unknown): NatureCatalogEntry | null {
  const item = raw as Partial<NatureCatalogEntry>;
  if (!item || typeof item.id !== 'string' || !['pack', 'model'].includes(String(item.kind)) || typeof item.name !== 'string'
    || typeof item.version !== 'string' || typeof item.url !== 'string' || !/^https:\/\//i.test(item.url)
    || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(item.sha256)
    || !Number.isSafeInteger(item.downloadBytes) || Number(item.downloadBytes) <= 0
    || !Number.isSafeInteger(item.installedBytes) || Number(item.installedBytes) <= 0 || typeof item.description !== 'string'
    || (item.archive !== undefined && !['oznature', 'zip'].includes(item.archive))) return null;
  try { safeId(item.id); return item as NatureCatalogEntry; } catch { return null; }
}

export function verifyNatureCatalog(raw: unknown, verificationKey = UPDATE_PUBLIC_KEY): NatureCatalogPayload {
  const envelope = raw as { schemaVersion?: unknown; signedPayload?: unknown; signature?: unknown };
  if (!envelope || envelope.schemaVersion !== 1 || typeof envelope.signedPayload !== 'string' || typeof envelope.signature !== 'string') throw new Error('Nature catalog envelope is invalid.');
  const signed = Buffer.from(envelope.signedPayload, 'base64');
  if (!crypto.verify(null, signed, verificationKey, Buffer.from(envelope.signature, 'base64'))) throw new Error('Nature catalog signature verification failed.');
  const payload = JSON.parse(signed.toString('utf8')) as Partial<NatureCatalogPayload>;
  if (payload.schemaVersion !== 1 || typeof payload.publishedAt !== 'string' || !Number.isFinite(Date.parse(payload.publishedAt)) || !Array.isArray(payload.entries)) throw new Error('Nature catalog payload is invalid.');
  const entries = payload.entries.map(catalogEntry);
  if (entries.some((entry) => !entry) || new Set(entries.map((entry) => entry!.id)).size !== entries.length) throw new Error('Nature catalog contains an invalid or duplicate entry.');
  return { schemaVersion: 1, publishedAt: payload.publishedAt, entries: entries as NatureCatalogEntry[] };
}

function run(file: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }); let error = '';
    child.stderr.on('data', (chunk) => { error += String(chunk); }); child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(error.trim() || `${file} exited with code ${code ?? 'unknown'}.`)));
  });
}

function safeId(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(value)) throw new Error('Nature identifier is invalid.');
  return value;
}

function searchExpression(query: string): string | null {
  const tokens = query.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, MAX_QUERY_TOKENS) ?? [];
  return tokens.length ? tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ') : null;
}

function readManifest(db: DatabaseSync): NaturePackManifest {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pack_metadata'").get();
  if (!table) throw new Error('Nature Pack does not contain pack_metadata.');
  const row = db.prepare("SELECT value FROM pack_metadata WHERE key = 'manifest'").get() as { value?: unknown } | undefined;
  if (!row || typeof row.value !== 'string') throw new Error('Nature Pack manifest is missing.');
  const value = JSON.parse(row.value) as Partial<NaturePackManifest>;
  if (value.schemaVersion !== PACK_SCHEMA_VERSION || typeof value.packId !== 'string' || typeof value.name !== 'string'
    || typeof value.region !== 'string' || typeof value.version !== 'string' || typeof value.buildDate !== 'string'
    || !Number.isSafeInteger(value.downloadBytes) || Number(value.downloadBytes) < 0 || !Number.isSafeInteger(value.installedBytes) || Number(value.installedBytes) < 0
    || !Number.isSafeInteger(value.speciesCount) || Number(value.speciesCount) < 0 || !Number.isSafeInteger(value.imageCount) || Number(value.imageCount) < 0
    || !Array.isArray(value.categories) || !Array.isArray(value.licenseSummary) || !Array.isArray(value.dependencies)
    || !value.sourceVersions || typeof value.sourceVersions !== 'object') throw new Error('Nature Pack manifest is invalid or incompatible.');
  safeId(value.packId);
  return value as NaturePackManifest;
}

function requiredSchema(db: DatabaseSync): void {
  const required = ['species', 'species_names', 'species_distribution', 'species_images', 'species_fts'];
  const existing = new Set((db.prepare("SELECT name FROM sqlite_master WHERE name IN ('species','species_names','species_distribution','species_images','species_fts')").all() as Array<{ name: string }>).map((row) => row.name));
  for (const table of required) if (!existing.has(table)) throw new Error(`Nature Pack is missing ${table}.`);
  const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
  if (integrity.integrity_check !== 'ok') throw new Error('Nature Pack database failed its integrity check.');
}

function validatePack(db: DatabaseSync): NaturePackManifest {
  requiredSchema(db); const manifest = readManifest(db);
  const species = Number((db.prepare('SELECT count(*) count FROM species').get() as { count: number | bigint }).count);
  const images = Number((db.prepare('SELECT count(*) count FROM species_images').get() as { count: number | bigint }).count);
  if (species !== manifest.speciesCount || images !== manifest.imageCount) throw new Error('Nature Pack manifest counts do not match its database.');
  const unattributed = Number((db.prepare("SELECT count(*) count FROM species_images WHERE trim(creator) = '' OR trim(source_url) = '' OR trim(license) = '' OR trim(license_url) = ''").get() as { count: number | bigint }).count);
  if (unattributed) throw new Error('Nature Pack contains images without complete attribution.');
  return manifest;
}

export function validateNaturePackFile(filePath: string): NaturePackManifest {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try { return validatePack(db); } finally { db.close(); }
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 })) hash.update(chunk);
  return hash.digest('hex');
}

export class NatureService {
  private abort?: AbortController;
  private downloadDisposition: 'pause' | 'cancel' | null = null;
  private installWorker?: Worker;
  private queryWorker?: Worker;
  private querySequence = 0;
  private readonly queryRequests = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private recoveredDownload = false;
  private recoveredInstallArtifacts = false;
  private download: NatureDownloadStatus = { state: 'idle', downloadedBytes: 0, totalBytes: 0, percent: 0, bytesPerSecond: 0, message: 'No Nature download is active.' };

  constructor(private readonly database: DatabaseService, private readonly paths: PortablePathService, private readonly fetchImpl: typeof fetch = fetch,
    private readonly catalogVerificationKey: string = UPDATE_PUBLIC_KEY, private readonly catalogUrl = CATALOG_URL) {}

  private catalog(): NatureCatalogEntry[] {
    const entries = new Map<string, NatureCatalogEntry>();
    const cached = this.paths.resolve('Cache/Nature/catalog.json');
    if (fs.existsSync(cached)) try { for (const item of verifyNatureCatalog(JSON.parse(fs.readFileSync(cached, 'utf8')), this.catalogVerificationKey).entries) entries.set(item.id, item); } catch { /* Ignore damaged cache and allow an online refresh. */ }
    const local = this.paths.resolve('Config/nature-catalog.json');
    if (fs.existsSync(local)) try { const parsed = JSON.parse(fs.readFileSync(local, 'utf8')) as { entries?: unknown[] }; for (const raw of parsed.entries ?? []) { const item = catalogEntry(raw); if (item) entries.set(item.id, item); } } catch { /* Operator catalog is optional. */ }
    return [...entries.values()];
  }

  async refreshCatalog(): Promise<NatureOperationResult> {
    try {
      const response = await this.fetchImpl(this.catalogUrl, { cache: 'no-store', signal: AbortSignal.timeout(30_000), headers: { Accept: 'application/json', 'User-Agent': 'Outpost-Zero-Nature' } });
      if (!response.ok) throw new Error(`Nature catalog returned HTTP ${response.status}.`);
      const raw = await response.json(); const payload = verifyNatureCatalog(raw, this.catalogVerificationKey);
      const target = this.paths.resolve('Cache/Nature/catalog.json'); fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(raw, null, 2)}\n`, 'utf8'); fs.rmSync(target, { force: true }); fs.renameSync(temporary, target);
      return { ok: true, message: `${payload.entries.length} verified Nature download${payload.entries.length === 1 ? '' : 's'} available.`, state: this.state() };
    } catch (error) {
      const state = this.state(); const cached = state.catalog.length > 0;
      return { ok: cached, message: cached ? 'Using the last verified Nature catalog while offline.' : error instanceof Error ? error.message : 'Nature catalog could not be loaded.', state };
    }
  }

  private installedPacks(): NaturePackSummary[] {
    return this.database.naturePackRecords().flatMap((record) => {
      const file = this.paths.resolve(record.relativePath); if (!fs.existsSync(file)) return [];
      return [{ ...record.manifest, relativePath: record.relativePath, installed: true }];
    });
  }

  state(): NatureState {
    if (!this.recoveredDownload) {
      this.recoveredDownload = true;
      for (const entry of this.catalog()) {
        const partial = this.paths.resolve(`Downloads/Nature-${entry.id}.download`);
        if (!fs.existsSync(partial)) continue;
        const downloadedBytes = Math.min(fs.statSync(partial).size, entry.downloadBytes);
        this.download = { state: 'paused', entryId: entry.id, title: entry.name, downloadedBytes, totalBytes: entry.downloadBytes,
          percent: entry.downloadBytes ? downloadedBytes / entry.downloadBytes * 100 : 0, bytesPerSecond: 0, message: 'Saved Nature download found. Select resume to continue.' };
        break;
      }
    }
    const models = fs.readdirSync(this.paths.ensureDirectory('AI/Nature/Models'), { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.onnx'));
    return { packs: this.installedPacks(), catalog: this.catalog(), sightings: this.database.natureSightings(),
      model: models.length ? { installed: true, name: path.basename(models[0].name, '.onnx'), message: 'A local Nature ID encoder is installed. Runtime validation is required before identification.' }
        : { installed: false, message: 'Install a verified Nature ID model to identify photographs offline.' }, download: { ...this.download } };
  }

  private startMaintenance(): void {
    if (this.recoveredInstallArtifacts) return;
    this.recoveredInstallArtifacts = true;
    void this.cleanInterruptedInstallArtifacts().catch(() => undefined);
  }

  private async cleanInterruptedInstallArtifacts(): Promise<void> {
    const packRoot = this.paths.ensureDirectory('Content/Nature/Packs');
    const stalePack = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\.oznature\.installing|\.installing-[0-9a-f-]{36}\.oznature)$/i;
    for (const entry of await fs.promises.readdir(packRoot, { withFileTypes: true })) {
      if (entry.isFile() && !entry.isSymbolicLink() && stalePack.test(entry.name)) await fs.promises.rm(path.join(packRoot, entry.name), { force: true });
    }
    const tempRoot = this.paths.ensureDirectory('Temp');
    for (const entry of await fs.promises.readdir(tempRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && /^NatureInstall-[0-9a-f-]{36}$/i.test(entry.name)) await fs.promises.rm(path.join(tempRoot, entry.name), { recursive: true, force: true });
    }
  }

  private packInput(packId: string): { packId: string; filePath: string } {
    safeId(packId); const record = this.database.naturePackRecords().find((item) => item.manifest.packId === packId);
    if (!record || !fs.existsSync(this.paths.resolve(record.relativePath))) throw new Error('Nature Pack is not installed.');
    return { packId, filePath: this.paths.resolve(record.relativePath) };
  }

  private selectedPackInputs(packIds?: string[]): Array<{ packId: string; filePath: string }> {
    const selected = new Set(packIds?.map(safeId));
    return this.installedPacks().filter((pack) => !selected.size || selected.has(pack.packId)).map((pack) => this.packInput(pack.packId));
  }

  private workerRequest<T>(message: Record<string, unknown>): Promise<T> {
    if (!this.queryWorker) {
      const compiledWorker = path.join(__dirname, 'nature-query-worker.js');
      const workerFile = fs.existsSync(compiledWorker) ? compiledWorker : path.join(__dirname, 'nature-query-worker.ts');
      const worker = new Worker(workerFile); this.queryWorker = worker;
      worker.on('message', (response: { id?: number; result?: unknown; error?: string }) => {
        if (typeof response.id !== 'number') return; const request = this.queryRequests.get(response.id); if (!request) return;
        this.queryRequests.delete(response.id); if (response.error) request.reject(new Error(response.error)); else request.resolve(response.result);
      });
      const fail = (error: Error) => {
        if (this.queryWorker === worker) this.queryWorker = undefined;
        for (const request of this.queryRequests.values()) request.reject(error); this.queryRequests.clear();
      };
      worker.once('error', fail); worker.once('exit', (code) => { if (code && this.queryWorker === worker) fail(new Error(`Nature database worker exited with code ${code}.`)); });
    }
    const id = ++this.querySequence;
    return new Promise<T>((resolve, reject) => { this.queryRequests.set(id, { resolve: resolve as (value: unknown) => void, reject }); this.queryWorker!.postMessage({ id, ...message }); });
  }

  reconcile(): NatureState {
    // Packs are fully validated and registered during installation. Page entry only
    // reconciles missing files; repeating PRAGMA integrity_check on multi-GB packs
    // would block Electron's main process and make Windows report Not Responding.
    this.startMaintenance();
    for (const record of this.database.naturePackRecords()) if (!fs.existsSync(this.paths.resolve(record.relativePath))) this.database.removeNaturePackRecord(record.manifest.packId);
    return this.state();
  }

  importPack(sourcePath: string): NatureOperationResult {
    const source = path.resolve(sourcePath); const stats = fs.statSync(source);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PACK_BYTES) throw new Error('Choose a valid Nature Pack file.');
    const sourceDb = new DatabaseSync(source, { readOnly: true }); let manifest: NaturePackManifest;
    try { manifest = validatePack(sourceDb); }
    finally { sourceDb.close(); }
    const prior = this.database.naturePackRecords().find((item) => item.manifest.packId === manifest.packId);
    const destination = this.paths.resolve(`Content/Nature/Packs/${safeId(manifest.packId)}-${safeId(manifest.version)}.oznature`);
    const temporary = `${destination}.installing`; fs.rmSync(temporary, { force: true }); fs.copyFileSync(source, temporary);
    const copied = new DatabaseSync(temporary, { readOnly: true });
    try { validatePack(copied); } finally { copied.close(); }
    fs.rmSync(destination, { force: true }); fs.renameSync(temporary, destination);
    const relativePath = path.relative(this.paths.root, destination).replaceAll('\\', '/');
    this.database.upsertNaturePack({ ...manifest, installedBytes: fs.statSync(destination).size }, relativePath);
    if (prior && prior.relativePath !== relativePath) fs.rmSync(this.paths.resolve(prior.relativePath), { force: true });
    return { ok: true, message: `${manifest.name} ${manifest.version} is installed and ready offline.`, state: this.state() };
  }

  async importPackAsync(sourcePath: string): Promise<NatureOperationResult> {
    const source = path.resolve(sourcePath); const stats = await fs.promises.stat(source);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_PACK_BYTES) throw new Error('Choose a valid Nature Pack file.');
    const temporary = this.paths.resolve(`Content/Nature/Packs/.installing-${crypto.randomUUID()}.oznature`);
    fs.mkdirSync(path.dirname(temporary), { recursive: true });
    try {
      const manifest = await new Promise<NaturePackManifest>((resolve, reject) => {
        const compiledWorker = path.join(__dirname, 'nature-install-worker.js');
        const workerFile = fs.existsSync(compiledWorker) ? compiledWorker : path.join(__dirname, 'nature-install-worker.ts');
        const worker = new Worker(workerFile, { workerData: { source, temporary } }); this.installWorker = worker;
        let settled = false;
        worker.on('message', (message: { type?: string; manifest?: NaturePackManifest; message?: string }) => {
          if (message.type === 'progress' && message.message && this.download.state === 'installing') this.download = { ...this.download, message: message.message };
          if (message.type === 'complete' && message.manifest && !settled) { settled = true; resolve(message.manifest); }
          if (message.type === 'error' && !settled) { settled = true; reject(new Error(message.message || 'Nature Pack installation failed.')); }
        });
        worker.once('error', (error) => { if (!settled) { settled = true; reject(error); } });
        worker.once('exit', (code) => { if (!settled) { settled = true; reject(new Error(`Nature Pack installer exited with code ${code}.`)); } });
      });
      const prior = this.database.naturePackRecords().find((item) => item.manifest.packId === manifest.packId);
      const destination = this.paths.resolve(`Content/Nature/Packs/${safeId(manifest.packId)}-${safeId(manifest.version)}.oznature`);
      await this.closeQueryPack(manifest.packId); fs.rmSync(destination, { force: true }); fs.renameSync(temporary, destination);
      const relativePath = path.relative(this.paths.root, destination).replaceAll('\\', '/');
      this.database.upsertNaturePack({ ...manifest, installedBytes: fs.statSync(destination).size }, relativePath);
      if (prior && prior.relativePath !== relativePath) fs.rmSync(this.paths.resolve(prior.relativePath), { force: true });
      return { ok: true, message: `${manifest.name} ${manifest.version} is installed and ready offline.`, state: this.state() };
    } finally { this.installWorker = undefined; fs.rmSync(temporary, { force: true }); }
  }

  async removePack(packId: string): Promise<NatureOperationResult> {
    safeId(packId); const record = this.database.naturePackRecords().find((item) => item.manifest.packId === packId);
    if (!record) return { ok: false, message: 'Nature Pack is not installed.', state: this.state() };
    await this.closeQueryPack(packId); fs.unlinkSync(this.paths.resolve(record.relativePath)); this.database.removeNaturePackRecord(packId);
    return { ok: true, message: `${record.manifest.name} was removed. Saved sightings were kept.`, state: this.state() };
  }

  async search(query: string, packIds?: string[], limit = 80): Promise<NatureSpeciesSummary[]> {
    const expression = searchExpression(query); if (!expression) return [];
    return this.workerRequest<NatureSpeciesSummary[]>({ operation: 'search', packs: this.selectedPackInputs(packIds), query: expression, category: query.trim(), limit });
  }

  async browse(category?: string, packIds?: string[], limit = 200): Promise<NatureSpeciesSummary[]> {
    return this.workerRequest<NatureSpeciesSummary[]>({ operation: 'browse', packs: this.selectedPackInputs(packIds), category: category ?? '', limit });
  }

  private async closeQueryPack(packId: string): Promise<void> {
    if (!this.queryWorker) return;
    await this.workerRequest<boolean>({ operation: 'close-pack', packId });
  }

  async species(packId: string, speciesId: string): Promise<NatureSpeciesDetails> {
    safeId(packId); if (!/^[\w.:-]{1,160}$/u.test(speciesId)) throw new Error('Species identifier is invalid.');
    return this.workerRequest<NatureSpeciesDetails>({ operation: 'species', pack: this.packInput(packId), speciesId });
  }

  async image(packId: string, imageId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    if (!/^[\w.:-]{1,160}$/u.test(imageId)) throw new Error('Nature image identifier is invalid.');
    return this.workerRequest<{ bytes: Uint8Array; mimeType: string }>({ operation: 'image', pack: this.packInput(packId), imageId });
  }

  saveSighting(input: NatureSightingInput): NatureState {
    if (!input || typeof input.observedAt !== 'string' || !Number.isFinite(Date.parse(input.observedAt)) || typeof input.commonName !== 'string' || input.commonName.length > 240
      || typeof input.scientificName !== 'string' || input.scientificName.length > 240 || typeof input.notes !== 'string' || input.notes.length > 20_000
      || (input.latitude !== undefined && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90))
      || (input.longitude !== undefined && (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180))) throw new Error('Nature sighting contains invalid data.');
    this.database.saveNatureSighting(input); return this.state();
  }
  deleteSighting(id: string): NatureState { if (!/^[\w-]{1,80}$/.test(id)) throw new Error('Sighting identifier is invalid.'); this.database.deleteNatureSighting(id); return this.state(); }

  async downloadContent(entryId: string): Promise<NatureOperationResult> {
    const entry = this.catalog().find((item) => item.id === entryId); if (!entry) throw new Error('Nature catalog entry is unavailable.');
    if (this.abort) return { ok: false, message: 'Another Nature download is active.', state: this.state() };
    const partial = this.paths.resolve(`Downloads/Nature-${safeId(entry.id)}.download`); let existing = fs.existsSync(partial) ? fs.statSync(partial).size : 0;
    if (existing > entry.downloadBytes) { fs.truncateSync(partial, 0); existing = 0; }
    const disk = fs.statfsSync(this.paths.root); if (disk.bavail * disk.bsize < Math.max(0, entry.downloadBytes - existing) + entry.installedBytes) throw new Error('Not enough free space for this Nature content.');
    this.abort = new AbortController(); this.downloadDisposition = null; const started = Date.now(); this.download = { state: 'downloading', entryId, title: entry.name, downloadedBytes: existing, totalBytes: entry.downloadBytes, percent: entry.downloadBytes ? existing / entry.downloadBytes * 100 : 0, bytesPerSecond: 0, message: existing ? 'Resuming Nature download...' : 'Downloading Nature content...' };
    try {
      if (existing < entry.downloadBytes) {
        let response = await this.fetchImpl(entry.url, { signal: this.abort.signal, headers: existing ? { Range: `bytes=${existing}-` } : undefined });
        if (response.status === 416 && existing) {
          fs.truncateSync(partial, 0); existing = 0;
          this.download = { ...this.download, downloadedBytes: 0, percent: 0, message: 'The server could not resume this file. Restarting its download safely...' };
          response = await this.fetchImpl(entry.url, { signal: this.abort.signal });
        }
        if (!response.ok || !response.body) throw new Error(`Nature download failed with HTTP ${response.status}.`);
        const append = existing > 0 && response.status === 206; if (!append && existing) { fs.truncateSync(partial, 0); existing = 0; }
        const writer = fs.createWriteStream(partial, { flags: append ? 'a' : 'w' }); const reader = response.body.getReader(); let downloaded = append ? existing : 0;
        try { while (true) { const chunk = await reader.read(); if (chunk.done) break; if (!chunk.value?.length) continue; await new Promise<void>((resolve, reject) => writer.write(Buffer.from(chunk.value), (error) => error ? reject(error) : resolve())); downloaded += chunk.value.length; const seconds = Math.max(.1, (Date.now() - started) / 1000); this.download = { ...this.download, downloadedBytes: downloaded, percent: entry.downloadBytes ? Math.min(100, downloaded / entry.downloadBytes * 100) : 0, bytesPerSecond: Math.max(0, downloaded / seconds) }; } }
        finally { await new Promise<void>((resolve) => writer.end(resolve)); }
      } else this.download = { ...this.download, message: 'Completed Nature download found. Verifying it now...' };
      this.download = { ...this.download, state: 'verifying', percent: 100, message: 'Verifying SHA-256 checksum...' };
      if ((await hashFile(partial)).toLowerCase() !== entry.sha256.toLowerCase()) throw new Error('Nature download failed SHA-256 verification.');
      this.download = { ...this.download, state: 'installing', message: 'Installing verified Nature content...' };
      if (entry.kind === 'pack') {
        if (entry.archive === 'zip') {
          const staging = this.paths.resolve(`Temp/NatureInstall-${crypto.randomUUID()}`); fs.mkdirSync(staging, { recursive: true });
          try {
            const listing: string[] = []; await new Promise<void>((resolve, reject) => { const child = spawn('tar', ['-tf', partial], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = ''; let error = ''; child.stdout.on('data', (chunk) => { output += String(chunk); }); child.stderr.on('data', (chunk) => { error += String(chunk); }); child.once('error', reject); child.once('exit', (code) => { if (code !== 0) reject(new Error(error.trim() || 'Nature archive could not be inspected.')); else { listing.push(...output.split(/\r?\n/).filter(Boolean)); resolve(); } }); });
            if (listing.length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.oznature$/i.test(listing[0])) throw new Error('Nature archive must contain exactly one safe .oznature file.');
            await run('tar', ['-xf', partial, '-C', staging, listing[0]], staging); await this.importPackAsync(path.join(staging, listing[0]));
          } finally { fs.rmSync(staging, { recursive: true, force: true }); }
        } else await this.importPackAsync(partial);
      } else { const target = this.paths.resolve(`AI/Nature/Models/${safeId(entry.id)}-${safeId(entry.version)}.onnx`); fs.copyFileSync(partial, `${target}.installing`); fs.renameSync(`${target}.installing`, target); }
      fs.unlinkSync(partial); this.download = { ...this.download, state: 'complete', message: `${entry.name} is installed and ready offline.` };
      return { ok: true, message: this.download.message, state: this.state() };
    } catch (error) {
      const disposition = this.downloadDisposition;
      if (disposition === 'cancel') fs.rmSync(partial, { force: true });
      this.download = { ...this.download, state: disposition === 'cancel' ? 'cancelled' : disposition === 'pause' ? 'paused' : 'error',
        message: disposition === 'cancel' ? 'Nature download cancelled and partial data removed.' : disposition === 'pause' ? 'Download paused. Select resume to continue.' : error instanceof Error ? error.message : 'Nature download failed.' };
      return { ok: false, message: this.download.message, state: this.state() };
    } finally { this.abort = undefined; }
  }

  pauseDownload(): NatureDownloadStatus { if (this.abort) { this.downloadDisposition = 'pause'; this.download = { ...this.download, state: 'paused', message: 'Pausing Nature download...' }; this.abort.abort(); } return { ...this.download }; }
  cancelDownload(): NatureDownloadStatus { if (this.abort) { this.downloadDisposition = 'cancel'; this.download = { ...this.download, state: 'cancelled', message: 'Cancelling Nature download...' }; this.abort.abort(); } else if (this.download.entryId) { fs.rmSync(this.paths.resolve(`Downloads/Nature-${safeId(this.download.entryId)}.download`), { force: true }); this.download = { ...this.download, state: 'cancelled', downloadedBytes: 0, percent: 0, message: 'Nature download cancelled and partial data removed.' }; } return { ...this.download }; }
  downloadStatus(): NatureDownloadStatus { return { ...this.download }; }
  hasActiveDownload(): boolean { return Boolean(this.abort); }
  close(): void { this.abort?.abort(); void this.installWorker?.terminate(); this.installWorker = undefined; void this.queryWorker?.terminate(); this.queryWorker = undefined; const error = new Error('Nature database worker stopped.'); for (const request of this.queryRequests.values()) request.reject(error); this.queryRequests.clear(); }
}
