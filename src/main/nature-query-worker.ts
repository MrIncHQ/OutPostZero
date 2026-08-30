import { parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

interface PackInput { packId: string; filePath: string }
interface QueryMessage {
  id: number;
  operation: 'search' | 'browse' | 'species' | 'image' | 'close-pack';
  packs?: PackInput[];
  pack?: PackInput;
  query?: string;
  category?: string;
  speciesId?: string;
  imageId?: string;
  limit?: number;
  packId?: string;
}

const databases = new Map<string, { filePath: string; database: DatabaseSync }>();

function databaseFor(pack: PackInput): DatabaseSync {
  const current = databases.get(pack.packId);
  if (current?.filePath === pack.filePath) return current.database;
  current?.database.close();
  const database = new DatabaseSync(pack.filePath, { readOnly: true });
  database.exec('PRAGMA query_only = ON; PRAGMA cache_size = -16384; PRAGMA mmap_size = 268435456;');
  databases.set(pack.packId, { filePath: pack.filePath, database });
  return database;
}

function summary(packId: string, row: Record<string, unknown>) {
  return {
    id: String(row.id), packId, scientificName: String(row.scientific_name), commonName: String(row.common_name || row.scientific_name),
    rank: String(row.rank), category: String(row.category), family: row.family ? String(row.family) : undefined,
    imageId: row.image_id ? String(row.image_id) : undefined, regionalStatus: row.regional_status ? String(row.regional_status) : undefined,
  };
}

function search(message: QueryMessage) {
  const output: ReturnType<typeof summary>[] = []; const limit = Math.max(1, Math.min(200, message.limit ?? 80));
  for (const pack of message.packs ?? []) {
    const rows = databaseFor(pack).prepare(`SELECT s.id, s.scientific_name, s.common_name, s.rank, s.category,
      s.family, s.regional_status, (SELECT id FROM species_images WHERE species_id = s.id ORDER BY sort_order LIMIT 1) image_id
      FROM species_fts f JOIN species s ON s.id = f.species_id WHERE species_fts MATCH ? LIMIT ?`)
      .all(message.query ?? '', Math.min(200, limit * 2)) as Array<Record<string, unknown>>;
    const exact = (message.category ?? '').toLocaleLowerCase();
    rows.sort((left, right) => Number(![left.common_name, left.scientific_name].some((name) => String(name).toLocaleLowerCase() === exact))
      - Number(![right.common_name, right.scientific_name].some((name) => String(name).toLocaleLowerCase() === exact)));
    output.push(...rows.map((row) => summary(pack.packId, row)));
    if (output.length >= limit) break;
  }
  return output.slice(0, limit);
}

function browse(message: QueryMessage) {
  const output: ReturnType<typeof summary>[] = []; const limit = Math.max(1, Math.min(200, message.limit ?? 200));
  for (const pack of message.packs ?? []) {
    const database = databaseFor(pack); const category = message.category?.trim() ?? '';
    const sql = category
      ? `SELECT s.id, s.scientific_name, s.common_name, s.rank, s.category, s.family, s.regional_status,
          (SELECT id FROM species_images WHERE species_id = s.id ORDER BY sort_order LIMIT 1) image_id
          FROM species s WHERE s.category = ? LIMIT ?`
      : `SELECT s.id, s.scientific_name, s.common_name, s.rank, s.category, s.family, s.regional_status,
          (SELECT id FROM species_images WHERE species_id = s.id ORDER BY sort_order LIMIT 1) image_id
          FROM species s LIMIT ?`;
    const rows = (category ? database.prepare(sql).all(category, limit) : database.prepare(sql).all(limit)) as Array<Record<string, unknown>>;
    output.push(...rows.map((row) => summary(pack.packId, row)));
    if (output.length >= limit) break;
  }
  return output.slice(0, limit);
}

function species(message: QueryMessage) {
  if (!message.pack || !message.speciesId) throw new Error('Nature species request is incomplete.');
  const database = databaseFor(message.pack); const speciesId = message.speciesId;
  const row = database.prepare(`SELECT *, (SELECT id FROM species_images WHERE species_id = species.id ORDER BY sort_order LIMIT 1) image_id FROM species WHERE id = ?`).get(speciesId) as Record<string, unknown> | undefined;
  if (!row) throw new Error('Species is not present in that Nature Pack.');
  const names = database.prepare('SELECT name, kind FROM species_names WHERE species_id = ? ORDER BY preferred DESC, name').all(speciesId) as Array<{ name: string; kind: string }>;
  const distribution = (database.prepare('SELECT area FROM species_distribution WHERE species_id = ? ORDER BY area').all(speciesId) as Array<{ area: string }>).map((item) => item.area);
  const images = (database.prepare('SELECT id, mime_type, creator, source_url, license, license_url FROM species_images WHERE species_id = ? ORDER BY sort_order').all(speciesId) as Array<Record<string, unknown>>).map((item) => ({
    id: String(item.id), mimeType: String(item.mime_type), creator: String(item.creator), sourceUrl: String(item.source_url), license: String(item.license), licenseUrl: String(item.license_url),
    readerUrl: `outpost-nature://image/${encodeURIComponent(message.pack!.packId)}/${encodeURIComponent(String(item.id))}`,
  }));
  return { ...summary(message.pack.packId, row), taxonomy: Object.fromEntries(['kingdom', 'phylum', 'class', 'order_name', 'family', 'genus'].flatMap((key) => row[key] ? [[key === 'order_name' ? 'order' : key, String(row[key])]] : [])),
    synonyms: names.filter((item) => item.kind === 'synonym').map((item) => item.name), commonNames: names.filter((item) => item.kind === 'common').map((item) => item.name),
    distribution, sourceTaxonId: row.source_taxon_id ? String(row.source_taxon_id) : undefined, sourceName: String(row.source_name || 'Catalogue of Life'),
    sourceUrl: row.source_url ? String(row.source_url) : undefined, images };
}

function image(message: QueryMessage) {
  if (!message.pack || !message.imageId) throw new Error('Nature image request is incomplete.');
  const row = databaseFor(message.pack).prepare('SELECT data, mime_type FROM species_images WHERE id = ?').get(message.imageId) as { data: Uint8Array; mime_type: string } | undefined;
  if (!row?.data || !String(row.mime_type).startsWith('image/')) throw new Error('Nature image is unavailable.');
  return { bytes: Uint8Array.from(row.data), mimeType: row.mime_type };
}

parentPort?.on('message', (message: QueryMessage) => {
  try {
    let result: unknown;
    if (message.operation === 'search') result = search(message);
    else if (message.operation === 'browse') result = browse(message);
    else if (message.operation === 'species') result = species(message);
    else if (message.operation === 'image') result = image(message);
    else { const current = message.packId ? databases.get(message.packId) : undefined; current?.database.close(); if (message.packId) databases.delete(message.packId); result = true; }
    parentPort?.postMessage({ id: message.id, result });
  } catch (error) {
    parentPort?.postMessage({ id: message.id, error: error instanceof Error ? error.message : 'Nature database operation failed.' });
  }
});

process.once('exit', () => { for (const item of databases.values()) item.database.close(); });
