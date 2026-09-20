import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import { StorageService } from '../src/main/storage-service';

test('summarizes portable content by category', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-storage-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  fs.writeFileSync(paths.resolve('Content/PDFs/manual.pdf'), Buffer.alloc(1024));
  fs.writeFileSync(paths.resolve('Content/ZIM/reference.zim'), Buffer.alloc(2048));

  const summary = await new StorageService(paths).summarize();
  assert.equal(summary.categories.find((item) => item.id === 'documents')?.bytes, 1024);
  assert.equal(summary.categories.find((item) => item.id === 'knowledge')?.bytes, 2048);
  assert.ok(summary.usedByOutpostBytes >= 3072);
  assert.ok(summary.totalBytes === null || summary.totalBytes > 0);
  assert.ok(summary.scannedAt);
});

test('quick storage summary does not scan portable content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-storage-quick-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  fs.writeFileSync(paths.resolve('Content/ZIM/large-reference.zim'), Buffer.alloc(2048));

  const summary = new StorageService(paths).quickSummary(100, 200);
  assert.equal(summary.usedByOutpostBytes, 0);
  assert.equal(summary.categories.find((item) => item.id === 'knowledge')?.bytes, 0);
  assert.equal(summary.freeBytes, 100);
  assert.equal(summary.totalBytes, 200);
  assert.equal(summary.scannedAt, null);
});

test('Nature models and state are counted exactly once alongside other AI and data', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-storage-nature-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  for (const [file, size] of [
    ['AI/Nature/Models/model.bin', 1024], ['Data/Nature/index.bin', 2048],
    ['Content/Nature/Packs/pack.bin', 4096], ['AI/Models/chat.bin', 8192],
    ['Data/State/settings.json', 512],
  ] as const) fs.writeFileSync(paths.resolve(file), Buffer.alloc(size));
  const summary = await new StorageService(paths).summarize();
  assert.equal(summary.categories.find((item) => item.id === 'nature')?.bytes, 7168);
  assert.equal(summary.categories.find((item) => item.id === 'ai')?.bytes, 8192);
  assert.equal(summary.categories.find((item) => item.id === 'outpost-data')?.bytes, 512);
  assert.equal(summary.usedByOutpostBytes, 15872);
});
