import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalScientificName } from './nature-build-lib.mjs';

function args(values) { const output = {}; for (let index = 2; index < values.length; index += 2) { const key = values[index]; if (!key?.startsWith('--') || values[index + 1] === undefined) throw new Error(`Invalid argument ${key ?? ''}`); output[key.slice(2)] = values[index + 1]; } return output; }
function required(options, name) { if (!options[name]) throw new Error(`--${name} is required`); return options[name]; }
function stripHtml(value) { return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim(); }
function tsv(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r/g, '\\r').replace(/\n/g, '\\n'); }
function sleep(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

const LICENSES = new Map([
  ['cc0', ['CC0-1.0', 'https://creativecommons.org/publicdomain/zero/1.0/']],
  ['cc-zero', ['CC0-1.0', 'https://creativecommons.org/publicdomain/zero/1.0/']],
  ['public domain', ['Public domain', 'https://creativecommons.org/publicdomain/mark/1.0/']],
  ['pd', ['Public domain', 'https://creativecommons.org/publicdomain/mark/1.0/']],
  ['cc by 4.0', ['CC-BY-4.0', 'https://creativecommons.org/licenses/by/4.0/']],
  ['cc-by-4.0', ['CC-BY-4.0', 'https://creativecommons.org/licenses/by/4.0/']],
  ['cc by-sa 4.0', ['CC-BY-SA-4.0', 'https://creativecommons.org/licenses/by-sa/4.0/']],
  ['cc-by-sa-4.0', ['CC-BY-SA-4.0', 'https://creativecommons.org/licenses/by-sa/4.0/']],
  ['cc by 3.0', ['CC-BY-3.0', 'https://creativecommons.org/licenses/by/3.0/']],
  ['cc-by-3.0', ['CC-BY-3.0', 'https://creativecommons.org/licenses/by/3.0/']],
  ['cc by-sa 3.0', ['CC-BY-SA-3.0', 'https://creativecommons.org/licenses/by-sa/3.0/']],
  ['cc-by-sa-3.0', ['CC-BY-SA-3.0', 'https://creativecommons.org/licenses/by-sa/3.0/']],
]);

async function json(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'OutpostZero-NaturePackBuilder/1.0 (https://github.com/MrIncHQ/OutPostZero)' } });
    if (response.ok) return response.json();
    if (attempt === 4) throw new Error(`${url.hostname} returned HTTP ${response.status}.`);
    await sleep(attempt * 750);
  }
}

async function wikipediaImages(names) {
  const endpoint = new URL('https://en.wikipedia.org/w/api.php'); endpoint.searchParams.set('action', 'query'); endpoint.searchParams.set('format', 'json'); endpoint.searchParams.set('formatversion', '2'); endpoint.searchParams.set('redirects', '1'); endpoint.searchParams.set('prop', 'pageimages'); endpoint.searchParams.set('piprop', 'name'); endpoint.searchParams.set('titles', names.join('|'));
  const payload = await json(endpoint); const aliases = new Map(names.map((name) => [name.toLocaleLowerCase(), name]));
  for (const item of [...(payload.query?.normalized ?? []), ...(payload.query?.redirects ?? [])]) { const origin = aliases.get(String(item.from).toLocaleLowerCase()); if (origin) aliases.set(String(item.to).toLocaleLowerCase(), origin); }
  return (payload.query?.pages ?? []).flatMap((page) => { const scientificName = aliases.get(String(page.title).toLocaleLowerCase()); return scientificName && page.pageimage ? [{ scientificName, fileName: String(page.pageimage) }] : []; });
}

async function commonsMetadata(items) {
  if (!items.length) return [];
  const endpoint = new URL('https://commons.wikimedia.org/w/api.php'); endpoint.searchParams.set('action', 'query'); endpoint.searchParams.set('format', 'json'); endpoint.searchParams.set('formatversion', '2'); endpoint.searchParams.set('prop', 'imageinfo'); endpoint.searchParams.set('iiprop', 'url|mime|extmetadata'); endpoint.searchParams.set('iiurlwidth', '640'); endpoint.searchParams.set('titles', items.map((item) => `File:${item.fileName}`).join('|'));
  const payload = await json(endpoint); const byFile = new Map(items.map((item) => [item.fileName.replaceAll('_', ' ').toLocaleLowerCase(), item.scientificName]));
  return (payload.query?.pages ?? []).flatMap((page) => {
    const info = page.imageinfo?.[0]; const metadata = info?.extmetadata ?? {}; const fileName = String(page.title ?? '').replace(/^File:/i, ''); const scientificName = byFile.get(fileName.replaceAll('_', ' ').toLocaleLowerCase());
    const normalized = LICENSES.get(stripHtml(metadata.LicenseShortName?.value).toLocaleLowerCase()); const creator = stripHtml(metadata.Artist?.value || metadata.Credit?.value);
    if (!scientificName || !info?.thumburl || !info?.descriptionurl || !normalized || !creator) return [];
    return [{ scientificName, fileName, creator: creator.slice(0, 500), sourceUrl: String(info.descriptionurl), license: normalized[0], licenseUrl: stripHtml(metadata.LicenseUrl?.value) || normalized[1], imageUrl: String(info.thumburl), mimeType: String(info.thumbmime || info.mime || 'image/jpeg') }];
  });
}

