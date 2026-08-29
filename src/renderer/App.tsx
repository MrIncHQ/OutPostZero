import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiDownloadStatus, AiSource, BootstrapData, KiwixCatalogEntry, KiwixCatalogOptionsResult, KiwixCatalogResult, KiwixDownloadStatus, LocalProfile, MapDownloadStatus, ModuleOperationResult, ModuleSummary, OfflineLibraryStatus, StorageSummary, UnifiedSearchResult, UpdateActivity } from '../shared/contracts';
import { DocumentsView } from './DocumentsView';
import { AiView } from './AiView';

const NotesView = lazy(() => import('./NotesView').then((module) => ({ default: module.NotesView })));
const MapsView = lazy(() => import('./MapsView').then((module) => ({ default: module.MapsView })));
const RelayView = lazy(() => import('./RelayView').then((module) => ({ default: module.RelayView })));
const ToolsView = lazy(() => import('./ToolsView').then((module) => ({ default: module.ToolsView })));
const LearningView = lazy(() => import('./LearningView').then((module) => ({ default: module.LearningView })));
const MediaView = lazy(() => import('./MediaView').then((module) => ({ default: module.MediaView })));
const MedicationView = lazy(() => import('./MedicationView').then((module) => ({ default: module.MedicationView })));
const NatureView = lazy(() => import('./NatureView').then((module) => ({ default: module.NatureView })));

type ViewId = 'home' | 'library' | 'documents' | 'maps' | 'nature' | 'learning' | 'notes' |
  'medications' | 'relay' | 'tools' | 'ai' | 'modules' | 'storage' | 'settings' | 'updates';
type FileTab = 'documents' | 'media' | 'downloads';

interface NavigationItem { id: ViewId; label: string; detail: string; icon: string }
const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  { label: 'COMMAND', items: [{ id: 'home', label: 'Home', detail: 'Search and quick access', icon: 'HQ' }] },
  { label: 'FIELD LIBRARY', items: [
    { id: 'library', label: 'Library', detail: 'Offline knowledge', icon: 'KB' },
    { id: 'documents', label: 'Files', detail: 'Documents, media, transfers', icon: 'FL' },
    { id: 'maps', label: 'Maps', detail: 'Offline navigation', icon: 'MP' },
    { id: 'nature', label: 'Nature', detail: 'Species library and ID', icon: 'NR' },
    { id: 'learning', label: 'Learning', detail: 'Courses and training', icon: 'TR' },
    { id: 'notes', label: 'Notes', detail: 'Plans and field notes', icon: 'NT' },
    { id: 'medications', label: 'Medications', detail: 'Reference only', icon: 'RX' },
  ] },
  { label: 'SYSTEMS', items: [
    { id: 'relay', label: 'Local Relay', detail: 'Nearby communications', icon: 'CM' },
    { id: 'tools', label: 'Tools', detail: 'Offline utilities', icon: 'TL' },
    { id: 'ai', label: 'Local AI', detail: 'On-device assistant', icon: 'AI' },
    { id: 'modules', label: 'Modules', detail: 'Installed capabilities', icon: 'MD' },
    { id: 'updates', label: 'Updates', detail: 'Signed runtime releases', icon: 'UP' },
  ] },
];
const navigation = navigationGroups.flatMap((group) => group.items);

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

