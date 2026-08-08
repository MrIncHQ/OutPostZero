import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BUILTIN_PROCESS_TEST_PACKAGE, MODULE_PACKAGE_PUBLIC_KEY } from '../src/main/builtin-module-package';
import { DatabaseService } from '../src/main/database-service';
import { ModuleService, validateModuleFilePath } from '../src/main/module-service';
import { PortablePathService } from '../src/main/portable-path';

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-module-'));
  fs.writeFileSync(path.join(root, '.outpost-zero-root'), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  const database = new DatabaseService(paths);
  const modules = new ModuleService(database, paths);
  return { root, paths, database, modules };
}

test('rejects module file traversal and absolute paths', () => {
  assert.throws(() => validateModuleFilePath('../outside.exe'), /traversal/);
  assert.throws(() => validateModuleFilePath('runtime\\server.cjs'), /portable notation/);
  assert.throws(() => validateModuleFilePath(path.resolve('outside.exe')), /portable notation/);
  assert.equal(validateModuleFilePath('runtime/server.cjs'), 'runtime/server.cjs');
});

test('installs, health-checks, runs, stops, and safely uninstalls the portable process test', async () => {
  const runtime = makeRuntime();
  try {
    assert.equal(runtime.modules.modules()[0].status, 'available');
    const installed = await runtime.modules.install('portable-process-test');
    assert.equal(installed.ok, true, installed.message);
    assert.equal(installed.modules[0].status, 'installed');
    assert.equal(fs.existsSync(runtime.paths.resolve('Modules/Installed/portable-process-test/runtime/server.cjs')), true);
    assert.deepEqual(fs.readdirSync(runtime.paths.resolve('Modules/Staging')), []);

    const started = await runtime.modules.start('portable-process-test');
    assert.equal(started.ok, true, started.message);
    const summary = started.modules[0];
    assert.equal(summary.status, 'running');
    assert.ok(summary.pid && summary.pid > 0);
    assert.ok(summary.port && summary.port > 0);
    const health = await fetch(`http://127.0.0.1:${summary.port}/health`).then((response) => response.json()) as {
      ok: boolean;
      moduleId: string;
      dataPath: string;
    };
    assert.equal(health.ok, true);
    assert.equal(health.moduleId, 'portable-process-test');
    assert.equal(path.resolve(health.dataPath), runtime.paths.resolve('Data/Modules/portable-process-test'));

    const stopped = await runtime.modules.stop('portable-process-test');
    assert.equal(stopped.ok, true);
    assert.equal(stopped.modules[0].status, 'installed');
    const userState = runtime.paths.resolve('Data/Modules/portable-process-test/user-state.txt');
    fs.writeFileSync(userState, 'keep this data');
    const removed = await runtime.modules.uninstall('portable-process-test');
    assert.equal(removed.ok, true);
    assert.equal(removed.modules[0].status, 'available');
    assert.equal(fs.existsSync(runtime.paths.resolve('Modules/Installed/portable-process-test')), false);
    assert.equal(fs.readFileSync(userState, 'utf8'), 'keep this data');
    assert.equal(fs.existsSync(runtime.paths.resolve('Logs/Modules/portable-process-test.log')), true);
  } finally {
    await runtime.modules.stopAll();
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('rejects a forged package without removing the installed working module', async () => {
  const runtime = makeRuntime();
  try {
    const installed = await runtime.modules.install('portable-process-test');
    assert.equal(installed.ok, true, installed.message);
    const installedRuntime = runtime.paths.resolve('Modules/Installed/portable-process-test/runtime/server.cjs');
    const original = fs.readFileSync(installedRuntime);
    const forged = JSON.parse(JSON.stringify(BUILTIN_PROCESS_TEST_PACKAGE)) as {
      signature: string;
    };
    const signature = Buffer.from(forged.signature, 'base64');
    signature[0] ^= 0xff;
    forged.signature = signature.toString('base64');
    const forgedService = new ModuleService(runtime.database, runtime.paths, forged, MODULE_PACKAGE_PUBLIC_KEY);

    const repaired = await forgedService.repair('portable-process-test');
    assert.equal(repaired.ok, false);
    assert.match(repaired.message, /signature verification failed/);
    assert.deepEqual(fs.readFileSync(installedRuntime), original);
    assert.equal(runtime.database.moduleRecords()[0].status, 'installed');
  } finally {
    await runtime.modules.stopAll();
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('rolls back to the installed engine when a signed replacement fails its health check', async () => {
  const runtime = makeRuntime();
  try {
    const installed = await runtime.modules.install('portable-process-test');
    assert.equal(installed.ok, true, installed.message);
    const installedRuntime = runtime.paths.resolve('Modules/Installed/portable-process-test/runtime/server.cjs');
    const original = fs.readFileSync(installedRuntime);
    const keys = crypto.generateKeyPairSync('ed25519');
    const unhealthyRuntime = Buffer.from('process.exit(23);\n');
    const payload = JSON.parse(Buffer.from(BUILTIN_PROCESS_TEST_PACKAGE.signedPayload, 'base64').toString('utf8')) as {
      downloadSize: number;
      installSize: number;
      files: Array<{ path: string; size: number; sha256: string }>;
    };
    payload.downloadSize = unhealthyRuntime.length;
    payload.installSize = unhealthyRuntime.length;
    payload.files[0].size = unhealthyRuntime.length;
    payload.files[0].sha256 = crypto.createHash('sha256').update(unhealthyRuntime).digest('hex').toUpperCase();
    const signedPayload = Buffer.from(JSON.stringify(payload));
    const unhealthyPackage = {
      schemaVersion: 1,
      signedPayload: signedPayload.toString('base64'),
      signature: crypto.sign(null, signedPayload, keys.privateKey).toString('base64'),
      files: [{ path: 'runtime/server.cjs', content: unhealthyRuntime.toString('base64') }],
    };
    const testKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const unhealthyService = new ModuleService(runtime.database, runtime.paths, unhealthyPackage, testKey);

    const repaired = await unhealthyService.repair('portable-process-test');
    assert.equal(repaired.ok, false);
    assert.match(repaired.message, /exited before becoming healthy/);
    assert.deepEqual(fs.readFileSync(installedRuntime), original);
    assert.equal(runtime.database.moduleRecords()[0].status, 'installed');
  } finally {
    await runtime.modules.stopAll();
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});
