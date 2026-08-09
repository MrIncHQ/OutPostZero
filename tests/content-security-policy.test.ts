import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { RENDERER_CONTENT_SECURITY_POLICY, responseHeadersForUrl } from '../src/main/security-policy';

test('renderer CSP permits loopback Kiwix and the internal portable document reader', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  assert.ok(policy, 'Content-Security-Policy meta tag is missing.');
  assert.match(policy, /frame-src http:\/\/127\.0\.0\.1:\*/);
  assert.match(policy, /frame-src[^;]*outpost-doc:/);
  assert.doesNotMatch(policy, /frame-src[^;]*https?:\/\/\*/);
  assert.doesNotMatch(policy, /frame-src[^;]*'self'/);
});

test('applies the renderer policy only to Outpost Zero files', () => {
  const headers = responseHeadersForUrl('file:///portable/resources/app.asar/index.html', { Existing: ['kept'] });
  assert.deepEqual(headers.Existing, ['kept']);
  assert.deepEqual(headers['Content-Security-Policy'], [RENDERER_CONTENT_SECURITY_POLICY]);
});

test('preserves Kiwix loopback response headers without replacing its content policy', () => {
  const kiwixPolicy = "default-src 'self' data: blob: about: 'unsafe-inline' 'unsafe-eval'; sandbox allow-scripts allow-same-origin";
  const original = { 'Content-Security-Policy': [kiwixPolicy], Server: ['kiwix-serve'] };
  assert.deepEqual(responseHeadersForUrl('http://127.0.0.1:7338/content/wikipedia/main.html', original), original);
});
