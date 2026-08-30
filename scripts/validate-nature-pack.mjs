import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const input = process.argv[2]; if (!input) throw new Error('Usage: node scripts/validate-nature-pack.mjs <pack.oznature> [--skip-integrity]');
const file = path.resolve(input); if (!fs.statSync(file).isFile()) throw new Error('Nature Pack is missing.');
const db = new DatabaseSync(file, { readOnly: true });
try {
  const skipIntegrity = process.argv.includes('--skip-integrity');
  const integrity = skipIntegrity ? 'previously verified' : db.prepare('PRAGMA integrity_check').get().integrity_check; if (integrity !== 'ok' && !skipIntegrity) throw new Error(`Integrity check failed: ${integrity}`);
  const manifest = JSON.parse(db.prepare("SELECT value FROM pack_metadata WHERE key='manifest'").get().value);
  const count = (table, where = '') => Number(db.prepare(`SELECT count(*) count FROM ${table} ${where}`).get().count);
  const counts = { species: count('species'), names: count('species_names'), commonNames: count('species_names', "WHERE kind='common'"), synonyms: count('species_names', "WHERE kind='synonym'"), searchRows: count('species_fts'), images: count('species_images') };
  if (counts.species !== manifest.speciesCount || counts.searchRows !== counts.species || counts.images !== manifest.imageCount) throw new Error('Nature Pack counts do not match its manifest or search index.');
  const search = db.prepare('SELECT s.common_name commonName,s.scientific_name scientificName FROM species_fts f JOIN species s ON s.id=f.species_id WHERE species_fts MATCH ? LIMIT 3');
  const samples = ['black bear', 'white tailed deer', 'copperhead', 'morel', 'monarch butterfly'].map((query) => ({ query, results: search.all(query.split(/\s+/u).map((token) => `"${token}"*`).join(' AND ')) }));
  console.log(JSON.stringify({ file, bytes: fs.statSync(file).size, integrity, manifest, counts, samples }, null, 2));
} finally { db.close(); }
