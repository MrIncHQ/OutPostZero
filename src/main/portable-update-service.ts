import crypto from 'node:crypto';
import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import type {
  UpdateApplyResult,
  UpdateCheckResult,
  UpdateDownloadResult,
  UpdateActivity,
  UpdateStatus,
} from '../shared/contracts';
import { DatabaseService } from './database-service';
import { PortablePathService } from './portable-path';
import { UPDATE_PUBLIC_KEY, UPDATE_REPOSITORY } from './update-trust';

export const PROTECTED_DATA_ROOTS = new Set([
  'ai', 'backups', 'cache', 'config', 'content', 'data', 'downloads',
  'exports', 'logs', 'modules', 'profile', 'temp', 'updates',
]);

const ALLOWED_RUNTIME_DIRECTORIES = new Set(['locales', 'resources']);
const ALLOWED_ROOT_FILES = new Set([
  'Outpost Zero.exe', 'Run_Outpost_Zero.bat', 'PortableUpdater.ps1', 'README.txt',
  'LICENSE.electron.txt', 'LICENSES.chromium.html', 'chrome_100_percent.pak',
  'chrome_200_percent.pak', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll',
  'ffmpeg.dll', 'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll', 'resources.pak',
  'snapshot_blob.bin', 'v8_context_snapshot.bin', 'vk_swiftshader.dll',
  'vk_swiftshader_icd.json', 'vulkan-1.dll',
]);

interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}

interface UpdateManifestPayload {
  schemaVersion: 1;
  version: string;
  publishedAt: string;
  platform: 'win32';
  architecture: 'x64';
  files: ManifestFile[];
  executable: ManifestFile & { parts: ManifestFile[] };
}

interface SignedManifestEnvelope {
  schemaVersion: 1;
  signedPayload: string;
  signature: string;
}

interface PendingUpdate {
  version: string;
  previousVersion: string;
  createdAt: string;
  stagingDirectory?: string;
  files: ManifestFile[];
}

type FetchLike = typeof globalThis.fetch;

const manifestUrl = `https://raw.githubusercontent.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}/${UPDATE_REPOSITORY.branch}/update-manifest.json`;
const rawBaseUrl = `https://raw.githubusercontent.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}/${UPDATE_REPOSITORY.branch}`;

function normalizeHash(value: string): string {
  if (!/^[A-Fa-f0-9]{64}$/.test(value)) throw new Error('Update manifest contains an invalid SHA-256 hash.');
  return value.toUpperCase();
}

export function validateRuntimePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error(`Update path must use portable forward-slash notation: ${relativePath}`);
  }
  const segments = relativePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Update path contains traversal or empty segments: ${relativePath}`);
  }
  if (PROTECTED_DATA_ROOTS.has(segments[0].toLowerCase())) {
    throw new Error(`Update path targets protected user data: ${relativePath}`);
  }
  if (segments.length === 1) {
    if (!ALLOWED_ROOT_FILES.has(segments[0])) throw new Error(`Update path is not an owned runtime file: ${relativePath}`);
  } else if (!ALLOWED_RUNTIME_DIRECTORIES.has(segments[0].toLowerCase())) {
    throw new Error(`Update path is outside owned runtime directories: ${relativePath}`);
  }
  return relativePath;
}

function validateManifestFile(file: unknown): ManifestFile {
  if (!file || typeof file !== 'object') throw new Error('Update manifest contains an invalid file entry.');
  const candidate = file as Partial<ManifestFile>;
  if (typeof candidate.path !== 'string' || typeof candidate.size !== 'number' || candidate.size < 0 || !Number.isSafeInteger(candidate.size)) {
    throw new Error('Update manifest file metadata is invalid.');
  }
  return { path: validateRuntimePath(candidate.path), size: candidate.size, sha256: normalizeHash(String(candidate.sha256)) };
}

function parseVersion(version: string): number[] {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Unsupported update version: ${version}`);
  return match.slice(1).map(Number);
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex').toUpperCase();
}