function HomeView({ data, go, onOpenResult }: { data: BootstrapData; go: (view: ViewId) => void; onOpenResult: (result: UnifiedSearchResult) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<UnifiedSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await window.outpost.searchOutpost(query));
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
      {results.length > 0 && <div className="universal-results">{results.map((result) => <button key={`${result.source}:${result.id}:${result.page ?? ''}`} onClick={() => onOpenResult(result)}>
        <span><b>{result.title}</b><small>{result.source.toUpperCase()} · {result.context}</small></span><p>{result.excerpt}</p><i>OPEN →</i>
      </button>)}</div>}
      {searched && results.length === 0 && <div className="home-search-empty"><b>No results for “{query}”</b><span>Try another phrase or add documents to this drive.</span><button className="secondary-button" onClick={() => go('documents')}>OPEN DOCUMENTS</button></div>}
      {!searched && <div className="home-action-grid">
        <button className="home-action-card" onClick={() => go('documents')}><span className="home-action-number">01</span><div><p className="section-label">PORTABLE DOCUMENTS</p><h3>Search manuals, PDFs, and notes.</h3><p>Import documents, keep your place, and open search results to the exact page.</p></div><i>OPEN DOCUMENTS →</i></button>
        <button className="home-action-card" onClick={() => go('library')}><span className="home-action-number">02</span><div><p className="section-label">OFFLINE KNOWLEDGE</p><h3>Browse your Kiwix library.</h3><p>Read downloaded encyclopedias and reference archives without a connection.</p></div><i>OPEN LIBRARY →</i></button>
        <button className="home-action-card" onClick={() => go('notes')}><span className="home-action-number">03</span><div><p className="section-label">PORTABLE NOTES</p><h3>Write, organize, and carry plans.</h3><p>Markdown notes autosave locally with tags, folders, templates, and attachments.</p></div><i>OPEN NOTES →</i></button>
        <button className="home-action-card" onClick={() => go('maps')}><span className="home-action-number">04</span><div><p className="section-label">OFFLINE MAPS</p><h3>Navigate your own map packages.</h3><p>Open PMTiles or MBTiles, mark places, measure routes, and carry GPX points.</p></div><i>OPEN MAPS →</i></button>
        <button className="home-action-card compact" onClick={() => go('tools')}><span className="home-action-number">05</span><div><p className="section-label">TOOLS / STATUS</p><h3>Offline utilities · Version {data.status.version}</h3><p>Calculate, convert, encode, inspect, and reference without sending anything away.</p></div><i>OPEN TOOLS →</i></button>
      </div>}
    </section>
  );
}

