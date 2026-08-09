import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync('src/renderer/App.tsx', 'utf8');
const styles = fs.readFileSync('src/renderer/styles.css', 'utf8');

test('Home searches directly without a separate Search navigation item', () => {
  assert.doesNotMatch(app, /label:\s*'Search'/);
  assert.doesNotMatch(app, /function SearchView/);
  assert.match(app, /function HomeView[\s\S]*window\.outpost\.searchOutpost\(query\)/);
  assert.match(app, /className="search-block home-search"/);
  assert.match(app, /onOpenResult\(result\)/);
});

test('Home is action-focused and system summaries live in Settings', () => {
  const home = app.slice(app.indexOf('function HomeView'), app.indexOf('function LibraryView'));
  const settings = app.slice(app.indexOf('function SettingsView'), app.indexOf('function UpdatesView'));
  assert.match(home, /What do you need\?/);
  assert.match(home, /OPEN DOCUMENTS/);
  assert.match(home, /OPEN LIBRARY/);
  assert.doesNotMatch(home, /PORTABLE FOUNDATION/);
  assert.match(settings, /settings-system-grid/);
  assert.match(settings, /PORTABLE FOUNDATION/);
  assert.match(settings, /DRIVE CAPACITY/);
  assert.match(settings, /MODULE CENTER/);
  assert.match(styles, /\.home-action-grid\s*\{/);
  assert.match(styles, /\.settings-system-grid\s*\{/);
});
