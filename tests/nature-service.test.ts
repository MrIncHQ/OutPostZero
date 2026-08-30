import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseService } from '../src/main/database-service';
import { NatureService } from '../src/main/nature-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-nature-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root); paths.initializeLayout();
  const database = new DatabaseService(paths); const service = new NatureService(database, paths);
  const pack = path.join(root, 'fixture.oznature'); const db = new DatabaseSync(pack);
  db.exec(`CREATE TABLE pack_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    CREATE TABLE species(id TEXT PRIMARY KEY, scientific_name TEXT NOT NULL, common_name TEXT NOT NULL DEFAULT '', rank TEXT NOT NULL,
      kingdom TEXT NOT NULL DEFAULT '', phylum TEXT NOT NULL DEFAULT '', class TEXT NOT NULL DEFAULT '', order_name TEXT NOT NULL DEFAULT '', family TEXT NOT NULL DEFAULT '', genus TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL, regional_status TEXT NOT NULL DEFAULT '', source_taxon_id TEXT, source_name TEXT NOT NULL, source_url TEXT) STRICT;
    CREATE TABLE species_names(species_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL, language TEXT NOT NULL DEFAULT '', preferred INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(species_id,name,kind)) STRICT;
    CREATE TABLE species_distribution(species_id TEXT NOT NULL, area TEXT NOT NULL, status TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', PRIMARY KEY(species_id,area)) STRICT;
    CREATE TABLE species_images(id TEXT PRIMARY KEY, species_id TEXT NOT NULL, mime_type TEXT NOT NULL, data BLOB NOT NULL, creator TEXT NOT NULL, source_url TEXT NOT NULL, license TEXT NOT NULL, license_url TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0) STRICT;
    CREATE VIRTUAL TABLE species_fts USING fts5(species_id UNINDEXED, common_name, scientific_name, names);
    INSERT INTO species VALUES('ursus-americanus','Ursus americanus','American black bear','species','Animalia','Chordata','Mammalia','Carnivora','Ursidae','Ursus','Mammals','Recorded in Missouri','COL:1','Catalogue of Life','https://example.invalid/taxon');
    INSERT INTO species_names VALUES('ursus-americanus','black bear','common','en',1),('ursus-americanus','Euarctos americanus','synonym','',0);
    INSERT INTO species_distribution VALUES('ursus-americanus','Missouri','native','GBIF');
    INSERT INTO species_fts VALUES('ursus-americanus','American black bear','Ursus americanus','black bear Euarctos americanus');`);
  db.prepare('INSERT INTO species_images VALUES(?,?,?,?,?,?,?,?,?)').run('bear-photo','ursus-americanus','image/jpeg',Buffer.from([0xff, 0xd8, 0xff, 0xd9]),'Fixture Author','https://example.invalid/photo','CC BY','https://creativecommons.org/licenses/by/4.0/',0);
  db.prepare("INSERT INTO pack_metadata VALUES('manifest',?)").run(JSON.stringify({ schemaVersion: 1, packId: 'missouri-test', name: 'Missouri Test Nature Pack', region: 'Missouri', version: '2026.08', buildDate: '2026-08-29T00:00:00.000Z', sourceVersions: { 'Catalogue of Life': 'fixture' }, downloadBytes: fs.statSync(pack).size, installedBytes: fs.statSync(pack).size, speciesCount: 1, imageCount: 1, categories: ['Mammals'], licenseSummary: ['CC BY'], dependencies: [] }));
  db.close();
  return { root, pack, database, service };
}

