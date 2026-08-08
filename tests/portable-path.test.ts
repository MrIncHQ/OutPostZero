import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findPortableRoot, isWithinRoot, PortablePathService, ROOT_MARKER } from '../src/main/portable-path';

function makeRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `outpost-zero-${label}-`));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  return root;
}

test('finds the portable root from an arbitrary nested launch path', () => {
  const root = makeRoot('nested');
  const nested = path.join(root, 'Runtime', 'windows-x64', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  assert.equal(findPortableRoot([nested]), fs.realpathSync(root));
});

test('resolves and creates managed paths beneath the root', () => {
  const root = makeRoot('managed');
  const paths = new PortablePathService(root);
  const created = paths.ensureDirectory('Data/State');
  assert.equal(created, fs.realpathSync(path.join(root, 'Data', 'State')));
  assert.equal(isWithinRoot(root, created), true);
});

test('rejects absolute paths and traversal outside the root', () => {
  const root = makeRoot('escape');
  const paths = new PortablePathService(root);
  assert.throws(() => paths.resolve('../host-data'), /escaped the root/);
  assert.throws(() => paths.resolve(path.resolve(root, 'Data')), /must be non-empty and relative/);
});

test('continues to work when the complete root is moved', () => {
  const original = makeRoot('move-source');
  const state = new PortablePathService(original);
  fs.writeFileSync(path.join(state.ensureDirectory('Data/State'), 'proof.txt'), 'portable');
  const destinationParent = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-move-target-'));
  const moved = path.join(destinationParent, 'OutpostZero');
  fs.renameSync(original, moved);
  const relocated = new PortablePathService(findPortableRoot([path.join(moved, 'Data')]));
  assert.equal(fs.readFileSync(relocated.resolve('Data/State/proof.txt'), 'utf8'), 'portable');
  assert.equal(relocated.root, fs.realpathSync(moved));
});