function LibraryView({ onModules, requestedArticlePath, onRequestHandled }: { onModules: (modules: ModuleSummary[]) => void; requestedArticlePath?: string; onRequestHandled: () => void }) {
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
  const [readerPath, setReaderPath] = useState<string>();
  useEffect(() => { void window.outpost.getLibraryStatus().then((status) => { setLibrary(status); if (!status.content.length) setLibrarySection('add'); }); }, []);
  useEffect(() => { void window.outpost.getKiwixCatalogOptions().then(setCatalogOptions); }, []);
  useEffect(() => {
    if (!requestedArticlePath?.startsWith('/content/')) return;
    setReaderPath(requestedArticlePath); setLibrarySection('browse'); onRequestHandled();
  }, [requestedArticlePath, onRequestHandled]);
  useEffect(() => {
    let disposed = false;
    const refresh = () => void window.outpost.getKiwixDownloadStatus().then((status) => { if (!disposed) setDownload(status); });
    refresh();
    const timer = window.setInterval(refresh, 750);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => { if (download && ['downloading', 'verifying', 'cancelled', 'error'].includes(download.state)) setLibrarySection('add'); }, [download?.state]);
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
      setMessage(action === 'start' && result.ok ? '' : result.message);
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
    const resumingSavedDownload = download?.entryId === entry.id
      && ['cancelled', 'error'].includes(download.state)
      && download.downloadedBytes > 0;
    if (resumingSavedDownload) void downloadEntry(entry.id);
    else if (entry.downloadBytes >= 5 * 1024 ** 3) setConfirmDownload(entry);
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

  const checkingSavedDownload = Boolean(download && download.state === 'downloading'
    && download.message.startsWith('Authenticating the saved portion')
    && download.downloadedBytes > 0 && download.verifiedBytes !== undefined);
  const displayedDownloadBytes = checkingSavedDownload ? download?.verifiedBytes ?? 0
    : download?.state === 'verifying' ? download.verifiedBytes ?? 0 : download?.downloadedBytes ?? 0;
  const displayedDownloadTotal = checkingSavedDownload ? download?.downloadedBytes ?? 0 : download?.totalBytes ?? 0;
  const displayedDownloadPercent = displayedDownloadTotal ? Math.min(100, displayedDownloadBytes / displayedDownloadTotal * 100) : 0;

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
      {message && <div className="module-result" role="status">{message}</div>}
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
        {download && ['downloading', 'verifying', 'cancelled', 'error'].includes(download.state) && (
          <div className={`download-progress download-${download.state}`}>
            <div><b>{download.title ?? 'Kiwix content'}</b><span>{download.message}</span></div>
            <strong>{displayedDownloadTotal ? `${checkingSavedDownload ? 'CHECKING SAVED DATA ' : download.state === 'verifying' ? 'VERIFYING ' : ''}${displayedDownloadPercent.toFixed(1)}%` : download.message.startsWith('Loading verified download metadata') ? 'GETTING DOWNLOAD DETAILS' : 'PREPARING'}</strong>
            <progress max={Math.max(1, displayedDownloadTotal)} value={displayedDownloadBytes} />
            {checkingSavedDownload && <small className="resume-verification-note">{formatBytes(displayedDownloadBytes)} of {formatBytes(displayedDownloadTotal)} checked · download resumes automatically after this finishes</small>}
            {!displayedDownloadTotal && download.state === 'downloading' && <small className="resume-verification-note">Waiting for Kiwix to provide the signed file details · this stops with a resumable error after 45 seconds if the server does not respond</small>}
            {download.state === 'downloading' && <button type="button" onClick={() => void cancelDownload()}>PAUSE</button>}
            {['cancelled', 'error'].includes(download.state) && download.entryId && <button type="button" onClick={() => void downloadEntry(download.entryId!)}>RESUME DOWNLOAD</button>}
          </div>
        )}
        <div className="content-steps"><span className="active"><i>1</i>CHOOSE</span><span><i>2</i>SELECT SIZE</span><span><i>3</i>DOWNLOAD</span></div>
        <div className="catalog-filters simple">
          <label>CONTENT TYPE<select value={catalogCategory} onChange={(event) => { setCatalogQuery(''); setCatalogCategory(event.target.value); }} disabled={!catalogOptions?.ok}>{catalogOptions?.categories.map((option) => <option key={option.id} value={option.id}>{categoryLabel(option.id)}</option>) ?? <option value="wikipedia">Wikipedia</option>}</select></label>
          <label>LANGUAGE<select value={catalogLanguage} onChange={(event) => { setCatalogQuery(''); setCatalogLanguage(event.target.value); }} disabled={!catalogOptions?.ok}>{catalogOptions?.languages.map((option) => <option key={option.id} value={option.id}>{option.label}</option>) ?? <option value="eng">English</option>}</select></label>
        </div>
        <details className="catalog-search"><summary>Looking for something specific?</summary><form onSubmit={(event) => { event.preventDefault(); void searchCatalog(); }}><input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} maxLength={80} placeholder="Search within this content type" /><button className="secondary-button" type="submit" disabled={busy !== null}>SEARCH</button></form></details>
        {catalogOptions && !catalogOptions.ok && <p className="catalog-option-error">Live catalog choices are unavailable: {catalogOptions.message}</p>}
        {busy === 'catalog' && !catalog && <div className="catalog-loading">Loading available editions...</div>}
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
            <button className={selected.installed ? 'installed-button' : 'secondary-button'} disabled={selected.installed || busy !== null || (freeAfter !== null && freeAfter < 0)} onClick={() => requestDownload(selected)}>{selected.installed ? 'INSTALLED' : download?.entryId === selected.id && ['cancelled', 'error'].includes(download.state) && download.downloadedBytes > 0 ? `RESUME FROM ${Math.min(100, download.downloadedBytes / Math.max(1, download.totalBytes) * 100).toFixed(1)}%` : `DOWNLOAD ${editionLabel(selected.flavour).toUpperCase()} · ${formatBytes(selected.downloadBytes)}`}</button>
          </article>;
        })}</div> : catalog?.ok && <p className="catalog-empty">No matching archives were returned. Try a broader content name or another language.</p>}
        {catalog?.ok && catalog.totalResults > catalog.itemsPerPage && <div className="catalog-pagination"><button disabled={busy !== null || catalog.startIndex === 0} onClick={() => void searchCatalog(Math.max(0, catalog.startIndex - catalog.itemsPerPage))}>PREVIOUS</button><span>{catalog.startIndex + 1}–{Math.min(catalog.totalResults, catalog.startIndex + catalog.entries.length)} OF {catalog.totalResults} EDITIONS</span><button disabled={busy !== null || catalog.startIndex + catalog.itemsPerPage >= catalog.totalResults} onClick={() => void searchCatalog(catalog.startIndex + catalog.itemsPerPage)}>NEXT</button></div>}
      </section>}

      {librarySection === 'browse' && <section className="library-browse">
        <div className="library-section-heading"><div><p className="section-label">OFFLINE READER</p><h3>{busy === 'start' ? 'Starting Kiwix from this drive...' : library.running ? 'Browse your offline knowledge' : library.content.length ? 'Reader is ready' : 'Your library is empty'}</h3></div>{library.engineInstalled && !library.running && library.content.length > 0 && <button className="primary-button" onClick={() => void moduleAction('start')} disabled={busy !== null}>{busy === 'start' ? 'OPENING READER...' : 'OPEN READER'}</button>}{library.running && <button className="secondary-button" onClick={() => void moduleAction('stop')} disabled={busy !== null}>{busy === 'stop' ? 'CLOSING...' : 'CLOSE READER'}</button>}</div>
        {busy === 'start' && <div className="module-result" role="status">Opening the offline reader. Large libraries and slower portable drives can take a little longer on the first start.</div>}
        {!library.content.length && <div className="library-empty"><b>Add your first offline knowledge source</b><p>Choose a language, content type, and size. Only the edition you select is downloaded.</p><button className="primary-button" onClick={() => setLibrarySection('add')}>CHOOSE CONTENT</button></div>}
        {library.content.length > 0 && !library.engineInstalled && <div className="library-empty"><b>The offline reader is not installed</b><p>Your downloaded content is safe. Install or repair the Kiwix engine from Manage.</p><button className="secondary-button" onClick={() => setLibrarySection('manage')}>OPEN MANAGE</button></div>}
        {library.running && library.serverUrl && <div className="kiwix-frame-shell"><div><span>OFFLINE READER</span><code>{readerPath ?? library.serverUrl}</code></div><iframe title="Offline Kiwix library" src={readerPath ? new URL(readerPath, library.serverUrl).toString() : library.serverUrl} sandbox="allow-scripts allow-forms allow-same-origin" /></div>}
      </section>}
    </section>
  );
}

