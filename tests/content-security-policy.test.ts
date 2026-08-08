import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('renderer CSP permits only loopback HTTP frames for the local Kiwix server', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(policy, 'Content-Security-Policy meta tag is missing.');
  assert.match(policy, /frame-src http:\/\/127\.0\.0\.1:\*/);
  assert.doesNotMatch(policy, /frame-src[^;]*https?:\/\/\*/);
  assert.doesNotMatch(policy, /frame-src[^;]*'self'/);
});
