import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Library grids expand responsively instead of staying fixed-width in full screen', () => {
  const styles = fs.readFileSync('src/renderer/styles.css', 'utf8');
  assert.match(styles, /\.kiwix-catalog\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.catalog-list\s*\{[^}]*repeat\(auto-fit,\s*minmax\(340px,\s*1fr\)\)/s);
  assert.match(styles, /\.library-manage \.zim-list\s*\{[^}]*repeat\(auto-fit,\s*minmax\(420px,\s*1fr\)\)/s);
  assert.doesNotMatch(styles, /\.kiwix-catalog\s*\{[^}]*max-width:\s*920px/s);
});

test('shared page sections use the available width in full screen', () => {
  const styles = fs.readFileSync('src/renderer/styles.css', 'utf8');
  for (const className of ['module-result', 'detail-list', 'update-link-card', 'update-explainer', 'update-result']) {
    assert.match(styles, new RegExp(`\\.${className}\\s*\\{[^}]*width:\\s*100%`, 's'));
  }
  assert.doesNotMatch(styles, /\.(?:module-result|detail-list|update-explainer|update-result)\s*\{[^}]*max-width:\s*820px/s);
});
