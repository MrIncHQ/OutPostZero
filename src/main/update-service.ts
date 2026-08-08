import crypto from 'node:crypto';
import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import type {
  UpdateApplyResult,
  UpdateCheckResult,
  UpdateDownloadResult,
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

  constructor(
    private readonly database: DatabaseService,
    private readonly currentVersion: string,
    private readonly paths: PortablePathService,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
    private readonly verificationKey: string = UPDATE_PUBLIC_KEY,
  ) {
    this.stateDirectory = paths.ensureDirectory('Updates/State');
    this.pendingFile = path.join(this.stateDirectory, 'pending-update.json');
  }

  status(): UpdateStatus {
    return this.database.updateStatus(this.currentVersion);
  }

  private async loadManifest(): Promise<UpdateManifestPayload> {
    const response = await this.fetchImpl(manifestUrl, {
      headers: { Accept: 'application/json', 'User-Agent': 'Outpost-Zero-Updater' },
      signal: AbortSignal.timeout(15_000),
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
        return { status: 'not-configured', message: 'The GitHub update source is not configured.', currentVersion: this.currentVersion };
      }
      const manifest = await this.loadManifest();
      this.availableManifest = manifest;
      if (compareVersions(manifest.version, this.currentVersion) <= 0) {
        return { status: 'up-to-date', message: `Outpost Zero ${this.currentVersion} is current.`, currentVersion: this.currentVersion };
      }
      return {
        status: 'available',
        message: `Outpost Zero ${manifest.version} is available from GitHub.`,
        currentVersion: this.currentVersion,
        availableVersion: manifest.version,
        downloadBytes: manifest.files.reduce((sum, file) => sum + file.size, manifest.executable.parts.reduce((sum, part) => sum + part.size, 0)),
      };
    } catch (error) {
      this.availableManifest = null;
      return { status: 'error', message: error instanceof Error ? error.message : 'Update check failed.', currentVersion: this.currentVersion };
    }
  }

  private async downloadFile(file: ManifestFile, destination: string): Promise<void> {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const response = await this.fetchImpl(remoteUrl(file.path), {
      headers: { 'User-Agent': 'Outpost-Zero-Updater' },
      signal: AbortSignal.timeout(300_000),
      cache: 'no-store',
    });
    if (!response.ok || !response.body) throw new Error(`GitHub returned HTTP ${response.status} for ${file.path}.`);
    const temporary = `${destination}.download`;
    try {
      await pipeline(Readable.fromWeb(response.body as never), createWriteStream(temporary));
      const stats = fs.statSync(temporary);
      if (stats.size !== file.size || await sha256File(temporary) !== file.sha256) throw new Error(`Downloaded file failed verification: ${file.path}`);
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
    }
  }

  async download(): Promise<UpdateDownloadResult> {
    try {
      const manifest = this.availableManifest ?? await this.loadManifest();
      if (compareVersions(manifest.version, this.currentVersion) <= 0) {
        return { status: 'no-update', message: 'No newer update is available.' };
      }
      const stagingDirectory = `${safeStagingVersion(manifest.version)}-${crypto.randomUUID()}`;
      const stagingRelative = `Updates/Staging/${stagingDirectory}`;
      const stagingRoot = this.paths.resolve(stagingRelative);
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
        await this.downloadFile(file, staged);
        changed.push(file);
        downloadedBytes += file.size;
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
          await this.downloadFile(part, destination);
          downloadedBytes += part.size;
        }
        const stagedExecutable = path.join(stagingRoot, executable.path);
        const output = createWriteStream(stagedExecutable);
        for (const part of executable.parts) {
          await pipeline(createReadStream(path.join(stagingRoot, ...part.path.split('/'))), output, { end: false });
        }
        output.end();
        await new Promise<void>((resolve, reject) => {
          output.once('finish', resolve);
          output.once('error', reject);
        });
        if (fs.statSync(stagedExecutable).size !== executable.size || await sha256File(stagedExecutable) !== executable.sha256) {
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
      return {
        status: 'ready',
        message: `Outpost Zero ${manifest.version} is verified and ready to install.`,
        version: manifest.version,
        changedFiles: changed.length,
        downloadedBytes,
      };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : 'Update download failed.' };
    }
  }

  apply(processId: number): UpdateApplyResult {
    try {
      if (!fs.existsSync(this.pendingFile)) return { status: 'not-ready', message: 'No verified update is ready to install.' };
      const pending = JSON.parse(fs.readFileSync(this.pendingFile, 'utf8')) as PendingUpdate;
      safeStagingVersion(pending.version);
      const stagingDirectory = safeStagingDirectory(pending.stagingDirectory ?? pending.version);
      const stagingRoot = this.paths.resolve(`Updates/Staging/${stagingDirectory}`);
      const updater = this.paths.resolve('PortableUpdater.ps1');
      if (!fs.existsSync(updater)) throw new Error('Portable updater helper is missing.');
      const child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updater,
        '-PortableRoot', this.paths.root,
        '-StagingRoot', stagingRoot,
        '-PendingFile', this.pendingFile,
        '-ProcessId', String(processId),
      ], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      return { status: 'launching', message: 'Outpost Zero will close, apply the update, verify it, and restart.' };
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : 'Could not launch the portable updater.' };
    }
  }
}
