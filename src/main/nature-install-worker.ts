import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import type { NaturePackManifest } from '../shared/contracts';

interface InstallWorkerData { source: string; temporary: string }

const input = workerData as InstallWorkerData;

function validatePackFile(filePath: string): NaturePackManifest {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const required = ['species', 'species_names', 'species_distribution', 'species_images', 'species_fts'];
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('species','species_names','species_distribution','species_images','species_fts','pack_metadata')").all() as Array<{ name: string }>;
    const existing = new Set(rows.map((row) => row.name));
    for (const table of [...required, 'pack_metadata']) if (!existing.has(table)) throw new Error(`Nature Pack is missing ${table}.`);
    const integrity = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity.integrity_check !== 'ok') throw new Error('Nature Pack database failed its integrity check.');
    const row = db.prepare("SELECT value FROM pack_metadata WHERE key = 'manifest'").get() as { value?: unknown } | undefined;
    if (!row || typeof row.value !== 'string') throw new Error('Nature Pack manifest is missing.');
    const manifest = JSON.parse(row.value) as NaturePackManifest;
    if (manifest.schemaVersion !== 1 || typeof manifest.packId !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(manifest.packId)
      || typeof manifest.name !== 'string' || typeof manifest.region !== 'string' || typeof manifest.version !== 'string' || typeof manifest.buildDate !== 'string'
      || !Number.isSafeInteger(manifest.downloadBytes) || manifest.downloadBytes < 0 || !Number.isSafeInteger(manifest.installedBytes) || manifest.installedBytes < 0
      || !Number.isSafeInteger(manifest.speciesCount) || manifest.speciesCount < 0 || !Number.isSafeInteger(manifest.imageCount) || manifest.imageCount < 0
      || !Array.isArray(manifest.categories) || !Array.isArray(manifest.licenseSummary) || !Array.isArray(manifest.dependencies)
      || !manifest.sourceVersions || typeof manifest.sourceVersions !== 'object') throw new Error('Nature Pack manifest is invalid or incompatible.');
    const species = Number((db.prepare('SELECT count(*) count FROM species').get() as { count: number | bigint }).count);
    const images = Number((db.prepare('SELECT count(*) count FROM species_images').get() as { count: number | bigint }).count);
    if (species !== manifest.speciesCount || images !== manifest.imageCount) throw new Error('Nature Pack manifest counts do not match its database.');
    const unattributed = Number((db.prepare("SELECT count(*) count FROM species_images WHERE trim(creator) = '' OR trim(source_url) = '' OR trim(license) = '' OR trim(license_url) = ''").get() as { count: number | bigint }).count);
    if (unattributed) throw new Error('Nature Pack contains images without complete attribution.');
    return manifest;
  } finally { db.close(); }
}

try {
  parentPort?.postMessage({ type: 'progress', message: 'Checking the Nature Pack database...' });
  const manifest = validatePackFile(input.source);
  parentPort?.postMessage({ type: 'progress', message: 'Copying verified Nature data onto this drive...' });
  fs.copyFileSync(input.source, input.temporary);
  parentPort?.postMessage({ type: 'progress', message: 'Confirming the installed Nature Pack...' });
  validatePackFile(input.temporary);
  parentPort?.postMessage({ type: 'complete', manifest });
} catch (error) {
  fs.rmSync(input.temporary, { force: true });
  parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Nature Pack installation failed.' });
}
