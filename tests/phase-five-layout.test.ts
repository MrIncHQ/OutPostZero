import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('src/renderer/App.tsx', 'utf8');
const notes = fs.readFileSync('src/renderer/NotesView.tsx', 'utf8');
const maps = fs.readFileSync('src/renderer/MapsView.tsx', 'utf8');
const mapRendering = fs.readFileSync('src/renderer/map-rendering.ts', 'utf8');
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
  for (const feature of ['IMPORT COURSE FOLDER', 'ADD STARTER COURSE', 'MARK LESSON COMPLETE', 'HOW TO ADD COURSES', 'COURSE BUILDER GUIDE', 'COPY COURSE.JSON EXAMPLE']) assert.match(learning, new RegExp(feature));
  assert.match(learning, /"schemaVersion": 1/);
  assert.match(learning, /Content\/Education\/outpost-zero-basics/);
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
  const mapSources = `${maps}\n${mapRendering}`;
  for (const feature of ['PMTiles', 'outpost-tile://package', 'COPY COORDINATES', 'MEASURE', 'IMPORT GPX', 'EXPORT GPX', 'SAVE PLACE', 'DOWNLOAD MAP', 'DOWNLOAD THIS CONFIRMED REGION', 'SEARCH LOCATIONS', 'LOCATION REQUIRED', 'ROUGH SIZE ESTIMATE', 'CANCEL DOWNLOAD']) assert.match(mapSources, new RegExp(feature));
  assert.match(maps, /maplibre-gl-worker\.mjs\?worker&url/);
  assert.match(maps, /setWorkerUrl\(maplibreWorkerUrl\)/);
  assert.match(maps, /addProtocol\('outpost-tile'/);
  assert.match(maps, /window\.outpost\.getMapTile/);
  assert.match(mapRendering, /@protomaps\/basemaps/);
  assert.match(mapRendering, /OFFLINE_BASEMAP_LAYERS/);
  assert.match(maps, /addProtocol\('outpost-glyph'/);
  assert.match(maps, /window\.outpost\.getMapGlyph/);
  assert.match(mapRendering, /OpenStreetMap/);
  assert.match(maps, /if \(added\) await loadPackage\(added\)/);
  assert.match(maps, /if \(!selectedPackage && state\?\.packages\[0\] && mapRef\.current && mapReady\) void loadPackage\(state\.packages\[0\]\)/);
  for (const feature of ['SCIENTIFIC CALCULATOR', 'UNIT CONVERTER', 'SHA-256', 'IPV4 SUBNET', 'COORDINATE CONVERTER', 'REGEX TESTER', 'PASSWORD GENERATOR']) assert.match(tools, new RegExp(feature));
  assert.match(tools, /All 118 elements/);
  assert.match(tools, /\['Og', 'Oganesson', 118\]/);
});

test('periodic reference contains every atomic number from 1 through 118', () => {
  const block = tools.slice(tools.indexOf('const elements:'), tools.indexOf('function dms'));
  const atomicNumbers = [...block.matchAll(/\['[A-Z][a-z]?', '[A-Za-z]+', (\d+)\]/g)].map((match) => Number(match[1]));
  assert.deepEqual(atomicNumbers, Array.from({ length: 118 }, (_, index) => index + 1));
});

test('PMTiles reads do not block the Electron main process', () => {
  const mapService = fs.readFileSync('src/main/map-service.ts', 'utf8');
  const source = mapService.slice(mapService.indexOf('class NodeFileSource'), mapService.indexOf('export class MapService'));
  assert.match(source, /await fs\.promises\.open/);
  assert.match(source, /await file\.read/);
  assert.match(source, /await file\.close/);
  assert.doesNotMatch(source, /openSync|readSync|closeSync/);
});

test('map download controls stay inside a two-column responsive grid', () => {
  const styles = fs.readFileSync('src/renderer/phase-five.css', 'utf8');
  assert.match(styles, /\.map-download-form \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.map-download-form label:first-child \{ grid-column: 1 \/ -1; \}/);
  assert.match(styles, /\.map-coordinate-actions \{[^}]*flex-wrap: wrap/);
});

test('map view gives the map full width and keeps packages in a separate tab', () => {
  const styles = fs.readFileSync('src/renderer/phase-five.css', 'utf8');
  assert.match(maps, /MAP VIEW/);
  assert.match(maps, /MAP PACKAGES/);
  assert.match(maps, /className="map-place-panel"[\s\S]*className="map-main"/);
  assert.match(maps, /className="map-packages-section"/);
  assert.match(maps, /mapRef\.current\?\.resize\(\)/);
  assert.doesNotMatch(maps, /className="map-workspace"|className="map-sidebar"|className="place-editor"/);
  assert.match(styles, /\.map-view-section \{[^}]*display: grid;[^}]*gap:/);
  assert.match(styles, /\.map-package-grid \{[^}]*grid-template-columns: repeat\(auto-fit/);
  assert.doesNotMatch(styles, /\.map-workspace \{|\.map-sidebar \{|\.place-editor \{/);
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
