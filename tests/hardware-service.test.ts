import assert from 'node:assert/strict';
import test from 'node:test';
import { collectHardwareDiagnostics } from '../src/main/hardware-service';

test('collects host diagnostics and normalizes GPU names', async () => {
  const diagnostics = await collectHardwareDiagnostics(Promise.resolve({
    gpuDevice: [{ active: true, deviceString: 'Test GPU' }, { deviceString: 'Test GPU' }],
  }));
  assert.ok(diagnostics.cpuModel.length > 0);
  assert.ok(diagnostics.logicalCores > 0);
  assert.ok(diagnostics.totalMemoryBytes > 0);
  assert.deepEqual(diagnostics.gpuDevices, ['Test GPU']);
});

test('continues when GPU information is unavailable', async () => {
  const diagnostics = await collectHardwareDiagnostics(Promise.reject(new Error('unavailable')));
  assert.deepEqual(diagnostics.gpuDevices, []);
});
