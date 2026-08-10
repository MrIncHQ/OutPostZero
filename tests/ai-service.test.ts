import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AiService, evaluateAiModels } from '../src/main/ai-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import type { HardwareDiagnostics } from '../src/shared/contracts';

const GIB = 1024 ** 3;

function hardware(memoryGiB: number): HardwareDiagnostics {
  return { cpuModel: 'Test CPU', logicalCores: 8, totalMemoryBytes: memoryGiB * GIB, freeMemoryBytes: memoryGiB * GIB / 2, operatingSystem: 'Windows', platform: 'win32', architecture: 'x64', hostname: 'test', gpuDevices: [], gpuChecked: true };
}

test('recommends the highest conservative tier for current host memory', () => {
  assert.equal(evaluateAiModels(hardware(8), null, new Set()).recommendedModelId, 'qwen3-0.6b-q8');
  assert.equal(evaluateAiModels(hardware(16), null, new Set()).recommendedModelId, 'qwen3-4b-q8');
  assert.equal(evaluateAiModels(hardware(24), null, new Set()).recommendedModelId, 'qwen3-8b-q8');
});

test('locks a selected model after moving the drive to a weaker host', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-ai-')); context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test'); const paths = new PortablePathService(root); paths.initializeLayout();
  let diagnostics = hardware(24); const service = new AiService(paths, () => Promise.resolve(diagnostics));
  await service.selectModel('qwen3-8b-q8');
  assert.equal((await service.state()).models.find((model) => model.selected)?.compatible, true);
  diagnostics = hardware(8);
  const moved = await service.state();
  assert.equal(moved.selectedModelId, 'qwen3-8b-q8');
  assert.equal(moved.enabled, false);
  assert.equal(moved.models.find((model) => model.selected)?.compatible, false);
  assert.equal(moved.recommendedModelId, 'qwen3-0.6b-q8');
});

test('unsupported platforms offer no recommendation and cannot enable AI', () => {
  const diagnostics = { ...hardware(32), platform: 'linux' as const };
  const result = evaluateAiModels(diagnostics, 'qwen3-4b-q8', new Set(['qwen3-4b-q8']));
  assert.equal(result.supportedHost, false);
  assert.equal(result.recommendedModelId, null);
  assert.equal(result.models.every((model) => !model.compatible), true);
});
