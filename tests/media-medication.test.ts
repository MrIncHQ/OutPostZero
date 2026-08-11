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
