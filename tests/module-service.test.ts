import assert from 'node:assert/strict';
import test from 'node:test';
import { ModuleService } from '../src/main/module-service';

test('shows only real and planned optional modules', () => {
  const service = new ModuleService();
  const modules = service.modules();

  assert.deepEqual(modules.map((module) => module.id), ['education', 'ocr', 'local-ai']);
  assert.equal(modules.some((module) => module.id === 'offline-maps'), false);
  assert.equal(modules.some((module) => module.id === 'portable-process-test'), false);
  assert.equal(modules.every((module) => module.status === 'available-later'), true);
});

test('planned modules cannot be operated before release', async () => {
  const service = new ModuleService();

  assert.equal((await service.install('education')).ok, false);
  assert.equal((await service.start('education')).ok, false);
  assert.equal((await service.repair('education')).ok, false);
  assert.equal((await service.uninstall('education')).ok, false);
  assert.equal((await service.stop('education')).ok, true);
  assert.equal(service.hasRunningModules(), false);
  await service.stopAll();
});

test('module summaries are returned as independent values', () => {
  const service = new ModuleService();
  const first = service.modules();
  first[0].name = 'Changed';
  assert.equal(service.modules()[0].name, 'Education Center');
});
