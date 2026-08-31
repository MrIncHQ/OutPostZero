import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { canonicalScientificName, matchesRegional, regionalNameKeys, streamTsvRows } from '../scripts/nature-build-lib.mjs';
import { Readable } from 'node:stream';
import { acquireGbifPreview, prepareGbifDownload } from '../scripts/prepare-regional-nature.mjs';

test('regional taxonomy matching tolerates authorship while preserving infraspecific names', () => {
  assert.equal(canonicalScientificName('Cardinalis cardinalis (Linnaeus, 1758)'), 'cardinalis cardinalis');
  assert.equal(canonicalScientificName('Canis lupus familiaris Linnaeus'), 'canis lupus familiaris');
  assert.equal(canonicalScientificName('Quercus alba var. latiloba Sarg.'), 'quercus alba var latiloba');
  const regional = new Set([...regionalNameKeys({ scientificName: 'Cardinalis cardinalis (Linnaeus, 1758)' })]);
  assert.equal(matchesRegional({ scientificName: 'Cardinalis cardinalis', rank: 'species' }, regional), true);
});

test('current ColDP namespace prefixes are normalized while streaming', async () => {
  const rows = []; for await (const row of streamTsvRows(Readable.from(['col:ID\tcol:status\tcol:scientificName\tcol:rank\nabc\taccepted\tUrsus americanus\tspecies\n']))) rows.push(row);
  assert.deepEqual(rows, [{ ID: 'abc', status: 'accepted', scientificName: 'Ursus americanus', rank: 'species' }]);
});

test('GBIF preview pagination emits a small explicitly non-publishable provenance record', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-nature-builder-')); const output = path.join(root, 'missouri.tsv'); let calls = 0;
  const fetchImpl = async (url: URL) => {
    calls += 1; const offset = Number(url.searchParams.get('facetOffset'));
    const counts = offset === 0 ? Array.from({ length: 1000 }, (_, index) => ({ name: `Species ${index}`, count: index + 1 })) : [{ name: 'Cardinalis cardinalis (Linnaeus, 1758)', count: 25 }];
    return new Response(JSON.stringify({ count: 15_000_000, facets: [{ field: 'SCIENTIFIC_NAME', counts }] }), { status: 200 });
  };
  const result = await acquireGbifPreview({ region: 'Missouri', gadmGid: 'USA.26_1', output, fetchImpl: fetchImpl as typeof fetch });
  assert.equal(calls, 2); assert.equal(result.rows, 1001); assert.match(fs.readFileSync(output, 'utf8'), /Cardinalis cardinalis/);
  const provenance = JSON.parse(fs.readFileSync(`${output}.provenance.json`, 'utf8')); assert.equal(provenance.publishable, false); assert.equal(provenance.gadmGid, 'USA.26_1');
  fs.rmSync(root, { recursive: true, force: true });
});

test('DOI-backed GBIF input creates publishable provenance without retaining credentials', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-nature-builder-')); const input = path.join(root, 'occurrence.txt'); const output = path.join(root, 'species.tsv');
  fs.writeFileSync(input, 'scientificName\tlocality\nUrsus americanus\tMissouri\nUrsus americanus\tMissouri\n');
  await prepareGbifDownload({ region: 'Missouri', input, doi: '10.15468/dl.abc123', output });
  assert.match(fs.readFileSync(output, 'utf8'), /Ursus americanus\t2/);
  const provenance = JSON.parse(fs.readFileSync(`${output}.provenance.json`, 'utf8')); assert.equal(provenance.publishable, true); assert.equal(provenance.gbifDoi, '10.15468/dl.abc123');
  fs.rmSync(root, { recursive: true, force: true });
});

