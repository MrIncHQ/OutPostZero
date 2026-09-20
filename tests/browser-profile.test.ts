import assert from 'node:assert/strict';
import test from 'node:test';
import { browserProfileId, currentBrowserProfileId } from '../src/main/browser-profile';

test('browser profiles follow the Windows installation and account, not the drive letter', () => {
  const original = browserProfileId('machine-a:S-1-5-21-100');
  assert.equal(original, browserProfileId('machine-a:S-1-5-21-100'));
  assert.notEqual(original, browserProfileId('machine-b:S-1-5-21-100'));
  assert.notEqual(original, browserProfileId('machine-a:S-1-5-21-200'));
  assert.match(original, /^[a-f0-9]{64}$/);
  assert.throws(() => browserProfileId(''), /missing/);
});

test('current Windows browser identity is stable across launches', { skip: process.platform !== 'win32' }, () => {
  assert.equal(currentBrowserProfileId(), currentBrowserProfileId());
});
