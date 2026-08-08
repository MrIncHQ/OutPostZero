import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseService } from '../src/main/database-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import { UpdateService, validateRuntimePath } from '../src/main/update-service';

function hash(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

function createServices(fetchImpl: typeof fetch, publicKey: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-updates-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  const database = new DatabaseService(paths);
  const updates = new UpdateService(database, '0.3.0', paths, fetchImpl, publicKey);
  return { root, paths, database, updates };
}

function signedFixture() {
  const readme = Buffer.from('Outpost Zero 0.4.0\n');
  const partOne = Buffer.from('portable-executable-');
  const partTwo = Buffer.from('version-0.4.0');
  const executable = Buffer.concat([partOne, partTwo]);
  const payload = {
    schemaVersion: 1,
    version: '0.4.0',
    publishedAt: '2026-08-08T00:00:00.000Z',
    platform: 'win32',
    architecture: 'x64',
    files: [{ path: 'README.txt', size: readme.length, sha256: hash(readme) }],
    executable: {
      path: 'Outpost Zero.exe',
      size: executable.length,
      sha256: hash(executable),
      parts: [
        { path: 'RuntimeParts/OutpostZero.exe.001', size: partOne.length, sha256: hash(partOne) },
        { path: 'RuntimeParts/OutpostZero.exe.002', size: partTwo.length, sha256: hash(partTwo) },
      ],
    },
  };
  const signedBytes = Buffer.from(JSON.stringify(payload));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const envelope = {
    schemaVersion: 1,
    signedPayload: signedBytes.toString('base64'),
    signature: crypto.sign(null, signedBytes, privateKey).toString('base64'),
  };
  const files = new Map<string, Buffer>([
    ['README.txt', readme],
    ['RuntimeParts/OutpostZero.exe.001', partOne],
    ['RuntimeParts/OutpostZero.exe.002', partTwo],
  ]);
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/update-manifest.json')) {
      return new Response(JSON.stringify(envelope), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const decodedPath = decodeURIComponent(new URL(url).pathname);
    const entry = [...files.entries()].find(([relativePath]) => decodedPath.endsWith(`/${relativePath}`));
    return entry ? new Response(entry[1], { status: 200 }) : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return {
    fetchImpl,
    publicKey: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    executable,
    readme,
  };
}

test('rejects update paths that could overwrite portable user data', () => {
  for (const protectedPath of [
    'Data/outpost-zero.sqlite', 'Profile/profile.json', 'Content/PDFs/manual.pdf',
    'AI/Models/model.gguf', 'Modules/Installed/tool/file.exe', 'Downloads/user-file.zip',
    'Updates/evil.exe', '../outside.exe',
  ]) {
    assert.throws(() => validateRuntimePath(protectedPath));
  }
  assert.equal(validateRuntimePath('resources/app.asar'), 'resources/app.asar');
  assert.equal(validateRuntimePath('Outpost Zero.exe'), 'Outpost Zero.exe');
  assert.equal(validateRuntimePath('Extract_Kiwix.ps1'), 'Extract_Kiwix.ps1');
});

test('verifies a signed GitHub manifest and detects a newer version', async () => {
  const fixture = signedFixture();
  const { database, updates } = createServices(fixture.fetchImpl, fixture.publicKey);
  const result = await updates.check();
  assert.equal(result.status, 'available');
  assert.equal(result.availableVersion, '0.4.0');
  assert.ok((result.downloadBytes ?? 0) > 0);
  database.close();
});

test('rejects a forged update manifest', async () => {
  const fixture = signedFixture();
  const wrongKey = crypto.generateKeyPairSync('ed25519').publicKey.export({ format: 'pem', type: 'spki' }).toString();
  const { database, updates } = createServices(fixture.fetchImpl, wrongKey);
  const result = await updates.check();
  assert.equal(result.status, 'error');
  assert.match(result.message, /signature verification failed/);
  database.close();
});

test('downloads, verifies, and assembles an update only in portable staging', async () => {
  const fixture = signedFixture();
  const { root, database, updates } = createServices(fixture.fetchImpl, fixture.publicKey);
  assert.equal((await updates.check()).status, 'available');
  const result = await updates.download();
  assert.equal(result.status, 'ready');
  assert.equal(fs.readFileSync(path.join(root, 'Updates', 'Staging', '0.4.0', 'README.txt'), 'utf8'), fixture.readme.toString());
  assert.deepEqual(fs.readFileSync(path.join(root, 'Updates', 'Staging', '0.4.0', 'Outpost Zero.exe')), fixture.executable);
  assert.equal(fs.existsSync(path.join(root, 'Data', 'outpost-zero.sqlite')), true);
  assert.equal(fs.existsSync(path.join(root, 'Profile', 'profile.json')), false);
  const pending = JSON.parse(fs.readFileSync(path.join(root, 'Updates', 'State', 'pending-update.json'), 'utf8'));
  assert.deepEqual(pending.files.map((file: { path: string }) => file.path).sort(), ['Outpost Zero.exe', 'README.txt']);
  database.close();
});
