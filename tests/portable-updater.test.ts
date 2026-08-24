import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const updaterScript = path.resolve('portable', 'PortableUpdater.ps1');
const bootstrapScript = path.resolve('portable', 'UpdaterBootstrap.ps1');

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

function runUpdater(root: string, staging: string, pendingFile: string, noRestart = true) {
  const args = [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updaterScript,
    '-PortableRoot', root,
    '-StagingRoot', staging,
    '-PendingFile', pendingFile,
    '-ProcessId', '2147483647',
  ];
  if (noRestart) args.push('-NoRestart');
  return spawnSync('powershell.exe', args, { encoding: 'utf8', timeout: 30_000 });
}

function runBootstrap(root: string, staging: string, pendingFile: string, handshakeFile: string) {
  return spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bootstrapScript,
    '-Updater', updaterScript,
    '-PortableRoot', root,
    '-StagingRoot', staging,
    '-PendingFile', pendingFile,
    '-ProcessId', '2147483647',
    '-HandshakeFile', handshakeFile,
  ], { encoding: 'utf8', timeout: 30_000 });
}

async function waitForFile(filePath: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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

test('portable updater retains only the newest updater-owned rollback after success', {
  skip: process.platform !== 'win32',
}, () => {
  const { root, staging, pendingFile } = makeUpdateRoot();
  const rollbackRoot = path.join(root, 'Updates', 'Rollback');
  const oldRollbacks = [
    path.join(rollbackRoot, '0.3.0-20260101-010101'),
    path.join(rollbackRoot, '0.3.1-20260102-010101'),
  ];
  const unrelatedDirectory = path.join(rollbackRoot, 'notes-do-not-delete');
  for (const directory of [...oldRollbacks, unrelatedDirectory]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'README.txt'), 'old bytes');
  }
  const oldTime = new Date('2026-01-01T00:00:00Z');
  for (const directory of oldRollbacks) fs.utimesSync(directory, oldTime, oldTime);

  const original = Buffer.from('current runtime');
  const runtime = Buffer.from('new runtime');
  fs.writeFileSync(path.join(root, 'README.txt'), original);
  fs.writeFileSync(path.join(staging, 'README.txt'), runtime);
  fs.writeFileSync(pendingFile, JSON.stringify({
    version: '0.4.1', previousVersion: '0.4.0',
    files: [{ path: 'README.txt', size: runtime.length, sha256: hash(runtime) }],
  }));

  const result = runUpdater(root, staging, pendingFile);
  assert.equal(result.status, 0, result.stderr);
  const ownedRollbacks = fs.readdirSync(rollbackRoot).filter((name) => /^\d+\.\d+\.\d+-\d{8}-\d{6}$/.test(name));
  assert.equal(ownedRollbacks.length, 1);
  assert.match(ownedRollbacks[0], /^0\.4\.0-/);
  assert.equal(fs.existsSync(unrelatedDirectory), true);
  assert.deepEqual(fs.readFileSync(path.join(rollbackRoot, ownedRollbacks[0], 'README.txt')), original);
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

test('portable updater supports a portable root at the root of a Windows drive', {
  skip: process.platform !== 'win32',
}, async () => {
  const backingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-drive-root-'));
  const driveLetter = ['Z', 'Y', 'X', 'W'].find((letter) => !fs.existsSync(`${letter}:\\`));
  assert.ok(driveLetter, 'No unused drive letter was available for the test.');
  const drive = `${driveLetter}:`;
  const mapped = spawnSync('subst.exe', [drive, backingRoot], { encoding: 'utf8' });
  assert.equal(mapped.status, 0, mapped.stderr);
  const root = `${drive}\\`;
  try {
    const staging = path.join(root, 'Updates', 'Staging', '0.4.0');
    const pendingFile = path.join(root, 'Updates', 'State', 'pending-update.json');
    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(path.dirname(pendingFile), { recursive: true });
    fs.writeFileSync(path.join(root, '.outpost-zero-root'), 'test');
    const runtime = Buffer.from('drive-root runtime');
    fs.writeFileSync(path.join(staging, 'README.txt'), runtime);
    fs.writeFileSync(pendingFile, JSON.stringify({
      version: '0.4.1', previousVersion: '0.4.0',
      files: [{ path: 'README.txt', size: runtime.length, sha256: hash(runtime) }],
    }));
    const handshake = path.join(root, 'Updates', 'State', 'updater-started.txt');
    const result = runBootstrap(root, staging, pendingFile, handshake);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(handshake), true);
    await waitForFile(path.join(root, 'README.txt'));
    assert.deepEqual(fs.readFileSync(path.join(root, 'README.txt')), runtime);
    const installedPath = path.join(root, 'Data', 'State', 'installed-version.json');
    await waitForFile(installedPath);
    let installedText = '';
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try { installedText = fs.readFileSync(installedPath, 'utf8'); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EBUSY' || attempt === 9) throw error; await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    const installed = JSON.parse(installedText.replace(/^\uFEFF/, ''));
    assert.match(installed.rollbackPath, /^Updates\/Rollback\/0\.4\.0-/);
  } finally {
    spawnSync('subst.exe', [drive, '/D'], { encoding: 'utf8' });
    fs.rmSync(backingRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('portable updater relaunches through the portable batch launcher', {
  skip: process.platform !== 'win32',
}, async () => {
  const { root, staging, pendingFile } = makeUpdateRoot();
  const runtime = Buffer.from('restart runtime');
  const restarted = path.join(root, 'restarted.txt');
  fs.writeFileSync(path.join(staging, 'README.txt'), runtime);
  fs.writeFileSync(path.join(root, 'Run_Outpost_Zero.bat'), '@echo off\r\n> "%~dp0restarted.txt" echo restarted\r\n');
  fs.writeFileSync(pendingFile, JSON.stringify({
    version: '0.4.1', previousVersion: '0.4.0',
    files: [{ path: 'README.txt', size: runtime.length, sha256: hash(runtime) }],
  }));
  const result = runUpdater(root, staging, pendingFile, false);
  assert.equal(result.status, 0, result.stderr);
  await waitForFile(restarted);
  assert.equal(fs.existsSync(restarted), true);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
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
