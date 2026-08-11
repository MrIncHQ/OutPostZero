import { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem, MediaState } from '../shared/contracts';
import './media.css';

function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB']; let size = value; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export function MediaView({ requestedMediaId, onRequestHandled }: { requestedMediaId?: string; onRequestHandled?: () => void }) {
  const [state, setState] = useState<MediaState>(); const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState(''); const [kind, setKind] = useState<'all' | MediaItem['kind']>('all');
  const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false); const lastSaved = useRef(0);
  useEffect(() => { void window.outpost.getMedia().then((next) => { setState(next); if (requestedMediaId && next.items.some((item) => item.id === requestedMediaId)) setSelectedId(requestedMediaId); onRequestHandled?.(); }).catch((error) => setMessage(String(error))); }, [requestedMediaId, onRequestHandled]);
  const items = useMemo(() => (state?.items ?? []).filter((item) => {
    const haystack = [item.title, item.fileName, ...item.tags, ...item.collections].join(' ').toLocaleLowerCase();
    return (kind === 'all' || item.kind === kind) && query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
  }), [state, query, kind]);
  const selected = state?.items.find((item) => item.id === selectedId);

  async function run(action: () => Promise<{ message: string; state: MediaState }>) {
    setBusy(true); try { const result = await action(); setState(result.state); setMessage(result.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Media operation failed.'); } finally { setBusy(false); }
  }
  async function update(item: MediaItem, changes: Parameters<typeof window.outpost.updateMediaMetadata>[1]) {
    try { setState(await window.outpost.updateMediaMetadata(item.id, changes)); } catch (error) { setMessage(String(error)); }
  }
  function saveProgress(item: MediaItem, currentTime: number, duration: number) {
    const now = Date.now(); if (now - lastSaved.current < 5000 && currentTime < duration - 2) return; lastSaved.current = now;
    void update(item, { playbackSeconds: currentTime, durationSeconds: Number.isFinite(duration) ? duration : undefined });
  }

  if (!state) return <section className="page-panel"><p className="section-label">PORTABLE MEDIA</p><h2>Scanning media on this drive...</h2>{message && <div className="module-result">{message}</div>}</section>;
  return <section className="page-panel media-page">
    <div className="page-heading"><div><p className="section-label">PORTABLE MEDIA</p><h2>Your offline media</h2></div><div className="media-actions"><button className="secondary-button" disabled={busy} onClick={() => void run(window.outpost.scanMedia)}>SCAN FOLDER</button><button className="primary-button" disabled={busy} onClick={() => void run(window.outpost.importMedia)}>+ ADD MEDIA</button></div></div>
    <p className="page-intro">Play video and audio or view images directly from this drive. No installed browser, account, or internet connection is needed.</p>
    {message && <div className="module-result" role="status">{message}</div>}
    <div className="media-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, tag, or collection"/><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="all">All media</option><option value="video">Video</option><option value="audio">Audio</option><option value="image">Images</option></select><span>{items.length} OF {state.items.length}</span></div>
    {!state.items.length && <div className="empty-state"><b>Add media to this portable library</b><p>Choose files above or copy supported video, audio, and images into Content/Media, then scan.</p></div>}
    <div className={selected ? 'media-workspace playing' : 'media-workspace'}>
      <div className="media-grid">{items.map((item) => <button key={item.id} className={selectedId === item.id ? 'media-card active' : 'media-card'} onClick={() => setSelectedId(item.id)}>
        <div className={`media-thumb ${item.kind}`}>{item.kind === 'image' ? <img src={item.readerUrl} alt="" loading="lazy"/> : <span>{item.kind === 'video' ? '▶' : '♪'}</span>}</div>
        <div><b>{item.title}</b><small>{item.kind.toUpperCase()} · {bytes(item.size)}</small></div>{item.favorite && <i>★</i>}
      </button>)}</div>
      {selected && <aside className="media-player">
        <div className="media-stage">{selected.kind === 'image' ? <img src={selected.readerUrl} alt={selected.title}/> : selected.kind === 'video' ? <video key={selected.id} src={selected.readerUrl} controls autoPlay onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(selected.playbackSeconds, Math.max(0, event.currentTarget.duration - 1)); }} onTimeUpdate={(event) => saveProgress(selected, event.currentTarget.currentTime, event.currentTarget.duration)}/> : <audio key={selected.id} src={selected.readerUrl} controls autoPlay onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(selected.playbackSeconds, Math.max(0, event.currentTarget.duration - 1)); }} onTimeUpdate={(event) => saveProgress(selected, event.currentTarget.currentTime, event.currentTarget.duration)}/>}</div>
        <label>TITLE<input defaultValue={selected.title} key={`${selected.id}-title`} onBlur={(event) => void update(selected, { title: event.target.value })}/></label>
        <label>TAGS<input defaultValue={selected.tags.join(', ')} key={`${selected.id}-tags`} onBlur={(event) => void update(selected, { tags: event.target.value.split(',') })} placeholder="family, training"/></label>
        <label>COLLECTIONS<input defaultValue={selected.collections.join(', ')} key={`${selected.id}-collections`} onBlur={(event) => void update(selected, { collections: event.target.value.split(',') })} placeholder="Favorites, Field guides"/></label>
        <div className="media-detail-actions"><button className="secondary-button" onClick={() => void update(selected, { favorite: !selected.favorite })}>{selected.favorite ? 'REMOVE FAVORITE' : '★ FAVORITE'}</button><button className="danger-button" onClick={() => { if (confirm(`Delete ${selected.title} from this drive? This cannot be undone.`)) { setSelectedId(undefined); void run(() => window.outpost.removeMedia(selected.id)); } }}>DELETE FILE</button></div>
      </aside>}
    </div>
  </section>;
}