function TransfersView({ go }: { go: (view: ViewId) => void }) {
  const [kiwix, setKiwix] = useState<KiwixDownloadStatus>();
  const [maps, setMaps] = useState<MapDownloadStatus>();
  const [ai, setAi] = useState<AiDownloadStatus>();
  useEffect(() => {
    let disposed = false;
    const refresh = () => void Promise.all([
      window.outpost.getKiwixDownloadStatus(), window.outpost.getMapDownloadStatus(), window.outpost.getAiDownloadStatus(),
    ]).then(([nextKiwix, nextMaps, nextAi]) => { if (!disposed) { setKiwix(nextKiwix); setMaps(nextMaps); setAi(nextAi); } });
    refresh(); const timer = window.setInterval(refresh, 750);
    return () => { disposed = true; window.clearInterval(timer); };
  }, []);
  const cards = [
    { id: 'knowledge', title: 'Knowledge downloads', detail: 'Kiwix archives and reference libraries', status: kiwix?.state ?? 'idle', message: kiwix?.message ?? 'Checking library transfers...', current: kiwix?.state === 'verifying' ? kiwix.verifiedBytes ?? 0 : kiwix?.downloadedBytes ?? 0, total: kiwix?.totalBytes ?? 0, active: Boolean(kiwix && ['downloading', 'verifying'].includes(kiwix.state)), open: () => go('library'), cancel: () => window.outpost.cancelKiwixDownload().then(setKiwix) },
    { id: 'maps', title: 'Map downloads', detail: 'Selected offline regions and street data', status: maps?.state ?? 'idle', message: maps?.message ?? 'Checking map transfers...', current: maps?.downloadedBytes ?? 0, total: maps?.estimatedBytes ?? 0, active: Boolean(maps && ['resolving', 'downloading', 'verifying'].includes(maps.state)), open: () => go('maps'), cancel: () => window.outpost.cancelMapDownload().then(setMaps) },
    { id: 'ai', title: 'AI packages', detail: 'Portable runtimes and selected models', status: ai?.state ?? 'idle', message: ai?.message ?? 'Checking AI transfers...', current: ai?.downloadedBytes ?? 0, total: ai?.totalBytes ?? 0, active: Boolean(ai && ['downloading-runtime', 'downloading-model', 'verifying', 'installing'].includes(ai.state)), open: () => go('ai'), cancel: () => window.outpost.cancelAiDownload().then(setAi) },
  ];
  return <section className="page-panel transfers-page">
    <div className="page-heading"><div><p className="section-label">TRANSFER CONTROL</p><h2>Downloads on this drive</h2></div><button className="secondary-button" onClick={() => go('updates')}>APPLICATION UPDATES</button></div>
    <p className="page-intro">Monitor portable content in one place. Downloads stay with their owning tool so the correct verification and resume rules are always used.</p>
    <div className="transfer-grid">{cards.map((card) => {
      const percent = card.total ? Math.min(100, card.current / card.total * 100) : card.status === 'complete' ? 100 : 0;
      return <article className={card.active ? 'transfer-card active' : 'transfer-card'} key={card.id}>
        <div className="transfer-card-heading"><span><small>{card.detail}</small><b>{card.title}</b></span><i>{card.status.replaceAll('-', ' ').toUpperCase()}</i></div>
        <p>{card.message}</p><div className="transfer-meter"><span style={{ width: `${percent}%` }} /></div>
        <div className="transfer-meta"><span>{percent.toFixed(1)}%</span><span>{card.total ? `${formatBytes(card.current)} / ${formatBytes(card.total)}` : 'No active transfer'}</span></div>
        <div className="transfer-actions"><button className="secondary-button" onClick={card.open}>OPEN TOOL</button>{card.active && <button className="danger-button" onClick={() => void card.cancel()}>PAUSE</button>}</div>
      </article>;
    })}</div>
  </section>;
}

