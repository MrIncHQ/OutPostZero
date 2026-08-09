import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import type { BootstrapData, DocumentSearchResult, KiwixCatalogEntry, KiwixCatalogOptionsResult, KiwixCatalogResult, KiwixDownloadStatus, LocalProfile, ModuleOperationResult, ModuleSummary, OfflineLibraryStatus, StorageSummary } from '../shared/contracts';
import { DocumentsView } from './DocumentsView';

type ViewId = 'home' | 'library' | 'documents' | 'maps' | 'learning' | 'notes' |
  'media' | 'relay' | 'tools' | 'modules' | 'downloads' | 'storage' | 'settings' | 'updates';

const navigation: Array<{ id: ViewId; label: string }> = [
  { id: 'home', label: 'Home' }, { id: 'library', label: 'Library' },
  { id: 'documents', label: 'Documents' },
  { id: 'maps', label: 'Maps' }, { id: 'learning', label: 'Learning' },
  { id: 'notes', label: 'Notes' }, { id: 'media', label: 'Media' },
  { id: 'relay', label: 'Local Relay' }, { id: 'tools', label: 'Tools' },
  { id: 'modules', label: 'Modules' }, { id: 'downloads', label: 'Downloads' },
  { id: 'updates', label: 'Updates' },
];

const comingSoon: Partial<Record<ViewId, { title: string; description: string; milestone: string }>> = {
  maps: { title: 'Maps without a connection', description: 'User-selected PMTiles and MBTiles packages will remain entirely on this drive.', milestone: 'PHASE 5' },
  learning: { title: 'Education center', description: 'Drive-contained lessons, courses, media, quizzes, and progress require no online account.', milestone: 'PHASE 7' },
  notes: { title: 'Notes that travel with you', description: 'Markdown notes, folders, tags, attachments, and local full-text search will live on this drive.', milestone: 'PHASE 5' },
  media: { title: 'Portable media library', description: 'Video, audio, images, playlists, metadata, and collections are planned after the core library.', milestone: 'LATER PHASE' },
  relay: { title: 'Nearby Outposts', description: 'Encrypted LAN discovery, direct messages, identity verification, and file transfer are not enabled yet.', milestone: 'PHASE 6' },
  tools: { title: 'Offline tools center', description: 'Calculators, conversion tools, checksums, formatters, and reference utilities will share one interface.', milestone: 'PHASE 5' },
  downloads: { title: 'Download manager', description: 'Queues, resume support, verification, and storage warnings activate with the first content module.', milestone: 'PHASE 4' },
};

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit > 2 ? 1 : unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function editionLabel(flavour: string): string {
  if (flavour.toLowerCase() === 'mini') return 'Mini';
  if (flavour.toLowerCase() === 'nopic') return 'Nopic';
  if (flavour.toLowerCase() === 'maxi') return 'Maxi';
  return flavour ? flavour.replace(/[_-]+/g, ' ') : 'Standard';
}

function editionDescription(flavour: string): string {
  if (flavour.toLowerCase() === 'mini') return 'Introductions and infoboxes; smallest package.';
  if (flavour.toLowerCase() === 'nopic') return 'Fuller article text without images.';
  if (flavour.toLowerCase() === 'maxi') return 'Fullest standard edition with images.';
  return 'The standard edition published for this archive.';
}

