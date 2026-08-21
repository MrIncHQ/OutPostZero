import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('src/renderer/App.tsx', 'utf8');
const styles = fs.readFileSync('src/renderer/styles.css', 'utf8');

test('primary navigation groups files and removes standalone media and downloads', () => {
  const navigationBlock = app.slice(app.indexOf('const navigationGroups'), app.indexOf('const navigation ='));
  assert.match(navigationBlock, /label: 'Files'/);
  assert.match(navigationBlock, /Documents, media, transfers/);
  assert.doesNotMatch(navigationBlock, /label: 'Media'/);
  assert.doesNotMatch(navigationBlock, /label: 'Downloads'/);
  assert.match(app, /function FilesWorkspace/);
  assert.match(app, />DOCUMENTS<\/button>/);
  assert.match(app, />MEDIA<\/button>/);
  assert.match(app, />TRANSFERS<\/button>/);
});

test('files workspace exposes live transfer controls for portable content', () => {
  assert.match(app, /getKiwixDownloadStatus/);
  assert.match(app, /getMapDownloadStatus/);
  assert.match(app, /getAiDownloadStatus/);
  assert.match(app, /cancelKiwixDownload/);
  assert.match(app, /cancelMapDownload/);
  assert.match(app, /cancelAiDownload/);
  assert.match(styles, /\.transfer-grid\s*\{/);
  assert.match(styles, /\.transfer-card\.active\s*\{/);
});

test('Library restores paused downloads with direct resume and visible saved-data verification', () => {
  assert.match(app, /'cancelled', 'error'\]\.includes\(download\.state\)\) setLibrarySection\('add'\)/);
  assert.match(app, />RESUME DOWNLOAD<\/button>/);
  assert.match(app, /CHECKING SAVED DATA/);
  assert.match(app, /download resumes automatically after this finishes/);
  assert.match(styles, /\.resume-verification-note\s*\{/);
});

test('field-console rail is grouped, descriptive, and scoped from page tabs', () => {
  assert.match(app, /COMMAND/);
  assert.match(app, /FIELD LIBRARY/);
  assert.match(app, /SYSTEMS/);
  assert.match(app, /className="rail-readiness"/);
  assert.match(app, /className="nav-icon"/);
  assert.match(app, /className="nav-copy"/);
  assert.match(styles, /\.rail > nav\s*\{/);
  assert.match(styles, /\.nav-group\s*\{/);
  assert.doesNotMatch(styles, /^nav button,/m);
});

test('switching pages or file tabs returns the workspace to its heading', () => {
  assert.match(app, /mainRef\.current\?\.scrollTo\(\{ top: 0, left: 0/);
  assert.match(app, /\[view, fileTab\]/);
  assert.match(app, /<main ref=\{mainRef\}>/);
});
