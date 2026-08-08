import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import { ProfileService, validateDisplayName } from '../src/main/profile-service';

function createServices() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-profile-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  return { root, profiles: new ProfileService(paths) };
}

test('creates a persistent local profile and Ed25519 identity beneath the root', () => {
  const { root, profiles } = createServices();
  const profile = profiles.create('  Test   Outpost  ');
  assert.equal(profile.displayName, 'Test Outpost');
  assert.match(profile.deviceFingerprint, /^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/);
  assert.equal(fs.existsSync(path.join(root, 'Profile', 'Identity', 'device-private.pem')), true);
  assert.equal(fs.existsSync(path.join(root, 'Profile', 'Identity', 'device-public.pem')), true);
  assert.deepEqual(profiles.read(), profile);
});

test('updates the display name without replacing the device identity', () => {
  const { profiles } = createServices();
  const original = profiles.create('First Name');
  const updated = profiles.update('Second Name');
  assert.equal(updated.displayName, 'Second Name');
  assert.equal(updated.deviceFingerprint, original.deviceFingerprint);
  assert.equal(updated.createdAt, original.createdAt);
});

test('rejects invalid display names', () => {
  assert.throws(() => validateDisplayName('x'), /between 2 and 32/);
  assert.throws(() => validateDisplayName('bad\u0000name'), /control characters/);
});