function categoryLabel(category: string): string {
  const labels: Record<string, string> = {
    wikipedia: 'Wikipedia', wiktionary: 'Dictionary', wikivoyage: 'Travel Guides', wikibooks: 'Books',
    wikisource: 'Source Library', wikiquote: 'Quotes', wikiversity: 'Courses', gutenberg: 'Project Gutenberg',
    iFixit: 'Repair Guides', stack_exchange: 'Stack Exchange', phet: 'Science Simulations', ted: 'TED Talks',
    mooc: 'Online Courses', vikidia: 'Vikidia for Younger Readers', other: 'More Knowledge', psiram: 'Health Reference',
  };
  return labels[category] ?? category.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Onboarding({ onComplete }: { onComplete: (profile: LocalProfile) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      onComplete(await window.outpost.createProfile(name));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the local identity.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="onboarding">
      <div className="setup-card">
        <div className="setup-brand"><span>O</span> OUTPOST ZERO</div>
        <p className="eyebrow">THE WORLD, OFFLINE.</p>
        <h1>Welcome to your <em>portable outpost.</em></h1>
        <p>Everything you save, index, or configure stays beneath this application folder.</p>
        <form onSubmit={submit}>
          <label htmlFor="display-name">LOCAL IDENTITY</label>
          <input id="display-name" value={name} onChange={(event) => setName(event.target.value)}
            autoFocus maxLength={32} placeholder="Name seen by nearby Outposts" />
          <small>No account or internet login is required.</small>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" disabled={saving || name.trim().length < 2}>
            {saving ? 'CREATING IDENTITY...' : 'CREATE LOCAL IDENTITY'}
          </button>
        </form>
      </div>
    </div>
  );
}

function HomeView({ data, go, onOpenDocument }: { data: BootstrapData; go: (view: ViewId) => void; onOpenDocument: (documentId: string, page: number) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DocumentSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await window.outpost.searchDocuments(query));
      setSearched(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="home-workspace">
      <div className="home-intro"><p className="section-label">YOUR OFFLINE OUTPOST</p><h2>What do you need?</h2><p>Search the documents you carry, or open one of your offline libraries.</p></div>
      <form className="search-block home-search" onSubmit={search}>
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Search inside your portable documents" />
        <button className="primary-button" disabled={busy || !query.trim()}>{busy ? 'SEARCHING...' : 'SEARCH'}</button>
      </form>
      {results.length > 0 && <div className="universal-results">{results.map((result) => <button key={`${result.documentId}:${result.page}`} onClick={() => onOpenDocument(result.documentId, result.page)}>
        <span><b>{result.title}</b><small>PAGE {result.page} · {result.format.toUpperCase()}</small></span><p>{result.excerpt}</p><i>OPEN →</i>
      </button>)}</div>}
      {searched && results.length === 0 && <div className="home-search-empty"><b>No results for “{query}”</b><span>Try another phrase or add documents to this drive.</span><button className="secondary-button" onClick={() => go('documents')}>OPEN DOCUMENTS</button></div>}
      {!searched && <div className="home-action-grid">
        <button className="home-action-card" onClick={() => go('documents')}><span className="home-action-number">01</span><div><p className="section-label">PORTABLE DOCUMENTS</p><h3>Search manuals, PDFs, and notes.</h3><p>Import documents, keep your place, and open search results to the exact page.</p></div><i>OPEN DOCUMENTS →</i></button>
        <button className="home-action-card" onClick={() => go('library')}><span className="home-action-number">02</span><div><p className="section-label">OFFLINE KNOWLEDGE</p><h3>Browse your Kiwix library.</h3><p>Read downloaded encyclopedias and reference archives without a connection.</p></div><i>OPEN LIBRARY →</i></button>
        <button className="home-action-card compact" onClick={() => go('updates')}><span className="home-action-number">03</span><div><p className="section-label">OUTPOST STATUS</p><h3>Version {data.status.version}</h3><p>Updates remain manual and never overwrite your content.</p></div><i>CHECK UPDATES →</i></button>
      </div>}
    </section>
  );
}

function LibraryView({ onModules }: { onModules: (modules: ModuleSummary[]) => void }) {
  const [library, setLibrary] = useState<OfflineLibraryStatus>();
  const [librarySection, setLibrarySection] = useState<'browse' | 'add' | 'manage'>('browse');
  const [busy, setBusy] = useState<'install' | 'sample' | 'scan' | 'start' | 'stop' | 'catalog' | 'download' | 'remove' | null>(null);
  const [message, setMessage] = useState('');
  const [catalog, setCatalog] = useState<KiwixCatalogResult>();
  const [catalogOptions, setCatalogOptions] = useState<KiwixCatalogOptionsResult>();
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogLanguage, setCatalogLanguage] = useState('eng');
  const [catalogCategory, setCatalogCategory] = useState('wikipedia');
  const [selectedEditions, setSelectedEditions] = useState<Record<string, string>>({});
  const [confirmDownload, setConfirmDownload] = useState<KiwixCatalogEntry>();
  const [confirmRemove, setConfirmRemove] = useState<OfflineLibraryStatus['content'][number]>();
  const [download, setDownload] = useState<KiwixDownloadStatus>();
  useEffect(() => { void window.outpost.getLibraryStatus().then((status) => { setLibrary(status); if (!status.content.length) setLibrarySection('add'); }); }, []);
  useEffect(() => { void window.outpost.getKiwixCatalogOptions().then(setCatalogOptions); }, []);
  useEffect(() => {
    let disposed = false;
    const refresh = () => void window.outpost.getKiwixDownloadStatus().then((status) => { if (!disposed) setDownload(status); });
    refresh();
    const timer = window.setInterval(refresh, 750);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => { if (download && ['downloading', 'verifying'].includes(download.state)) setLibrarySection('add'); }, [download?.state]);
  const archiveGroups = useMemo(() => {
    const groups = new Map<string, { key: string; title: string; summary: string; variants: KiwixCatalogEntry[] }>();
    for (const entry of catalog?.entries ?? []) {
      const key = entry.archiveName;
      const group = groups.get(key) ?? { key, title: entry.title, summary: entry.summary, variants: [] };
      group.variants.push(entry);
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({ ...group, variants: group.variants.sort((left, right) => left.downloadBytes - right.downloadBytes) }));
  }, [catalog]);
  useEffect(() => {
    setSelectedEditions((current) => {
      const next = { ...current };
      for (const group of archiveGroups) {
        if (!group.variants.some((entry) => entry.id === next[group.key])) next[group.key] = group.variants[0].id;
      }
      return next;
    });
  }, [archiveGroups]);
  useEffect(() => {
    if (catalogOptions?.ok) void searchCatalog(0);
    // Category and language choices intentionally refresh without a separate confirmation button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogOptions?.ok, catalogCategory, catalogLanguage]);

  async function moduleAction(action: 'install' | 'start' | 'stop') {
    setBusy(action);
    setMessage('');
    try {
      const result = action === 'install' ? await window.outpost.installModule('library-engine')
        : action === 'start' ? await window.outpost.startModule('library-engine')
          : await window.outpost.stopModule('library-engine');
      onModules(result.modules);
      setMessage(result.message);
      setLibrary(await window.outpost.getLibraryStatus());
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Kiwix action failed.');
    } finally {
      setBusy(null);
    }
  }

  async function installSample() {
    setBusy('sample');
    setMessage('');
    try {
      const result = await window.outpost.installKiwixSample();
      setLibrary(result.status);
      setMessage(result.message);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Sample library download failed.');
    } finally {
      setBusy(null);
    }
  }

  async function scan() {
    setBusy('scan');
    setLibrary(await window.outpost.scanLibrary());
    setMessage('Content/ZIM scan complete.');
    setBusy(null);
  }

  async function searchCatalog(startIndex = 0) {
    setBusy('catalog');
    setMessage('');
    try {
      const result = await window.outpost.fetchKiwixCatalog(catalogQuery, catalogLanguage, catalogCategory, startIndex);
      setCatalog(result);
      setMessage(result.ok ? '' : result.message);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Kiwix catalog lookup failed.');
    } finally {
      setBusy(null);
    }
  }

  async function downloadEntry(entryId: string) {
    setConfirmDownload(undefined);
    setBusy('download');
    setMessage('');
    try {
      const result = await window.outpost.downloadKiwixContent(entryId);
      setLibrary(result.status);
      setMessage(result.message);
      setDownload(await window.outpost.getKiwixDownloadStatus());
      if (result.ok) setCatalog(await window.outpost.fetchKiwixCatalog(catalogQuery, catalogLanguage, catalogCategory, catalog?.startIndex ?? 0));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Kiwix download failed.');
    } finally {
      setBusy(null);
    }
  }

  function requestDownload(entry: KiwixCatalogEntry) {
    if (entry.downloadBytes >= 5 * 1024 ** 3) setConfirmDownload(entry);
    else void downloadEntry(entry.id);
  }

  async function cancelDownload() {
    setDownload(await window.outpost.cancelKiwixDownload());
  }

  async function removeContent(contentId: string) {
    setConfirmRemove(undefined);
    setBusy('remove');
    setMessage('');
    try {
      const result = await window.outpost.removeKiwixContent(contentId);
      setLibrary(result.status);
      setMessage(result.message);
      if (catalog) setCatalog(await window.outpost.fetchKiwixCatalog(catalogQuery, catalogLanguage, catalogCategory, catalog.startIndex));
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not remove the offline library.');
    } finally {
      setBusy(null);
    }
  }

  if (!library) return <section className="page-panel"><p className="section-label">OFFLINE LIBRARY</p><h2>Scanning portable knowledge...</h2></section>;
  return (
    <section className="page-panel library-panel">
      <div className="page-heading">
        <div><p className="section-label">OFFLINE KNOWLEDGE</p><h2>My Library</h2></div>
        <button className="primary-button library-add-button" onClick={() => setLibrarySection('add')}>+ ADD CONTENT</button>
      </div>
      <nav className="library-tabs" aria-label="Library sections">
        <button className={librarySection === 'browse' ? 'active' : ''} onClick={() => setLibrarySection('browse')}>MY LIBRARY</button>
        <button className={librarySection === 'add' ? 'active' : ''} onClick={() => setLibrarySection('add')}>ADD CONTENT</button>
        <button className={librarySection === 'manage' ? 'active' : ''} onClick={() => setLibrarySection('manage')}>MANAGE <span>{library.content.length}</span></button>
      </nav>
      {message && librarySection !== 'browse' && <div className="module-result" role="status">{message}</div>}
      {librarySection === 'manage' && <section className="library-manage">
      <div className="library-section-heading"><div><p className="section-label">LIBRARY MANAGEMENT</p><h3>Engine and downloaded content</h3></div><button className="secondary-button" onClick={() => void scan()} disabled={busy !== null}>{busy === 'scan' ? 'SCANNING...' : 'SCAN FOR ZIM FILES'}</button></div>
      <p className="page-intro">Kiwix runs from this drive, serves only on 127.0.0.1, and blocks direct external-resource navigation. ZIM files remain separate from the removable engine.</p>
      <div className="library-actions">
        {!library.engineInstalled && <button className="primary-button" onClick={() => void moduleAction('install')} disabled={busy !== null}>{busy === 'install' ? 'DOWNLOADING AND VERIFYING KIWIX...' : 'INSTALL KIWIX ENGINE'}</button>}
        <button className="secondary-button" onClick={() => void installSample()} disabled={busy !== null}>{busy === 'sample' ? 'DOWNLOADING SAMPLE...' : 'ADD 41 KB TEST LIBRARY'}</button>
        {library.engineInstalled && !library.running && <button className="primary-button" onClick={() => void moduleAction('start')} disabled={busy !== null}>{busy === 'start' ? 'STARTING...' : 'START OFFLINE LIBRARY'}</button>}
        {library.running && <button className="secondary-button" onClick={() => void moduleAction('stop')} disabled={busy !== null}>{busy === 'stop' ? 'STOPPING...' : 'STOP LIBRARY'}</button>}
      </div>
      <dl className="detail-list library-details">
        <div><dt>Engine</dt><dd>{library.engineInstalled ? `Kiwix Tools ${library.engineVersion}` : 'Not installed'}</dd></div>
        <div><dt>Process</dt><dd>{library.running ? `Healthy · PID ${library.pid} · 127.0.0.1:${library.port}` : 'Stopped'}</dd></div>
        <div><dt>Content location</dt><dd>Content/ZIM</dd></div>
      </dl>
      {confirmRemove && <div className="download-confirm library-remove-confirm" role="alertdialog" aria-label="Confirm library removal"><div><p className="section-label">REMOVE OFFLINE CONTENT</p><b>{confirmRemove.name}</b><p>This permanently deletes this ZIM file and frees {formatBytes(confirmRemove.size)} on the drive. This cannot be undone.</p></div><div><button className="secondary-button" onClick={() => setConfirmRemove(undefined)}>KEEP IT</button><button className="danger-button" onClick={() => void removeContent(confirmRemove.id)}>DELETE FROM DRIVE</button></div></div>}
      <div className="zim-list">
        {library.content.map((item) => <div key={item.id}><span><b>{item.name}</b><small>{item.relativePath}</small></span><div className="zim-actions"><strong>{formatBytes(item.size)}</strong><button onClick={() => setConfirmRemove(item)} disabled={busy !== null}>REMOVE</button></div></div>)}
        {library.content.length === 0 && <p>No ZIM files found. Add your own file to Content/ZIM or download the small test library.</p>}
      </div>
      </section>}

      {librarySection === 'add' && <section className="kiwix-catalog">
        <div className="catalog-heading">
          <div><p className="section-label">ADD OFFLINE CONTENT</p><h3>What do you want to carry?</h3></div>
          <span>Only your final choice downloads.</span>
        </div>
        <div className="content-steps"><span className="active"><i>1</i>CHOOSE</span><span><i>2</i>SELECT SIZE</span><span><i>3</i>DOWNLOAD</span></div>
        <div className="catalog-filters simple">
          <label>CONTENT TYPE<select value={catalogCategory} onChange={(event) => { setCatalogQuery(''); setCatalogCategory(event.target.value); }} disabled={!catalogOptions?.ok}>{catalogOptions?.categories.map((option) => <option key={option.id} value={option.id}>{categoryLabel(option.id)}</option>) ?? <option value="wikipedia">Wikipedia</option>}</select></label>
          <label>LANGUAGE<select value={catalogLanguage} onChange={(event) => { setCatalogQuery(''); setCatalogLanguage(event.target.value); }} disabled={!catalogOptions?.ok}>{catalogOptions?.languages.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) ?? <option value="eng">English</option>}</select></label>
        </div>
        <details className="catalog-search"><summary>Looking for something specific?</summary><form onSubmit={(event) => { event.preventDefault(); void searchCatalog(); }}><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} maxLength={80} placeholder="Search within this content type" /><button className="secondary-button" type="submit" disabled={busy !== null}>SEARCH</button></form></details>
        {catalogOptions && !catalogOptions.ok && <p className="catalog-option-error">Live catalog choices are unavailable: {catalogOptions.message}</p>}
        {busy === 'catalog' && !catalog && <div className="catalog-loading">Loading available editions...</div>}
        {download && ['downloading', 'verifying', 'cancelled', 'error'].includes(download.state) && (
          <div className={`download-progress download-${download.state}`}>
            <div><b>{download.title ?? 'Kiwix content'}</b><span>{download.message}</span></div>
            <strong>{download.totalBytes ? `${download.state === 'verifying' ? 'VERIFYING ' : ''}${Math.min(100, (download.state === 'verifying' ? download.verifiedBytes ?? 0 : download.downloadedBytes) / download.totalBytes * 100).toFixed(1)}%` : 'PREPARING'}</strong>
            <progress max={Math.max(1, download.totalBytes)} value={download.state === 'verifying' ? download.verifiedBytes ?? 0 : download.downloadedBytes} />
            {download.state === 'downloading' && <button type="button" onClick={() => void cancelDownload()}>PAUSE</button>}
          </div>
        )}
        {confirmDownload && <div className="download-confirm" role="alertdialog" aria-label="Confirm large download"><div><p className="section-label">LARGE DOWNLOAD</p><b>{confirmDownload.title} · {editionLabel(confirmDownload.flavour)}</b><p>This will use {formatBytes(confirmDownload.downloadBytes)} on this drive. You can pause and resume it later.</p></div><div><button className="secondary-button" onClick={() => setConfirmDownload(undefined)}>GO BACK</button><button className="primary-button" onClick={() => void downloadEntry(confirmDownload.id)}>START DOWNLOAD</button></div></div>}
        {archiveGroups.length ? <div className="catalog-list">{archiveGroups.map((group) => {
          const selected = group.variants.find((entry) => entry.id === selectedEditions[group.key]) ?? group.variants[0];
          const freeAfter = catalog?.freeBytes === null ? null : (catalog?.freeBytes ?? 0) - selected.downloadBytes;
          return <article key={group.key}>
            <div className="catalog-title"><span><b>{group.title}</b><small>{group.summary || selected.fileName}</small></span><i>{selected.category.replace(/_/g, ' ')}</i></div>
            <fieldset className="edition-choices"><legend>CHOOSE AN EDITION</legend>{group.variants.map((entry) => <label className={selected.id === entry.id ? 'selected' : ''} key={entry.id}>
              <input type="radio" name={`edition-${group.key}`} value={entry.id} checked={selected.id === entry.id} onChange={() => setSelectedEditions((current) => ({ ...current, [group.key]: entry.id }))} />
              <span><b>{editionLabel(entry.flavour)}</b><small>{editionDescription(entry.flavour)}</small></span>
              <strong>{formatBytes(entry.downloadBytes)}</strong>
              {entry.installed && <i>INSTALLED</i>}
            </label>)}</fieldset>
            <dl><div><dt>Language</dt><dd>{selected.language.toUpperCase()}</dd></div><div><dt>Release</dt><dd>{selected.releaseDate.slice(0, 10)}</dd></div><div><dt>Articles</dt><dd>{selected.articleCount ? selected.articleCount.toLocaleString() : 'Not listed'}</dd></div><div><dt>Free after</dt><dd className={freeAfter !== null && freeAfter < 0 ? 'low-space' : ''}>{formatBytes(freeAfter)}</dd></div></dl>
            <button className={selected.installed ? 'installed-button' : 'secondary-button'} disabled={selected.installed || busy !== null || (freeAfter !== null && freeAfter < 0)} onClick={() => requestDownload(selected)}>{selected.installed ? 'INSTALLED' : download?.entryId === selected.id && download.state === 'cancelled' ? 'RESUME DOWNLOAD' : `DOWNLOAD ${editionLabel(selected.flavour).toUpperCase()} · ${formatBytes(selected.downloadBytes)}`}</button>
          </article>;
        })}</div> : catalog?.ok && <p className="catalog-empty">No matching archives were returned. Try a broader content name or another language.</p>}
        {catalog?.ok && catalog.totalResults > catalog.itemsPerPage && <div className="catalog-pagination"><button disabled={busy !== null || catalog.startIndex === 0} onClick={() => void searchCatalog(Math.max(0, catalog.startIndex - catalog.itemsPerPage))}>PREVIOUS</button><span>{catalog.startIndex + 1}–{Math.min(catalog.totalResults, catalog.startIndex + catalog.entries.length)} OF {catalog.totalResults} EDITIONS</span><button disabled={busy !== null || catalog.startIndex + catalog.itemsPerPage >= catalog.totalResults} onClick={() => void searchCatalog(catalog.startIndex + catalog.itemsPerPage)}>NEXT</button></div>}
      </section>}

      {librarySection === 'browse' && <section className="library-browse">
        <div className="library-section-heading"><div><p className="section-label">OFFLINE READER</p><h3>{library.running ? 'Browse your offline knowledge' : library.content.length ? 'Reader is ready' : 'Your library is empty'}</h3></div>{library.engineInstalled && !library.running && library.content.length > 0 && <button className="primary-button" onClick={() => void moduleAction('start')} disabled={busy !== null}>{busy === 'start' ? 'OPENING...' : 'OPEN READER'}</button>}{library.running && <button className="secondary-button" onClick={() => void moduleAction('stop')} disabled={busy !== null}>{busy === 'stop' ? 'CLOSING...' : 'CLOSE READER'}</button>}</div>
        {!library.content.length && <div className="library-empty"><b>Add your first offline knowledge source</b><p>Choose a language, content type, and size. Only the edition you select is downloaded.</p><button className="primary-button" onClick={() => setLibrarySection('add')}>CHOOSE CONTENT</button></div>}
        {library.content.length > 0 && !library.engineInstalled && <div className="library-empty"><b>The offline reader is not installed</b><p>Your downloaded content is safe. Install or repair the Kiwix engine from Manage.</p><button className="secondary-button" onClick={() => setLibrarySection('manage')}>OPEN MANAGE</button></div>}
        {library.running && library.serverUrl && <div className="kiwix-frame-shell"><div><span>OFFLINE READER</span><code>{library.serverUrl}</code></div><iframe title="Offline Kiwix library" src={library.serverUrl} sandbox="allow-scripts allow-forms allow-same-origin" /></div>}
      </section>}
    </section>
  );
}

function StorageView({ storage, onRefresh }: { storage: StorageSummary; onRefresh: () => Promise<void> }) {
  const largest = Math.max(1, ...storage.categories.map((category) => category.bytes));
  return (
    <section className="page-panel">
      <div className="page-heading">
        <div><p className="section-label">STORAGE INSPECTOR</p><h2>{formatBytes(storage.freeBytes)} free</h2></div>
        <button className="secondary-button" onClick={() => void onRefresh()}>REFRESH SCAN</button>
      </div>
      <p className="page-intro">Outpost Zero currently manages {formatBytes(storage.usedByOutpostBytes)} beneath this portable root.</p>
      <div className="storage-list">
        {storage.categories.map((category) => (
          <div className="storage-row" key={category.id}>
            <span>{category.label}</span>
            <div><i style={{ width: `${Math.max(category.bytes ? 2 : 0, category.bytes / largest * 100)}%` }} /></div>
            <strong>{formatBytes(category.bytes)}</strong>
          </div>
        ))}
      </div>
      <p className="quiet-note">Outpost Zero never automatically deletes documents or user content.</p>
    </section>
  );
}

function ModulesView({ modules, onModules }: { modules: ModuleSummary[]; onModules: (modules: ModuleSummary[]) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  async function operate(module: ModuleSummary, action: 'install' | 'start' | 'stop' | 'repair' | 'uninstall') {
    if (action === 'uninstall' && !window.confirm('Remove this module engine? Its portable data and logs will be kept.')) return;
    setBusy(`${module.id}:${action}`);
    setMessage('');
    try {
      let result: ModuleOperationResult;
      if (action === 'install') result = await window.outpost.installModule(module.id);
      else if (action === 'start') result = await window.outpost.startModule(module.id);
      else if (action === 'stop') result = await window.outpost.stopModule(module.id);
      else if (action === 'repair') result = await window.outpost.repairModule(module.id);
      else result = await window.outpost.uninstallModule(module.id);
      onModules(result.modules);
      setMessage(result.message);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Module action failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page-panel">
      <p className="section-label">MODULE CENTER</p>
      <h2>Expand this outpost.</h2>
      <p className="page-intro">Signed modules install entirely on this drive. The process test proves lifecycle safety; the Offline Library Engine adds real Kiwix-powered ZIM browsing.</p>
      {message && <div className="module-result" role="status">{message}</div>}
      <div className="module-list">
        {modules.map((module) => (
          <article className={`module-row module-${module.status}`} key={module.id}>
            <div className="module-icon">{module.status === 'running' ? '●' : module.status === 'installed' ? '✓' : '○'}</div>
            <div>
              <h3>{module.name}</h3><p>{module.description}</p>
              <small>{module.status.replace('-', ' ').toUpperCase()}{module.version ? ` · V${module.version}` : ''}{module.pid ? ` · PID ${module.pid}` : ''}{module.port ? ` · 127.0.0.1:${module.port}` : ''}</small>
              {module.logPath && <code className="module-log">{module.logPath}</code>}
            </div>
            <div className="module-actions">
              {module.status === 'available' && <button onClick={() => void operate(module, 'install')} disabled={busy !== null}>{busy === `${module.id}:install` ? 'INSTALLING...' : 'INSTALL'}</button>}
              {module.status === 'installed' && <><button onClick={() => void operate(module, 'start')} disabled={busy !== null}>START</button><button onClick={() => void operate(module, 'repair')} disabled={busy !== null}>REPAIR</button><button onClick={() => void operate(module, 'uninstall')} disabled={busy !== null}>UNINSTALL</button></>}
              {module.status === 'running' && <button className="stop-button" onClick={() => void operate(module, 'stop')} disabled={busy !== null}>STOP</button>}
              {module.status === 'error' && <><button onClick={() => void operate(module, 'repair')} disabled={busy !== null}>REPAIR</button><button onClick={() => void operate(module, 'uninstall')} disabled={busy !== null}>UNINSTALL</button></>}
              {module.status === 'available-later' && <button disabled>COMING LATER</button>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsView({ data, onProfile, onHardware, go }: {
  data: BootstrapData;
  onProfile: (profile: LocalProfile) => void;
  onHardware: () => Promise<void>;
  go: (view: ViewId) => void;
}) {
  const [name, setName] = useState(data.profile?.displayName ?? '');
  const [message, setMessage] = useState('');
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      onProfile(await window.outpost.updateProfile(name));
      setMessage('Local identity updated on this drive.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Update failed.');
    }
  }
  return (
    <section className="page-panel">
      <p className="section-label">SETTINGS</p><h2>Local identity and system.</h2>
      <div className="content-grid settings-system-grid">
        <button className="feature-card portable-card card-button" onClick={() => go('storage')}>
          <p className="section-label">PORTABLE FOUNDATION</p>
          <h2>Your drive is the system.</h2>
          <p>All controlled application state is contained beneath the active portable root.</p>
          <div className="path-display"><small>ACTIVE PORTABLE ROOT</small><code>{data.status.root}</code></div>
          <div className="checks"><span>✓ Root marker verified</span><span>✓ Writable paths contained</span><span>✓ Clean shutdown tracking active</span></div>
          <span className="card-action">INSPECT STORAGE →</span>
        </button>
        <button className="feature-card capacity-card card-button" onClick={() => go('storage')}>
          <p className="section-label">DRIVE CAPACITY</p>
          <div className="capacity-value">{formatBytes(data.storage.freeBytes)}</div>
          <p>available of {formatBytes(data.storage.totalBytes)}</p>
          <div className="meter"><span style={{ width: data.storage.totalBytes && data.storage.freeBytes ? `${Math.max(2, (1 - data.storage.freeBytes / data.storage.totalBytes) * 100)}%` : '2%' }} /></div>
          <span className="card-action">VIEW BREAKDOWN →</span>
        </button>
        <button className="feature-card next-card card-button" onClick={() => go('modules')}>
          <p className="section-label">MODULE CENTER</p>
          <h3>{data.modules.length} optional components available or planned</h3>
          <p>Install, repair, start, or stop portable components.</p>
          <span className="card-action">OPEN MODULE CENTER →</span>
        </button>
      </div>
      <form className="settings-form" onSubmit={save}>
        <label htmlFor="settings-name">DISPLAY NAME</label>
        <div><input id="settings-name" value={name} maxLength={32} onChange={(event) => setName(event.target.value)} /><button className="primary-button">SAVE NAME</button></div>
        {message && <small className="save-message">{message}</small>}
      </form>
      <dl className="detail-list">
        <div><dt>Device fingerprint</dt><dd>{data.profile?.deviceFingerprint}</dd></div>
        <div><dt>Portable root</dt><dd>{data.status.root}</dd></div>
        <div><dt>Platform</dt><dd>{data.status.platform} / {data.status.architecture}</dd></div>
        <div><dt>Version</dt><dd>v{data.status.version}</dd></div>
        <div><dt>Telemetry</dt><dd>Disabled</dd></div>
        <div><dt>AI</dt><dd>Not installed</dd></div>
        <div><dt>Database</dt><dd>Schema {data.database.schemaVersion} / {data.database.integrityOk ? 'Integrity OK' : 'Check failed'}</dd></div>
      </dl>
      <div className="settings-section-heading">
        <div><p className="section-label">HARDWARE DIAGNOSTICS</p><h3>Current host resources</h3></div>
        <button className="secondary-button" onClick={() => void onHardware()}>REFRESH</button>
      </div>
      <dl className="detail-list hardware-list">
        <div><dt>CPU</dt><dd>{data.hardware.cpuModel}</dd></div>
        <div><dt>Logical cores</dt><dd>{data.hardware.logicalCores}</dd></div>
        <div><dt>Memory</dt><dd>{formatBytes(data.hardware.freeMemoryBytes)} free / {formatBytes(data.hardware.totalMemoryBytes)}</dd></div>
        <div><dt>GPU</dt><dd>{data.hardware.gpuDevices.join(', ') || 'Unavailable'}</dd></div>
        <div><dt>Operating system</dt><dd>{data.hardware.operatingSystem}</dd></div>
        <div><dt>Host name</dt><dd>{data.hardware.hostname}</dd></div>
      </dl>
      <button className="update-link-card" onClick={() => go('updates')}>
        <span><small>UPDATE CENTER</small><b>GitHub-ready update foundation</b></span><i>OPEN →</i>
      </button>
    </section>
  );
}

function UpdatesView({ data }: { data: BootstrapData }) {
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState<'checking' | 'downloading' | 'applying' | null>(null);
  const [available, setAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  async function check() {
    setBusy('checking');
    setReady(false);
    const checkResult = await window.outpost.checkForUpdates();
    setAvailable(checkResult.status === 'available');
    setResult(checkResult.downloadBytes ? `${checkResult.message} Download: ${formatBytes(checkResult.downloadBytes)}.` : checkResult.message);
    setBusy(null);
  }
  async function download() {
    setBusy('downloading');
    const downloadResult = await window.outpost.downloadUpdate();
    setReady(downloadResult.status === 'ready');
    setResult(downloadResult.downloadedBytes ? `${downloadResult.message} Downloaded ${formatBytes(downloadResult.downloadedBytes)}.` : downloadResult.message);
    setBusy(null);
  }
  async function apply() {
    setBusy('applying');
    const applyResult = await window.outpost.applyUpdate();
    setResult(applyResult.message);
    if (applyResult.status !== 'launching') setBusy(null);
  }
  return (
    <section className="page-panel">
      <p className="section-label">UPDATE CENTER</p><h2>Portable updates, controlled by you.</h2>
      <p className="page-intro">Core, module, and content updates will always be downloaded and applied on this drive. Automatic checks are off.</p>
      <dl className="detail-list update-details">
        <div><dt>Current version</dt><dd>v{data.updates.currentVersion}</dd></div>
        <div><dt>Provider</dt><dd>{data.updates.configured ? 'GitHub signed manifest' : 'Not configured'}</dd></div>
        <div><dt>Repository</dt><dd>{data.updates.repositoryOwner && data.updates.repositoryName ? `${data.updates.repositoryOwner}/${data.updates.repositoryName}` : 'Not configured'}</dd></div>
        <div><dt>Channel</dt><dd>{data.updates.channel}</dd></div>
        <div><dt>Automatic checks</dt><dd>{data.updates.automaticChecks ? 'Enabled' : 'Disabled'}</dd></div>
      </dl>
      <div className="update-explainer">
        <b>User data is outside the update boundary</b>
        <p>Updates verify an Ed25519-signed manifest and every SHA-256 checksum, stage beneath <code>Updates/</code>, back up the current runtime, and roll back on failure. Documents, profiles, content, databases, models, modules, notes, and downloads are never update targets.</p>
      </div>
      <div className="update-actions">
        <button className="primary-button" onClick={() => void check()} disabled={busy !== null}>{busy === 'checking' ? 'CHECKING...' : 'CHECK FOR UPDATES'}</button>
        {available && !ready && <button className="secondary-button" onClick={() => void download()} disabled={busy !== null}>{busy === 'downloading' ? 'DOWNLOADING AND VERIFYING...' : 'DOWNLOAD UPDATE'}</button>}
        {ready && <button className="primary-button" onClick={() => void apply()} disabled={busy !== null}>{busy === 'applying' ? 'STARTING UPDATER...' : 'INSTALL AND RESTART'}</button>}
      </div>
      {result && <div className="update-result">{result}</div>}
    </section>
  );
}

function PlannedView({ view, go }: { view: ViewId; go: (view: ViewId) => void }) {
  const content = comingSoon[view]!;
  return (
    <section className="page-panel planned-view">
      <p className="section-label">{content.milestone}</p><h2>{content.title}</h2><p>{content.description}</p>
      <div className="planned-rule" />
      <button className="secondary-button" onClick={() => go('home')}>RETURN HOME</button>
    </section>
  );
}

export default function App() {
  const [data, setData] = useState<BootstrapData>();
  const [view, setView] = useState<ViewId>('home');
  const [removalMessage, setRemovalMessage] = useState('');
  const [requestedDocument, setRequestedDocument] = useState<{ id: string; page: number }>();
  const clearRequestedDocument = useCallback(() => setRequestedDocument(undefined), []);

  useEffect(() => { void window.outpost.getBootstrap().then(setData); }, []);
  const title = useMemo(() => navigation.find((item) => item.id === view)?.label ?? (view === 'storage' ? 'Storage' : 'Settings'), [view]);

  if (!data) return <div className="loading-screen">PREPARING PORTABLE ENVIRONMENT...</div>;
  if (!data.profile) return <Onboarding onComplete={(profile) => setData({ ...data, profile })} />;
  const activeData = data;

  async function refreshStorage() {
    const storage = await window.outpost.refreshStorage();
    setData((current) => current ? { ...current, storage } : current);
  }
  async function refreshHardware() {
    const hardware = await window.outpost.refreshHardware();
    setData((current) => current ? { ...current, hardware } : current);
  }
  async function prepareForRemoval() {
    const result = await window.outpost.prepareForRemoval();
    setRemovalMessage(result.message);
  }
  function renderView() {
    if (view === 'home') return <HomeView data={activeData} go={setView} onOpenDocument={(id, page) => { setRequestedDocument({ id, page }); setView('documents'); }} />;
    if (view === 'library') return <LibraryView onModules={(modules) => setData({ ...activeData, modules })} />;
    if (view === 'documents') return <DocumentsView requestedDocument={requestedDocument} onRequestHandled={clearRequestedDocument} />;
    if (view === 'storage') return <StorageView storage={activeData.storage} onRefresh={refreshStorage} />;
    if (view === 'modules') return <ModulesView modules={activeData.modules} onModules={(modules) => setData({ ...activeData, modules })} />;
    if (view === 'updates') return <UpdatesView data={activeData} />;
    if (view === 'settings') return <SettingsView data={activeData} onProfile={(profile) => setData({ ...activeData, profile })} onHardware={refreshHardware} go={setView} />;
    return <PlannedView view={view} go={setView} />;
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <button className="brand-mark" onClick={() => setView('home')}><span>O</span><i>ZERO</i></button>
        <nav aria-label="Primary navigation">
          {navigation.map((item, index) => (
            <button className={view === item.id ? 'active' : ''} key={item.id} onClick={() => setView(item.id)}>
              <span className="nav-index">{String(index + 1).padStart(2, '0')}</span>{item.label}
            </button>
          ))}
        </nav>
        <button className={view === 'settings' ? 'settings active' : 'settings'} onClick={() => setView('settings')}><span className="nav-index">••</span>Settings</button>
      </aside>
      <main>
        <header>
          <div><p className="eyebrow">OUTPOST / {title.toUpperCase()}</p><h1>Hello, <em>{data.profile.displayName}.</em></h1></div>
          <div className="status-pulse"><span /> SYSTEM READY</div>
        </header>
        {data.status.recoveredFromUncleanShutdown && <div className="warning">The previous session ended unexpectedly. Portable state was recovered.</div>}
        {renderView()}
        <footer>
          <div className="global-status"><span>OFFLINE</span><i />0 OUTPOSTS NEARBY<i />{formatBytes(data.storage.freeBytes)} FREE<i />AI: NOT INSTALLED</div>
          <button className="eject-button" onClick={prepareForRemoval}>PREPARE DRIVE FOR REMOVAL</button>
        </footer>
        {removalMessage && <div className="toast" role="status">✓ {removalMessage}</div>}
      </main>
    </div>
  );
}
