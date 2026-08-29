import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseService } from '../src/main/database-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';

function createDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-database-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  return { root, database: new DatabaseService(paths) };
}

test('creates and migrates the portable SQLite database', () => {
  const { root, database } = createDatabase();
  assert.equal(database.schemaVersion(), 7);
  assert.equal(database.integrityCheck(), true);
  assert.equal(fs.existsSync(path.join(root, 'Data', 'outpost-zero.sqlite')), true);
  database.close();
});

test('configures GitHub updates with automatic checks disabled', () => {
  const { database } = createDatabase();
  const updates = database.updateStatus('0.3.0');
  assert.equal(updates.provider, 'github');
  assert.equal(updates.configured, true);
  assert.equal(updates.repositoryOwner, 'MrIncHQ');
  assert.equal(updates.repositoryName, 'OutPostZero');
  assert.equal(updates.automaticChecks, false);
  assert.equal(updates.currentVersion, '0.3.0');
  database.close();
});

test('creates a portable database backup before removal', async () => {
  const { root, database } = createDatabase();
  const backupPath = await database.createRotatingBackup();
  assert.equal(path.dirname(backupPath), path.join(root, 'Backups'));
  assert.equal(fs.existsSync(backupPath), true);
  assert.ok(fs.statSync(backupPath).size > 0);
  database.close();
});