function safeStagingVersion(version: string): string {
  parseVersion(version);
  return version;
}

function safeStagingDirectory(directory: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/.test(directory)) {
    throw new Error('Update staging directory is invalid.');
  }
  return directory;
}

function remoteUrl(relativePath: string): string {
  return `${rawBaseUrl}/${relativePath.split('/').map(encodeURIComponent).join('/')}`;
}

export class UpdateService {
  private availableManifest: UpdateManifestPayload | null = null;
  private readonly stateDirectory: string;
  private readonly pendingFile: string;
  private downloadAbort: AbortController | null = null;
  private downloadSettled: Promise<void> | null = null;
  private settleDownload: (() => void) | null = null;
  private activity: UpdateActivity = { state: 'idle', message: 'No update activity.', downloadedBytes: 0, totalBytes: 0 };

  constructor(
    private readonly database: DatabaseService,
    private readonly currentVersion: string,
    private readonly paths: PortablePathService,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly verificationKey: string = UPDATE_PUBLIC_KEY,
  ) {
    this.stateDirectory = paths.ensureDirectory('Updates/State');
    this.pendingFile = path.join(this.stateDirectory, 'pending-update.json');
    try { this.cleanRollbackHistory(); }
    catch { /* A locked rollback is retried on the next launch or successful update. */ }
  }

  status(): UpdateStatus {
    return { ...this.database.updateStatus(this.currentVersion), readyVersion: this.readyVersion() };
  }

  activityStatus(): UpdateActivity {
    const readyVersion = this.readyVersion();
    if (readyVersion && !this.downloadAbort) return { state: 'ready', version: readyVersion, message: `Outpost Zero ${readyVersion} is verified and ready to install.`, downloadedBytes: this.activity.downloadedBytes, totalBytes: this.activity.totalBytes };
    return { ...this.activity };
  }

  hasActiveDownload(): boolean { return Boolean(this.downloadAbort); }

  async shutdown(): Promise<void> {
    this.downloadAbort?.abort();
    await this.downloadSettled;
  }

  private readPending(): PendingUpdate | null {
    try {
      if (!fs.existsSync(this.pendingFile)) return null;
      const pending = JSON.parse(fs.readFileSync(this.pendingFile, 'utf8')) as PendingUpdate;
      safeStagingVersion(pending.version);
      pending.stagingDirectory = safeStagingDirectory(pending.stagingDirectory ?? pending.version);
      if (!Array.isArray(pending.files)) return null;
      pending.files = pending.files.map(validateManifestFile);
      return pending;
    } catch { return null; }
  }

  private readyVersion(): string | null {
    const pending = this.readPending();
    if (!pending || compareVersions(pending.version, this.currentVersion) <= 0) return null;
    const stagingRoot = this.paths.resolve(`Updates/Staging/${pending.stagingDirectory}`);
    return pending.files.every((file) => {
      const staged = path.join(stagingRoot, ...file.path.split('/'));
      return fs.existsSync(staged) && fs.statSync(staged).size === file.size;
    }) ? pending.version : null;
  }

  private cleanStagingExcept(keptDirectories: Set<string>): void {
    const stagingRoot = this.paths.ensureDirectory('Updates/Staging');
    for (const entry of fs.readdirSync(stagingRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || keptDirectories.has(entry.name)) continue;
      try { safeStagingDirectory(entry.name); }
      catch { continue; }
      fs.rmSync(path.join(stagingRoot, entry.name), { recursive: true, force: true });
    }
  }

  private cleanRollbackHistory(keep = 1): void {
    const rollbackRoot = this.paths.ensureDirectory('Updates/Rollback');
    const ownedName = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?-\d{8}-\d{6}$/;
    const owned = fs.readdirSync(rollbackRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && ownedName.test(entry.name))
      .map((entry) => ({ name: entry.name, modified: fs.statSync(path.join(rollbackRoot, entry.name)).mtimeMs }))
      .sort((left, right) => right.modified - left.modified);
    for (const obsolete of owned.slice(Math.max(1, keep))) {
      fs.rmSync(path.join(rollbackRoot, obsolete.name), { recursive: true, force: true });
    }
  }

