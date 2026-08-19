import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AiService, buildAiRetrievalQuery, evaluateAiModels, sanitizeAiCitations, supportsAiAcceleration } from '../src/main/ai-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import type { AiState, HardwareDiagnostics } from '../src/shared/contracts';

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

test('uses a real display GPU for portable acceleration but rejects software renderers', () => {
  assert.equal(supportsAiAcceleration({ ...hardware(32), gpuDevices: ['NVIDIA GeForce RTX 5080'] }), true);
  assert.equal(supportsAiAcceleration({ ...hardware(32), gpuDevices: ['AMD Radeon RX 7800 XT'] }), true);
  assert.equal(supportsAiAcceleration({ ...hardware(32), gpuDevices: ['Microsoft Basic Render Driver'] }), false);
});

test('carries the prior topic into referential follow-up retrieval', () => {
  assert.equal(buildAiRetrievalQuery([
    { role: 'user', content: 'Find me a PDF about survival skills.' },
    { role: 'assistant', content: 'Let me check.' },
    { role: 'user', content: 'Use the ones we have.' },
  ]), 'Find me a PDF about survival skills.\nUse the ones we have.');
  assert.equal(buildAiRetrievalQuery([
    { role: 'user', content: 'Find survival books.' },
    { role: 'assistant', content: 'Done.' },
    { role: 'user', content: 'Explain subnet masks in detail.' },
  ]), 'Explain subnet masks in detail.');
  assert.equal(buildAiRetrievalQuery([
    { role: 'user', content: 'Find emergency shelter manuals.' },
    { role: 'assistant', content: 'I found several.' },
    { role: 'user', content: 'Tell me more.' },
    { role: 'assistant', content: 'What would you like to know?' },
    { role: 'user', content: 'Which one should I open?' },
  ]), 'Find emergency shelter manuals.\nWhich one should I open?');
});

test('removes citation markers that do not correspond to supplied sources', () => {
  assert.deepEqual(sanitizeAiCitations('Supported [S1], invented [S9], and malformed [S0].', 2), {
    content: 'Supported [S1], invented, and malformed.', removed: 2,
  });
  assert.deepEqual(sanitizeAiCitations('General answer [S1].', 0), { content: 'General answer.', removed: 1 });
});

test('streams local chat text into observable progress', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-ai-stream-')); context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test'); const paths = new PortablePathService(root); paths.initializeLayout();
  const diagnostics = { ...hardware(16), gpuDevices: ['Test Vulkan GPU'] };
  const evaluated = evaluateAiModels(diagnostics, 'qwen3-0.6b-q8', new Set(['qwen3-0.6b-q8']));
  const state: AiState = { ...evaluated, runtimeInstalled: true, runtimeVersion: 'test', accelerationSupported: true, acceleratorInstalled: true, runtimeBackend: 'vulkan', runtimeMessage: 'GPU ready.', running: true, enabled: true, selectedModelId: 'qwen3-0.6b-q8', hardware: diagnostics, download: { state: 'idle', downloadedBytes: 0, totalBytes: 0, message: '' } };
  let requestBody = ''; let requestHeaders: HeadersInit | undefined;
  const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = String(init?.body ?? ''); requestHeaders = init?.headers;
    return new Response([
      'data: {"choices":[{"delta":{"content":"Fast "}}]}',
      'data: {"choices":[{"delta":{"content":"answer"}}]}',
      'data: {"choices":[],"usage":{"completion_tokens":2}}',
      'data: [DONE]',
      '',
    ].join('\n'));
  }) as typeof fetch;
  const service = new AiService(paths, async () => diagnostics, fetchImpl, async () => [{ id: 'source', kind: 'document', title: 'Guide', location: 'Page 1', excerpt: 'Relevant local fact.', context: 'Expanded matching page and neighboring page context.', documentId: 'guide-id', page: 1 }]);
  (service as unknown as { active: unknown }).active = { child: {}, port: 1234, modelId: 'qwen3-0.6b-q8', backend: 'vulkan', apiKey: 'test-secret' };
  service.state = async () => state;
  const result = await service.chat([{ role: 'user', content: 'Answer briefly.' }]);
  assert.equal(result.ok, true); assert.equal(result.response, 'Fast answer');
  assert.equal(service.getChatProgress().phase, 'complete'); assert.equal(service.getChatProgress().response, 'Fast answer');
  assert.equal(service.getChatProgress().generatedTokens, 2); assert.match(requestBody, /"stream":true/); assert.match(requestBody, /"max_tokens":768/); assert.match(requestBody, /host reports its local date and time/);
  assert.match(requestBody, /Expanded matching page and neighboring page context/);
  assert.equal(new Headers(requestHeaders).get('Authorization'), 'Bearer test-secret');
  assert.equal(service.getChatProgress().sources[0].documentId, 'guide-id');
  assert.match(service.getChatProgress().searchSummary ?? '', /1 confident document match/);
});
