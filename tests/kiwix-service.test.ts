import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MODULE_PACKAGE_PUBLIC_KEY } from '../src/main/builtin-module-package';
import { DatabaseService } from '../src/main/database-service';
import { KIWIX_PACKAGE } from '../src/main/kiwix-package';
import { KiwixService, validateKiwixPackagePath, verifyKiwixPackage } from '../src/main/kiwix-service';
import { PortablePathService } from '../src/main/portable-path';

const archivePath = path.resolve('VendorCache', 'kiwix-tools_win-x86_64-3.8.1.zip');
const samplePath = path.resolve('VendorCache', 'openzim-small.zim');

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-kiwix-'));
  fs.writeFileSync(path.join(root, '.outpost-zero-root'), 'test');
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  fs.copyFileSync(path.resolve('portable', 'Extract_Kiwix.ps1'), path.join(root, 'resources', 'Extract_Kiwix.ps1'));
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  const database = new DatabaseService(paths);
  return { root, paths, database };
}

test('verifies the signed pinned Kiwix package and rejects unsafe paths', () => {
  const manifest = verifyKiwixPackage(KIWIX_PACKAGE, MODULE_PACKAGE_PUBLIC_KEY);
  assert.equal(manifest.version, '3.8.1');
  assert.equal(manifest.archive.size, 18_301_924);
  assert.equal(manifest.archive.sha256, 'FCD01ED2B93E9A68632C7863C83B9F66BF64406A66357BE1DF7B8B75596F3E45');
  assert.equal(manifest.sampleContent.size, 41_155);
  assert.throws(() => validateKiwixPackagePath('../outside.dll'), /not a root file|invalid/);
  assert.throws(() => validateKiwixPackagePath('nested/file.dll'), /not a root file/);
  assert.throws(() => validateKiwixPackagePath('nested\\file.dll'), /invalid/);
});

test('rejects a forged Kiwix package signature', () => {
  const forged = JSON.parse(JSON.stringify(KIWIX_PACKAGE)) as { signature: string };
  const signature = Buffer.from(forged.signature, 'base64');
  signature[0] ^= 0xff;
  forged.signature = signature.toString('base64');
  assert.throws(() => verifyKiwixPackage(forged), /signature verification failed/);
});

test('scans only ZIM files beneath the portable content root', () => {
  const runtime = makeRuntime();
  try {
    fs.mkdirSync(runtime.paths.resolve('Content/ZIM/Nested'), { recursive: true });
    fs.writeFileSync(runtime.paths.resolve('Content/ZIM/reference_en_2026-08.zim'), Buffer.alloc(123));
    fs.writeFileSync(runtime.paths.resolve('Content/ZIM/Nested/guide.zim'), Buffer.alloc(456));
    fs.writeFileSync(runtime.paths.resolve('Content/ZIM/ignore.txt'), 'not a zim');
    const service = new KiwixService(runtime.database, runtime.paths);
    const content = service.scan();
    assert.equal(content.length, 2);
    assert.deepEqual(content.map((item) => item.relativePath).sort(), [
      'Content/ZIM/Nested/guide.zim',
      'Content/ZIM/reference_en_2026-08.zim',
    ]);
  } finally {
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('installs and runs the official Kiwix engine with an official small ZIM', {
  skip: process.platform !== 'win32' || !fs.existsSync(archivePath) || !fs.existsSync(samplePath),
  timeout: 60_000,
}, async () => {
  const runtime = makeRuntime();
  const archive = fs.readFileSync(archivePath);
  const sample = fs.readFileSync(samplePath);
  const fetchFixture: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('kiwix-tools_win-x86_64-3.8.1.zip')) return new Response(archive);
    if (url.endsWith('/data/nons/small.zim')) return new Response(sample);
    return new Response('not found', { status: 404 });
  };
  const service = new KiwixService(runtime.database, runtime.paths, fetchFixture);
  try {
    const installed = await service.install();
    assert.equal(installed.ok, true, installed.message);
    assert.equal(service.status().engineVersion, '3.8.1');
    const sampleResult = await service.installSample();
    assert.equal(sampleResult.ok, true, sampleResult.message);
    assert.equal(sampleResult.status.content.length, 1);
    const marker = runtime.paths.resolve('Content/ZIM/user-marker.txt');
    fs.writeFileSync(marker, 'preserve');

    const started = await service.start();
    assert.equal(started.ok, true, started.message);
    const running = service.status();
    assert.equal(running.running, true);
    const response = await fetch(running.serverUrl!);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /small zimfile|Kiwix/i);
    await service.stop();
    assert.equal(service.status().running, false);

    const removed = await service.uninstall();
    assert.equal(removed.ok, true);
    assert.equal(fs.existsSync(runtime.paths.resolve('Modules/Installed/kiwix-engine')), false);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    assert.equal(fs.existsSync(runtime.paths.resolve('Content/ZIM/openzim-small.zim')), true);
  } finally {
    await service.stop(true);
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});
