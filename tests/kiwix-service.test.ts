import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { MODULE_PACKAGE_PUBLIC_KEY } from '../src/main/module-trust';
import { DatabaseService } from '../src/main/database-service';
import { KIWIX_PACKAGE } from '../src/main/kiwix-package';
import { buildAiSearchQueries, hashFile, KiwixService, parseKiwixCatalog, parseKiwixCatalogFeed, parseKiwixMetalink, parseKiwixNavigation, parseKiwixSearchXml, validateKiwixPackagePath, verifyKiwixPackage } from '../src/main/kiwix-service';
import { PortablePathService } from '../src/main/portable-path';

const archivePath = path.resolve('VendorCache', 'kiwix-tools_win-x86_64-3.8.1.zip');

test('parses Kiwix full-text XML results into local AI sources', () => {
  const results = parseKiwixSearchXml('<rss><channel><item><title>Water purification</title><link>/content/wiki/Water</link><description>Methods &amp; safety notes</description></item></channel></rss>');
  assert.deepEqual(results, [{ title: 'Water purification', link: '/content/wiki/Water', excerpt: 'Methods & safety notes' }]);
});

test('turns conversational AI questions into compact offline search phrases', () => {
  assert.deepEqual(buildAiSearchQueries('Can you give me info on how to skin a deer?'), ['skin deer', 'field dressing deer', 'butchering deer']);
  assert.deepEqual(buildAiSearchQueries('How do I purify water after a flood?'), ['purify water after flood', 'water after flood']);
  assert.deepEqual(buildAiSearchQueries('Find me a PDF file about water purification'), ['water purification']);
});

test('searches all same-language installed Kiwix books for local AI context', async () => {
  const runtime = makeRuntime();
  const requested: URL[] = [];
  try {
    fs.writeFileSync(runtime.paths.resolve('Content/ZIM/field_guide_en_all_2026-08.zim'), Buffer.alloc(10));
    fs.writeFileSync(runtime.paths.resolve('Content/ZIM/wikipedia_en_all_2026-08.zim'), Buffer.alloc(10));
    const fetchFixture: typeof fetch = async (input) => {
      const url = new URL(String(input)); requested.push(url);
      if (url.pathname === '/search') return new Response('<rss><channel><item><title>Field dressing</title><link>/content/wikipedia_en_all_2026-08/Field_dressing</link><description>Preparing harvested game.</description></item></channel></rss>');
      return new Response('<html><body><main>Field dressing and skinning safely preserves harvested deer meat.</main></body></html>', { headers: { 'content-type': 'text/html' } });
    };
    const service = new KiwixService(runtime.database, runtime.paths, fetchFixture);
    (service as unknown as { active: unknown }).active = { child: {}, pid: 1, port: 1234, startedAt: new Date().toISOString() };
    const sources = await service.searchForAi('Can you tell me how to skin a deer?', 2);
    const searchRequest = requested.find((url) => url.pathname === '/search');
    assert.ok(searchRequest);
    assert.deepEqual(searchRequest.searchParams.getAll('books.name').sort(), ['field_guide_en_all_2026-08', 'wikipedia_en_all_2026-08']);
    assert.equal(searchRequest.searchParams.get('pattern'), 'skin deer');
    assert.match(sources[0].excerpt, /skinning safely preserves/i);
    assert.equal(sources[0].articlePath, '/content/wikipedia_en_all_2026-08/Field_dressing');
  } finally {
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});
const samplePath = path.resolve('VendorCache', 'openzim-small.zim');

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-kiwix-'));
  fs.writeFileSync(path.join(root, '.outpost-zero-root'), 'test');
  fs.mkdirSync(path.join(root, 'resources'), { recursive: true });
  fs.copyFileSync(path.resolve('portable', 'Extract_Kiwix.ps1'), path.join(root, 'resources', 'Extract_Kiwix.ps1'));
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  const database = new DatabaseService(paths);
  return { root, paths, database };
}

test('verifies the signed pinned Kiwix package and rejects unsafe paths', () => {
  const manifest = verifyKiwixPackage(KIWIX_PACKAGE, MODULE_PACKAGE_PUBLIC_KEY);
  assert.equal(manifest.version, '3.8.1');
  assert.equal(manifest.archive.size, 18_301_924);
  assert.equal(manifest.archive.sha256, 'FCD01ED2B93E9A68632C7863C83B9F66BF64406A66357BE1DF7B8B75596F3E45');
  assert.equal(manifest.sampleContent.size, 41_155);
  assert.throws(() => validateKiwixPackagePath('../outside.dll'), /not a root file|invalid/);
  assert.throws(() => validateKiwixPackagePath('nested/file.dll'), /not a root file/);
  assert.throws(() => validateKiwixPackagePath('nested\\file.dll'), /invalid/);
});

