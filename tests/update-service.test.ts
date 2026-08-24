import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { DatabaseService } from '../src/main/database-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import { UpdateService, validateRuntimePath } from '../src/main/portable-update-service';

function hash(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

function createServices(fetchImpl: typeof fetch, publicKey: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost zero updates-'));
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
    envelope,
    files,
  };
}

async function waitForFile(filePath: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
  assert.equal(validateRuntimePath('resources/Extract_Kiwix.ps1'), 'resources/Extract_Kiwix.ps1');
  assert.throws(() => validateRuntimePath('Extract_Kiwix.ps1'));
});

test('verifies a signed GitHub manifest and detects a newer version', async () => {
  const fixture = signedFixture();
  const { database, updates } = createServices(fixture.fetchImpl, fixture.publicKey);
  const result = await updates.check();
  assert.equal(result.status, 'available');
  assert.equal(result.availableVersion, '0.4.0');
  assert.ok((result.downloadBytes ?? 0) > 0);
  assert.equal(updates.activityStatus().state, 'available');
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
  assert.equal(fs.existsSync(path.join(root, 'Data', 'outpost-zero.sqlite')), true);
  assert.equal(fs.existsSync(path.join(root, 'Profile', 'profile.json')), false);
  const pending = JSON.parse(fs.readFileSync(path.join(root, 'Updates', 'State', 'pending-update.json'), 'utf8'));
  assert.equal(pending.stagingDirectory, '0.4.0');
  const staging = path.join(root, 'Updates', 'Staging', pending.stagingDirectory);
  assert.equal(fs.readFileSync(path.join(staging, 'README.txt'), 'utf8'), fixture.readme.toString());
  assert.deepEqual(fs.readFileSync(path.join(staging, 'Outpost Zero.exe')), fixture.executable);
  assert.deepEqual(pending.files.map((file: { path: string }) => file.path).sort(), ['Outpost Zero.exe', 'README.txt']);
  database.close();
});

test('pauses an update on shutdown and resumes its authenticated partial after relaunch', async () => {
  const fixture = signedFixture();
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const interruptedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/update-manifest.json')) return fixture.fetchImpl(input, init);
    if (url.endsWith('/README.txt')) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          controller.enqueue(fixture.readme.subarray(0, 8));
          init?.signal?.addEventListener('abort', () => controller.error(new Error('paused')), { once: true });
        },
      });
      return new Response(stream, { status: 200 });
    }
    return fixture.fetchImpl(input, init);
  }) as typeof fetch;
  const { root, paths, database, updates } = createServices(interruptedFetch, fixture.publicKey);
  try {
    assert.equal((await updates.check()).status, 'available');
    const interrupted = updates.download();
    const partial = path.join(root, 'Updates', 'Staging', '0.4.0', 'README.txt.download');
    await waitForFile(partial);
    assert.equal(updates.activityStatus().state, 'downloading');
    await updates.shutdown();
    const paused = await interrupted;
    assert.equal(paused.status, 'error');
    assert.match(paused.message, /paused/i);
    assert.equal(updates.activityStatus().state, 'paused');
    assert.ok(fs.statSync(partial).size > 0);
    assert.ok(streamController);

    const ranges: string[] = [];
    const resumedFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/update-manifest.json')) return fixture.fetchImpl(input, init);
      const decodedPath = decodeURIComponent(new URL(url).pathname);
      const entry = [...fixture.files.entries()].find(([relativePath]) => decodedPath.endsWith(`/${relativePath}`));
      if (!entry) return new Response('not found', { status: 404 });
      const range = new Headers(init?.headers).get('Range');
      if (!range) return new Response(entry[1]);
      ranges.push(range);
      const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1]);
      return new Response(entry[1].subarray(start), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${entry[1].length - 1}/${entry[1].length}` },
      });
    }) as typeof fetch;
    const relaunched = new UpdateService(database, '0.3.0', paths, resumedFetch, fixture.publicKey);
    assert.equal((await relaunched.check()).status, 'available');
    const completed = await relaunched.download();
    assert.equal(completed.status, 'ready', completed.message);
    assert.equal(relaunched.activityStatus().state, 'ready');
    assert.ok(ranges.some((range) => range === 'bytes=8-'));
    assert.equal(relaunched.status().readyVersion, '0.4.0');
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('restarts only the partial file when an update host ignores ranges', async () => {
  const fixture = signedFixture();
  const { root, database, updates } = createServices(fixture.fetchImpl, fixture.publicKey);
  try {
    const partial = path.join(root, 'Updates', 'Staging', '0.4.0', 'README.txt.download');
    fs.mkdirSync(path.dirname(partial), { recursive: true });
    fs.writeFileSync(partial, fixture.readme.subarray(0, 7));
    assert.equal((await updates.check()).status, 'available');
    const result = await updates.download();
    assert.equal(result.status, 'ready', result.message);
    assert.deepEqual(fs.readFileSync(path.join(root, 'Updates', 'Staging', '0.4.0', 'README.txt')), fixture.readme);
    assert.equal(fs.existsSync(partial), false);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a verified staged update remains installable after creating a new service', async () => {
  const fixture = signedFixture();
  const { root, paths, database, updates } = createServices(fixture.fetchImpl, fixture.publicKey);
  try {
    assert.equal((await updates.check()).status, 'available');
    assert.equal((await updates.download()).status, 'ready');
    const relaunched = new UpdateService(database, '0.3.0', paths, fixture.fetchImpl, fixture.publicKey);
    assert.equal(relaunched.status().readyVersion, '0.4.0');
    const check = await relaunched.check();
    assert.equal(check.readyToInstall, true);
    assert.match(check.message, /already verified and ready/i);
  } finally {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('confirms updater startup, applies the staged update, and relaunches', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  const fixture = signedFixture();
  const { root, paths, database, updates } = createServices(fixture.fetchImpl, fixture.publicKey);
  const restarted = paths.resolve('restarted.txt');
  fs.copyFileSync(path.resolve('portable', 'PortableUpdater.ps1'), paths.resolve('PortableUpdater.ps1'));
  fs.mkdirSync(paths.resolve('resources'), { recursive: true });
  fs.copyFileSync(path.resolve('portable', 'UpdaterBootstrap.ps1'), paths.resolve('resources/UpdaterBootstrap.ps1'));
  fs.writeFileSync(paths.resolve('Run_Outpost_Zero.bat'), '@echo off\r\n> "%~dp0restarted.txt" echo restarted\r\n');
  assert.equal((await updates.check()).status, 'available');
  assert.equal((await updates.download()).status, 'ready');
  database.close();

  const child = spawn(process.execPath, [
    path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs'),
    path.resolve('tests', 'fixtures', 'apply-update-child.ts'),
    root,
  ], { windowsHide: true });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  const exitCode = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  assert.equal(exitCode, 0, stderr);
  assert.equal(JSON.parse(stdout).status, 'launching');

  await waitForFile(restarted);
  assert.equal(fs.existsSync(restarted), true);
  assert.deepEqual(fs.readFileSync(paths.resolve('Outpost Zero.exe')), fixture.executable);
  assert.equal(fs.existsSync(paths.resolve('Updates/State/pending-update.json')), false);
  assert.match(fs.readFileSync(paths.resolve('Updates/update.log'), 'utf8'), /Update to 0\.4\.0 completed successfully/);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
});
