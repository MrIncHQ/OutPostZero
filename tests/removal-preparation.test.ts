import assert from 'node:assert/strict';
import test from 'node:test';
import { RemovalPreparation } from '../src/main/removal-preparation';
import { flushPendingSaves, registerPendingSave } from '../src/renderer/pending-saves';

test('concurrent and repeated removal requests only back up and close once', async () => {
  const calls: string[] = [];
  const preparation = new RemovalPreparation([
    async () => { await new Promise((resolve) => setTimeout(resolve, 10)); calls.push('stop'); },
    () => { calls.push('backup'); },
    () => { calls.push('close'); },
  ]);
  await Promise.all([preparation.run(), preparation.run()]);
  await preparation.run();
  assert.deepEqual(calls, ['stop', 'backup', 'close']);
});

test('retry after a failure does not back up an already closed database', async () => {
  const calls: string[] = [];
  let attempts = 0;
  const preparation = new RemovalPreparation([
    () => { calls.push('backup'); },
    () => { calls.push('close'); },
    () => { if (++attempts === 1) throw new Error('Drive write failed'); calls.push('clean'); },
  ]);
  await assert.rejects(preparation.run(), /Drive write failed/);
  await preparation.run();
  assert.deepEqual(calls, ['backup', 'close', 'clean']);
});

test('drive removal waits for pending edits and surfaces save failures for retry', async () => {
  let saved = false;
  let fail = true;
  const unregister = registerPendingSave(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    if (fail) throw new Error('write failed');
    saved = true;
  });
  try {
    await assert.rejects(flushPendingSaves(), /latest edits could not be saved/);
    assert.equal(saved, false);
    fail = false;
    await flushPendingSaves();
    assert.equal(saved, true);
  } finally { unregister(); }
});
