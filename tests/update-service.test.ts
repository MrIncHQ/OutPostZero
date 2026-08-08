import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseService } from '../src/main/database-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';
import { UpdateService } from '../src/main/update-service';

test('returns a safe result without network access when GitHub is not configured', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-updates-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  const database = new DatabaseService(paths);
  const updates = new UpdateService(database, '0.3.0');
  const result = await updates.check();
  assert.equal(result.status, 'not-configured');
  assert.match(result.message, /GitHub Releases/);
  database.close();
});
