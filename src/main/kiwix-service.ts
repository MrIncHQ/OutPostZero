import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import type { LibraryOperationResult, ModuleSummary, OfflineLibraryStatus, ZimContentSummary } from '../shared/contracts';
import { MODULE_PACKAGE_PUBLIC_KEY } from './builtin-module-package';
import { DatabaseService } from './database-service';
import { KIWIX_PACKAGE } from './kiwix-package';
import { PortablePathService } from './portable-path';

interface PackageFile { path: string; size: number; sha256: string }
interface DownloadFile extends PackageFile { url: string }
interface KiwixManifest {
  schemaVersion: 1;
  id: 'library-engine';
  name: string;
  version: string;
  platform: 'win32';
  architecture: 'x64';
  license: string;
  networkPolicy: 'loopback-only';
  ownedDirectory: 'Modules/Installed/kiwix-engine';
  sharedContentDirectory: 'Content/ZIM';
  executable: 'kiwix-serve.exe';
  archive: DownloadFile;
  files: PackageFile[];
  sampleContent: DownloadFile & { title: string };
}
interface ActiveKiwix { child: ChildProcess; pid: number; port: number; startedAt: string; stopping: boolean }
type FetchLike = typeof globalThis.fetch;

function hashBuffer(content: Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex').toUpperCase();
}

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex').toUpperCase();
}

function validateHash(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Fa-f0-9]{64}$/.test(value)) throw new Error('Kiwix package hash is invalid.');
  return value.toUpperCase();
}