function FilesWorkspace({ tab, onTab, requestedDocument, requestedMedia, onDocumentHandled, onMediaHandled, go }: { tab: FileTab; onTab: (tab: FileTab) => void; requestedDocument?: { id: string; page: number }; requestedMedia?: string; onDocumentHandled: () => void; onMediaHandled: () => void; go: (view: ViewId) => void }) {
  useEffect(() => { if (requestedDocument) onTab('documents'); }, [requestedDocument, onTab]);
  useEffect(() => { if (requestedMedia) onTab('media'); }, [requestedMedia, onTab]);
  return <section className="files-workspace">
    <div className="files-command-bar"><div><p className="section-label">CARRIED FILES</p><b>One place for documents, media, and active transfers.</b></div><nav className="files-tabs" aria-label="File workspace sections"><button className={tab === 'documents' ? 'active' : ''} onClick={() => onTab('documents')}>DOCUMENTS</button><button className={tab === 'media' ? 'active' : ''} onClick={() => onTab('media')}>MEDIA</button><button className={tab === 'downloads' ? 'active' : ''} onClick={() => onTab('downloads')}>TRANSFERS</button></nav></div>
    {tab === 'documents' && <DocumentsView requestedDocument={requestedDocument} onRequestHandled={onDocumentHandled} />}
    {tab === 'media' && <Suspense fallback={<section className="page-panel"><h2>Opening Media...</h2></section>}><MediaView requestedMediaId={requestedMedia} onRequestHandled={onMediaHandled} /></Suspense>}
    {tab === 'downloads' && <TransfersView go={go} />}
  </section>;
}

