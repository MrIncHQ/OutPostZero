"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_worker_threads_1 = require("node:worker_threads");
const node_sqlite_1 = require("node:sqlite");
const input = node_worker_threads_1.workerData;
function validatePackFile(filePath) {
    const db = new node_sqlite_1.DatabaseSync(filePath, { readOnly: true });
    try {
        const required = ['species', 'species_names', 'species_distribution', 'species_images', 'species_fts'];
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('species','species_names','species_distribution','species_images','species_fts','pack_metadata')").all();
        const existing = new Set(rows.map((row) => row.name));
        for (const table of [...required, 'pack_metadata'])
            if (!existing.has(table))
                throw new Error(`Nature Pack is missing ${table}.`);
        const integrity = db.prepare('PRAGMA integrity_check').get();
        if (integrity.integrity_check !== 'ok')
            throw new Error('Nature Pack database failed its integrity check.');
        const row = db.prepare("SELECT value FROM pack_metadata WHERE key = 'manifest'").get();
        if (!row || typeof row.value !== 'string')
            throw new Error('Nature Pack manifest is missing.');
        const manifest = JSON.parse(row.value);
        if (manifest.schemaVersion !== 1 || typeof manifest.packId !== 'string' || !/^[a-z0-9][a-z0-9._-]{1,63}$/i.test(manifest.packId)
            || typeof manifest.name !== 'string' || typeof manifest.region !== 'string' || typeof manifest.version !== 'string' || typeof manifest.buildDate !== 'string'
            || !Number.isSafeInteger(manifest.downloadBytes) || manifest.downloadBytes < 0 || !Number.isSafeInteger(manifest.installedBytes) || manifest.installedBytes < 0
            || !Number.isSafeInteger(manifest.speciesCount) || manifest.speciesCount < 0 || !Number.isSafeInteger(manifest.imageCount) || manifest.imageCount < 0
            || !Array.isArray(manifest.categories) || !Array.isArray(manifest.licenseSummary) || !Array.isArray(manifest.dependencies)
            || !manifest.sourceVersions || typeof manifest.sourceVersions !== 'object')
            throw new Error('Nature Pack manifest is invalid or incompatible.');
        const species = Number(db.prepare('SELECT count(*) count FROM species').get().count);
        const images = Number(db.prepare('SELECT count(*) count FROM species_images').get().count);
        if (species !== manifest.speciesCount || images !== manifest.imageCount)
            throw new Error('Nature Pack manifest counts do not match its database.');
        const unattributed = Number(db.prepare("SELECT count(*) count FROM species_images WHERE trim(creator) = '' OR trim(source_url) = '' OR trim(license) = '' OR trim(license_url) = ''").get().count);
        if (unattributed)
            throw new Error('Nature Pack contains images without complete attribution.');
        return manifest;
    }
    finally {
        db.close();
    }
}
try {
    node_worker_threads_1.parentPort?.postMessage({ type: 'progress', message: 'Checking the Nature Pack database...' });
    const manifest = validatePackFile(input.source);
    node_worker_threads_1.parentPort?.postMessage({ type: 'progress', message: 'Copying verified Nature data onto this drive...' });
    node_fs_1.default.copyFileSync(input.source, input.temporary);
    node_worker_threads_1.parentPort?.postMessage({ type: 'progress', message: 'Confirming the installed Nature Pack...' });
    validatePackFile(input.temporary);
    node_worker_threads_1.parentPort?.postMessage({ type: 'complete', manifest });
}
catch (error) {
    node_fs_1.default.rmSync(input.temporary, { force: true });
    node_worker_threads_1.parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Nature Pack installation failed.' });
}
