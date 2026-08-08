import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const executable = path.resolve(process.argv[2] ?? 'Releases/OutpostZero-Windows-x64/Outpost Zero.exe');
const runtime = path.resolve('module-packages/process-test/runtime/server.cjs');
if (!fs.existsSync(executable)) throw new Error(`Packaged executable is missing: ${executable}`);
if (!fs.existsSync(runtime)) throw new Error(`Test module runtime is missing: ${runtime}`);

const expectedDataPath = path.join(path.dirname(executable), 'Data', 'Modules', 'portable-process-test');
const child = spawn(executable, [runtime], {
  cwd: path.dirname(executable),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OUTPOST_ZERO_MODULE_DATA: expectedDataPath },
  shell: false,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});

let output = '';
let stderr = '';
child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Packaged module host timed out. ${stderr}`)), 10_000);
  child.once('error', (error) => { clearTimeout(timeout); reject(error); });
  child.once('exit', (code) => { if (!output.includes('"type":"ready"')) reject(new Error(`Packaged host exited early with code ${code}. ${stderr}`)); });
  child.stdout.on('data', (chunk) => {
    output += chunk.toString('utf8');
    for (const line of output.split(/\r?\n/)) {
      try {
        const message = JSON.parse(line);
        if (message.type === 'ready') {
          clearTimeout(timeout);
          resolve(message);
        }
      } catch { /* Wait for a complete JSON line. */ }
    }
  });
});

try {
  const message = await ready;
  const response = await fetch(`http://127.0.0.1:${message.port}/health`, { signal: AbortSignal.timeout(5000) });
  const health = await response.json();
  if (!response.ok || health.ok !== true || health.moduleId !== 'portable-process-test'
    || path.resolve(health.dataPath) !== path.resolve(expectedDataPath)) {
    throw new Error(`Packaged module health response was invalid: ${JSON.stringify(health)}`);
  }
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.send({ type: 'shutdown' });
  const exitCode = await exited;
  if (exitCode !== 0) throw new Error(`Packaged module did not stop cleanly: ${exitCode}`);
  console.log(JSON.stringify({ ok: true, executable, pid: health.pid, port: message.port, binding: '127.0.0.1', cleanExit: true }, null, 2));
} finally {
  if (child.exitCode === null) child.kill();
}
