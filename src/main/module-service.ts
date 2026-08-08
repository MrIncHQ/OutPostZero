import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ModuleOperationResult, ModuleSummary } from '../shared/contracts';
import { BUILTIN_PROCESS_TEST_PACKAGE, MODULE_PACKAGE_PUBLIC_KEY } from './builtin-module-package';
import { DatabaseService } from './database-service';
import { PortablePathService } from './portable-path';

interface ModuleFile {
  path: string;
  size: number;
  sha256: string;
}

interface ModuleManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  platforms: string[];
  architectures: string[];
  downloadSize: number;
  installSize: number;
  ownedDirectories: string[];
  sharedDataDirectories: string[];
  dependencies: string[];
  runtimeCommand: { executable: 'host-runtime'; args: string[] };
  healthCheck: { type: 'http'; path: string; timeoutMs: number };
  networkPolicy: 'loopback-only';
  license: string;
  files: ModuleFile[];
}

interface VerifiedPackage {
  manifest: ModuleManifest;
  files: Map<string, Buffer>;
}

interface ActiveModule {
  child: ChildProcess;
  pid: number;
  port: number;
  startedAt: string;
  logPath: string;
  stopping: boolean;
}

const TEST_MODULE_ID = 'portable-process-test';

const plannedModules: ModuleSummary[] = [
  { id: 'library-engine', name: 'Offline Library Engine', description: 'Kiwix-compatible ZIM browsing and catalog management.', status: 'available-later', optional: true },
  { id: 'offline-maps', name: 'Offline Maps', description: 'Portable MapLibre map packages selected by the user.', status: 'available-later', optional: true },
  { id: 'education', name: 'Education Center', description: 'Drive-contained courses, lessons, and learning progress.', status: 'available-later', optional: true },
  { id: 'ocr', name: 'OCR Pack', description: 'Extract searchable text from image-only documents.', status: 'available-later', optional: true },
  { id: 'local-ai', name: 'Local AI Assistant', description: 'Optional portable AI runtime and user-selected model.', status: 'available-later', optional: true },
];