test('imports a self-contained Nature Pack and serves search, details, images, and sightings offline', async () => {
  const { root, pack, database, service } = fixture();
  const imported = service.importPack(pack);
  assert.equal(imported.ok, true); assert.equal(imported.state.packs.length, 1);
  assert.equal((await service.search('black bear'))[0]?.scientificName, 'Ursus americanus');
  assert.equal((await service.search('Euarctos'))[0]?.commonName, 'American black bear');
  assert.equal((await service.browse('Mammals')).length, 1);
  const details = await service.species('missouri-test', 'ursus-americanus');
  assert.deepEqual(details.distribution, ['Missouri']); assert.equal(details.images[0]?.license, 'CC BY');
  assert.deepEqual([...(await service.image('missouri-test', 'bear-photo')).bytes], [0xff, 0xd8, 0xff, 0xd9]);
  const sightingState = service.saveSighting({ observedAt: '2026-08-29T12:00:00.000Z', packId: 'missouri-test', speciesId: details.id, commonName: details.commonName, scientificName: details.scientificName, notes: 'Trail camera' });
  assert.equal(sightingState.sightings.length, 1);
  assert.equal((await service.removePack('missouri-test')).ok, true);
  assert.equal(service.state().sightings.length, 1, 'private sightings survive pack removal');
  service.close(); database.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('installs a Nature Pack in a worker without blocking the application event loop', async () => {
  const { root, pack, database, service } = fixture(); let ticks = 0;
  const heartbeat = setInterval(() => { ticks += 1; }, 1);
  try {
    const imported = await service.importPackAsync(pack);
    assert.equal(imported.ok, true); assert.equal(imported.state.packs[0]?.packId, 'missouri-test'); assert.ok(ticks > 0);
  } finally { clearInterval(heartbeat); service.close(); database.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejects malformed files instead of registering them as Nature Packs', () => {
  const { root, database, service } = fixture(); const broken = path.join(root, 'broken.oznature'); fs.writeFileSync(broken, 'not sqlite');
  assert.throws(() => service.importPack(broken)); assert.equal(service.state().packs.length, 0);
  service.close(); database.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('removes only abandoned Nature installer artifacts while preserving the resumable download', async () => {
  const { root, database, service } = fixture();
  const packs = path.join(root, 'Content', 'Nature', 'Packs'); const temp = path.join(root, 'Temp'); const downloads = path.join(root, 'Downloads');
  fs.writeFileSync(path.join(packs, 'global-taxonomy.oznature.installing'), 'stale'); fs.writeFileSync(path.join(packs, 'operator-notes.txt'), 'keep');
  fs.mkdirSync(path.join(temp, 'NatureInstall-04d4875d-b821-49cb-9eb2-a7153fbfbd21')); fs.writeFileSync(path.join(downloads, 'Nature-global-taxonomy.download'), 'resume');
  service.reconcile();
  for (let attempt = 0; attempt < 100 && (fs.existsSync(path.join(packs, 'global-taxonomy.oznature.installing')) || fs.existsSync(path.join(temp, 'NatureInstall-04d4875d-b821-49cb-9eb2-a7153fbfbd21'))); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fs.existsSync(path.join(packs, 'global-taxonomy.oznature.installing')), false);
  assert.equal(fs.existsSync(path.join(temp, 'NatureInstall-04d4875d-b821-49cb-9eb2-a7153fbfbd21')), false);
  assert.equal(fs.existsSync(path.join(packs, 'operator-notes.txt')), true); assert.equal(fs.existsSync(path.join(downloads, 'Nature-global-taxonomy.download')), true);
  service.close(); database.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('loads a signed online catalog and installs a verified compressed pack for offline use', async () => {
  const { root, pack, database, service: original } = fixture(); original.close();
  const archive = path.join(root, 'missouri-test.zip');
  const packed = spawnSync('tar', ['-a', '-cf', archive, '-C', path.dirname(pack), path.basename(pack)], { encoding: 'utf8' }); assert.equal(packed.status, 0, packed.stderr);
  const bytes = fs.readFileSync(archive); const keys = crypto.generateKeyPairSync('ed25519');
  const entry = { id: 'missouri-test', kind: 'pack' as const, name: 'Missouri Test Nature Pack', version: '2026.08', url: 'https://example.invalid/missouri-test.zip',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), downloadBytes: bytes.length, installedBytes: fs.statSync(pack).size, archive: 'zip' as const, region: 'Missouri', description: 'Verified fixture pack' };
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, publishedAt: '2026-08-29T00:00:00.000Z', entries: [entry] }));
  const envelope = { schemaVersion: 1, signedPayload: payload.toString('base64'), signature: crypto.sign(null, payload, keys.privateKey).toString('base64') };
  let contentFetches = 0;
  const fetchImpl = async (url: string | URL | Request) => String(url).includes('catalog')
    ? new Response(JSON.stringify(envelope), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : (contentFetches += 1, new Response(bytes, { status: 200 }));
  const service = new NatureService(database, new PortablePathService(root), fetchImpl as typeof fetch, keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'https://example.invalid/catalog.json');
  const refreshed = await service.refreshCatalog(); assert.equal(refreshed.ok, true); assert.equal(refreshed.state.catalog.length, 1);
  fs.writeFileSync(path.join(root, 'Downloads', 'Nature-missouri-test.download'), bytes);
  const installed = await service.downloadContent(entry.id); assert.equal(installed.ok, true); assert.equal(installed.state.packs[0]?.packId, entry.id); assert.equal((await service.search('black bear'))[0]?.commonName, 'American black bear');
  assert.equal(contentFetches, 0, 'an exact completed partial is verified and installed without an invalid range request');
  service.close(); database.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('Nature stays one primary navigation item with its tools contained as internal tabs', () => {
  const app = fs.readFileSync(path.resolve('src/renderer/App.tsx'), 'utf8');
  const view = fs.readFileSync(path.resolve('src/renderer/NatureView.tsx'), 'utf8');
  assert.equal((app.match(/id: 'nature'/g) ?? []).length, 1);
  for (const tab of ['SEARCH & BROWSE', 'IDENTIFY', 'SIGHTINGS', 'PACKS', 'SOURCES & LICENSES']) assert.ok(view.includes(tab));
  assert.match(app, /result\.source === 'nature'/);
  assert.ok(view.indexOf('getNatureState()') < view.indexOf('refreshNatureCatalog()'), 'installed state renders before an online catalog refresh');
  assert.match(view, /showTransfer = transferring \|\| \['paused','error'\]/, 'completed downloads do not remain as active transfer cards');
});
