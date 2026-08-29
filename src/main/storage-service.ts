import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageCategory, StorageSummary } from '../shared/contracts';
import { PortablePathService } from './portable-path';

interface CategoryDefinition {
  id: string;
  label: string;
  roots: string[];
}

const CATEGORIES: CategoryDefinition[] = [
  { id: 'knowledge', label: 'Knowledge', roots: ['Content/ZIM'] },
  { id: 'nature', label: 'Nature', roots: ['Content/Nature', 'AI/Nature', 'Data/Nature'] },
  { id: 'maps', label: 'Maps', roots: ['Content/Maps'] },
  { id: 'documents', label: 'Documents', roots: ['Content/PDFs', 'Content/Documents', 'Content/Books'] },
  { id: 'notes', label: 'Note Attachments', roots: ['Content/Notes'] },
  { id: 'education', label: 'Education', roots: ['Content/Education'] },
  { id: 'ai', label: 'AI', roots: ['AI'] },
  { id: 'media', label: 'Media', roots: ['Content/Media'] },
  { id: 'modules', label: 'Modules', roots: ['Modules'] },
  { id: 'outpost-data', label: 'Outpost Data', roots: ['Data', 'Profile', 'Config', 'Cache', 'Logs', 'Backups', 'Downloads', 'Updates', 'Exports'] },
];

async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += await directoryBytes(entryPath);
    else if (entry.isFile()) {
      try {
        total += (await fs.stat(entryPath)).size;
      } catch {
        // A file may disappear during the scan; the next refresh will include it.
      }
    }
  }
  return total;
}

export class StorageService {
  constructor(private readonly paths: PortablePathService) {}

  quickSummary(freeBytes: number | null = null, totalBytes: number | null = null): StorageSummary {
    return {
      categories: CATEGORIES.map((category) => ({ id: category.id, label: category.label, bytes: 0 })),
      usedByOutpostBytes: 0,
      freeBytes,
      totalBytes,
      scannedAt: null,
    };
  }

  async summarize(): Promise<StorageSummary> {
    const categories: StorageCategory[] = await Promise.all(CATEGORIES.map(async (category) => ({
      id: category.id,
      label: category.label,
      bytes: (await Promise.all(category.roots.map((root) => directoryBytes(this.paths.resolve(root)))))
        .reduce((sum, bytes) => sum + bytes, 0),
    })));

    let freeBytes: number | null = null;
    let totalBytes: number | null = null;
    try {
      const stats = await fs.statfs(this.paths.root);
      freeBytes = stats.bavail * stats.bsize;
      totalBytes = stats.blocks * stats.bsize;
    } catch {
      // Disk totals are optional on unsupported filesystems.
    }

    return {
      categories,
      usedByOutpostBytes: categories.reduce((sum, category) => sum + category.bytes, 0),
      freeBytes,
      totalBytes,
      scannedAt: new Date().toISOString(),
    };
  }
}
