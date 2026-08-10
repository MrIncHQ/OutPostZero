import assert from 'node:assert/strict';
import test from 'node:test';
import { ModuleService } from '../src/main/module-service';

test('shows only real and planned optional modules', () => {
  const service = new ModuleService();
  const modules = service.modules();

  assert.deepEqual(modules.map((module) => module.id), ['local-ai']);
  assert.equal(modules.some((module) => module.id === 'offline-maps'), false);
  assert.equal(modules.some((module) => module.id === 'portable-process-test'), false);
  assert.equal(modules.every((module) => module.status === 'available-later'), true);
});

test('planned modules cannot be operated before release', async () => {
  const service = new ModuleService();

  assert.equal((await service.install('local-ai')).ok, false);
  assert.equal((await service.start('local-ai')).ok, false);
  assert.equal((await service.repair('local-ai')).ok, false);
  assert.equal((await service.uninstall('local-ai')).ok, false);
  assert.equal((await service.stop('local-ai')).ok, true);
  assert.equal(service.hasRunningModules(), false);
  await service.stopAll();
});

test('module summaries are returned as independent values', () => {
  const service = new ModuleService();
  const first = service.modules();
  first[0].name = 'Changed';
  assert.equal(service.modules()[0].name, 'Local AI Assistant');
});