test('pack builder matches GBIF authorship, imports synonyms, and records DOI provenance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-nature-pack-')); const coldp = path.join(root, 'coldp'); fs.mkdirSync(coldp);
  fs.writeFileSync(path.join(coldp, 'NameUsage.tsv'), [
    'ID\tstatus\trank\tscientificName\tacceptedID\tkingdom\tphylum\tclass\torder\tfamily\tgenus',
    'bird-1\taccepted\tspecies\tCardinalis cardinalis\t\tAnimalia\tChordata\tAves\tPasseriformes\tCardinalidae\tCardinalis',
    'bird-old\tsynonym\tspecies\tLoxia cardinalis\tbird-1\tAnimalia\tChordata\tAves\tPasseriformes\tCardinalidae\tLoxia',
  ].join('\n'));
  fs.writeFileSync(path.join(coldp, 'VernacularName.tsv'), 'taxonID\tname\tlanguage\tpreferred\nbird-1\tNorthern cardinal\ten\ttrue\n');
  const regional = path.join(root, 'missouri.tsv'); fs.writeFileSync(regional, 'scientificName\toccurrenceCount\nCardinalis cardinalis (Linnaeus, 1758)\t5\n');
  fs.writeFileSync(`${regional}.provenance.json`, JSON.stringify({ publishable: true, gbifDoi: '10.15468/dl.abc123' }));
  const output = path.join(root, 'missouri.oznature');
  const built = spawnSync(process.execPath, ['scripts/build-nature-pack.mjs', '--coldp', coldp, '--regional-species', regional, '--pack-id', 'missouri-test', '--name', 'Missouri Test', '--region', 'Missouri', '--version', '2026.08', '--catalogue-version', '2026-07-14', '--output', output], { cwd: path.resolve('.'), encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  const db = new DatabaseSync(output, { readOnly: true });
  assert.equal(Number((db.prepare('SELECT count(*) count FROM species').get() as { count: number }).count), 1);
  assert.equal((db.prepare("SELECT name FROM species_names WHERE kind='synonym'").get() as { name: string }).name, 'Loxia cardinalis');
  const manifest = JSON.parse((db.prepare("SELECT value FROM pack_metadata WHERE key='manifest'").get() as { value: string }).value); assert.equal(manifest.sourceVersions.GBIF, '10.15468/dl.abc123');
  db.close();
  const archive = path.join(root, 'coldp.zip'); const archived = spawnSync('tar', ['-a', '-cf', archive, '-C', coldp, '.'], { encoding: 'utf8' }); assert.equal(archived.status, 0, archived.stderr);
  const streamedOutput = path.join(root, 'missouri-streamed.oznature');
  const streamed = spawnSync(process.execPath, ['scripts/build-nature-pack.mjs', '--coldp-archive', archive, '--regional-species', regional, '--pack-id', 'missouri-streamed', '--name', 'Missouri Streamed', '--region', 'Missouri', '--version', '2026.08', '--catalogue-version', '2026-07-14', '--output', streamedOutput], { cwd: path.resolve('.'), encoding: 'utf8', timeout: 20_000 });
  assert.equal(streamed.status, 0, streamed.stderr); assert.ok(fs.statSync(streamedOutput).size > 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test('photo pack builder copies matching taxonomy and embeds attributed offline images', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-nature-photo-pack-')); const base = path.join(root, 'base.oznature'); const db = new DatabaseSync(base);
  db.exec(`CREATE TABLE species(id TEXT PRIMARY KEY,scientific_name TEXT,common_name TEXT,rank TEXT,kingdom TEXT,phylum TEXT,class TEXT,order_name TEXT,family TEXT,genus TEXT,category TEXT,regional_status TEXT,source_taxon_id TEXT,source_name TEXT,source_url TEXT);
    CREATE TABLE species_names(species_id TEXT,name TEXT,kind TEXT,language TEXT,preferred INTEGER,PRIMARY KEY(species_id,name,kind)); CREATE TABLE species_distribution(species_id TEXT,area TEXT,status TEXT,source TEXT,PRIMARY KEY(species_id,area));
    CREATE VIRTUAL TABLE species_fts USING fts5(species_id UNINDEXED,common_name,scientific_name,names); INSERT INTO species VALUES('oak','Quercus alba','White oak','species','Plantae','Tracheophyta','','Fagales','Fagaceae','Quercus','Plants','','oak','Catalogue of Life','https://example.invalid/oak'); INSERT INTO species_names VALUES('oak','White oak','common','en',1); INSERT INTO species_fts VALUES('oak','White oak','Quercus alba','White oak');`); db.close();
  const image = path.join(root, 'oak.jpg'); fs.writeFileSync(image, Buffer.from([0xff,0xd8,0xff,0xd9])); const manifest = path.join(root, 'images.tsv'); fs.writeFileSync(manifest, 'id\tscientificName\tfile\tcreator\tsourceUrl\tlicense\tlicenseUrl\tsortOrder\n1\tQuercus alba\toak.jpg\tTest Creator\thttps://example.invalid/photo\tCC0-1.0\thttps://creativecommons.org/publicdomain/zero/1.0/\t0\n'); const output = path.join(root, 'plants.oznature');
  const built = spawnSync(process.execPath, ['scripts/build-nature-photo-pack.mjs','--base-pack',base,'--images',manifest,'--output',output,'--pack-id','plants-photo','--version','2026.08','--name','Plants Photo','--region','Worldwide','--coverage','Worldwide','--description','Offline plant photographs'], { cwd:path.resolve('.'),encoding:'utf8' }); assert.equal(built.status,0,built.stderr);
  const result = new DatabaseSync(output,{readOnly:true}); assert.equal(Number((result.prepare('SELECT count(*) count FROM species_images').get() as {count:number}).count),1); const metadata = result.prepare("SELECT value FROM pack_metadata WHERE key='manifest'").get() as {value:string}; assert.equal(JSON.parse(metadata.value).packType,'photo'); result.close(); fs.rmSync(root,{recursive:true,force:true});
});
