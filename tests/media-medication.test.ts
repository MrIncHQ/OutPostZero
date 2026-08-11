import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MediaService } from '../src/main/media-service';
import { MEDICATION_DISCLAIMER_VERSION, MedicationService } from '../src/main/medication-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';

function runtime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-media-med-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test'); const paths = new PortablePathService(root); paths.initializeLayout();
  return { root, paths };
}

test('media import, metadata, resume position, rescan, and deletion remain portable', () => {
  const app = runtime(); const source = path.join(app.root, 'sample.mp3'); fs.writeFileSync(source, Buffer.from('test audio'));
  try {
    const service = new MediaService(app.paths); const imported = service.importFiles([source]);
    assert.equal(imported.state.items.length, 1); const item = imported.state.items[0];
    assert.match(item.readerUrl, /^outpost-media:\/\/file\//); assert.equal(fs.existsSync(service.filePath(item.id)), true);
    const updated = service.update(item.id, { title: 'Emergency radio', favorite: true, tags: ['radio'], collections: ['Training'], playbackSeconds: 12.5, durationSeconds: 90 });
    assert.equal(updated.items[0].title, 'Emergency radio'); assert.equal(updated.items[0].playbackSeconds, 12.5); assert.equal(updated.items[0].favorite, true);
    assert.equal(service.reconcile().state.items[0].title, 'Emergency radio');
    assert.equal(service.remove(item.id).state.items.length, 0);
  } finally { fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('medication reference requires acknowledgment and caches official label results for offline search', async () => {
  const app = runtime(); let calls = 0;
  const fetcher = async () => { calls += 1; return new Response(JSON.stringify({ results: [{ id: 'label-1', openfda: { brand_name: ['ExampleMed'], generic_name: ['example ingredient'], substance_name: ['EXAMPLE'], manufacturer_name: ['Example Labs'], product_ndc: ['12345-678'], route: ['ORAL'], dosage_form: ['TABLET'] }, indications_and_usage: ['For example testing only.'], warnings: ['Ask a clinician.'] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try {
    const service = new MedicationService(app.paths, fetcher as typeof fetch);
    assert.equal(service.state().disclaimerVersion, MEDICATION_DISCLAIMER_VERSION); assert.equal(service.state().acknowledged, false);
    await assert.rejects(() => service.fetch('ExampleMed'), /Accept the medication-reference warning/);
    service.acknowledge(true); const result = await service.fetch('ExampleMed');
    assert.equal(result.ok, true); assert.ok(calls >= 1); assert.equal(service.state('ingredient').records[0].brandNames[0], 'ExampleMed');
    const suggestions = await service.suggestions('Exam');
    assert.equal(suggestions[0].label, 'ExampleMed'); assert.ok(['drive', 'FDA'].includes(suggestions[0].source));
    const offline = new MedicationService(app.paths, async () => { throw new Error('offline'); });
    assert.equal(offline.state('ExampleMed').records.length, 1); assert.equal(offline.clear().state.cachedRecords, 0);
  } finally { fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('medication page uses one primary smart search and an autocomplete list', () => {
  const source = fs.readFileSync('src/renderer/MedicationView.tsx', 'utf8');
  assert.match(source, /SEARCH MEDICATION/); assert.match(source, /THIS DRIVE ONLY/);
  assert.match(source, /getMedicationSuggestions/); assert.match(source, /role="listbox"/);
  assert.match(source, /automatically falls back|automatically cache|automatically falls back/i);
});

test('current DailyMed pill characteristics are cached and matched offline by imprint, color, and shape', async () => {
  const app = runtime();
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input);
    assert.match(url, /dailymed\.nlm\.nih\.gov/);
    return new Response(JSON.stringify({
      COLUMNS: ['SETID', 'SPL_VERSION', 'NAME', 'PRODUCT_CODE', 'SPLCOLOR', 'COLOR_TEXT', 'SPLIMPRINT', 'SPLSHAPE', 'SHAPE_TEXT', 'SPLSIZE', 'SPLSCORE', 'SPLSYMBOL', 'SPLCOATING', 'PUBLISHED_DATE'],
      DATA: [['set-1', 2, 'Example tablet', '50580-519', 'PINK', 'PINK', 'TY;80', 'ROUND', null, '13 mm', 1, null, null, 'August 1, 2026']],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const service = new MedicationService(app.paths, fetcher as typeof fetch); service.acknowledge(true);
    const downloaded = await service.fetchPillRecords('50580-519-08');
    assert.equal(downloaded.state.cachedPills, 1);
    assert.match(downloaded.message, /saved to this drive/i);
    assert.equal(service.searchPills({ imprint: 'TY 80' })[0].match, 'exact');
    assert.equal(service.searchPills({ imprint: 'TY', color: 'PINK', shape: 'ROUND' })[0].match, 'partial');
    assert.equal(service.searchPills({ imprint: 'TY 80', color: 'BLUE' }).length, 0);
    const offline = new MedicationService(app.paths, async () => { throw new Error('offline'); });
    assert.equal(offline.searchPills({ imprint: 'TY80' }).length, 1);
  } finally { fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('pill lookup UI uses free FDA data and never presents matches as verified identity', () => {
  const source = fs.readFileSync('src/renderer/MedicationView.tsx', 'utf8');
  const mainSource = fs.readFileSync('src/main/main.ts', 'utf8');
  assert.match(source, /PILL IMPRINT LOOKUP/);
  assert.match(source, /ADD FROM FDA/);
  assert.match(source, /Possible match only/);
  assert.doesNotMatch(source, /DATA SOURCE REQUIRED/);
  assert.doesNotMatch(source, /PREPARE OFFLINE IMAGES|REFRESH OFFICIAL IMAGES|downloadPillImages/);
  assert.doesNotMatch(mainSource, /outpost-medication|download-pill-images/);
});

test('bundled NLM starter index is searchable offline and survives clearing user downloads', () => {
  const app = runtime(); const indexPath = path.join(app.root, 'pill-index.json');
  fs.writeFileSync(indexPath, JSON.stringify({ schemaVersion: 1, sourceRelease: '2026-08-03', records: [
    ['aui-1', 'set-1', 'Starter tablet', '12345-678', 'AB;12', 'WHITE', 'OVAL', '8 mm', 1],
  ] }));
  try {
    const service = new MedicationService(app.paths, async () => { throw new Error('offline'); }, indexPath);
    assert.equal(service.state().starterPills, 1); assert.equal(service.state().pillIndexRelease, '2026-08-03');
    assert.equal(service.searchPills({ imprint: 'AB 12', color: 'WHITE', shape: 'OVAL' })[0].name, 'Starter tablet');
    assert.equal(service.clear().state.starterPills, 1);
    assert.equal(service.searchPills({ imprint: 'AB12' }).length, 1);
  } finally { fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('Windows packaging includes the compact free pill index and its provenance', () => {
  const packageJson = fs.readFileSync('package.json', 'utf8');
  assert.match(packageJson, /vendor\/medication-data/);
  assert.equal(fs.existsSync('vendor/medication-data/pill-index.json'), true);
  assert.equal(fs.existsSync('vendor/medication-data/SOURCE.md'), true);
  const index = JSON.parse(fs.readFileSync('vendor/medication-data/pill-index.json', 'utf8')) as { schemaVersion: number; sourceRelease: string; records: unknown[] };
  assert.equal(index.schemaVersion, 1); assert.match(index.sourceRelease, /^\d{4}-\d{2}-\d{2}$/); assert.ok(index.records.length > 40000);
});