function StorageView({ storage, onRefresh }: { storage: StorageSummary; onRefresh: () => Promise<void> }) {
  const [scanning, setScanning] = useState(!storage.scannedAt);
  const largest = Math.max(1, ...storage.categories.map((category) => category.bytes));
  async function refresh() {
    setScanning(true);
    try { await onRefresh(); } finally { setScanning(false); }
  }
  useEffect(() => {
    if (!storage.scannedAt) void refresh();
    // Storage is intentionally scanned only after the inspector opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <section className="page-panel">
      <div className="page-heading">
        <div><p className="section-label">STORAGE INSPECTOR</p><h2>{formatBytes(storage.freeBytes)} free</h2></div>
        <button className="secondary-button" onClick={() => void refresh()} disabled={scanning}>{scanning ? 'SCANNING DRIVE...' : 'REFRESH SCAN'}</button>
      </div>
      <p className="page-intro">{scanning && !storage.scannedAt ? 'Calculating the portable content breakdown without blocking startup.' : `Outpost Zero currently manages ${formatBytes(storage.usedByOutpostBytes)} beneath this portable root.`}</p>
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
      <p className="page-intro">Optional capabilities and signed engines install entirely on this drive and remain off until you start them. Use this page to enable only the systems you need.</p>
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

function SettingsView({ data, onProfile, onHardware, onDatabaseIntegrity, go }: {
  data: BootstrapData;
  onProfile: (profile: LocalProfile) => void;
  onHardware: () => Promise<void>;
  onDatabaseIntegrity: () => Promise<void>;
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
        <div><dt>AI</dt><dd>{data.modules.find((module) => module.id === 'local-ai')?.status ?? 'Not installed'}</dd></div>
        <div><dt>Database</dt><dd>Schema {data.database.schemaVersion} / {data.database.integrityOk === null ? 'Not checked this session' : data.database.integrityOk ? 'Integrity OK' : 'Check failed'}</dd></div>
      </dl>
      <button className="secondary-button" onClick={() => void onDatabaseIntegrity()}>CHECK DATABASE INTEGRITY</button>
      <div className="settings-section-heading">
        <div><p className="section-label">HARDWARE DIAGNOSTICS</p><h3>Current host resources</h3></div>
        <button className="secondary-button" onClick={() => void onHardware()}>REFRESH</button>
      </div>
      <dl className="detail-list hardware-list">
        <div><dt>CPU</dt><dd>{data.hardware.cpuModel}</dd></div>
        <div><dt>Logical cores</dt><dd>{data.hardware.logicalCores}</dd></div>
        <div><dt>Memory</dt><dd>{formatBytes(data.hardware.freeMemoryBytes)} free / {formatBytes(data.hardware.totalMemoryBytes)}</dd></div>
        <div><dt>GPU</dt><dd>{data.hardware.gpuChecked ? data.hardware.gpuDevices.join(', ') || 'Unavailable' : 'Select Refresh to inspect'}</dd></div>
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
  const [result, setResult] = useState(data.updates.readyVersion ? `Outpost Zero ${data.updates.readyVersion} is verified and ready to install.` : '');
  const [busy, setBusy] = useState<'checking' | 'downloading' | 'applying' | null>(null);
  const [available, setAvailable] = useState(Boolean(data.updates.readyVersion));
  const [ready, setReady] = useState(Boolean(data.updates.readyVersion));
  const [activity, setActivity] = useState<UpdateActivity>({ state: data.updates.readyVersion ? 'ready' : 'idle', version: data.updates.readyVersion ?? undefined, message: data.updates.readyVersion ? `Outpost Zero ${data.updates.readyVersion} is verified and ready to install.` : 'No update activity.', downloadedBytes: 0, totalBytes: 0 });
  function acceptActivity(next: UpdateActivity) {
    setActivity(next);
    if (next.state === 'preparing-install') { setBusy('applying'); setAvailable(true); setReady(true); setResult(next.message); }
    else if (next.state === 'downloading' || next.state === 'verifying') { setBusy('downloading'); setAvailable(true); setReady(false); setResult(next.message); }
    else if (next.state === 'ready') { setBusy(null); setAvailable(true); setReady(true); setResult(next.message); }
    else if (next.state === 'available') { setBusy(null); setAvailable(true); setReady(false); setResult(next.message); }
    else if (next.state === 'paused' || next.state === 'error') { setBusy(null); setAvailable(Boolean(next.version)); setReady(false); setResult(next.message); }
  }
  useEffect(() => {
    let mounted = true;
    const refresh = () => void window.outpost.getUpdateActivity().then((next) => { if (mounted) acceptActivity(next); });
    refresh(); const timer = window.setInterval(refresh, 750);
    return () => { mounted = false; window.clearInterval(timer); };
  }, []);
  async function check() {
    setBusy('checking');
    const checkResult = await window.outpost.checkForUpdates();
    setAvailable(checkResult.status === 'available');
    setReady(Boolean(checkResult.readyToInstall));
    setResult(checkResult.downloadBytes ? `${checkResult.message} Download: ${formatBytes(checkResult.downloadBytes)}.` : checkResult.message);
    setBusy(null);
    acceptActivity(await window.outpost.getUpdateActivity());
  }
  async function download() {
    setBusy('downloading');
    const downloadResult = await window.outpost.downloadUpdate();
    setReady(downloadResult.status === 'ready');
    setResult(downloadResult.downloadedBytes ? `${downloadResult.message} Downloaded ${formatBytes(downloadResult.downloadedBytes)}.` : downloadResult.message);
    setBusy(null);
    acceptActivity(await window.outpost.getUpdateActivity());
  }
  async function apply() {
    setBusy('applying');
    setResult('Preparing the portable update. Outpost Zero will close automatically; do not click again or remove the drive.');
    try {
      const applyResult = await window.outpost.applyUpdate();
      setResult(applyResult.message);
      if (applyResult.status !== 'launching' && applyResult.status !== 'preparing') {
        setBusy(null); setReady(false); acceptActivity(await window.outpost.getUpdateActivity());
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Could not prepare the portable update.');
      setBusy(null); setReady(false); acceptActivity(await window.outpost.getUpdateActivity());
    }
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
        {available && !ready && <button className="secondary-button" onClick={() => void download()} disabled={busy !== null}>{activity.state === 'verifying' ? 'VERIFYING UPDATE...' : busy === 'downloading' ? 'DOWNLOADING UPDATE...' : activity.state === 'paused' ? 'RESUME UPDATE' : 'DOWNLOAD UPDATE'}</button>}
        {ready && <button className="primary-button" onClick={() => void apply()} disabled={busy !== null}>{busy === 'applying' ? 'PREPARING INSTALL...' : 'INSTALL AND RESTART'}</button>}
      </div>
      {(activity.state === 'downloading' || activity.state === 'verifying' || activity.state === 'preparing-install') && <div className="update-activity"><div><b>{activity.state === 'preparing-install' ? 'INSTALL PREPARATION ACTIVE' : activity.state === 'verifying' ? 'VERIFYING UPDATE' : 'UPDATE DOWNLOAD ACTIVE'}</b><span>{activity.version ? `v${activity.version}` : ''}</span></div><p>{activity.message}</p>{activity.downloadedBytes > 0 && activity.state !== 'preparing-install' && <small>{formatBytes(activity.downloadedBytes)} downloaded and authenticated</small>}</div>}
      {result && <div className="update-result">{result}</div>}
    </section>
  );
}

export default function App() {
  const mainRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<BootstrapData>();
  const [view, setView] = useState<ViewId>('home');
  const [fileTab, setFileTab] = useState<FileTab>('documents');
  const [removalMessage, setRemovalMessage] = useState('');
  const [requestedDocument, setRequestedDocument] = useState<{ id: string; page: number }>();
  const [requestedNote, setRequestedNote] = useState<string>();
  const [requestedPlace, setRequestedPlace] = useState<string>();
  const [requestedMedia, setRequestedMedia] = useState<string>();
  const [requestedArticle, setRequestedArticle] = useState<string>();
  const [requestedNature, setRequestedNature] = useState<{ packId: string; speciesId: string }>();
  const clearRequestedDocument = useCallback(() => setRequestedDocument(undefined), []);
  const clearRequestedNote = useCallback(() => setRequestedNote(undefined), []);
  const clearRequestedPlace = useCallback(() => setRequestedPlace(undefined), []);
  const clearRequestedMedia = useCallback(() => setRequestedMedia(undefined), []);
  const clearRequestedArticle = useCallback(() => setRequestedArticle(undefined), []);
  const clearRequestedNature = useCallback(() => setRequestedNature(undefined), []);

  useEffect(() => { void window.outpost.getBootstrap().then(setData); }, []);
  useEffect(() => { mainRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }, [view, fileTab]);
  const currentNavigation = useMemo(() => navigation.find((item) => item.id === view), [view]);
  const title = currentNavigation?.label ?? (view === 'storage' ? 'Storage' : 'Settings');
  const viewDetail = currentNavigation?.detail ?? (view === 'storage' ? 'Drive capacity and content' : 'Identity, hardware, and maintenance');

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
  async function checkDatabaseIntegrity() {
    const integrityOk = await window.outpost.checkDatabaseIntegrity();
    setData((current) => current ? { ...current, database: { ...current.database, integrityOk } } : current);
  }
  async function prepareForRemoval() {
    const result = await window.outpost.prepareForRemoval();
    setRemovalMessage(result.message);
  }
  function renderView() {
    if (view === 'home') return <HomeView data={activeData} go={setView} onOpenResult={(result) => {
      if (result.source === 'document') { setRequestedDocument({ id: result.id, page: result.page ?? 1 }); setView('documents'); }
      else if (result.source === 'note') { setRequestedNote(result.id); setView('notes'); }
      else if (result.source === 'media') { setRequestedMedia(result.id); setFileTab('media'); setView('documents'); }
      else if (result.source === 'nature' && result.packId) { setRequestedNature({ packId: result.packId, speciesId: result.id }); setView('nature'); }
      else { setRequestedPlace(result.id); setView('maps'); }
    }} />;
    if (view === 'library') return <LibraryView onModules={(modules) => setData({ ...activeData, modules })} requestedArticlePath={requestedArticle} onRequestHandled={clearRequestedArticle} />;
    if (view === 'documents') return <FilesWorkspace tab={fileTab} onTab={setFileTab} requestedDocument={requestedDocument} requestedMedia={requestedMedia} onDocumentHandled={clearRequestedDocument} onMediaHandled={clearRequestedMedia} go={setView} />;
    if (view === 'notes') return <Suspense fallback={<section className="page-panel"><h2>Opening Notes...</h2></section>}><NotesView requestedNoteId={requestedNote} onRequestHandled={clearRequestedNote} /></Suspense>;
    if (view === 'maps') return <Suspense fallback={<section className="page-panel"><h2>Opening Maps...</h2></section>}><MapsView requestedPlaceId={requestedPlace} onRequestHandled={clearRequestedPlace} onModules={(modules) => setData({ ...activeData, modules })} /></Suspense>;
    if (view === 'nature') return <Suspense fallback={<section className="page-panel"><h2>Opening Nature Library...</h2></section>}><NatureView requested={requestedNature} onRequestHandled={clearRequestedNature} /></Suspense>;
    if (view === 'learning') return <Suspense fallback={<section className="page-panel"><h2>Opening Education Center...</h2></section>}><LearningView /></Suspense>;
    if (view === 'medications') return <Suspense fallback={<section className="page-panel"><h2>Opening Medication Reference...</h2></section>}><MedicationView /></Suspense>;
    if (view === 'relay') return <Suspense fallback={<section className="page-panel"><h2>Opening Local Relay...</h2></section>}><RelayView /></Suspense>;
    if (view === 'tools') return <Suspense fallback={<section className="page-panel"><h2>Opening Tools...</h2></section>}><ToolsView /></Suspense>;
    if (view === 'ai') return <AiView onModules={(modules) => setData({ ...activeData, modules })} onOpenSource={(source: AiSource) => {
      if (source.kind === 'document' && source.documentId) { setRequestedDocument({ id: source.documentId, page: source.page ?? 1 }); setView('documents'); }
      else if (source.kind === 'kiwix' && source.articlePath) { setRequestedArticle(source.articlePath); setView('library'); }
    }} />;
    if (view === 'storage') return <StorageView storage={activeData.storage} onRefresh={refreshStorage} />;
    if (view === 'modules') return <ModulesView modules={activeData.modules} onModules={(modules) => setData({ ...activeData, modules })} />;
    if (view === 'updates') return <UpdatesView data={activeData} />;
    if (view === 'settings') return <SettingsView data={activeData} onProfile={(profile) => setData({ ...activeData, profile })} onHardware={refreshHardware} onDatabaseIntegrity={checkDatabaseIntegrity} go={setView} />;
    return null;
  }

  return (
    <div className="app-shell">
      <aside className="rail">
        <button className="brand-mark" onClick={() => setView('home')}>
          <span>O</span>
          <i><b>OUTPOST ZERO</b><small>PORTABLE FIELD SYSTEM</small></i>
        </button>
        <div className="rail-readiness"><span /><div><b>DRIVE ONLINE</b><small>LOCAL MODE</small></div></div>
        <nav aria-label="Primary navigation">
          {navigationGroups.map((group) => (
            <section className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <button className={view === item.id ? 'active' : ''} key={item.id} onClick={() => setView(item.id)}>
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-copy"><b>{item.label}</b><small>{item.detail}</small></span>
                  <i aria-hidden="true">›</i>
                </button>
              ))}
            </section>
          ))}
        </nav>
        <div className="rail-footer">
          <span className="rail-identity"><i>{data.profile.displayName.slice(0, 1).toUpperCase()}</i><span><b>{data.profile.displayName}</b><small>LOCAL OPERATOR</small></span></span>
          <button className={view === 'settings' ? 'settings active' : 'settings'} onClick={() => setView('settings')}>
            <span className="nav-icon">ST</span><span className="nav-copy"><b>Settings</b><small>System configuration</small></span>
          </button>
        </div>
      </aside>
      <main ref={mainRef}>
        <header className="command-header">
          <div>
            <p className="eyebrow">OUTPOST ZERO / {title.toUpperCase()}</p>
            <h1>{view === 'home' ? <>Ready, <em>{data.profile.displayName}.</em></> : title}</h1>
            <p className="header-context">{viewDetail}</p>
          </div>
          <div className="command-status"><span><i /> SYSTEM READY</span><small>OFFLINE-FIRST · DRIVE LOCAL</small></div>
        </header>
        {data.status.recoveredFromUncleanShutdown && <div className="warning">The previous session ended unexpectedly. Portable state was recovered.</div>}
        {renderView()}
        <footer>
          <div className="global-status"><span>OFFLINE</span><i />0 OUTPOSTS NEARBY<i />{formatBytes(data.storage.freeBytes)} FREE<i />AI: {data.modules.find((module) => module.id === 'local-ai')?.status.replace('-', ' ').toUpperCase() ?? 'NOT INSTALLED'}</div>
          <button className="eject-button" onClick={prepareForRemoval}>PREPARE DRIVE FOR REMOVAL</button>
        </footer>
        {removalMessage && <div className="toast" role="status">✓ {removalMessage}</div>}
      </main>
    </div>
  );
}
