import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('src/renderer/App.tsx', 'utf8');
const notes = fs.readFileSync('src/renderer/NotesView.tsx', 'utf8');
const maps = fs.readFileSync('src/renderer/MapsView.tsx', 'utf8');
const tools = fs.readFileSync('src/renderer/ToolsView.tsx', 'utf8');
const learning = fs.readFileSync('src/renderer/LearningView.tsx', 'utf8');

test('Phase 5 pages replace their planned placeholders', () => {
  assert.doesNotMatch(app, /notes:\s*\{[^}]*PHASE 5/);
  assert.doesNotMatch(app, /maps:\s*\{[^}]*PHASE 5/);
  assert.doesNotMatch(app, /tools:\s*\{[^}]*PHASE 5/);
  assert.match(app, /view === 'notes'.*<Suspense.*<NotesView/s);
  assert.match(app, /view === 'maps'.*<Suspense.*<MapsView/s);
  assert.match(app, /view === 'tools'.*<Suspense.*<ToolsView/s);
});

test('Education and OCR replace their module placeholders with offline controls', () => {
  assert.match(app, /view === 'learning'.*<Suspense.*<LearningView/s);
  for (const feature of ['IMPORT COURSE FOLDER', 'ADD STARTER COURSE', 'MARK LESSON COMPLETE']) assert.match(learning, new RegExp(feature));
  const documents = fs.readFileSync('src/renderer/DocumentsView.tsx', 'utf8');
  for (const feature of ['OFFLINE TEXT RECOGNITION', 'RECOGNIZE TEXT', 'CANCEL OCR']) assert.match(documents, new RegExp(feature));
});

test('Notes exposes autosave, Markdown, templates, attachments, and export', () => {
  assert.match(notes, /setTimeout[\s\S]*saveNote/);
  assert.match(notes, /ReactMarkdown/);
  assert.match(notes, /NEW FROM TEMPLATE/);
  assert.match(notes, /importNoteAttachments/);
  assert.match(notes, /exportNote/);
});

test('Maps and tools expose the core offline controls', () => {
  for (const feature of ['PMTiles', 'outpost-tile://package', 'COPY COORDINATES', 'MEASURE', 'IMPORT GPX', 'EXPORT GPX', 'SAVE THIS PLACE', 'DOWNLOAD MAP', 'DOWNLOAD THIS CONFIRMED REGION', 'SEARCH LOCATIONS', 'LOCATION REQUIRED', 'ROUGH SIZE ESTIMATE', 'CANCEL DOWNLOAD']) assert.match(maps, new RegExp(feature));
  assert.match(maps, /maplibre-gl-worker\.mjs\?worker&url/);
  assert.match(maps, /setWorkerUrl\(maplibreWorkerUrl\)/);
  assert.match(maps, /addProtocol\('outpost-tile'/);
  assert.match(maps, /window\.outpost\.getMapTile/);
  assert.match(maps, /@protomaps\/basemaps/);
  assert.match(maps, /OFFLINE_BASEMAP_LAYERS/);
  assert.match(maps, /addProtocol\('outpost-glyph'/);
  assert.match(maps, /window\.outpost\.getMapGlyph/);
  assert.match(maps, /OpenStreetMap/);
  assert.match(maps, /if \(added\) await loadPackage\(added\)/);
  assert.match(maps, /if \(!selectedPackage && state\?\.packages\[0\] && mapRef\.current && mapReady\) void loadPackage\(state\.packages\[0\]\)/);
  for (const feature of ['SCIENTIFIC CALCULATOR', 'UNIT CONVERTER', 'SHA-256', 'IPV4 SUBNET', 'COORDINATE CONVERTER', 'REGEX TESTER', 'PASSWORD GENERATOR']) assert.match(tools, new RegExp(feature));
});

test('map download controls stay inside a two-column responsive grid', () => {
  const styles = fs.readFileSync('src/renderer/phase-five.css', 'utf8');
  assert.match(styles, /\.map-download-form \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.map-download-form label:first-child \{ grid-column: 1 \/ -1; \}/);
  assert.match(styles, /\.map-coordinate-actions \{[^}]*flex-wrap: wrap/);
});

test('Windows packaging includes the pinned offline map extractor and its license', () => {
  const packageFile = fs.readFileSync('package.json', 'utf8');
  assert.match(packageFile, /vendor\/pmtiles\/pmtiles\.exe/);
  assert.match(packageFile, /vendor\/pmtiles\/LICENSE/);
  assert.equal(fs.existsSync('vendor/pmtiles/pmtiles.exe'), true);
  assert.equal(fs.existsSync('vendor/pmtiles/LICENSE'), true);
});

test('Windows packaging includes offline cartographic fonts and their licenses', () => {
  const packageFile = fs.readFileSync('package.json', 'utf8');
  assert.match(packageFile, /vendor\/map-assets\/\*\*\/\*/);
  assert.match(packageFile, /Noto-Sans-OFL\.txt/);
  assert.match(packageFile, /Protomaps-BSD-3-Clause\.md/);
  for (const file of [
    'vendor/map-assets/fonts/Noto Sans Regular/0-255.pbf',
    'vendor/map-assets/fonts/Noto Sans Medium/0-255.pbf',
    'vendor/map-assets/fonts/Noto Sans Italic/0-255.pbf',
    'vendor/map-assets/Noto-Sans-OFL.txt',
    'vendor/map-assets/Protomaps-BSD-3-Clause.md',
  ]) assert.equal(fs.existsSync(file), true, `${file} is missing`);
});
