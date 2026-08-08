import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SessionState } from '../src/main/session-state';

test('records active state and then a clean shutdown', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-session-'));
  const session = new SessionState(directory);
  const active = JSON.parse(fs.readFileSync(path.join(directory, 'session.json'), 'utf8'));
  assert.equal(active.clean, false);
  session.markClean();
  const closed = JSON.parse(fs.readFileSync(path.join(directory, 'session.json'), 'utf8'));
  assert.equal(closed.clean, true);
  assert.ok(closed.closedAt);
});

test('detects a prior unclean shutdown', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-recovery-'));
  fs.writeFileSync(path.join(directory, 'session.json'), JSON.stringify({ clean: false, processId: 1, startedAt: 'test' }));
  const session = new SessionState(directory);
  assert.equal(session.recoveredFromUncleanShutdown, true);
});
