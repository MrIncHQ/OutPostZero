import crypto from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MapDownloadRequest, MapDownloadStatus, MapPackage, MapPlace, MapPlaceInput, MapsState, PhaseFiveOperationResult } from '../shared/contracts';
import { DatabaseService } from './database-service';
import { PortablePathService } from './portable-path';

function titleFor(fileName: string): string { return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function safeName(fileName: string): string { const ext = path.extname(fileName).toLowerCase(); return `${path.basename(fileName, ext).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) || 'map'}${ext}`; }
function xml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
function dateStamp(date: Date): string { return date.toISOString().slice(0, 10).replace(/-/g, ''); }

interface MapServiceOptions {
  helperPath?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export class MapService {
  private readonly helperPath?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private activeDownload: ChildProcessWithoutNullStreams | null = null;
  private downloadAbort: AbortController | null = null;
  private currentDownload: MapDownloadStatus = { state: 'idle', percent: 0, downloadedBytes: 0, estimatedBytes: 0, elapsedSeconds: 0, message: 'No map download is active.' };

  constructor(private readonly database: DatabaseService, private readonly paths: PortablePathService, options: MapServiceOptions = {}) {
    this.helperPath = options.helperPath;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  state(): MapsState { return { packages: this.database.mapPackages().map((item) => item.format === 'mbtiles' ? { ...item, ...this.mbtilesInfo(this.paths.resolve(item.relativePath)) } : item), places: this.database.mapPlaces() }; }

  private mbtilesInfo(filePath: string): Pick<MapPackage, 'tileType' | 'sourceLayers' | 'minZoom' | 'maxZoom' | 'bounds'> {
    const db = new DatabaseSync(filePath, { readOnly: true });
    try {
      const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='metadata'").get();
      if (!exists) return { tileType: 'unknown' };
      const metadata = Object.fromEntries((db.prepare('SELECT name, value FROM metadata').all() as Array<{ name: string; value: string }>).map((row) => [row.name, row.value]));
      let sourceLayers: string[] | undefined;
      try { sourceLayers = (JSON.parse(metadata.json ?? '{}') as { vector_layers?: Array<{ id: string }> }).vector_layers?.map((layer) => layer.id); } catch { sourceLayers = undefined; }
      const bounds = metadata.bounds?.split(',').map(Number); const validBounds = bounds?.length === 4 && bounds.every(Number.isFinite) ? bounds as [number, number, number, number] : undefined;
      return { tileType: /^(pbf|mvt)$/i.test(metadata.format ?? '') || sourceLayers?.length ? 'vector' : /^(png|jpg|jpeg|webp)$/i.test(metadata.format ?? '') ? 'raster' : 'unknown',
        sourceLayers, minZoom: Number.isFinite(Number(metadata.minzoom)) ? Number(metadata.minzoom) : undefined, maxZoom: Number.isFinite(Number(metadata.maxzoom)) ? Number(metadata.maxzoom) : undefined, bounds: validBounds };
    } finally { db.close(); }
  }

  private validatePackage(filePath: string, format: MapPackage['format']): void {
    if (format === 'pmtiles') {
      const file = fs.openSync(filePath, 'r'); const bytes = Buffer.alloc(7);
      try { fs.readSync(file, bytes, 0, bytes.length, 0); } finally { fs.closeSync(file); }
      if (bytes.toString('ascii') !== 'PMTiles') throw new Error(`${path.basename(filePath)} is not a valid PMTiles archive.`);
      return;
    }
    const tileDatabase = new DatabaseSync(filePath, { readOnly: true });
    try {
      const tables = tileDatabase.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tiles','metadata')").all() as Array<{ name: string }>;
      if (!tables.some((table) => table.name === 'tiles')) throw new Error(`${path.basename(filePath)} does not contain an MBTiles tiles table.`);
    } finally { tileDatabase.close(); }
  }

  async reconcile(): Promise<MapsState> {
    const root = this.paths.ensureDirectory('Content/Maps');
    const seen = new Set<string>();
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !['.pmtiles', '.mbtiles'].includes(path.extname(entry.name).toLowerCase())) continue;
      const filePath = path.join(root, entry.name); const format = path.extname(entry.name).toLowerCase().slice(1) as MapPackage['format'];
      try { this.validatePackage(filePath, format); } catch { continue; }
      const relativePath = path.relative(this.paths.root, filePath).replace(/\\/g, '/'); seen.add(relativePath.toLowerCase());
      const id = crypto.createHash('sha256').update(relativePath.toLowerCase()).digest('hex').slice(0, 24).toUpperCase();
      this.database.upsertMapPackage({ id, title: titleFor(entry.name), fileName: entry.name, relativePath, format, size: fs.statSync(filePath).size, addedAt: new Date().toISOString() });
    }
    for (const item of this.database.mapPackages()) if (!seen.has(item.relativePath.toLowerCase())) this.database.removeMapPackageRecord(item.id);
    return this.state();
  }

  async importPackages(sourcePaths: string[]): Promise<PhaseFiveOperationResult<MapsState>> {
    const root = this.paths.ensureDirectory('Content/Maps'); let imported = 0;
    for (const sourcePath of sourcePaths.slice(0, 20)) {
      const source = path.resolve(sourcePath); const extension = path.extname(source).toLowerCase();
      if (!['.pmtiles', '.mbtiles'].includes(extension)) continue;
      this.validatePackage(source, extension.slice(1) as MapPackage['format']);
      let destination = path.join(root, safeName(path.basename(source)));
      if (fs.existsSync(destination)) destination = path.join(root, `${path.basename(destination, extension)}-${crypto.randomBytes(4).toString('hex')}${extension}`);
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL); imported += 1;
    }
    const state = await this.reconcile();
    return { ok: true, message: imported ? `Imported ${imported} offline map package${imported === 1 ? '' : 's'}.` : 'No supported map packages were selected.', state };
  }

  downloadStatus(): MapDownloadStatus { return { ...this.currentDownload }; }

  hasActiveDownload(): boolean { return Boolean(this.activeDownload || this.downloadAbort); }

  async shutdown(): Promise<void> {
    const child = this.activeDownload; this.cancelDownload();
    if (!child || child.exitCode !== null) return;
    await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }

  cancelDownload(): MapDownloadStatus {
    if (!this.activeDownload && !this.downloadAbort) return this.downloadStatus();
    this.currentDownload = { ...this.currentDownload, state: 'cancelled', message: 'Map download cancelled. The incomplete temporary file will be removed.' };
    this.downloadAbort?.abort(); this.activeDownload?.kill();
    return this.downloadStatus();
  }

  private boundsFor(request: MapDownloadRequest): [number, number, number, number] {
    if (!Number.isFinite(request.latitude) || request.latitude < -85 || request.latitude > 85 || !Number.isFinite(request.longitude) || request.longitude < -180 || request.longitude > 180) throw new Error('Map center coordinates are invalid.');
    if (!Number.isFinite(request.radiusKilometers) || request.radiusKilometers < 5 || request.radiusKilometers > 1000) throw new Error('Map radius must be between 5 and 1,000 kilometers.');
    if (![8, 12, 15].includes(request.maxZoom)) throw new Error('Map detail selection is invalid.');
    const latitudeDelta = request.radiusKilometers / 111.32;
    const longitudeDelta = request.radiusKilometers / (111.32 * Math.max(0.08, Math.cos(request.latitude * Math.PI / 180)));
    if (request.longitude - longitudeDelta < -180 || request.longitude + longitudeDelta > 180) throw new Error('This region crosses the international date line. Choose a closer center or smaller radius.');
    return [request.longitude - longitudeDelta, Math.max(-85.051129, request.latitude - latitudeDelta), request.longitude + longitudeDelta, Math.min(85.051129, request.latitude + latitudeDelta)];
  }

  private estimateBytes(bounds: [number, number, number, number], maxZoom: number): number {
    const longitudeFraction = (bounds[2] - bounds[0]) / 360;
    const latitudeFraction = Math.abs(Math.sin(bounds[3] * Math.PI / 180) - Math.sin(bounds[1] * Math.PI / 180)) / 2;
    const detailFraction = 2 ** (maxZoom - 15);
    return Math.ceil(60 * 1024 * 1024 + 120 * 1024 ** 3 * longitudeFraction * latitudeFraction * detailFraction);
  }

  private async latestBuild(signal: AbortSignal): Promise<{ url: string; date: string }> {
    const today = this.now();
    for (let offset = 0; offset < 8; offset += 1) {
      const candidate = new Date(today); candidate.setUTCDate(candidate.getUTCDate() - offset);
      const date = dateStamp(candidate); const url = `https://build.protomaps.com/${date}.pmtiles`;
      try {
        const response = await this.fetchImpl(url, { method: 'HEAD', headers: { 'User-Agent': 'Outpost-Zero-Maps/0.8' }, redirect: 'follow', signal });
        if (response.ok) return { url, date };
      } catch { /* Try the prior retained daily build. */ }
    }
    throw new Error('No current Protomaps daily build could be reached. Check the internet connection and try again.');
  }

  private runHelper(args: string[], onOutput?: (text: string) => void): Promise<void> {
    if (!this.helperPath || !fs.existsSync(this.helperPath)) return Promise.reject(new Error('The packaged PMTiles download helper is missing. Update or repair Outpost Zero.'));
    return new Promise((resolve, reject) => {
      const child = spawn(this.helperPath!, args, { cwd: this.paths.root, shell: false, windowsHide: true });
      this.activeDownload = child;
      let errorText = '';
      const output = (chunk: Buffer) => { const text = chunk.toString(); errorText = `${errorText}${text}`.slice(-4000); onOutput?.(text); };
      child.stdout.on('data', output); child.stderr.on('data', output);
      child.once('error', reject);
      child.once('exit', (code) => {
        if (this.activeDownload === child) this.activeDownload = null;
        if (code === 0) resolve();
        else reject(new Error(this.currentDownload.state === 'cancelled' ? 'Map download cancelled.' : errorText.replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\r?\n/).at(-1) || `PMTiles helper exited with code ${code}.`));
      });
    });
  }

  async downloadMap(request: MapDownloadRequest): Promise<PhaseFiveOperationResult<MapsState>> {
    if (this.activeDownload || this.downloadAbort) return { ok: false, message: 'Another map download is already active.', state: this.state() };
    const controller = new AbortController(); this.downloadAbort = controller;
    const started = Date.now(); let temporary = ''; let timer: NodeJS.Timeout | undefined;
    try {
      if (typeof request.title !== 'string') throw new Error('Map name is invalid.');
      const title = request.title.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 100) || 'Offline map';
      const bounds = this.boundsFor(request); const estimatedBytes = this.estimateBytes(bounds, request.maxZoom);
      const temporaryRoot = this.paths.ensureDirectory('Downloads/Maps'); temporary = path.join(temporaryRoot, `${crypto.randomUUID()}.pmtiles.partial`);
      this.currentDownload = { state: 'resolving', title, percent: 0, downloadedBytes: 0, estimatedBytes, elapsedSeconds: 0, message: 'Finding the newest available OpenStreetMap build...' };
      const disk = fs.statfsSync(this.paths.root); const freeBytes = disk.bavail * disk.bsize;
      if (freeBytes < estimatedBytes + 256 * 1024 * 1024) throw new Error(`Not enough free space for this estimated ${Math.ceil(estimatedBytes / 1024 / 1024)} MB region plus working space.`);
      const build = await this.latestBuild(controller.signal); this.currentDownload = { ...this.currentDownload, state: 'downloading', sourceDate: build.date, message: 'Downloading only the selected region to this drive...' };
      timer = setInterval(() => {
        const downloadedBytes = fs.existsSync(temporary) ? fs.statSync(temporary).size : 0;
        this.currentDownload = { ...this.currentDownload, downloadedBytes, elapsedSeconds: Math.floor((Date.now() - started) / 1000) };
      }, 500);
      const updateProgress = (text: string) => {
        const matches = [...text.replace(/\x1b\[[0-9;]*m/g, '').matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
        const parsed = Number(matches.at(-1)?.[1]);
        if (Number.isFinite(parsed)) this.currentDownload = { ...this.currentDownload, percent: Math.max(this.currentDownload.percent, Math.min(99, parsed)) };
      };
      await this.runHelper(['extract', build.url, temporary, `--bbox=${bounds.join(',')}`, `--maxzoom=${request.maxZoom}`, '--download-threads=4', '--overfetch=0.05'], updateProgress);
      this.currentDownload = { ...this.currentDownload, state: 'verifying', percent: 100, downloadedBytes: fs.statSync(temporary).size, message: 'Verifying the downloaded PMTiles archive...' };
      await this.runHelper(['verify', temporary]); this.validatePackage(temporary, 'pmtiles');
      const mapRoot = this.paths.ensureDirectory('Content/Maps'); let destination = path.join(mapRoot, safeName(`${title}.pmtiles`));
      if (fs.existsSync(destination)) destination = path.join(mapRoot, `${path.basename(destination, '.pmtiles')}-${crypto.randomBytes(4).toString('hex')}.pmtiles`);
      fs.renameSync(temporary, destination); const state = await this.reconcile();
      this.currentDownload = { ...this.currentDownload, state: 'complete', percent: 100, downloadedBytes: fs.statSync(destination).size, elapsedSeconds: Math.floor((Date.now() - started) / 1000), message: `${title} downloaded, verified, and added to Maps.` };
      return { ok: true, message: this.currentDownload.message, state };
    } catch (error) {
      const cancelled = this.currentDownload.state === 'cancelled'; const message = cancelled ? 'Map download cancelled.' : error instanceof Error ? error.message : 'Map download failed.';
      this.currentDownload = { ...this.currentDownload, state: cancelled ? 'cancelled' : 'error', elapsedSeconds: Math.floor((Date.now() - started) / 1000), message };
      return { ok: false, message, state: this.state() };
    } finally {
      if (timer) clearInterval(timer);
      this.activeDownload = null;
      if (this.downloadAbort === controller) this.downloadAbort = null;
      if (temporary && fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  packagePath(packageId: string): string {
    if (!/^[A-F0-9]{24}$/i.test(packageId)) throw new Error('Map package identifier is invalid.');
    const item = this.database.mapPackage(packageId); if (!item) throw new Error('Map package was not found.');
    return this.paths.resolve(item.relativePath);
  }

  tile(packageId: string, z: number, x: number, y: number): { bytes: Uint8Array; mime: string } | null {
    const item = this.database.mapPackage(packageId); if (!item || item.format !== 'mbtiles') return null;
    const db = new DatabaseSync(this.packagePath(packageId), { readOnly: true });
    try {
      const row = db.prepare('SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?').get(z, x, (2 ** z - 1) - y) as { tile_data: Uint8Array } | undefined;
      if (!row) return null;
      const bytes = new Uint8Array(row.tile_data); const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
      const png = bytes[0] === 0x89 && bytes[1] === 0x50; const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      return { bytes, mime: png ? 'image/png' : jpeg ? 'image/jpeg' : gzip ? 'application/x-protobuf' : 'application/x-protobuf' };
    } finally { db.close(); }
  }

  removePackage(packageId: string): PhaseFiveOperationResult<MapsState> {
    const file = this.packagePath(packageId); if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    this.database.removeMapPackageRecord(packageId); return { ok: true, message: 'Offline map package removed from this drive.', state: this.state() };
  }

  savePlace(input: MapPlaceInput): MapPlace {
    if (input.id && !/^[0-9a-f-]{36}$/i.test(input.id)) throw new Error('Saved-place identifier is invalid.');
    if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90 || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) throw new Error('Coordinates are invalid.');
    const existing = input.id ? this.database.mapPlaces().find((place) => place.id === input.id) : undefined; const now = new Date().toISOString();
    return this.database.saveMapPlaceRecord({ id: input.id ?? crypto.randomUUID(), name: input.name.trim().slice(0, 120) || `${input.latitude.toFixed(5)}, ${input.longitude.toFixed(5)}`,
      latitude: input.latitude, longitude: input.longitude, note: input.note.trim().slice(0, 5000), favorite: Boolean(input.favorite), createdAt: existing?.createdAt ?? now, updatedAt: now });
  }

  deletePlace(placeId: string): MapsState { if (!/^[0-9a-f-]{36}$/i.test(placeId)) throw new Error('Saved-place identifier is invalid.'); this.database.deleteMapPlaceRecord(placeId); return this.state(); }

  importGpx(source: string): PhaseFiveOperationResult<MapsState> {
    const content = fs.readFileSync(source, 'utf8').slice(0, 20_000_000); let imported = 0;
    const pattern = /<(?:wpt|trkpt)\b[^>]*\blat=["'](-?\d+(?:\.\d+)?)["'][^>]*\blon=["'](-?\d+(?:\.\d+)?)["'][^>]*>([\s\S]*?)<\/(?:wpt|trkpt)>/gi;
    for (const match of content.matchAll(pattern)) {
      const name = match[3].match(/<name>([\s\S]*?)<\/name>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || `GPX point ${imported + 1}`;
      this.savePlace({ name, latitude: Number(match[1]), longitude: Number(match[2]), note: 'Imported from GPX', favorite: false }); imported += 1;
      if (imported >= 5000) break;
    }
    return { ok: imported > 0, message: imported ? `Imported ${imported} GPX point${imported === 1 ? '' : 's'}.` : 'No GPX waypoints or track points were found.', state: this.state() };
  }

  gpx(): string {
    const points = this.database.mapPlaces().map((place) => `  <wpt lat="${place.latitude}" lon="${place.longitude}"><name>${xml(place.name)}</name><desc>${xml(place.note)}</desc></wpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Outpost Zero" xmlns="http://www.topografix.com/GPX/1/1">\n${points}\n</gpx>\n`;
  }
}