const GBIF_FILTERS = {
  Plants: ['kingdomKey', '6'], Birds: ['classKey', '212'], Mammals: ['classKey', '359'], Reptiles: ['classKey', '358'],
  Amphibians: ['classKey', '131'], Fish: ['classKey', '204'], Insects: ['classKey', '216'], Arachnids: ['classKey', '367'],
};

async function commonOccurrenceNames(category, wanted) {
  const filter = GBIF_FILTERS[category]; if (!filter) return [];
  const output = [];
  for (let offset = 0; output.length < wanted && offset < 5000; offset += 1000) {
    const endpoint = new URL('https://api.gbif.org/v1/occurrence/search'); endpoint.searchParams.set('limit', '0'); endpoint.searchParams.set('facet', 'scientificName'); endpoint.searchParams.set('facetLimit', '1000'); endpoint.searchParams.set('facetOffset', String(offset)); endpoint.searchParams.set(filter[0], filter[1]);
    const payload = await json(endpoint); const facet = payload.facets?.find((item) => String(item.field).toLocaleLowerCase() === 'scientificname'); const names = (facet?.counts ?? []).map((item) => canonicalScientificName(item.name)).filter(Boolean).map((name) => name[0].toLocaleUpperCase() + name.slice(1)); output.push(...names); if (names.length < 1000) break;
  }
  return [...new Set(output)].slice(0, wanted);
}

async function download(item, directory, index) {
  const extension = item.mimeType.includes('png') ? '.png' : item.mimeType.includes('webp') ? '.webp' : '.jpg'; const file = path.join(directory, `${String(index).padStart(5, '0')}${extension}`); const temporary = `${file}.partial`;
  const response = await fetch(item.imageUrl, { headers: { 'User-Agent': 'OutpostZero-NaturePackBuilder/1.0 (https://github.com/MrIncHQ/OutPostZero)' } });
  if (!response.ok) throw new Error(`Image download returned HTTP ${response.status}.`); const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024 || bytes.length > 8 * 1024 * 1024) throw new Error('Image size is outside the accepted range.'); fs.writeFileSync(temporary, bytes); fs.renameSync(temporary, file); return file;
}

const options = args(process.argv); const base = path.resolve(required(options, 'base-pack')); const output = path.resolve(required(options, 'output')); const targets = new Map(required(options, 'targets').split(',').map((part) => { const [category, count] = part.split('='); if (!category || !Number.isSafeInteger(Number(count)) || Number(count) < 1) throw new Error(`Invalid target ${part}.`); return [category, Number(count)]; }));
if (fs.existsSync(output) || fs.existsSync(path.join(path.dirname(output), 'images'))) throw new Error('Output manifest or image directory already exists.');
const imagesDirectory = path.join(path.dirname(output), 'images'); fs.mkdirSync(imagesDirectory, { recursive: true }); const db = new DatabaseSync(base, { readOnly: true }); const selected = [];
try {
  for (const [category, target] of targets) {
    const frequent = await commonOccurrenceNames(category, Math.max(target * 20, 1000));
    const taxonomyCandidates = db.prepare(`SELECT scientific_name FROM species WHERE category = ? AND trim(common_name) <> '' ORDER BY length(common_name), common_name COLLATE NOCASE, scientific_name LIMIT ?`).all(category, Math.max(target * 20, 1000)).map((row) => { const canonical = canonicalScientificName(row.scientific_name); return canonical ? canonical[0].toLocaleUpperCase() + canonical.slice(1) : ''; }).filter(Boolean);
    const candidates = [...new Set([...frequent, ...taxonomyCandidates])];
    let categoryCount = 0;
    for (let offset = 0; offset < candidates.length && categoryCount < target; offset += 40) {
      const names = candidates.slice(offset, offset + 40); const pageImages = await wikipediaImages(names); const metadata = await commonsMetadata(pageImages);
      for (const item of metadata) {
        if (categoryCount >= target || selected.some((record) => record.scientificName.toLocaleLowerCase() === item.scientificName.toLocaleLowerCase())) continue;
        try { const file = await download(item, imagesDirectory, selected.length + 1); selected.push({ ...item, file: path.relative(path.dirname(output), file).replaceAll('\\', '/'), category }); categoryCount++; process.stderr.write(`\r[nature-images] ${category}: ${categoryCount}/${target}`); } catch { /* Skip unavailable media and keep looking. */ }
      }
      await sleep(100);
    }
    process.stderr.write('\n'); if (categoryCount < target) console.error(`[nature-images] warning: ${category} produced ${categoryCount} of ${target} requested photos`);
  }
} finally { db.close(); }
const headers = ['id','scientificName','file','creator','sourceUrl','license','licenseUrl','sortOrder','category']; const lines = [headers.join('\t'), ...selected.map((item, index) => [index + 1,item.scientificName,item.file,item.creator,item.sourceUrl,item.license,item.licenseUrl,0,item.category].map(tsv).join('\t'))]; fs.writeFileSync(output, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ output, imagesDirectory, images: selected.length, licenses: [...new Set(selected.map((item) => item.license))], categories: Object.fromEntries([...targets].map(([category]) => [category, selected.filter((item) => item.category === category).length])) }, null, 2));
