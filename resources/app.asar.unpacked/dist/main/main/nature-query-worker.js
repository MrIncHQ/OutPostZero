"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_worker_threads_1 = require("node:worker_threads");
const node_sqlite_1 = require("node:sqlite");
const databases = new Map();
function databaseFor(pack) {
    const current = databases.get(pack.packId);
    if (current?.filePath === pack.filePath)
        return current.database;
    current?.database.close();
    const database = new node_sqlite_1.DatabaseSync(pack.filePath, { readOnly: true });
    database.exec('PRAGMA query_only = ON; PRAGMA cache_size = -16384; PRAGMA mmap_size = 268435456;');
    databases.set(pack.packId, { filePath: pack.filePath, database });
    return database;
}
function summary(packId, row) {
    return {
        id: String(row.id), packId, scientificName: String(row.scientific_name), commonName: String(row.common_name || row.scientific_name),
        rank: String(row.rank), category: String(row.category), family: row.family ? String(row.family) : undefined,
        imageId: row.image_id ? String(row.image_id) : undefined, regionalStatus: row.regional_status ? String(row.regional_status) : undefined,
    };
}
function search(message) {
    const output = [];
    const limit = Math.max(1, Math.min(200, message.limit ?? 80));
    for (const pack of message.packs ?? []) {
        const rows = databaseFor(pack).prepare(`SELECT s.id, s.scientific_name, s.common_name, s.rank, s.category,
      s.family, s.regional_status, (SELECT id FROM species_images WHERE species_id = s.id ORDER BY sort_order LIMIT 1) image_id
      FROM species_fts f JOIN species s ON s.id = f.species_id WHERE species_fts MATCH ? LIMIT ?`)
            .all(message.query ?? '', Math.min(200, limit * 2));
        const exact = (message.category ?? '').toLocaleLowerCase();
        rows.sort((left, right) => Number(![left.common_name, left.scientific_name].some((name) => String(name).toLocaleLowerCase() === exact))
            - Number(![right.common_name, right.scientific_name].some((name) => String(name).toLocaleLowerCase() === exact)));
        output.push(...rows.map((row) => summary(pack.packId, row)));
    }
    return preferPhotoRecords(output, limit);
}
function browse(message) {
    const output = [];
    const limit = Math.max(1, Math.min(200, message.limit ?? 200));
    for (const pack of message.packs ?? []) {
        const database = databaseFor(pack);
        const category = message.category?.trim() ?? '';
        const sql = category
            ? `SELECT s.id, s.scientific_name, s.common_name, s.rank, s.category, s.family, s.regional_status,
          (SELECT id FROM species_images WHERE species_id = s.id ORDER BY sort_order LIMIT 1) image_id
          FROM species s WHERE s.category = ? LIMIT ?`
            : `SELECT s.id, s.scientific_name, s.common_name, s.rank, s.category, s.family, s.regional_status,
          (SELECT id FROM species_images WHERE species_id = s.id ORDER BY sort_order LIMIT 1) image_id
          FROM species s LIMIT ?`;
        const rows = (category ? database.prepare(sql).all(category, limit) : database.prepare(sql).all(limit));
        output.push(...rows.map((row) => summary(pack.packId, row)));
    }
    return preferPhotoRecords(output, limit);
}
function preferPhotoRecords(records, limit) {
    const selected = new Map();
    for (const record of records) {
        const key = record.scientificName.normalize('NFKC').toLocaleLowerCase();
        const current = selected.get(key);
        if (!current || (!current.imageId && record.imageId))
            selected.set(key, record);
    }
    return [...selected.values()].sort((left, right) => Number(!right.imageId) - Number(!left.imageId)).slice(0, limit);
}
function species(message) {
    if (!message.pack || !message.speciesId)
        throw new Error('Nature species request is incomplete.');
    const database = databaseFor(message.pack);
    const speciesId = message.speciesId;
    const row = database.prepare(`SELECT *, (SELECT id FROM species_images WHERE species_id = species.id ORDER BY sort_order LIMIT 1) image_id FROM species WHERE id = ?`).get(speciesId);
    if (!row)
        throw new Error('Species is not present in that Nature Pack.');
    const names = database.prepare('SELECT name, kind FROM species_names WHERE species_id = ? ORDER BY preferred DESC, name').all(speciesId);
    const distribution = database.prepare('SELECT area FROM species_distribution WHERE species_id = ? ORDER BY area').all(speciesId).map((item) => item.area);
    const images = database.prepare('SELECT id, mime_type, creator, source_url, license, license_url FROM species_images WHERE species_id = ? ORDER BY sort_order').all(speciesId).map((item) => ({
        id: String(item.id), mimeType: String(item.mime_type), creator: String(item.creator), sourceUrl: String(item.source_url), license: String(item.license), licenseUrl: String(item.license_url),
        readerUrl: `outpost-nature://image/${encodeURIComponent(message.pack.packId)}/${encodeURIComponent(String(item.id))}`,
    }));
    return { ...summary(message.pack.packId, row), taxonomy: Object.fromEntries(['kingdom', 'phylum', 'class', 'order_name', 'family', 'genus'].flatMap((key) => row[key] ? [[key === 'order_name' ? 'order' : key, String(row[key])]] : [])),
        synonyms: names.filter((item) => item.kind === 'synonym').map((item) => item.name), commonNames: names.filter((item) => item.kind === 'common').map((item) => item.name),
        distribution, sourceTaxonId: row.source_taxon_id ? String(row.source_taxon_id) : undefined, sourceName: String(row.source_name || 'Catalogue of Life'),
        sourceUrl: row.source_url ? String(row.source_url) : undefined, images };
}
function image(message) {
    if (!message.pack || !message.imageId)
        throw new Error('Nature image request is incomplete.');
    const row = databaseFor(message.pack).prepare('SELECT data, mime_type FROM species_images WHERE id = ?').get(message.imageId);
    if (!row?.data || !String(row.mime_type).startsWith('image/'))
        throw new Error('Nature image is unavailable.');
    return { bytes: Uint8Array.from(row.data), mimeType: row.mime_type };
}
node_worker_threads_1.parentPort?.on('message', (message) => {
    try {
        let result;
        if (message.operation === 'search')
            result = search(message);
        else if (message.operation === 'browse')
            result = browse(message);
        else if (message.operation === 'species')
            result = species(message);
        else if (message.operation === 'image')
            result = image(message);
        else {
            const current = message.packId ? databases.get(message.packId) : undefined;
            current?.database.close();
            if (message.packId)
                databases.delete(message.packId);
            result = true;
        }
        node_worker_threads_1.parentPort?.postMessage({ id: message.id, result });
    }
    catch (error) {
        node_worker_threads_1.parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : 'Nature database operation failed.' });
    }
});
process.once('exit', () => { for (const item of databases.values())
    item.database.close(); });
