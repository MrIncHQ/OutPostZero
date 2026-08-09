import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MapPackage, MapPlace, MapPlaceInput, MapsState, PhaseFiveOperationResult } from '../shared/contracts';
import { DatabaseService } from './database-service';
import { PortablePathService } from './portable-path';

function titleFor(fileName: string): string { return path.basename(fileName, path.extname(fileName)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function safeName(fileName: string): string { const ext = path.extname(fileName).toLowerCase(); return `${path.basename(fileName, ext).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) || 'map'}${ext}`; }
function xml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }

export class MapService {
  constructor(private readonly database: DatabaseService, private readonly paths: PortablePathService) {}

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
