import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { field, streamFileRows } from './nature-build-lib.mjs';

function parseArgs(values) {
  const output = {};
  for (let index = 2; index < values.length; index += 2) {
    const key = values[index];
    if (!key?.startsWith('--') || values[index + 1] === undefined) throw new Error(`Invalid argument ${key ?? ''}`);
    output[key.slice(2)] = values[index + 1];
  }
  return output;
}

function required(options, name) { const value = options[name]; if (!value) throw new Error(`--${name} is required`); return value; }

function writeOutputs(output, rows, provenance) {
  const resolved = path.resolve(output);
  if (fs.existsSync(resolved) || fs.existsSync(`${resolved}.provenance.json`)) throw new Error('Output or provenance file already exists. Refusing to overwrite it.');
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.partial`;
  try {
    fs.writeFileSync(temporary, `scientificName\toccurrenceCount\n${rows.map((row) => `${row.scientificName}\t${row.occurrenceCount}`).join('\n')}\n`);
    fs.renameSync(temporary, resolved);
    fs.writeFileSync(`${resolved}.provenance.json`, `${JSON.stringify(provenance, null, 2)}\n`);
  } finally { fs.rmSync(temporary, { force: true }); }
}

export async function acquireGbifPreview({ region, gadmGid, output, fetchImpl = fetch }) {
  const endpoint = new URL('https://api.gbif.org/v1/occurrence/search');
  endpoint.searchParams.set('gadm_gid', gadmGid); endpoint.searchParams.set('limit', '0'); endpoint.searchParams.set('facet', 'scientificName'); endpoint.searchParams.set('facetLimit', '1000');
  const byName = new Map(); let offset = 0; let occurrenceCount = 0;
  while (true) {
    endpoint.searchParams.set('facetOffset', String(offset));
    const response = await fetchImpl(endpoint, { headers: { Accept: 'application/json', 'User-Agent': 'OutpostZero-NaturePackBuilder/1.0' } });
    if (!response.ok) throw new Error(`GBIF preview request failed with HTTP ${response.status}.`);
    const payload = await response.json(); occurrenceCount = Number(payload.count ?? occurrenceCount);
    const facet = Array.isArray(payload.facets) ? payload.facets.find((item) => String(item.field).toLocaleLowerCase().includes('scientific')) : undefined;
    const counts = Array.isArray(facet?.counts) ? facet.counts : [];
    for (const item of counts) if (typeof item.name === 'string' && item.name.trim()) byName.set(item.name.trim(), Number(item.count ?? 0));
    if (counts.length < 1000) break;
    offset += counts.length;
  }
  const rows = [...byName].map(([scientificName, count]) => ({ scientificName, occurrenceCount: count })).sort((left, right) => left.scientificName.localeCompare(right.scientificName));
  writeOutputs(output, rows, { schemaVersion: 1, mode: 'public-api-preview', publishable: false, region, gadmGid, retrievedAt: new Date().toISOString(), sourceUrl: endpoint.origin + endpoint.pathname, query: { gadm_gid: gadmGid, facet: 'scientificName' }, occurrenceCount, scientificNameCount: rows.length, warning: 'Development preview only. Build the published pack from a GBIF download with a DOI.' });
  return { rows: rows.length, occurrenceCount };
}

export async function prepareGbifDownload({ region, input, doi, output }) {
  if (!/^10\.15468\/dl\.[a-z0-9]+$/i.test(doi)) throw new Error('Use the DOI assigned to the GBIF download, such as 10.15468/dl.xxxxxx.');
  const byName = new Map();
  for await (const row of streamFileRows(path.resolve(input))) {
    const scientificName = field(row, 'species', 'scientificName', 'acceptedScientificName');
    if (!scientificName) continue;
    byName.set(scientificName, (byName.get(scientificName) ?? 0) + 1);
  }
  const rows = [...byName].map(([scientificName, count]) => ({ scientificName, occurrenceCount: count })).sort((left, right) => left.scientificName.localeCompare(right.scientificName));
  writeOutputs(output, rows, { schemaVersion: 1, mode: 'gbif-doi-download', publishable: true, region, gbifDoi: doi, sourceFile: path.basename(input), retrievedAt: new Date().toISOString(), scientificNameCount: rows.length });
  return { rows: rows.length };
}

async function main() {
  const options = parseArgs(process.argv); const mode = required(options, 'mode'); const region = required(options, 'region'); const output = required(options, 'output');
  const result = mode === 'preview'
    ? await acquireGbifPreview({ region, gadmGid: required(options, 'gadm-gid'), output })
    : mode === 'gbif-download'
      ? await prepareGbifDownload({ region, input: required(options, 'input'), doi: required(options, 'gbif-doi'), output })
      : (() => { throw new Error('--mode must be preview or gbif-download'); })();
  console.log(JSON.stringify({ output: path.resolve(output), ...result }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
