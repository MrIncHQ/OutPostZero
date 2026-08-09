import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('src/renderer/App.tsx', 'utf8');
const notes = fs.readFileSync('src/renderer/NotesView.tsx', 'utf8');
const maps = fs.readFileSync('src/renderer/MapsView.tsx', 'utf8');
const tools = fs.readFileSync('src/renderer/ToolsView.tsx', 'utf8');

test('Phase 5 pages replace their planned placeholders', () => {
  assert.doesNotMatch(app, /notes:\s*\{[^}]*PHASE 5/);
  assert.doesNotMatch(app, /maps:\s*\{[^}]*PHASE 5/);
  assert.doesNotMatch(app, /tools:\s*\{[^}]*PHASE 5/);
  assert.match(app, /view === 'notes'.*<Suspense.*<NotesView/s);
  assert.match(app, /view === 'maps'.*<Suspense.*<MapsView/s);
  assert.match(app, /view === 'tools'.*<Suspense.*<ToolsView/s);
});

test('Notes exposes autosave, Markdown, templates, attachments, and export', () => {
  assert.match(notes, /setTimeout[\s\S]*saveNote/);
  assert.match(notes, /ReactMarkdown/);
  assert.match(notes, /NEW FROM TEMPLATE/);
  assert.match(notes, /importNoteAttachments/);
  assert.match(notes, /exportNote/);
});

test('Maps and tools expose the core offline controls', () => {
  for (const feature of ['PMTiles', 'outpost-map://tile', 'COPY COORDINATES', 'MEASURE', 'IMPORT GPX', 'EXPORT GPX', 'SAVE THIS PLACE', 'DOWNLOAD MAP', 'DOWNLOAD THIS REGION', 'ROUGH SIZE ESTIMATE', 'CANCEL DOWNLOAD']) assert.match(maps, new RegExp(feature));
  for (const feature of ['SCIENTIFIC CALCULATOR', 'UNIT CONVERTER', 'SHA-256', 'IPV4 SUBNET', 'COORDINATE CONVERTER', 'REGEX TESTER', 'PASSWORD GENERATOR']) assert.match(tools, new RegExp(feature));
});

test('Windows packaging includes the pinned offline map extractor and its license', () => {
  const packageFile = fs.readFileSync('package.json', 'utf8');
  assert.match(packageFile, /vendor\/pmtiles\/pmtiles\.exe/);
  assert.match(packageFile, /vendor\/pmtiles\/LICENSE/);
  assert.equal(fs.existsSync('vendor/pmtiles/pmtiles.exe'), true);
  assert.equal(fs.existsSync('vendor/pmtiles/LICENSE'), true);
});
