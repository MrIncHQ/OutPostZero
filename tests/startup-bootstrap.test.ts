import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const main = fs.readFileSync('src/main/main.ts', 'utf8');

test('normal startup avoids recursive storage and GPU diagnostics', () => {
  const start = main.indexOf("ipcMain.handle('outpost:get-bootstrap'");
  const end = main.indexOf("ipcMain.handle('outpost:create-profile'", start);
  const bootstrap = main.slice(start, end);
  assert.match(bootstrap, /storageService\.quickSummary/);
  assert.doesNotMatch(bootstrap, /storageService\.summarize/);
  assert.match(bootstrap, /collectBasicHardwareDiagnostics/);
  assert.doesNotMatch(bootstrap, /app\.getGPUInfo/);
});

test('full database integrity check is limited to recovery startup', () => {
  const start = main.indexOf("ipcMain.handle('outpost:get-bootstrap'");
  const end = main.indexOf("ipcMain.handle('outpost:create-profile'", start);
  const bootstrap = main.slice(start, end);
  assert.match(bootstrap, /recoveredFromUncleanShutdown \? databaseService\.integrityCheck\(\) : null/);
  assert.match(main, /outpost:check-database-integrity/);
});