export function validateKiwixPackagePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) throw new Error(`Kiwix package path is invalid: ${relativePath}`);
  const segments = relativePath.split('/');
  if (segments.length !== 1 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Kiwix package path is not a root file: ${relativePath}`);
  }
  return relativePath;
}

function parseFile(value: unknown): PackageFile {
  if (!value || typeof value !== 'object') throw new Error('Kiwix package file metadata is invalid.');
  const file = value as Partial<PackageFile>;
  if (typeof file.path !== 'string' || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new Error('Kiwix package file metadata is invalid.');
  }
  return { path: validateKiwixPackagePath(file.path), size: file.size, sha256: validateHash(file.sha256) };
}

function parseDownload(value: unknown): DownloadFile {
  const file = parseFile(value);
  const candidate = value as Partial<DownloadFile>;
  if (typeof candidate.url !== 'string') throw new Error('Kiwix download URL is invalid.');
  const url = new URL(candidate.url);
  if (url.protocol !== 'https:' || !['download.kiwix.org', 'raw.githubusercontent.com'].includes(url.hostname)) {
    throw new Error('Kiwix download host is not allowed.');
  }
  return { ...file, url: url.toString() };
}

export function verifyKiwixPackage(raw: unknown, publicKey = MODULE_PACKAGE_PUBLIC_KEY): KiwixManifest {
  if (!raw || typeof raw !== 'object') throw new Error('Kiwix package envelope is invalid.');
  const envelope = raw as { schemaVersion?: unknown; signedPayload?: unknown; signature?: unknown };
  if (envelope.schemaVersion !== 1 || typeof envelope.signedPayload !== 'string' || typeof envelope.signature !== 'string') {
    throw new Error('Kiwix package envelope is invalid.');
  }
  const signedPayload = Buffer.from(envelope.signedPayload, 'base64');
  if (!crypto.verify(null, signedPayload, publicKey, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Kiwix package signature verification failed.');
  }
  const rawManifest = JSON.parse(signedPayload.toString('utf8')) as Partial<KiwixManifest>;
  if (rawManifest.schemaVersion !== 1 || rawManifest.id !== 'library-engine' || typeof rawManifest.name !== 'string'
    || typeof rawManifest.version !== 'string' || rawManifest.platform !== 'win32' || rawManifest.architecture !== 'x64'
    || rawManifest.networkPolicy !== 'loopback-only' || rawManifest.ownedDirectory !== 'Modules/Installed/kiwix-engine'
    || rawManifest.sharedContentDirectory !== 'Content/ZIM' || rawManifest.executable !== 'kiwix-serve.exe'
    || typeof rawManifest.license !== 'string' || !Array.isArray(rawManifest.files) || !rawManifest.archive || !rawManifest.sampleContent) {
    throw new Error('Signed Kiwix package manifest is invalid.');
  }
  const files = rawManifest.files.map(parseFile);
  if (new Set(files.map((file) => file.path.toLowerCase())).size !== files.length
    || !files.some((file) => file.path.toLowerCase() === 'kiwix-serve.exe')) {
    throw new Error('Kiwix package file list is incomplete or duplicated.');
  }
  const sample = parseDownload(rawManifest.sampleContent);
  if (typeof rawManifest.sampleContent.title !== 'string' || sample.path !== 'openzim-small.zim') throw new Error('Kiwix sample metadata is invalid.');
  return {
    schemaVersion: 1, id: 'library-engine', name: rawManifest.name, version: rawManifest.version,
    platform: 'win32', architecture: 'x64', license: rawManifest.license, networkPolicy: 'loopback-only',
    ownedDirectory: 'Modules/Installed/kiwix-engine', sharedContentDirectory: 'Content/ZIM', executable: 'kiwix-serve.exe',
    archive: parseDownload(rawManifest.archive), files, sampleContent: { ...sample, title: rawManifest.sampleContent.title },
  };
}

function run(command: string, args: string[], cwd: string, timeoutMs = 30_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Process timed out: ${path.basename(command)}`)); }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(command)} failed with code ${code ?? 'unknown'}: ${stderr || stdout}`));
    });
  });
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') { server.close(); reject(new Error('Could not allocate a loopback port.')); return; }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

export class KiwixService {
  private active: ActiveKiwix | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly paths: PortablePathService,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly packageEnvelope: unknown = KIWIX_PACKAGE,
    private readonly verificationKey: string = MODULE_PACKAGE_PUBLIC_KEY,
  ) {}

  private manifest(): KiwixManifest { return verifyKiwixPackage(this.packageEnvelope, this.verificationKey); }

  summary(): ModuleSummary {
    const record = this.database.moduleRecords().find((candidate) => candidate.moduleId === 'library-engine');
    return {
      id: 'library-engine', name: 'Offline Library Engine',
      description: 'Kiwix-powered ZIM browsing, contained on this drive and served only over loopback.',
      status: this.active ? 'running' : this.lastError ? 'error' : record ? 'installed' : 'available', optional: true,
      version: record?.version ?? this.manifest().version, pid: this.active?.pid, port: this.active?.port,
      startedAt: this.active?.startedAt, health: this.active ? 'healthy' : this.lastError ? 'unhealthy' : 'stopped',
      logPath: this.paths.resolve('Logs/Modules/library-engine.log'),
    };
  }

  scan(): ZimContentSummary[] {
    const root = this.paths.ensureDirectory('Content/ZIM');
    const content: ZimContentSummary[] = [];
    const walk = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) walk(candidate);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.zim')) {
          const relativePath = path.relative(this.paths.root, candidate).replace(/\\/g, '/');
          const stem = path.basename(entry.name, path.extname(entry.name));
          content.push({
            id: hashBuffer(Buffer.from(relativePath.toLowerCase())).slice(0, 16),
            name: stem.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
            fileName: entry.name,
            relativePath,
            size: fs.statSync(candidate).size,
          });
        }
      }
    };
    walk(root);
    return content.sort((left, right) => left.name.localeCompare(right.name));
  }

  status(): OfflineLibraryStatus {
    const record = this.database.moduleRecords().find((candidate) => candidate.moduleId === 'library-engine');
    return {
      engineInstalled: Boolean(record), engineVersion: record?.version ?? null, running: Boolean(this.active),
      pid: this.active?.pid, port: this.active?.port,
      serverUrl: this.active ? `http://127.0.0.1:${this.active.port}/` : undefined,
      content: this.scan(),
    };
  }

  private result(ok: boolean, message: string): LibraryOperationResult { return { ok, message, status: this.status() }; }

  private async download(file: DownloadFile, destination: string): Promise<void> {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination) && fs.statSync(destination).size === file.size && await hashFile(destination) === file.sha256) return;
    const temporary = `${destination}.download`;
    try {
      const response = await this.fetchImpl(file.url, { signal: AbortSignal.timeout(300_000), cache: 'no-store', headers: { 'User-Agent': 'Outpost-Zero-Kiwix' } });
      if (!response.ok || !response.body) throw new Error(`Kiwix download returned HTTP ${response.status}.`);
      await pipeline(Readable.fromWeb(response.body as never), fs.createWriteStream(temporary));
      if (fs.statSync(temporary).size !== file.size || await hashFile(temporary) !== file.sha256) throw new Error(`Downloaded Kiwix file failed verification: ${file.path}`);
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  async install(): Promise<{ ok: boolean; message: string }> {
    const manifest = this.manifest();
    if (process.platform !== manifest.platform || process.arch !== manifest.architecture) return { ok: false, message: 'This Kiwix engine package supports Windows x64 only.' };
    const packagePath = this.paths.resolve(`Modules/Packages/${manifest.archive.path}`);
    const target = this.paths.resolve('Modules/Installed/kiwix-engine');
    let staging: string | undefined;
    let rollback: string | undefined;
    let placed = false;
    try {
      const installBytes = manifest.archive.size + manifest.files.reduce((sum, file) => sum + file.size, 0) + 50 * 1024 * 1024;
      try {
        const disk = fs.statfsSync(this.paths.root);
        if (disk.bavail * disk.bsize < installBytes) throw new Error(`Kiwix installation requires at least ${Math.ceil(installBytes / 1024 / 1024)} MB free.`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Kiwix installation requires')) throw error;
      }
      await this.stop(true);
      await this.download(manifest.archive, packagePath);
      staging = this.paths.resolve(`Modules/Staging/kiwix-engine-${crypto.randomUUID()}`);
      fs.mkdirSync(staging, { recursive: true });
      const extractor = this.paths.resolve('resources/Extract_Kiwix.ps1');
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', extractor,
        '-PortableRoot', this.paths.root, '-ArchivePath', packagePath, '-StagingRoot', staging], this.paths.root, 120_000);
      const stagedFiles = fs.readdirSync(staging, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
      const expectedFiles = manifest.files.map((file) => file.path).sort();
      if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) throw new Error('Extracted Kiwix package contains unexpected files.');
      for (const file of manifest.files) {
        const staged = path.join(staging, file.path);
        if (fs.statSync(staged).size !== file.size || await hashFile(staged) !== file.sha256) throw new Error(`Extracted Kiwix file failed verification: ${file.path}`);
      }
      if (fs.existsSync(target)) {
        rollback = this.paths.resolve(`Modules/Staging/kiwix-engine-rollback-${crypto.randomUUID()}`);
        fs.renameSync(target, rollback);
      }
      fs.renameSync(staging, target);
      placed = true;
      staging = undefined;
      const version = await run(path.join(target, manifest.executable), ['--version'], target);
      if (!`${version.stdout}\n${version.stderr}`.includes(`kiwix-tools ${manifest.version}`)) throw new Error('Installed Kiwix engine reported an unexpected version.');
      this.database.setModuleInstalled('library-engine', manifest.version);
      this.lastError = null;
      if (rollback && fs.existsSync(rollback)) fs.rmSync(rollback, { recursive: true, force: true });
      return { ok: true, message: `Kiwix Tools ${manifest.version} installed and verified on this drive.` };
    } catch (error) {
      if (placed && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      if (rollback && fs.existsSync(rollback)) fs.renameSync(rollback, target);
      if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : 'Kiwix installation failed.';
      this.lastError = message;
      return { ok: false, message };
    }
  }

  repair(): Promise<{ ok: boolean; message: string }> { return this.install(); }

  async installSample(): Promise<LibraryOperationResult> {
    try {
      const sample = this.manifest().sampleContent;
      let destination = this.paths.resolve(`Content/ZIM/${sample.path}`);
      if (fs.existsSync(destination) && fs.statSync(destination).size === sample.size && await hashFile(destination) === sample.sha256) {
        return this.result(true, `${sample.title} is already installed and verified.`);
      }
      if (fs.existsSync(destination) && (fs.statSync(destination).size !== sample.size || await hashFile(destination) !== sample.sha256)) {
        destination = this.paths.resolve(`Content/ZIM/openzim-small-${sample.sha256.slice(0, 8).toLowerCase()}.zim`);
      }
      const staged = this.paths.resolve(`Downloads/${path.basename(destination)}.staging`);
      await this.download(sample, staged);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      if (!fs.existsSync(destination)) fs.renameSync(staged, destination);
      else if (fs.existsSync(staged)) fs.rmSync(staged, { force: true });
      return this.result(true, `${sample.title} downloaded and verified.`);
    } catch (error) {
      return this.result(false, error instanceof Error ? error.message : 'Sample ZIM download failed.');
    }
  }

  async start(): Promise<{ ok: boolean; message: string }> {
    if (this.active) return { ok: true, message: 'Offline Library Engine is already running.' };
    const record = this.database.moduleRecords().find((candidate) => candidate.moduleId === 'library-engine');
    if (!record) return { ok: false, message: 'Install the Offline Library Engine first.' };
    const content = this.scan();
    if (content.length === 0) return { ok: false, message: 'Add at least one ZIM file to Content/ZIM before starting Kiwix.' };
    const executable = this.paths.resolve('Modules/Installed/kiwix-engine/kiwix-serve.exe');
    if (!fs.existsSync(executable)) return { ok: false, message: 'Kiwix engine files are missing. Repair the module.' };
    const port = await availablePort();
    const logPath = this.paths.resolve('Logs/Modules/library-engine.log');
    const log = fs.createWriteStream(logPath, { flags: 'a' });
    const args = ['--address=127.0.0.1', `--port=${port}`, '--blockexternal', `--attachToProcess=${process.pid}`,
      ...content.map((item) => this.paths.resolve(item.relativePath))];
    const child = spawn(executable, args, {
      cwd: path.dirname(executable), shell: false, windowsHide: true,
      env: { ...process.env, TEMP: this.paths.resolve('Temp'), TMP: this.paths.resolve('Temp'), TMPDIR: this.paths.resolve('Temp') },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!child.pid) return { ok: false, message: 'Kiwix process could not be created.' };
    const entry: ActiveKiwix = { child, pid: child.pid, port, startedAt: new Date().toISOString(), stopping: false };
    this.active = entry;
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.once('exit', (code) => {
      log.end(`${new Date().toISOString()} Kiwix exited with code ${code ?? 'unknown'}\n`);
      if (this.active === entry) this.active = null;
      if (!entry.stopping) this.lastError = `Kiwix exited unexpectedly with code ${code ?? 'unknown'}.`;
    });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (child.exitCode !== null) break;
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000), cache: 'no-store' });
          if (response.ok) { ready = true; break; }
        } catch { /* Continue polling until startup deadline. */ }
      }
      if (!ready) throw new Error('Kiwix did not become healthy on loopback. Check the module log or repair the engine.');
      this.lastError = null;
      return { ok: true, message: `Kiwix is serving ${content.length} ZIM file${content.length === 1 ? '' : 's'} on 127.0.0.1:${port}.` };
    } catch (error) {
      await this.stop(true);
      const message = error instanceof Error ? error.message : 'Kiwix failed to start.';
      this.lastError = message;
      return { ok: false, message };
    }
  }

  async stop(quiet = false): Promise<{ ok: boolean; message: string }> {
    const entry = this.active;
    if (!entry) return { ok: true, message: quiet ? '' : 'Offline Library Engine is already stopped.' };
    entry.stopping = true;
    await new Promise<void>((resolve) => {
      let complete = false;
      const finish = () => { if (!complete) { complete = true; resolve(); } };
      const timeout = setTimeout(() => { if (entry.child.exitCode === null) entry.child.kill(); finish(); }, 4000);
      entry.child.once('exit', () => { clearTimeout(timeout); finish(); });
      entry.child.kill();
    });
    if (this.active === entry) this.active = null;
    if (!quiet) this.lastError = null;
    return { ok: true, message: quiet ? '' : 'Offline Library Engine stopped.' };
  }

  async uninstall(): Promise<{ ok: boolean; message: string }> {
    await this.stop(true);
    const manifest = this.manifest();
    const target = this.paths.resolve('Modules/Installed/kiwix-engine');
    const archive = this.paths.resolve(`Modules/Packages/${manifest.archive.path}`);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    if (fs.existsSync(archive)) fs.rmSync(archive, { force: true });
    this.database.removeModule('library-engine');
    this.lastError = null;
    return { ok: true, message: 'Kiwix engine removed. All ZIM libraries in Content/ZIM were kept.' };
  }

  hasRunningProcess(): boolean { return Boolean(this.active); }
}
