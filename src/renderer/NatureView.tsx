import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { NaturePackSummary, NatureSpeciesDetails, NatureSpeciesSummary, NatureState } from '../shared/contracts';
import './nature.css';

type Section = 'explore' | 'identify' | 'sightings' | 'packs' | 'sources';
const CATEGORIES = ['Animals', 'Plants', 'Trees', 'Birds', 'Mammals', 'Reptiles', 'Amphibians', 'Fish', 'Insects', 'Arachnids', 'Fungi'];

export function NatureView({ requested, onRequestHandled }: { requested?: { packId: string; speciesId: string }; onRequestHandled: () => void }) {
  const [state, setState] = useState<NatureState>(); const [section, setSection] = useState<Section>('explore');
  const [query, setQuery] = useState(''); const [category, setCategory] = useState(''); const [results, setResults] = useState<NatureSpeciesSummary[]>([]);
  const [species, setSpecies] = useState<NatureSpeciesDetails>(); const [message, setMessage] = useState(''); const [busy, setBusy] = useState('');
  const [selectedPacks, setSelectedPacks] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void window.outpost.getNatureState().then((next) => {
      if (!active) return; setState(next); setSelectedPacks((current) => current.length ? current : next.packs.map((pack) => pack.packId));
      // Catalog refresh is deliberately background-only. Offline startup must
      // never hold the installed library behind a network timeout.
      void window.outpost.refreshNatureCatalog().then((result) => {
        if (!active) return; setState(result.state); setSelectedPacks((current) => current.length ? current : result.state.packs.map((pack) => pack.packId));
        if (!result.ok && !result.state.catalog.length) setMessage(`${result.message} You can still import a pack file.`);
      });
    }).catch((reason) => { if (active) setMessage(reason instanceof Error ? reason.message : 'Nature Library could not be opened.'); });
    return () => { active = false; };
  }, []);
  useEffect(() => { if (!requested) return; void openSpecies(requested.packId, requested.speciesId); onRequestHandled(); }, [requested]);
  useEffect(() => { if (!state || !['downloading', 'verifying', 'installing'].includes(state.download.state)) return; const timer = window.setInterval(() => void window.outpost.getNatureDownloadStatus().then((download) => setState((current) => current ? { ...current, download } : current)), 750); return () => window.clearInterval(timer); }, [state?.download.state]);

  async function search(event?: FormEvent) { event?.preventDefault(); if (!query.trim()) return; setBusy('search'); try { setResults(await window.outpost.searchNature(query, selectedPacks)); setSpecies(undefined); setSection('explore'); } finally { setBusy(''); } }
  async function browse(nextCategory: string) { setCategory(nextCategory); setQuery(''); setBusy('browse'); try { setResults(await window.outpost.browseNature(nextCategory, selectedPacks)); setSpecies(undefined); setSection('explore'); } finally { setBusy(''); } }
  async function openSpecies(packId: string, speciesId: string) { setBusy('species'); try { setSpecies(await window.outpost.getNatureSpecies(packId, speciesId)); setSection('explore'); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Species could not be opened.'); } finally { setBusy(''); } }
  async function importPack() { setBusy('import'); try { const result = await window.outpost.importNaturePack(); setState(result.state); setMessage(result.message); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Nature Pack import failed.'); } finally { setBusy(''); } }
  async function download(entryId: string) { setBusy(entryId); const promise = window.outpost.downloadNatureContent(entryId); setState((current) => current ? { ...current, download: { state: 'downloading', entryId, downloadedBytes: 0, totalBytes: 0, percent: 0, bytesPerSecond: 0, message: 'Starting Nature download...' } } : current); try { const result = await promise; setState(result.state); setMessage(result.message); } finally { setBusy(''); } }
  async function saveSighting() { if (!species) return; setBusy('sighting'); try { setState(await window.outpost.saveNatureSighting({ observedAt: new Date().toISOString(), packId: species.packId, speciesId: species.id, commonName: species.commonName, scientificName: species.scientificName, notes: '' })); setMessage('Sighting saved locally.'); } finally { setBusy(''); } }

  const packs = state?.packs ?? []; const packNames = useMemo(() => new Map(packs.map((pack) => [pack.packId, pack.name])), [packs]);
  if (!state) return <section className="page-panel nature-workspace"><h2>Opening Nature Library...</h2></section>;
  return <section className="page-panel nature-workspace">
    <div className="nature-heading"><div><p className="section-label">FULLY OFFLINE NATURE REFERENCE</p><h2>Nature Library</h2><p>Search installed taxonomy and regional reference packs. Installed data and photographs stay on this drive.</p></div><button className="primary-button" onClick={() => setSection('identify')}>IDENTIFY FROM PHOTO</button></div>
    <nav className="subtabs nature-tabs" aria-label="Nature sections">
      {([['explore','SEARCH & BROWSE'],['identify','IDENTIFY'],['sightings',`SIGHTINGS ${state.sightings.length}`],['packs',`PACKS ${packs.length}`],['sources','SOURCES & LICENSES']] as Array<[Section,string]>).map(([id,label]) => <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>{label}</button>)}
    </nav>
    {message && <div className="operation-message">{message}</div>}

    {section === 'explore' && <>
      {!packs.length ? <EmptyPacks onOpen={() => setSection('packs')} /> : <>
        <form className="nature-search" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Common name, scientific name, or synonym..." autoFocus /><button className="primary-button" disabled={!query.trim() || busy === 'search'}>{busy === 'search' ? 'SEARCHING...' : 'SEARCH OFFLINE'}</button></form>
        <div className="nature-pack-filter"><span>SEARCH PACKS</span>{packs.map((pack) => <label key={pack.packId}><input type="checkbox" checked={selectedPacks.includes(pack.packId)} onChange={(event) => setSelectedPacks((current) => event.target.checked ? [...new Set([...current, pack.packId])] : current.filter((id) => id !== pack.packId))} />{pack.name}</label>)}</div>
        {!species && <div className="nature-categories">{CATEGORIES.map((item) => <button className={category.toLowerCase() === item.toLowerCase() ? 'active' : ''} key={item} onClick={() => void browse(item)}>{item}</button>)}</div>}
        {species ? <SpeciesDetails item={species} packName={packNames.get(species.packId)} onBack={() => setSpecies(undefined)} onSave={() => void saveSighting()} saving={busy === 'sighting'} />
          : <div className="nature-results">{results.map((item) => <button key={`${item.packId}:${item.id}`} onClick={() => void openSpecies(item.packId, item.id)}>{item.imageId ? <img src={`outpost-nature://image/${encodeURIComponent(item.packId)}/${encodeURIComponent(item.imageId)}`} alt="" /> : <span className="nature-image-missing">NO IMAGE</span>}<div><small>{item.category} / {packNames.get(item.packId)}</small><h3>{item.commonName}</h3><em>{item.scientificName}</em>{item.regionalStatus && <p>{item.regionalStatus}</p>}</div></button>)}</div>}
        {!results.length && !species && <div className="empty-state"><h3>Search or choose a category</h3><p>Names, synonyms, taxonomy, distribution, and reference photographs are read only from installed Nature Packs.</p></div>}
      </>}
    </>}

    {section === 'identify' && <div className="nature-identify"><p className="section-label">PRIVATE ON-DEVICE IDENTIFICATION</p><h3>Identify a photograph locally</h3>{state.model.installed ? <><p>{state.model.message}</p><label className="nature-photo-picker">CHOOSE PHOTOGRAPH<input type="file" accept="image/jpeg,image/png,image/webp" disabled title="Model validation must complete before identification is enabled." /></label><div className="warning">The installed encoder has not completed Outpost compatibility validation. Identification remains disabled rather than returning unreliable results.</div></> : <><p>No Nature ID model is installed. Search and browsing still work fully offline.</p><button className="primary-button" onClick={() => setSection('packs')}>OPEN MODEL DOWNLOADS</button></>}<div className="nature-safety">Identification is a ranking aid and may be wrong. Never eat, touch, handle, or medically treat something solely from a computer-vision result.</div></div>}

    {section === 'sightings' && <div className="sightings-list">{state.sightings.map((item) => <article key={item.id}><div><small>{new Date(item.observedAt).toLocaleString()}</small><h3>{item.commonName || 'Unidentified sighting'}</h3><em>{item.scientificName}</em><p>{item.notes || 'No notes.'}</p></div><button className="danger-button" onClick={() => void window.outpost.deleteNatureSighting(item.id).then(setState)}>DELETE</button></article>)}{!state.sightings.length && <div className="empty-state"><h3>No saved sightings</h3><p>Open a species and select Save Sighting. Records remain on this drive and are never uploaded.</p></div>}</div>}

    {section === 'packs' && <Packs state={state} busy={busy} onImport={importPack} onDownload={download} onPause={() => void window.outpost.pauseNatureDownload().then((status) => setState({ ...state, download: status }))} onCancel={() => void window.outpost.cancelNatureDownload().then((status) => setState({ ...state, download: status }))} onRemove={(pack) => void window.outpost.removeNaturePack(pack.packId).then((result) => { setState(result.state); setMessage(result.message); })} />}
    {section === 'sources' && <Sources packs={packs} />}
  </section>;
}

function EmptyPacks({ onOpen }: { onOpen: () => void }) { return <div className="empty-state"><h3>No Nature Packs installed</h3><p>Install a complete `.oznature` pack while connected. Search, images, and species pages then work without a browser or network.</p><button className="primary-button" onClick={onOpen}>OPEN NATURE PACKS</button></div>; }

function SpeciesDetails({ item, packName, onBack, onSave, saving }: { item: NatureSpeciesDetails; packName?: string; onBack: () => void; onSave: () => void; saving: boolean }) { return <article className="species-details"><div className="species-actions"><button className="secondary-button" onClick={onBack}>BACK TO RESULTS</button><button className="primary-button" onClick={onSave} disabled={saving}>{saving ? 'SAVING...' : 'SAVE SIGHTING'}</button></div><p className="section-label">{item.category} / {packName}</p><h3>{item.commonName}</h3><em>{item.scientificName}</em><div className="species-images">{item.images.map((image) => <figure key={image.id}><img src={image.readerUrl} alt={item.commonName} /><figcaption>{image.creator} / {image.license}</figcaption></figure>)}</div><dl>{Object.entries(item.taxonomy).map(([rank,name]) => <div key={rank}><dt>{rank}</dt><dd>{name}</dd></div>)}</dl>{item.commonNames.length > 0 && <section><h4>COMMON NAMES</h4><p>{item.commonNames.join(', ')}</p></section>}{item.synonyms.length > 0 && <section><h4>SYNONYMS</h4><p>{item.synonyms.join(', ')}</p></section>}{item.distribution.length > 0 && <section><h4>KNOWN DISTRIBUTION</h4><p>{item.distribution.join(', ')}</p></section>}<section><h4>SOURCE</h4><p>{item.sourceName}{item.sourceTaxonId ? ` / ${item.sourceTaxonId}` : ''}</p></section></article>; }

function Packs({ state, busy, onImport, onDownload, onPause, onCancel, onRemove }: { state: NatureState; busy: string; onImport: () => void; onDownload: (id: string) => void; onPause: () => void; onCancel: () => void; onRemove: (pack: NaturePackSummary) => void }) {
  const [regionFilter, setRegionFilter] = useState('All regions');
  const [groupFilter, setGroupFilter] = useState('All nature');
  const transferring = ['downloading','verifying','installing'].includes(state.download.state);
  const showTransfer = transferring || ['paused','error'].includes(state.download.state);
  const canInterrupt = state.download.state === 'downloading';
  const installed = new Map(state.packs.map((pack) => [pack.packId, pack]));
  const availableCatalog = state.catalog.filter((entry) => installed.get(entry.id)?.version !== entry.version);
  const regions = ['All regions', ...new Set(availableCatalog.flatMap((entry) => entry.coverage?.length ? entry.coverage : [entry.region ?? 'Worldwide']))];
  const groups = ['All nature', ...new Set(availableCatalog.flatMap((entry) => entry.categories ?? []))];
  const available = availableCatalog.filter((entry) => (regionFilter === 'All regions' || entry.region === 'Worldwide' || entry.region === regionFilter || entry.coverage?.includes(regionFilter))
    && (groupFilter === 'All nature' || entry.categories?.includes(groupFilter)));
  const totalSpecies = state.packs.reduce((sum, pack) => sum + pack.speciesCount, 0);
  const totalImages = state.packs.reduce((sum, pack) => sum + pack.imageCount, 0);
  const installedBytes = state.packs.reduce((sum, pack) => sum + pack.installedBytes, 0);
  return <div className="nature-packs">
    <header className="nature-pack-tools"><div><p className="section-label">BUILD YOUR OFFLINE FIELD LIBRARY</p><h3>Choose what this drive carries</h3><p>Compare coverage and storage before downloading. Every installed pack remains searchable without internet access.</p></div><button className="secondary-button" onClick={onImport} disabled={busy === 'import'}>IMPORT PACK</button></header>
    <div className="nature-storage-strip">
      <div><small>DRIVE SPACE FREE</small><strong>{formatNatureBytes(state.freeBytes)}</strong><span>available now</span></div>
      <div><small>OFFLINE RECORDS</small><strong>{totalSpecies.toLocaleString()}</strong><span>species across {state.packs.length} pack{state.packs.length === 1 ? '' : 's'}</span></div>
      <div><small>REFERENCE PHOTOS</small><strong>{totalImages.toLocaleString()}</strong><span>stored entirely on this drive</span></div>
      <div><small>NATURE STORAGE</small><strong>{formatNatureBytes(installedBytes)}</strong><span>currently installed</span></div>
    </div>
    <div className="nature-pack-guide">
      <article><span>01 / REFERENCE PACKS</span><h4>Search and classify</h4><p>Common and scientific names, synonyms, biological classification, and available distribution records.</p></article>
      <article><span>02 / PHOTO PACKS</span><h4>Compare what you see</h4><p>Attributed reference photographs stored offline. Image packs use substantially more drive space.</p></article>
      <article><span>03 / ID MODELS</span><h4>Rank photo candidates</h4><p>Optional on-device identification models. Results are suggestions and never a safety determination.</p></article>
    </div>
    {showTransfer && <div className={`nature-download ${state.download.state}`}><div><small>TRANSFER STATUS</small><b>{state.download.title ?? 'Nature content'}</b></div><strong>{state.download.percent.toFixed(1)}%</strong><progress value={state.download.percent} max="100" /><p>{state.download.message}{state.download.totalBytes > state.download.downloadedBytes ? ` / ${((state.download.totalBytes - state.download.downloadedBytes) / 1024 / 1024).toFixed(1)} MB remaining` : ''}</p>{canInterrupt && <div className="nature-download-actions"><button className="secondary-button" onClick={onPause}>PAUSE</button><button className="danger-button" onClick={onCancel}>CANCEL</button></div>}</div>}
    <section className="nature-pack-section"><div className="nature-pack-section-heading"><div><h3>Installed and ready offline</h3><p>{state.packs.length} verified pack{state.packs.length === 1 ? '' : 's'} on this drive</p></div></div><div className="nature-pack-grid">{state.packs.map((pack) => <InstalledPackCard key={pack.packId} pack={pack} catalogEntry={state.catalog.find((entry) => entry.id === pack.packId)} onRemove={() => onRemove(pack)} />)}</div></section>
    <section className="nature-pack-section"><div className="nature-pack-section-heading"><div><h3>Available to add</h3><p>Signed Outpost content not already current on this drive</p></div><span className="nature-catalog-count">{available.length} OF {availableCatalog.length} OPTIONS</span></div>
      {!!availableCatalog.length && <div className="nature-catalog-filters"><label><span>WORLD REGION</span><select value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}>{regions.map((region) => <option key={region}>{region}</option>)}</select></label><label><span>NATURE GROUP</span><select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>{groups.map((group) => <option key={group}>{group}</option>)}</select></label></div>}
      <div className="nature-pack-grid">{available.map((entry) => { const current = installed.get(entry.id); const update = Boolean(current); const finalCost = Math.max(0, entry.installedBytes - (current?.installedBytes ?? 0)); const freeAfter = state.freeBytes === null ? null : state.freeBytes - finalCost; const peakRequired = entry.downloadBytes + entry.installedBytes; const enoughSpace = state.freeBytes === null || state.freeBytes >= peakRequired; return <article className="nature-pack-card available" key={entry.id}><div className="nature-pack-card-top"><span>{update ? 'UPDATE' : entry.packType === 'photo' ? 'OFFLINE PHOTO GUIDE' : entry.kind.toUpperCase()}</span><small>{entry.region ?? 'OFFLINE'} / V{entry.version}</small></div><h3>{entry.name}</h3><p className="nature-pack-description">{entry.description}</p>{(entry.speciesCount !== undefined || entry.imageCount !== undefined) && <dl className="nature-pack-coverage"><div><dt>SPECIES</dt><dd>{entry.speciesCount?.toLocaleString() ?? '—'}</dd></div><div><dt>PHOTOS</dt><dd>{entry.imageCount?.toLocaleString() ?? '—'}</dd></div><div><dt>COVERAGE</dt><dd>{entry.coverage?.join(', ') ?? entry.region ?? 'Worldwide'}</dd></div></dl>}<div className="nature-pack-includes"><small>WHAT THIS ADDS</small><ul>{natureEntryFeatures(entry).map((feature) => <li key={feature}>{feature}</li>)}</ul></div><dl className="nature-pack-capacity"><div><dt>DOWNLOAD</dt><dd>{formatNatureBytes(entry.downloadBytes)}</dd></div><div><dt>ON DRIVE</dt><dd>{formatNatureBytes(entry.installedBytes)}</dd></div><div><dt>FREE AFTER</dt><dd className={freeAfter !== null && freeAfter < 1024 ** 3 ? 'low-space' : ''}>{formatNatureBytes(freeAfter)}</dd></div></dl><div className={`nature-space-check ${enoughSpace ? 'ok' : 'blocked'}`}><b>{enoughSpace ? 'ENOUGH WORKING SPACE' : 'MORE SPACE REQUIRED'}</b><span>Needs up to {formatNatureBytes(peakRequired)} temporarily while the signed download is verified and installed.</span></div><button className="primary-button" disabled={transferring || busy === entry.id || !enoughSpace} onClick={() => onDownload(entry.id)}>{state.download.entryId === entry.id && state.download.state === 'paused' ? 'RESUME DOWNLOAD' : update ? 'UPDATE PACK' : 'DOWNLOAD PACK'}</button></article>; })}</div>{!availableCatalog.length ? <div className="nature-catalog-current"><div><span>LIBRARY CURRENT</span><h3>Everything in the signed catalog is already installed</h3><p>Installed packs no longer repeat here as downloads. New regional references, image collections, and identification models will appear when published.</p></div><button className="secondary-button" onClick={onImport} disabled={busy === 'import'}>IMPORT FROM ANOTHER DRIVE</button></div> : !available.length && <div className="nature-catalog-current"><div><span>NO FILTER MATCH</span><h3>Choose a different region or nature group</h3><p>Your installed packs are unchanged. Filters only narrow the available downloads shown here.</p></div><button className="secondary-button" onClick={() => { setRegionFilter('All regions'); setGroupFilter('All nature'); }}>SHOW ALL PACKS</button></div>}</section>
  </div>;
}

function InstalledPackCard({ pack, catalogEntry, onRemove }: { pack: NaturePackSummary; catalogEntry?: NatureState['catalog'][number]; onRemove: () => void }) {
  const sources = Object.keys(pack.sourceVersions);
  return <article className="nature-pack-card installed"><div className="nature-pack-card-top"><span>READY OFFLINE</span><small>{pack.region} / V{pack.version}</small></div><h3>{pack.name}</h3><p className="nature-pack-purpose">A searchable taxonomic reference for names, classification, synonyms, and recorded distribution.</p><dl className="nature-pack-capacity"><div><dt>SPECIES</dt><dd>{pack.speciesCount.toLocaleString()}</dd></div><div><dt>PHOTOS</dt><dd>{pack.imageCount.toLocaleString()}</dd></div><div><dt>ON DRIVE</dt><dd>{formatNatureBytes(pack.installedBytes)}</dd></div>{catalogEntry && <div><dt>PACKAGE</dt><dd>{formatNatureBytes(catalogEntry.downloadBytes)}</dd></div>}</dl><details className="nature-pack-details"><summary>VIEW PACK DETAILS</summary><div><section><small>SEARCHABLE CONTENT</small><p>{pack.categories.length ? pack.categories.join(' · ') : 'Taxonomy and species records'}</p></section><section><small>DATA SOURCES</small><p>{sources.length ? sources.join(' · ') : 'See source manifest'}</p></section><section><small>LICENSES</small><p>{pack.licenseSummary.length ? pack.licenseSummary.join(' · ') : 'See pack attribution'}</p></section><section><small>BUILT</small><p>{formatNatureDate(pack.buildDate)}</p></section><div className="nature-pack-limit"><b>{pack.imageCount ? `${pack.imageCount.toLocaleString()} attributed reference photos included.` : 'No photographs are included in this pack.'}</b><span>Taxonomy and distribution are reference data, not proof that a species is safe to touch, eat, or handle.</span></div></div></details><button className="text-danger-button" onClick={onRemove}>UNINSTALL PACK</button></article>;
}

function natureEntryFeatures(entry: NatureState['catalog'][number]): string[] {
  if (entry.kind === 'model') return ['Private on-device photo matching', 'Works without uploading photographs', 'Adds identification candidates to Nature ID'];
  const text = entry.description.toLowerCase();
  const features = ['Search common and scientific names'];
  if (entry.imageCount) features.push(`${entry.imageCount.toLocaleString()} attributed photos stored offline`);
  if (text.includes('synonym')) features.push('Find historical and alternate names');
  if (text.includes('classification') || text.includes('taxonomy')) features.push('Browse biological classification');
  if (text.includes('distribution')) features.push('Review available distribution records');
  if (!entry.imageCount && text.includes('photograph') && !text.includes('not included')) features.push('View attributed reference photographs');
  return features.slice(0, 4);
}

function formatNatureBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'UNKNOWN';
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 1024 * 100 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 1024 ** 2 * 100 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function formatNatureDate(value: string): string {
  const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function Sources({ packs }: { packs: NaturePackSummary[] }) { return <div className="nature-sources"><div className="nature-safety"><b>Reference and identification aid only.</b> Taxonomy, distributions, and computer-vision results can be incomplete or wrong.</div>{packs.map((pack) => <article key={pack.packId}><h3>{pack.name}</h3><p>Built {pack.buildDate} / version {pack.version}</p><dl>{Object.entries(pack.sourceVersions).map(([source,version]) => <div key={source}><dt>{source}</dt><dd>{version}</dd></div>)}</dl><h4>LICENSES INCLUDED</h4><p>{pack.licenseSummary.join(', ')}</p></article>)}{!packs.length && <div className="empty-state"><h3>No dataset licenses installed</h3><p>Every installed pack exposes its source versions and license summary here. Individual image attribution appears below each photograph.</p></div>}</div>; }
