import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const updaterScript = path.resolve('portable', 'PortableUpdater.ps1');

function hash(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

function makeUpdateRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-apply-'));
  const staging = path.join(root, 'Updates', 'Staging', '0.4.0');
  const state = path.join(root, 'Updates', 'State');
  fs.mkdirSync(staging, { recursive: true });
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(root, '.outpost-zero-root'), 'test');
  return { root, staging, state, pendingFile: path.join(state, 'pending-update.json') };
}

function runUpdater(root: string, staging: string, pendingFile: string) {
  return spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updaterScript,
    '-PortableRoot', root,
    '-StagingRoot', staging,
    '-PendingFile', pendingFile,
    '-ProcessId', '2147483647',
    '-NoRestart',
  ], { encoding: 'utf8', timeout: 30_000 });
}

test('portable updater installs runtime files without changing user content', {
  skip: process.platform !== 'win32',
}, () => {
  const { root, staging, pendingFile } = makeUpdateRoot();
  const runtime = Buffer.from('new signed runtime');
  const userFiles = new Map([
    ['Data/user.db', Buffer.from('database bytes')],
    ['Content/library.txt', Buffer.from('saved library')],
    ['Profile/identity.json', Buffer.from('{"identity":"local"}')],
  ]);
  fs.writeFileSync(path.join(staging, 'README.txt'), runtime);
  for (const [relativePath, content] of userFiles) {
    const destination = path.join(root, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  fs.writeFileSync(pendingFile, JSON.stringify({
    version: '0.4.1',
    previousVersion: '0.4.0',
    files: [{ path: 'README.txt', size: runtime.length, sha256: hash(runtime) }],
  }));

  const result = runUpdater(root, staging, pendingFile);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(path.join(root, 'README.txt')), runtime);
  for (const [relativePath, content] of userFiles) {
    assert.deepEqual(fs.readFileSync(path.join(root, ...relativePath.split('/'))), content);
  }
  const installedText = fs.readFileSync(path.join(root, 'Data', 'State', 'installed-version.json'), 'utf8').replace(/^\uFEFF/, '');
  const installed = JSON.parse(installedText);
  assert.equal(installed.version, '0.4.1');
  assert.equal(fs.existsSync(staging), false);
  assert.equal(fs.existsSync(pendingFile), false);
});

test('portable updater refuses to overwrite user data even with a malicious pending file', {
  skip: process.platform !== 'win32',
}, () => {
  const { root, staging, pendingFile } = makeUpdateRoot();
  const original = Buffer.from('personal document');
  const malicious = Buffer.from('replacement');
  fs.mkdirSync(path.join(root, 'Data'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'Data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Data', 'user.txt'), original);
  fs.writeFileSync(path.join(staging, 'Data', 'user.txt'), malicious);
  fs.writeFileSync(pendingFile, JSON.stringify({
    version: '0.4.0',
    previousVersion: '0.3.0',
    files: [{ path: 'Data/user.txt', size: malicious.length, sha256: hash(malicious) }],
  }));

  const result = runUpdater(root, staging, pendingFile);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(path.join(root, 'Data', 'user.txt')), original);
});

test('portable updater rolls back runtime files when a later verification fails', {
  skip: process.platform !== 'win32',
}, () => {
  const { root, staging, pendingFile } = makeUpdateRoot();
  const originalReadme = Buffer.from('old runtime');
  const newReadme = Buffer.from('new runtime');
  const badResource = Buffer.from('bad resource');
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  fs.mkdirSync(path.join(staging, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'README.txt'), originalReadme);
  fs.writeFileSync(path.join(staging, 'README.txt'), newReadme);
  fs.writeFileSync(path.join(staging, 'resources', 'app.asar'), badResource);
  fs.writeFileSync(pendingFile, JSON.stringify({
    version: '0.4.0',
    previousVersion: '0.3.0',
    files: [
      { path: 'README.txt', size: newReadme.length, sha256: hash(newReadme) },
      { path: 'resources/app.asar', size: badResource.length, sha256: '0'.repeat(64) },
    ],
  }));

  const result = runUpdater(root, staging, pendingFile);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(path.join(root, 'README.txt')), originalReadme);
});