  private async loadManifest(cancelSignal?: AbortSignal): Promise<UpdateManifestPayload> {
    const response = await this.fetchImpl(manifestUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'Outpost-Zero-Updater' },
      signal: cancelSignal ? AbortSignal.any([cancelSignal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for the update manifest.`);
    const envelope = await response.json() as Partial<SignedManifestEnvelope>;
    if (envelope.schemaVersion !== 1 || typeof envelope.signedPayload !== 'string' || typeof envelope.signature !== 'string') {
      throw new Error('Update manifest envelope is invalid.');
    }
    const signedBytes = Buffer.from(envelope.signedPayload, 'base64');
    const signature = Buffer.from(envelope.signature, 'base64');
    if (!crypto.verify(null, signedBytes, this.verificationKey, signature)) {
      throw new Error('Update manifest signature verification failed.');
    }
    const rawPayload = JSON.parse(signedBytes.toString('utf8')) as Partial<UpdateManifestPayload>;
    if (rawPayload.schemaVersion !== 1 || typeof rawPayload.version !== 'string' || typeof rawPayload.publishedAt !== 'string'
      || rawPayload.platform !== 'win32' || rawPayload.architecture !== 'x64' || !Array.isArray(rawPayload.files)
      || !rawPayload.executable || !Array.isArray(rawPayload.executable.parts)) {
      throw new Error('Signed update payload is invalid or incompatible.');
    }
    parseVersion(rawPayload.version);
    const files = rawPayload.files.map(validateManifestFile);
    const executableBase = validateManifestFile(rawPayload.executable);
    if (executableBase.path !== 'Outpost Zero.exe') throw new Error('Executable update target is invalid.');
    const parts = rawPayload.executable.parts.map((part) => {
      if (!part || typeof part !== 'object') throw new Error('Executable part metadata is invalid.');
      const candidate = part as Partial<ManifestFile>;
      if (typeof candidate.path !== 'string' || !/^RuntimeParts\/OutpostZero\.exe\.\d{3}$/.test(candidate.path)
        || typeof candidate.size !== 'number' || candidate.size <= 0 || !Number.isSafeInteger(candidate.size)) {
        throw new Error('Executable part metadata is invalid.');
      }
      return { path: candidate.path, size: candidate.size, sha256: normalizeHash(String(candidate.sha256)) };
    });
    const uniquePaths = new Set(files.map((file) => file.path));
    if (uniquePaths.size !== files.length || uniquePaths.has('Outpost Zero.exe')) throw new Error('Update manifest contains duplicate targets.');
    return {
      schemaVersion: 1,
      version: rawPayload.version,
      publishedAt: rawPayload.publishedAt,
      platform: 'win32',
      architecture: 'x64',
      files,
      executable: { ...executableBase, parts },
    };
  }

  async check(): Promise<UpdateCheckResult> {
    try {
      const status = this.status();
      if (!status.configured) {
        this.activity = { state: 'error', message: 'The GitHub update source is not configured.', downloadedBytes: 0, totalBytes: 0 };
        return { status: 'not-configured', message: 'The GitHub update source is not configured.', currentVersion: this.currentVersion };
      }
      const manifest = await this.loadManifest();
      this.availableManifest = manifest;
      if (compareVersions(manifest.version, this.currentVersion) <= 0) {
        this.activity = { state: 'idle', message: `Outpost Zero ${this.currentVersion} is current.`, downloadedBytes: 0, totalBytes: 0 };
        return { status: 'up-to-date', message: `Outpost Zero ${this.currentVersion} is current.`, currentVersion: this.currentVersion };
      }
      const readyToInstall = this.readyVersion() === manifest.version;
      const downloadBytes = readyToInstall ? 0 : manifest.files.reduce((sum, file) => sum + file.size, manifest.executable.parts.reduce((sum, part) => sum + part.size, 0));
      this.activity = { state: readyToInstall ? 'ready' : 'available', version: manifest.version, message: readyToInstall ? `Outpost Zero ${manifest.version} is already verified and ready to install.` : `Outpost Zero ${manifest.version} is available from GitHub.`, downloadedBytes: 0, totalBytes: downloadBytes };
      return {
        status: 'available',
        message: readyToInstall
          ? `Outpost Zero ${manifest.version} is already verified and ready to install.`
          : `Outpost Zero ${manifest.version} is available from GitHub.`,
        currentVersion: this.currentVersion,
        availableVersion: manifest.version,
        downloadBytes,
        readyToInstall,
      };
    } catch (error) {
      this.availableManifest = null;
      const message = error instanceof Error ? error.message : 'Update check failed.'; this.activity = { state: 'error', message, downloadedBytes: 0, totalBytes: 0 };
      return { status: 'error', message, currentVersion: this.currentVersion };
    }
  }

  private async downloadFile(file: ManifestFile, destination: string, downloadSignal: AbortSignal): Promise<number> {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    if (fs.existsSync(destination)) {
      if (fs.statSync(destination).size === file.size && await sha256File(destination) === file.sha256) return 0;
      fs.rmSync(destination, { force: true });
    }
    const temporary = `${destination}.download`;
    let offset = fs.existsSync(temporary) ? fs.statSync(temporary).size : 0;
    if (offset > file.size) { fs.rmSync(temporary, { force: true }); offset = 0; }
    let hash = crypto.createHash('sha256');
    if (offset) for await (const chunk of createReadStream(temporary)) {
      if (downloadSignal.aborted) throw new Error('Update download paused.');
      hash.update(chunk as Buffer);
    }
    if (offset === file.size) {
      if (hash.digest('hex').toUpperCase() === file.sha256) { fs.renameSync(temporary, destination); return 0; }
      fs.rmSync(temporary, { force: true }); offset = 0; hash = crypto.createHash('sha256');
    }
    const headers: Record<string, string> = { 'User-Agent': 'Outpost-Zero-Updater', 'Accept-Encoding': 'identity' };
    if (offset) headers.Range = `bytes=${offset}-`;
    const signal = AbortSignal.any([downloadSignal, AbortSignal.timeout(300_000)]);
    const response = await this.fetchImpl(remoteUrl(file.path), { headers, signal, cache: 'no-store' });
    if (!response.ok || !response.body) throw new Error(`GitHub returned HTTP ${response.status} for ${file.path}.`);
    if (offset && response.status !== 206) {
      if (response.status !== 200) throw new Error(`GitHub did not honor the saved update range for ${file.path}.`);
      fs.truncateSync(temporary, 0); offset = 0; hash = crypto.createHash('sha256');
    }
    if (response.status === 206) {
      const contentRange = response.headers.get('content-range');
      if (contentRange && contentRange.toLowerCase() !== `bytes ${offset}-${file.size - 1}/${file.size}`.toLowerCase()) {
        await response.body.cancel();
        throw new Error(`GitHub returned an unexpected saved update range for ${file.path}.`);
      }
    }
    let received = 0;
    const authenticate = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
      hash.update(chunk); received += chunk.length; callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as never), authenticate, createWriteStream(temporary, { flags: offset ? 'a' : 'w' }));
    const completedBytes = offset + received;
    if (completedBytes !== file.size) throw new Error(`Update file size mismatch for ${file.path}. Saved ${completedBytes} of ${file.size} bytes for resume.`);
    if (hash.digest('hex').toUpperCase() !== file.sha256) {
      fs.rmSync(temporary, { force: true });
      throw new Error(`Downloaded file failed verification and its invalid partial was removed: ${file.path}`);
    }
    fs.renameSync(temporary, destination);
    return received;
  }

  async download(): Promise<UpdateDownloadResult> {
    if (this.downloadAbort) return { status: 'error', message: 'An update download is already active.' };
    const controller = new AbortController();
    this.downloadAbort = controller;
    this.downloadSettled = new Promise<void>((resolve) => { this.settleDownload = resolve; });
    try {
      const manifest = this.availableManifest ?? await this.loadManifest(controller.signal);
      if (compareVersions(manifest.version, this.currentVersion) <= 0) {
        return { status: 'no-update', message: 'No newer update is available.' };
      }
      const stagingDirectory = safeStagingVersion(manifest.version);
      const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, manifest.executable.parts.reduce((sum, part) => sum + part.size, 0));
      this.activity = { state: 'downloading', version: manifest.version, message: `Downloading Outpost Zero ${manifest.version}...`, downloadedBytes: 0, totalBytes };
      const stagingRelative = `Updates/Staging/${stagingDirectory}`;
      const stagingRoot = this.paths.resolve(stagingRelative);
      const previousPending = this.readPending();
      this.cleanStagingExcept(new Set([stagingDirectory, ...(previousPending?.stagingDirectory ? [previousPending.stagingDirectory] : [])]));
      const conservativeRequiredBytes = manifest.files.reduce((sum, file) => sum + file.size, 0)
        + manifest.executable.parts.reduce((sum, part) => sum + part.size, 0)
        + manifest.executable.size
        + (fs.existsSync(this.paths.resolve('Outpost Zero.exe')) ? fs.statSync(this.paths.resolve('Outpost Zero.exe')).size : 0)
        + 100 * 1024 * 1024;
      try {
        const disk = fs.statfsSync(this.paths.root);
        const freeBytes = disk.bavail * disk.bsize;
        if (freeBytes < conservativeRequiredBytes) {
          throw new Error(`Not enough portable-drive space for safe staging and rollback. Required: ${Math.ceil(conservativeRequiredBytes / 1024 / 1024)} MB.`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Not enough portable-drive space')) throw error;
        // Filesystems without statfs support continue; per-file writes still fail safely in staging.
      }
      fs.mkdirSync(stagingRoot, { recursive: true });
      const changed: ManifestFile[] = [];
      let downloadedBytes = 0;

      for (const file of manifest.files) {
        const current = this.paths.resolve(file.path);
        if (fs.existsSync(current) && fs.statSync(current).size === file.size && await sha256File(current) === file.sha256) continue;
        const staged = path.join(stagingRoot, ...file.path.split('/'));
        this.activity = { ...this.activity, message: `Downloading and verifying ${file.path}...` };
        downloadedBytes += await this.downloadFile(file, staged, controller.signal); this.activity = { ...this.activity, downloadedBytes };
        changed.push(file);
      }

      const executable = manifest.executable;
      const currentExecutable = this.paths.resolve(executable.path);
      const executableMatches = fs.existsSync(currentExecutable)
        && fs.statSync(currentExecutable).size === executable.size
        && await sha256File(currentExecutable) === executable.sha256;
      if (!executableMatches) {
        const partsRoot = path.join(stagingRoot, 'RuntimeParts');
        fs.mkdirSync(partsRoot, { recursive: true });
        for (const part of executable.parts) {
          const destination = path.join(stagingRoot, ...part.path.split('/'));
          this.activity = { ...this.activity, message: `Downloading and verifying ${part.path}...` };
          downloadedBytes += await this.downloadFile(part, destination, controller.signal); this.activity = { ...this.activity, downloadedBytes };
        }
        this.activity = { ...this.activity, state: 'verifying', message: 'Assembling and verifying the portable executable...' };
        const stagedExecutable = path.join(stagingRoot, executable.path);
        const output = createWriteStream(stagedExecutable);
        const executableHash = crypto.createHash('sha256');
        for (const part of executable.parts) {
          const authenticate = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
            executableHash.update(chunk); callback(null, chunk);
          } });
          await pipeline(createReadStream(path.join(stagingRoot, ...part.path.split('/'))), authenticate, output, { end: false, signal: controller.signal });
        }
        output.end();
        await new Promise<void>((resolve, reject) => {
          output.once('finish', resolve);
          output.once('error', reject);
        });
        if (fs.statSync(stagedExecutable).size !== executable.size || executableHash.digest('hex').toUpperCase() !== executable.sha256) {
          throw new Error('Assembled update executable failed verification.');
        }
        fs.rmSync(partsRoot, { recursive: true, force: true });
        changed.push({ path: executable.path, size: executable.size, sha256: executable.sha256 });
      }

      const pending: PendingUpdate = {
        version: manifest.version,
        previousVersion: this.currentVersion,
        createdAt: new Date().toISOString(),
        stagingDirectory,
        files: changed,
      };
      const temporaryPending = `${this.pendingFile}.new`;
      fs.writeFileSync(temporaryPending, `${JSON.stringify(pending, null, 2)}\n`, 'utf8');
      fs.renameSync(temporaryPending, this.pendingFile);
      this.cleanStagingExcept(new Set([stagingDirectory]));
      this.activity = { state: 'ready', version: manifest.version, message: `Outpost Zero ${manifest.version} is verified and ready to install.`, downloadedBytes, totalBytes };
      return {
        status: 'ready',
        message: `Outpost Zero ${manifest.version} is verified and ready to install.`,
        version: manifest.version,
        changedFiles: changed.length,
        downloadedBytes,
      };
    } catch (error) {
      const paused = controller.signal.aborted; const message = paused ? 'Update download paused. Reopen Outpost Zero and choose Download Update to resume.' : error instanceof Error ? error.message : 'Update download failed.';
      this.activity = { ...this.activity, state: paused ? 'paused' : 'error', message };
      return { status: 'error', message };
    } finally {
      if (this.downloadAbort === controller) this.downloadAbort = null;
      this.settleDownload?.();
      this.settleDownload = null;
      this.downloadSettled = null;
    }
  }

  async apply(processId: number): Promise<UpdateApplyResult> {
    try {
      if (!fs.existsSync(this.pendingFile)) return { status: 'not-ready', message: 'No verified update is ready to install.' };
      const pending = JSON.parse(fs.readFileSync(this.pendingFile, 'utf8')) as PendingUpdate;
      safeStagingVersion(pending.version);
      const stagingDirectory = safeStagingDirectory(pending.stagingDirectory ?? pending.version);
      const stagingRoot = this.paths.resolve(`Updates/Staging/${stagingDirectory}`);
      const updater = this.paths.resolve('PortableUpdater.ps1');
      if (!fs.existsSync(updater)) throw new Error('Portable updater helper is missing.');
      const bootstrap = this.paths.resolve('resources/UpdaterBootstrap.ps1');
      if (!fs.existsSync(bootstrap)) throw new Error('Portable updater bootstrap is missing.');
      const handshake = path.join(this.stateDirectory, `updater-started-${crypto.randomUUID()}.txt`);
      const child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', bootstrap,
        '-Updater', updater,
        '-PortableRoot', this.paths.root,
        '-StagingRoot', stagingRoot,
        '-PendingFile', this.pendingFile,
        '-ProcessId', String(processId),
        '-HandshakeFile', handshake,
      ], { stdio: 'ignore', windowsHide: true });
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill();
          reject(new Error('Portable updater did not confirm startup. Outpost Zero will remain open.'));
        }, 20_000);
        child.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', (code) => {
          clearTimeout(timeout);
          if (code === 0 && fs.existsSync(handshake)) resolve();
          else reject(new Error(`Portable updater bootstrap failed before startup confirmation (code ${code ?? 'unknown'}).`));
        });
      });
      fs.rmSync(handshake, { force: true });
      return { status: 'launching', message: 'Outpost Zero will close, apply the update, verify it, and restart.' };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : 'Could not launch the portable updater.' };
    }
  }
}
