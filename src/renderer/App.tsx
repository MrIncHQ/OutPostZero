import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { BootstrapData, LocalProfile, StorageSummary } from '../shared/contracts';

type ViewId = 'home' | 'search' | 'library' | 'documents' | 'maps' | 'learning' | 'notes' |
  'media' | 'relay' | 'tools' | 'modules' | 'downloads' | 'storage' | 'settings' | 'updates';

const navigation: Array<{ id: ViewId; label: string }> = [
  { id: 'home', label: 'Home' }, { id: 'search', label: 'Search' },
  { id: 'library', label: 'Library' }, { id: 'documents', label: 'Documents' },
  { id: 'maps', label: 'Maps' }, { id: 'learning', label: 'Learning' },
  { id: 'notes', label: 'Notes' }, { id: 'media', label: 'Media' },
  { id: 'relay', label: 'Local Relay' }, { id: 'tools', label: 'Tools' },
  { id: 'modules', label: 'Modules' }, { id: 'downloads', label: 'Downloads' },
  { id: 'updates', label: 'Updates' },
];

const comingSoon: Partial<Record<ViewId, { title: string; description: string; milestone: string }>> = {
  library: { title: 'Your offline library', description: 'ZIM catalogs and integrated knowledge browsing arrive after the module installer is proven.', milestone: 'PHASE 4' },
  documents: { title: 'Portable document library', description: 'PDF import, page-level search, collections, bookmarks, and annotations are the next major application slice.', milestone: 'PHASE 2' },
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

function HomeView({ data, go }: { data: BootstrapData; go: (view: ViewId) => void }) {
  return (
    <>
      <section className="search-block interactive" onClick={() => go('search')}>
        <span>⌕</span><div className="search-prompt">Search your outpost</div><kbd>OPEN SEARCH</kbd>
      </section>
      <div className="content-grid">
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
          <h3>{data.modules.length} optional components planned</h3>
          <p>Review what can be added to this drive in upcoming milestones.</p>
          <span className="card-action">OPEN MODULE CENTER →</span>
        </button>
      </div>
    </>
  );
}

function SearchView() {
  const [query, setQuery] = useState('');
  return (
    <section className="page-panel">
      <p className="section-label">UNIVERSAL SEARCH</p>
      <h2>Search everything on this drive.</h2>
      <div className="search-block interactive">
        <span>⌕</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus placeholder="Search documents, knowledge, notes, maps, and media" />
      </div>
      <div className="empty-state">
        <b>{query ? `No indexed results for “${query}”` : 'Your search index is empty'}</b>
        <p>Universal search is working as a view; results will appear after the Document Library can import and index content.</p>
      </div>
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

function ModulesView({ data }: { data: BootstrapData }) {
  return (
    <section className="page-panel">
      <p className="section-label">MODULE CENTER</p>
      <h2>Expand this outpost.</h2>
      <p className="page-intro">Modules will install onto the portable drive only. Installation remains locked until signed package verification and rollback are implemented.</p>
      <div className="module-list">
        {data.modules.map((module) => (
          <article className="module-row" key={module.id}>
            <div className="module-icon">○</div>
            <div><h3>{module.name}</h3><p>{module.description}</p><small>OPTIONAL · NOT INSTALLED</small></div>
            <button disabled>COMING LATER</button>
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
  const [checking, setChecking] = useState(false);
  async function check() {
    setChecking(true);
    const checkResult = await window.outpost.checkForUpdates();
    setResult(checkResult.message);
    setChecking(false);
  }
  return (
    <section className="page-panel">
      <p className="section-label">UPDATE CENTER</p><h2>Portable updates, controlled by you.</h2>
      <p className="page-intro">Core, module, and content updates will always be downloaded and applied on this drive. Automatic checks are off.</p>
      <dl className="detail-list update-details">
        <div><dt>Current version</dt><dd>v{data.updates.currentVersion}</dd></div>
        <div><dt>Provider</dt><dd>{data.updates.configured ? 'GitHub Releases' : 'Not configured'}</dd></div>
        <div><dt>Repository</dt><dd>{data.updates.repositoryOwner && data.updates.repositoryName ? `${data.updates.repositoryOwner}/${data.updates.repositoryName}` : 'Will be linked after the base is published'}</dd></div>
        <div><dt>Channel</dt><dd>{data.updates.channel}</dd></div>
        <div><dt>Automatic checks</dt><dd>{data.updates.automaticChecks ? 'Enabled' : 'Disabled'}</dd></div>
      </dl>
      <div className="update-explainer">
        <b>Future GitHub release flow</b>
        <p>Check release metadata, verify a signed manifest and checksums, download into <code>Updates/</code>, stop the app, swap versions, health-check, and roll back if needed.</p>
      </div>
      <button className="primary-button" onClick={() => void check()} disabled={checking}>{checking ? 'CHECKING...' : 'CHECK FOR UPDATES'}</button>
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
    if (view === 'home') return <HomeView data={activeData} go={setView} />;
    if (view === 'search') return <SearchView />;
    if (view === 'storage') return <StorageView storage={activeData.storage} onRefresh={refreshStorage} />;
    if (view === 'modules') return <ModulesView data={activeData} />;
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
