import fs from 'node:fs';
import path from 'node:path';

export const ROOT_MARKER = '.outpost-zero-root';

const MANAGED_DIRECTORIES = [
  'AI/Embeddings', 'AI/Indexes', 'AI/Models', 'AI/Runtime', 'Backups', 'Cache', 'Config',
  'Content/Books', 'Content/Custom', 'Content/Documents', 'Content/Education', 'Content/Maps', 'Content/Notes/Attachments',
  'Content/Media', 'Content/PDFs', 'Content/ZIM', 'Data/Chat', 'Data/Media', 'Data/Medication', 'Data/Notes', 'Data/Search',
  'Data/State', 'Data/Modules', 'Downloads', 'Exports', 'Logs', 'Logs/Modules', 'Modules/Installed', 'Modules/Manifests',
  'Modules/Packages', 'Modules/Staging', 'Profile/Identity', 'Temp', 'Updates',
] as const;

function normalizeForComparison(value: string): string {
  const normalized = path.resolve(value).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function isWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

export function findPortableRoot(startLocations: string[]): string {
  const override = process.env.OUTPOST_ZERO_ROOT;
  const locations = override ? [override, ...startLocations] : startLocations;
  for (const start of locations) {
    let current = path.resolve(start);
    while (true) {
      if (fs.existsSync(path.join(current, ROOT_MARKER))) return fs.realpathSync(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error(`Portable root not found. Missing ${ROOT_MARKER}.`);
}

export class PortablePathService {
  readonly root: string;

  constructor(root: string) {
    const resolved = fs.realpathSync(path.resolve(root));
    if (!fs.existsSync(path.join(resolved, ROOT_MARKER))) {
      throw new Error(`Invalid portable root: ${ROOT_MARKER} is missing.`);
    }
    this.root = resolved;
  }

  resolve(relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new Error(`Portable paths must be non-empty and relative: ${relativePath}`);
    }
    const candidate = path.resolve(this.root, relativePath);
    if (!isWithinRoot(this.root, candidate)) throw new Error(`Portable path escaped the root: ${relativePath}`);
    return candidate;
  }

  ensureDirectory(relativePath: string): string {
    const target = this.resolve(relativePath);
    fs.mkdirSync(target, { recursive: true });
    const realTarget = fs.realpathSync(target);
    if (!isWithinRoot(this.root, realTarget)) throw new Error(`Portable path resolved outside the root: ${relativePath}`);
    return realTarget;
  }

  initializeLayout(): Record<string, string> {
    const paths: Record<string, string> = {};
    for (const relativePath of MANAGED_DIRECTORIES) paths[relativePath] = this.ensureDirectory(relativePath);
    return paths;
  }
}
