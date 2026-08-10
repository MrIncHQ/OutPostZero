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