test('rejects a forged Kiwix package signature', () => {
  const forged = JSON.parse(JSON.stringify(KIWIX_PACKAGE)) as { signature: string };
  const signature = Buffer.from(forged.signature, 'base64');
  signature[0] ^= 0xff;
  forged.signature = signature.toString('base64');
  assert.throws(() => verifyKiwixPackage(forged), /signature verification failed/);
});

test('reports SHA-256 verification progress from zero through the complete file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-hash-progress-'));
  const filePath = path.join(root, 'progress.zim');
  const content = Buffer.alloc(1024 * 1024, 42);
  fs.writeFileSync(filePath, content);
  const progress: number[] = [];
  try {
    const actual = await hashFile(filePath, (verifiedBytes, totalBytes) => {
      assert.equal(totalBytes, content.length);
      progress.push(verifiedBytes);
    });
    const expected = (await import('node:crypto')).createHash('sha256').update(content).digest('hex').toUpperCase();
    assert.equal(actual, expected);
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), content.length);
    assert.ok(progress.every((value, index) => index === 0 || value >= progress[index - 1]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scans only ZIM files beneath the portable content root', () => {
  const runtime = makeRuntime();
  try {
    fs.mkdirSync(runtime.paths.resolve('Content/ZIM/Nested'), { recursive: true });
    fs.writeFileSync(runtime.paths.resolve('Content/ZIM/reference_en_2026-08.zim'), Buffer.alloc(123));
    fs.writeFileSync(runtime.paths.resolve('Content/ZIM/Nested/guide.zim'), Buffer.alloc(456));
    fs.writeFileSync(runtime.paths.resolve('Content/ZIM/ignore.txt'), 'not a zim');
    const service = new KiwixService(runtime.database, runtime.paths);
    const content = service.scan();
    assert.equal(content.length, 2);
    assert.deepEqual(content.map((item) => item.relativePath).sort(), [
      'Content/ZIM/Nested/guide.zim',
      'Content/ZIM/reference_en_2026-08.zim',
    ]);
  } finally {
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('removes only the selected ZIM file from managed library content', async () => {
  const runtime = makeRuntime();
  try {
    const first = runtime.paths.resolve('Content/ZIM/remove-me.zim');
    const second = runtime.paths.resolve('Content/ZIM/keep-me.zim');
    fs.writeFileSync(first, Buffer.alloc(123));
    fs.writeFileSync(second, Buffer.alloc(456));
    const service = new KiwixService(runtime.database, runtime.paths);
    const selected = service.scan().find((item) => item.fileName === 'remove-me.zim');
    assert.ok(selected);
    const result = await service.removeContent(selected.id);
    assert.equal(result.ok, true, result.message);
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.existsSync(second), true);
    assert.deepEqual(result.status.content.map((item) => item.fileName), ['keep-me.zim']);
    const rejected = await service.removeContent('../keep-me.zim');
    assert.equal(rejected.ok, false);
    assert.equal(fs.existsSync(second), true);
  } finally {
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('parses current OPDS catalog and Metalink download metadata safely', () => {
  const catalog = `<?xml version="1.0"?><feed><totalResults>72</totalResults><startIndex>48</startIndex><itemsPerPage>24</itemsPerPage><entry>
    <id>urn:uuid:catalog-entry-1234</id><title>Wikipedia English</title><summary>Current reference</summary>
    <name>wikipedia_en_all</name><language>eng</language><flavour>mini</flavour><category>wikipedia</category><articleCount>7000000</articleCount><mediaCount>1500</mediaCount><dc:issued>2026-08-01T00:00:00Z</dc:issued>
    <link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim"
      href="https://lb.download.kiwix.org/zim/wikipedia/wikipedia_en_mini_2026-08.zim.meta4" length="12345" />
  </entry><entry><id>unsafe-entry</id><link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim" href="http://127.0.0.1/file.zim.meta4" length="10" /></entry></feed>`;
  const records = parseKiwixCatalog(catalog);
  assert.equal(records.length, 1);
  assert.equal(records[0].flavour, 'mini');
  assert.equal(records[0].archiveName, 'wikipedia_en_all');
  assert.equal(records[0].articleCount, 7_000_000);
  assert.equal(records[0].downloadBytes, 12_345);
  assert.equal(records[0].fileName, 'wikipedia_en_mini_2026-08.zim');
  const feed = parseKiwixCatalogFeed(catalog);
  assert.deepEqual({ total: feed.totalResults, start: feed.startIndex, page: feed.itemsPerPage }, { total: 72, start: 48, page: 24 });

  const metalink = `<metalink><file name="wikipedia_en_mini_2026-08.zim"><size>12345</size>
    <hash type="sha-256">${'ab'.repeat(32)}</hash></file></metalink>`;
  const metadata = parseKiwixMetalink(metalink, records[0].meta4Url);
  assert.equal(metadata.sha256, 'AB'.repeat(32));
  assert.equal(metadata.downloadUrl, 'https://lb.download.kiwix.org/zim/wikipedia/wikipedia_en_mini_2026-08.zim');
  assert.throws(() => parseKiwixMetalink(metalink, 'https://example.com/file.zim.meta4'), /source is not allowed/);
});

test('parses all official language and category choices from catalog navigation', () => {
  const languages = parseKiwixNavigation(`<feed><entry><title>English</title><dc:language>eng</dc:language><thr:count>1200</thr:count></entry><entry><title>Español</title><dc:language>spa</dc:language><thr:count>340</thr:count></entry></feed>`, 'language');
  const categories = parseKiwixNavigation(`<feed><entry><title>wikipedia</title></entry><entry><title>stack_exchange</title></entry></feed>`, 'category');
  assert.deepEqual(languages, [{ id: 'eng', label: 'English', count: 1200 }, { id: 'spa', label: 'Español', count: 340 }]);
  assert.deepEqual(categories.map((entry) => entry.id), ['stack_exchange', 'wikipedia']);
});

test('loads live catalog choices and applies category, language, search, and pagination filters', async () => {
  const runtime = makeRuntime();
  const requested: string[] = [];
  const fetchFixture: typeof fetch = async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith('/languages')) return new Response(`<feed><entry><title>English</title><dc:language>eng</dc:language><thr:count>10</thr:count></entry></feed>`);
    if (url.endsWith('/categories')) return new Response(`<feed><entry><title>wikipedia</title></entry></feed>`);
    return new Response(`<feed><totalResults>0</totalResults><startIndex>48</startIndex><itemsPerPage>48</itemsPerPage></feed>`);
  };
  const service = new KiwixService(runtime.database, runtime.paths, fetchFixture);
  try {
    const options = await service.fetchCatalogOptions();
    assert.equal(options.ok, true, options.message);
    const result = await service.fetchCatalog('medicine', 'eng', 'wikipedia', 48);
    assert.equal(result.ok, true, result.message);
    const request = new URL(requested.find((url) => url.includes('/entries'))!);
    assert.equal(request.searchParams.get('q'), 'medicine');
    assert.equal(request.searchParams.get('lang'), 'eng');
    assert.equal(request.searchParams.get('category'), 'wikipedia');
    assert.equal(request.searchParams.get('start'), '48');
  } finally {
    await service.shutdown();
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('resumes a catalog download, verifies SHA-256, and only then installs the ZIM', async () => {
  const runtime = makeRuntime();
  const content = Buffer.from('verified portable zim content');
  const sha256 = (await import('node:crypto')).createHash('sha256').update(content).digest('hex');
  const fileName = 'reference_en_2026-08.zim';
  const metaUrl = `https://lb.download.kiwix.org/zim/reference/${fileName}.meta4`;
  const catalogXml = `<feed><entry><id>urn:uuid:reference-entry-123</id><title>Reference Test</title><summary>Fixture</summary><language>eng</language><flavour>mini</flavour><category>reference</category><updated>2026-08-01T00:00:00Z</updated><link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim" href="${metaUrl}" length="${content.length}" /></entry></feed>`;
  const metalinkXml = `<metalink><file name="${fileName}"><size>${content.length}</size><hash type="sha-256">${sha256}</hash></file></metalink>`;
  let resumedAt = -1;
  const fetchFixture: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/catalog/v2/entries')) return new Response(catalogXml);
    if (url.endsWith('.meta4')) return new Response(metalinkXml);
    const range = new Headers(init?.headers).get('Range');
    resumedAt = range ? Number(range.match(/bytes=(\d+)-/)?.[1]) : 0;
    return new Response(content.subarray(resumedAt), { status: resumedAt ? 206 : 200 });
  };
  const service = new KiwixService(runtime.database, runtime.paths, fetchFixture);
  try {
    const catalog = await service.fetchCatalog('reference', 'eng');
    assert.equal(catalog.ok, true, catalog.message);
    const partialRoot = runtime.paths.ensureDirectory('Downloads/Kiwix');
    fs.writeFileSync(path.join(partialRoot, `${fileName}.part`), content.subarray(0, 8));
    const result = await service.downloadCatalogEntry('reference-entry-123');
    assert.equal(result.ok, true, result.message);
    assert.equal(resumedAt, 8);
    assert.deepEqual(fs.readFileSync(runtime.paths.resolve(`Content/ZIM/${fileName}`)), content);
    assert.equal(fs.existsSync(path.join(partialRoot, `${fileName}.part`)), false);
    assert.equal(service.downloadStatus().state, 'complete');
  } finally {
    await service.shutdown();
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('keeps a same-named user ZIM when installing verified catalog content', async () => {
  const runtime = makeRuntime();
  const userContent = Buffer.from('user supplied content');
  const verifiedContent = Buffer.from('official verified content');
  const sha256 = (await import('node:crypto')).createHash('sha256').update(verifiedContent).digest('hex');
  const fileName = 'same-name.zim';
  const metaUrl = `https://lb.download.kiwix.org/zim/custom/${fileName}.meta4`;
  const catalogXml = `<feed><entry><id>urn:uuid:same-name-entry-123</id><title>Same Name</title><language>eng</language><link rel="http://opds-spec.org/acquisition/open-access" type="application/x-zim" href="${metaUrl}" length="${verifiedContent.length}" /></entry></feed>`;
  const metalinkXml = `<metalink><file name="${fileName}"><size>${verifiedContent.length}</size><hash type="sha-256">${sha256}</hash></file></metalink>`;
  const fetchFixture: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/catalog/v2/entries')) return new Response(catalogXml);
    if (url.endsWith('.meta4')) return new Response(metalinkXml);
    return new Response(verifiedContent);
  };
  const service = new KiwixService(runtime.database, runtime.paths, fetchFixture);
  try {
    const original = runtime.paths.resolve(`Content/ZIM/${fileName}`);
    fs.writeFileSync(original, userContent);
    await service.fetchCatalog('same name', 'eng');
    const result = await service.downloadCatalogEntry('same-name-entry-123');
    assert.equal(result.ok, true, result.message);
    assert.deepEqual(fs.readFileSync(original), userContent);
    assert.deepEqual(fs.readFileSync(runtime.paths.resolve(`Content/ZIM/same-name-verified-${sha256.slice(0, 8)}.zim`)), verifiedContent);
  } finally {
    await service.shutdown();
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});

test('installs and runs the official Kiwix engine with an official small ZIM', {
  skip: process.platform !== 'win32' || !fs.existsSync(archivePath) || !fs.existsSync(samplePath),
  timeout: 60_000,
}, async () => {
  const runtime = makeRuntime();
  const archive = fs.readFileSync(archivePath);
  const sample = fs.readFileSync(samplePath);
  const fetchFixture: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('kiwix-tools_win-x86_64-3.8.1.zip')) return new Response(archive);
    if (url.endsWith('/data/nons/small.zim')) return new Response(sample);
    return new Response('not found', { status: 404 });
  };
  const service = new KiwixService(runtime.database, runtime.paths, fetchFixture);
  try {
    const installed = await service.install();
    assert.equal(installed.ok, true, installed.message);
    assert.equal(service.status().engineVersion, '3.8.1');
    const sampleResult = await service.installSample();
    assert.equal(sampleResult.ok, true, sampleResult.message);
    assert.equal(sampleResult.status.content.length, 1);
    const marker = runtime.paths.resolve('Content/ZIM/user-marker.txt');
    fs.writeFileSync(marker, 'preserve');

    const started = await service.start();
    assert.equal(started.ok, true, started.message);
    const running = service.status();
    assert.equal(running.running, true);
    const response = await fetch(running.serverUrl!);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /small zimfile|Kiwix/i);
    const article = await fetch(new URL('/content/openzim-small', running.serverUrl!));
    assert.equal(article.status, 200);
    assert.match(await article.text(), /Test ZIM file/i);
    await service.stop();
    assert.equal(service.status().running, false);

    const removed = await service.uninstall();
    assert.equal(removed.ok, true);
    assert.equal(fs.existsSync(runtime.paths.resolve('Modules/Installed/kiwix-engine')), false);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'preserve');
    assert.equal(fs.existsSync(runtime.paths.resolve('Content/ZIM/openzim-small.zim')), true);
  } finally {
    await service.stop(true);
    runtime.database.close();
    fs.rmSync(runtime.root, { recursive: true, force: true });
  }
});
