import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DatabaseService } from '../src/main/database-service';
import { DocumentService } from '../src/main/document-service';
import { MapService } from '../src/main/map-service';
import { NoteService } from '../src/main/note-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import { UnifiedSearchService } from '../src/main/unified-search-service';
import { ExpressionParser, subnet } from '../src/renderer/ToolsView';

function runtime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-phase-five-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root); paths.initializeLayout(); const database = new DatabaseService(paths);
  const documents = new DocumentService(database, paths); const notes = new NoteService(database, paths); const maps = new MapService(database, paths);
  return { root, paths, database, documents, notes, maps };
}

function createMbtiles(filePath: string) {
  const db = new DatabaseSync(filePath);
  db.exec('CREATE TABLE metadata (name TEXT, value TEXT); CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);');
  const metadata = db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)');
  metadata.run('name', 'Test offline map'); metadata.run('format', 'png'); metadata.run('bounds', '-10,-10,10,10'); metadata.run('minzoom', '0'); metadata.run('maxzoom', '2');
  db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)').run(0, 0, 0, Buffer.from([0x89, 0x50, 0x4e, 0x47])); db.close();
}

test('notes autosave records support folders, tags, search, attachments, export, and deletion', () => {
  const app = runtime(); const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-note-attachment-'));
  try {
    let note = app.notes.save({ title: 'Water plan', body: '# Well\nInspect the blue pressure tank.', folder: 'Homestead', pinned: true, favorite: true, tags: ['water', 'repair'] });
    assert.equal(app.notes.state().folders[0], 'Homestead');
    assert.equal(app.database.searchNotes('"pressure"*')[0].id, note.id);
    const attachment = path.join(sourceRoot, 'pump.txt'); fs.writeFileSync(attachment, 'Pump model reference');
    note = app.notes.importAttachments(note.id, [attachment]); assert.equal(note.attachments.length, 1); assert.equal(fs.existsSync(app.notes.attachmentPath(note.attachments[0].id)), true);
    assert.match(app.notes.markdown(note.id).content, /# Water plan/);
    app.notes.removeAttachment(note.id, note.attachments[0].id); assert.equal(app.notes.require(note.id).attachments.length, 0);
    assert.equal(app.notes.delete(note.id).notes.length, 0); assert.equal(fs.existsSync(attachment), true);
  } finally { app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); fs.rmSync(sourceRoot, { recursive: true, force: true }); }
});

test('maps import raster MBTiles, serve flipped tiles, manage places, and exchange GPX', async () => {
  const app = runtime(); const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-map-source-'));
  try {
    const source = path.join(sourceRoot, 'county.mbtiles'); createMbtiles(source);
    const imported = await app.maps.importPackages([source]); assert.equal(imported.state.packages.length, 1); assert.equal(imported.state.packages[0].tileType, 'raster'); assert.deepEqual(imported.state.packages[0].bounds, [-10, -10, 10, 10]);
    const tile = await app.maps.tile(imported.state.packages[0].id, 0, 0, 0); assert.equal(tile?.mime, 'image/png'); assert.equal(tile?.bytes[0], 0x89);
    const place = app.maps.savePlace({ name: 'Water cache', latitude: 35.12, longitude: -97.44, note: 'Near the north fence', favorite: true });
    assert.match(app.maps.gpx(), /Water cache/); assert.equal(app.database.searchMapPlaces('"fence"*')[0].id, place.id);
    const gpx = path.join(sourceRoot, 'points.gpx'); fs.writeFileSync(gpx, '<gpx><wpt lat="36.5" lon="-98.2"><name>Rally Point</name></wpt></gpx>');
    assert.equal(app.maps.importGpx(gpx).state.places.length, 2); assert.equal(app.maps.deletePlace(place.id).places.length, 1);
    assert.equal(app.maps.removePackage(imported.state.packages[0].id).state.packages.length, 0); assert.equal(fs.existsSync(source), true);
  } finally { app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); fs.rmSync(sourceRoot, { recursive: true, force: true }); }
});

test('map downloads reject unsafe or oversized regions before starting a helper', async () => {
  const app = runtime();
  try {
    const invalidCenter = await app.maps.downloadMap({ title: 'Invalid', latitude: 95, longitude: 0, radiusKilometers: 100, maxZoom: 12 });
    assert.equal(invalidCenter.ok, false); assert.match(invalidCenter.message, /coordinates are invalid/);
    const dateLine = await app.maps.downloadMap({ title: 'Crossing', latitude: 0, longitude: 179, radiusKilometers: 800, maxZoom: 8 });
    assert.equal(dateLine.ok, false); assert.match(dateLine.message, /date line/);
    assert.equal(app.maps.state().packages.length, 0);
  } finally { app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('location search returns the exact selected coordinates and caches repeat queries', async () => {
  const app = runtime(); let requests = 0;
  const maps = new MapService(app.database, app.paths, { fetchImpl: async (input) => {
    requests += 1; const url = new URL(String(input)); assert.equal(url.hostname, 'nominatim.openstreetmap.org'); assert.equal(url.searchParams.get('q'), 'Springfield, Missouri');
    return new Response(JSON.stringify([{ place_id: 123, display_name: 'Springfield, Greene County, Missouri, United States', lat: '37.20896', lon: '-93.29230', boundingbox: ['37.05', '37.35', '-93.45', '-93.10'] }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  try {
    const first = await maps.searchLocations('Springfield, Missouri'); assert.equal(first.length, 1); assert.equal(first[0].latitude, 37.20896); assert.equal(first[0].longitude, -93.29230); assert.deepEqual(first[0].bounds, [-93.45, 37.05, -93.10, 37.35]);
    const second = await maps.searchLocations('  springfield,   missouri '); assert.deepEqual(second, first); assert.equal(requests, 1);
  } finally { app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('expanded search returns documents, notes, and saved map places with deep-link data', async () => {
  const app = runtime();
  try {
    fs.writeFileSync(path.join(app.root, 'Content', 'Documents', 'radio.txt'), 'Ridgetop repeater battery procedure'); await app.documents.reconcile(true);
    const note = app.notes.save({ title: 'Radio plan', body: 'Check the repeater antenna', folder: '', pinned: false, favorite: false, tags: [] });
    const place = app.maps.savePlace({ name: 'Repeater site', latitude: 40, longitude: -100, note: 'Ridgetop repeater location', favorite: false });
    const results = new UnifiedSearchService(app.database, app.documents).search('repeater');
    assert.deepEqual(new Set(results.map((result) => result.source)), new Set(['document', 'note', 'map']));
    assert.equal(results.find((result) => result.source === 'note')?.id, note.id); assert.equal(results.find((result) => result.source === 'map')?.id, place.id);
  } finally { app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('offline calculator and subnet utilities produce deterministic results', () => {
  assert.equal(new ExpressionParser('sqrt(144) + sin(30) * 10').parse(), 17);
  assert.equal(new ExpressionParser('2^3^2').parse(), 512);
  assert.throws(() => new ExpressionParser('process.exit()').parse(), /Unknown function|Use/);
  assert.match(subnet('192.168.1.25', 24), /Network: 192\.168\.1\.0/);
  assert.match(subnet('192.168.1.25', 24), /Usable hosts: 254/);
});