function sha256(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

export function validateModuleFilePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error(`Module file path must be relative portable notation: ${relativePath}`);
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Module file path contains traversal: ${relativePath}`);
  }
  return relativePath;
}

function parsePackage(rawPackage: unknown, verificationKey: string): VerifiedPackage {
  if (!rawPackage || typeof rawPackage !== 'object') throw new Error('Module package is invalid.');
  const envelope = rawPackage as { schemaVersion?: unknown; signedPayload?: unknown; signature?: unknown; files?: unknown };
  if (envelope.schemaVersion !== 1 || typeof envelope.signedPayload !== 'string'
    || typeof envelope.signature !== 'string' || !Array.isArray(envelope.files)) {
    throw new Error('Module package envelope is invalid.');
  }
  const signedPayload = Buffer.from(envelope.signedPayload, 'base64');
  if (!crypto.verify(null, signedPayload, verificationKey, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Module package signature verification failed.');
  }
  const manifest = JSON.parse(signedPayload.toString('utf8')) as Partial<ModuleManifest>;
  if (manifest.schemaVersion !== 1 || manifest.id !== TEST_MODULE_ID || typeof manifest.name !== 'string'
    || typeof manifest.description !== 'string' || typeof manifest.version !== 'string'
    || !Array.isArray(manifest.platforms) || !Array.isArray(manifest.architectures)
    || !Number.isSafeInteger(manifest.downloadSize) || !Number.isSafeInteger(manifest.installSize)
    || !Array.isArray(manifest.ownedDirectories) || !Array.isArray(manifest.sharedDataDirectories)
    || !Array.isArray(manifest.dependencies) || !manifest.runtimeCommand || !manifest.healthCheck
    || manifest.networkPolicy !== 'loopback-only' || typeof manifest.license !== 'string' || !Array.isArray(manifest.files)) {
    throw new Error('Signed module manifest is invalid.');
  }
  if (manifest.ownedDirectories.length !== 1 || manifest.ownedDirectories[0] !== `Modules/Installed/${TEST_MODULE_ID}`) {
    throw new Error('Module package declares an invalid owned directory.');
  }
  if (manifest.runtimeCommand.executable !== 'host-runtime'
    || manifest.runtimeCommand.args.length !== 1
    || manifest.runtimeCommand.args[0] !== 'runtime/server.cjs') {
    throw new Error('Module runtime command is not allowed.');
  }
  if (manifest.healthCheck.type !== 'http' || manifest.healthCheck.path !== '/health'
    || !Number.isSafeInteger(manifest.healthCheck.timeoutMs) || manifest.healthCheck.timeoutMs < 1000 || manifest.healthCheck.timeoutMs > 15_000) {
    throw new Error('Module health check is invalid.');
  }

  const packageFiles = new Map<string, Buffer>();
  for (const entry of envelope.files as Array<{ path?: unknown; content?: unknown }>) {
    if (typeof entry.path !== 'string' || typeof entry.content !== 'string') throw new Error('Module package file is invalid.');
    const filePath = validateModuleFilePath(entry.path);
    if (packageFiles.has(filePath)) throw new Error(`Duplicate module package file: ${filePath}`);
    packageFiles.set(filePath, Buffer.from(entry.content, 'base64'));
  }
  const manifestFiles = manifest.files as ModuleFile[];
  if (manifestFiles.length !== packageFiles.size) throw new Error('Module package file list does not match its manifest.');
  for (const file of manifestFiles) {
    const filePath = validateModuleFilePath(file.path);
    const content = packageFiles.get(filePath);
    if (!content || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[A-Fa-f0-9]{64}$/.test(file.sha256)
      || content.length !== file.size || sha256(content) !== file.sha256.toUpperCase()) {
      throw new Error(`Module package checksum verification failed: ${filePath}`);
    }
  }
  return { manifest: manifest as ModuleManifest, files: packageFiles };
}

export class ModuleService {
  private readonly active = new Map<string, ActiveModule>();
  private readonly errors = new Map<string, string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly paths: PortablePathService,
    private readonly packageEnvelope: unknown = BUILTIN_PROCESS_TEST_PACKAGE,
    private readonly verificationKey: string = MODULE_PACKAGE_PUBLIC_KEY,
  ) {}

  modules(): ModuleSummary[] {
    const installed = new Map(this.database.moduleRecords().map((record) => [record.moduleId, record]));
    const active = this.active.get(TEST_MODULE_ID);
    const error = this.errors.get(TEST_MODULE_ID);
    const record = installed.get(TEST_MODULE_ID);
    const testModule: ModuleSummary = {
      id: TEST_MODULE_ID,
      name: 'Portable Process Test',
      description: 'Proves signed installation, loopback health checks, process tracking, clean stop, repair, and safe uninstall.',
      status: active ? 'running' : error ? 'error' : record ? 'installed' : 'available',
      optional: true,
      version: record?.version ?? '1.0.0',
      pid: active?.pid,
      port: active?.port,
      startedAt: active?.startedAt,
      health: active ? 'healthy' : error ? 'unhealthy' : 'stopped',
      logPath: this.paths.resolve(`Logs/Modules/${TEST_MODULE_ID}.log`),
      testModule: true,
    };
    return [testModule, ...plannedModules];
  }

  private result(ok: boolean, message: string): ModuleOperationResult {
    return { ok, message, modules: this.modules() };
  }

  private ensureSupported(manifest: ModuleManifest): void {
    if (!manifest.platforms.includes(process.platform) || !manifest.architectures.includes(process.arch)) {
      throw new Error(`Module ${manifest.id} does not support ${process.platform}/${process.arch}.`);
    }
    let disk: ReturnType<typeof fs.statfsSync> | undefined;
    try { disk = fs.statfsSync(this.paths.root); } catch { disk = undefined; }
    if (disk && disk.bavail * disk.bsize < manifest.installSize + 10 * 1024 * 1024) {
      throw new Error('Not enough portable-drive space to stage and verify this module.');
    }
  }

  async install(moduleId: string): Promise<ModuleOperationResult> {
    if (moduleId !== TEST_MODULE_ID) return this.result(false, 'That module is not available for installation yet.');
    let stagingRoot: string | undefined;
    let rollbackRoot: string | undefined;
    let placedNewTarget = false;
    const target = this.paths.resolve(`Modules/Installed/${TEST_MODULE_ID}`);
    try {
      const verified = parsePackage(this.packageEnvelope, this.verificationKey);
      this.ensureSupported(verified.manifest);
      await this.stop(TEST_MODULE_ID, true);
      stagingRoot = this.paths.resolve(`Modules/Staging/${TEST_MODULE_ID}-${crypto.randomUUID()}`);
      fs.mkdirSync(stagingRoot, { recursive: true });
      for (const file of verified.manifest.files) {
        const content = verified.files.get(file.path)!;
        const destination = path.join(stagingRoot, ...file.path.split('/'));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content);
        if (fs.statSync(destination).size !== file.size || sha256(fs.readFileSync(destination)) !== file.sha256.toUpperCase()) {
          throw new Error(`Staged module file failed verification: ${file.path}`);
        }
      }
      fs.writeFileSync(path.join(stagingRoot, 'module.json'), `${JSON.stringify(verified.manifest, null, 2)}\n`, 'utf8');
      if (fs.existsSync(target)) {
        rollbackRoot = this.paths.resolve(`Modules/Staging/${TEST_MODULE_ID}-rollback-${crypto.randomUUID()}`);
        fs.renameSync(target, rollbackRoot);
      }
      fs.renameSync(stagingRoot, target);
      placedNewTarget = true;
      stagingRoot = undefined;
      await this.startInternal(verified.manifest, target);
      await this.stop(TEST_MODULE_ID, true);
      this.database.setModuleInstalled(TEST_MODULE_ID, verified.manifest.version);
      this.errors.delete(TEST_MODULE_ID);
      if (rollbackRoot && fs.existsSync(rollbackRoot)) fs.rmSync(rollbackRoot, { recursive: true, force: true });
      return this.result(true, `${verified.manifest.name} ${verified.manifest.version} installed and health-checked on this drive.`);
    } catch (error) {
      await this.stop(TEST_MODULE_ID, true);
      if (placedNewTarget && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      if (rollbackRoot && fs.existsSync(rollbackRoot)) fs.renameSync(rollbackRoot, target);
      if (stagingRoot && fs.existsSync(stagingRoot)) fs.rmSync(stagingRoot, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : 'Module installation failed.';
      this.errors.set(TEST_MODULE_ID, message);
      return this.result(false, message);
    }
  }

  repair(moduleId: string): Promise<ModuleOperationResult> {
    return this.install(moduleId);
  }

  async start(moduleId: string): Promise<ModuleOperationResult> {
    if (moduleId !== TEST_MODULE_ID) return this.result(false, 'That module cannot be started yet.');
    if (this.active.has(moduleId)) return this.result(true, 'Portable Process Test is already running.');
    const record = this.database.moduleRecords().find((candidate) => candidate.moduleId === moduleId);
    if (!record) return this.result(false, 'Install the Portable Process Test before starting it.');
    try {
      const verified = parsePackage(this.packageEnvelope, this.verificationKey);
      await this.startInternal(verified.manifest, this.paths.resolve(`Modules/Installed/${moduleId}`));
      this.errors.delete(moduleId);
      return this.result(true, 'Portable Process Test is healthy and bound only to 127.0.0.1.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Module process failed to start.';
      this.errors.set(moduleId, message);
      return this.result(false, message);
    }
  }

  private async startInternal(manifest: ModuleManifest, installedRoot: string): Promise<void> {
    const script = path.join(installedRoot, ...manifest.runtimeCommand.args[0].split('/'));
    if (!fs.existsSync(script)) throw new Error('Installed module runtime is missing. Repair the module.');
    const dataPath = this.paths.ensureDirectory(`Data/Modules/${manifest.id}`);
    const logPath = this.paths.resolve(`Logs/Modules/${manifest.id}.log`);
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    const child = spawn(process.execPath, [script], {
      cwd: installedRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OUTPOST_ZERO_MODULE_DATA: dataPath,
        TEMP: this.paths.resolve('Temp'),
        TMP: this.paths.resolve('Temp'),
        TMPDIR: this.paths.resolve('Temp'),
      },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    if (!child.pid || !child.stdout || !child.stderr) throw new Error('Module process could not be created.');
    const entry: ActiveModule = {
      child,
      pid: child.pid,
      port: 0,
      startedAt: new Date().toISOString(),
      logPath,
      stopping: false,
    };
    this.active.set(manifest.id, entry);
    child.stderr.pipe(log, { end: false });

    let output = '';
    const ready = new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Module health startup timed out.')), manifest.healthCheck.timeoutMs);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => {
        if (!entry.stopping && entry.port === 0) {
          clearTimeout(timeout);
          reject(new Error(`Module exited before becoming healthy (code ${code ?? 'unknown'}).`));
        }
      });
      child.stdout!.on('data', (chunk: Buffer) => {
        log.write(chunk);
        output += chunk.toString('utf8');
        const lines = output.split(/\r?\n/);
        output = lines.pop() ?? '';
        for (const line of lines) {
          try {
            const message = JSON.parse(line) as { type?: string; port?: number; startedAt?: string };
            if (message.type === 'ready' && Number.isInteger(message.port) && message.port! > 0 && message.port! <= 65535) {
              entry.port = message.port!;
              if (message.startedAt) entry.startedAt = message.startedAt;
              clearTimeout(timeout);
              resolve(entry.port);
            }
          } catch { /* Non-JSON output is retained only in the module log. */ }
        }
      });
    });

    child.once('exit', (code) => {
      log.end(`${new Date().toISOString()} process exited with code ${code ?? 'unknown'}\n`);
      if (this.active.get(manifest.id) === entry) this.active.delete(manifest.id);
      if (!entry.stopping) this.errors.set(manifest.id, `Process exited unexpectedly with code ${code ?? 'unknown'}.`);
    });

    try {
      const port = await ready;
      const response = await fetch(`http://127.0.0.1:${port}${manifest.healthCheck.path}`, {
        signal: AbortSignal.timeout(manifest.healthCheck.timeoutMs),
        cache: 'no-store',
      });
      const health = await response.json() as { ok?: boolean; moduleId?: string };
      if (!response.ok || health.ok !== true || health.moduleId !== manifest.id) throw new Error('Module health response was invalid.');
    } catch (error) {
      await this.stop(manifest.id, true);
      throw error;
    }
  }

  async stop(moduleId: string, quiet = false): Promise<ModuleOperationResult> {
    const entry = this.active.get(moduleId);
    if (!entry) return this.result(true, quiet ? '' : 'Module process is already stopped.');
    entry.stopping = true;
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => { if (!settled) { settled = true; resolve(); } };
      const timeout = setTimeout(() => {
        if (entry.child.exitCode === null) entry.child.kill();
        finish();
      }, 4000);
      entry.child.once('exit', () => { clearTimeout(timeout); finish(); });
      if (entry.child.connected) entry.child.send({ type: 'shutdown' });
      else entry.child.kill();
    });
    this.active.delete(moduleId);
    if (!quiet) this.errors.delete(moduleId);
    return this.result(true, quiet ? '' : 'Module process stopped cleanly.');
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.active.keys()].map((moduleId) => this.stop(moduleId, true)));
  }

  hasRunningModules(): boolean {
    return this.active.size > 0;
  }

  async uninstall(moduleId: string): Promise<ModuleOperationResult> {
    if (moduleId !== TEST_MODULE_ID) return this.result(false, 'That module is not installed.');
    await this.stop(moduleId, true);
    const target = this.paths.resolve(`Modules/Installed/${moduleId}`);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    this.database.removeModule(moduleId);
    this.errors.delete(moduleId);
    return this.result(true, 'Module engine removed. Its portable data and logs were kept.');
  }
}
