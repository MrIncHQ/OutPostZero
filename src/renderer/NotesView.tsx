import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { NoteInput, NotesState, PortableNote } from '../shared/contracts';

const templates = [
  { name: 'Blank note', title: 'Untitled note', body: '' },
  { name: 'Field log', title: 'Field log', body: '## Conditions\n\n- Date:\n- Location:\n- Weather:\n\n## Observations\n\n\n## Actions taken\n\n' },
  { name: 'Checklist', title: 'Checklist', body: '- [ ] First item\n- [ ] Second item\n- [ ] Third item\n' },
  { name: 'Inventory', title: 'Inventory', body: '| Item | Quantity | Condition | Location |\n|---|---:|---|---|\n| | | | |\n' },
  { name: 'Meeting / plan', title: 'Plan', body: '## Objective\n\n## People\n\n## Decisions\n\n## Next actions\n\n- [ ] \n' },
];

function asInput(note: PortableNote): NoteInput { return { id: note.id, title: note.title, body: note.body, folder: note.folder, pinned: note.pinned, favorite: note.favorite, tags: note.tags }; }
function parseTags(value: string): string[] { return value.split(',').map((tag) => tag.trim()).filter(Boolean); }
function formatBytes(bytes: number): string { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }

export function NotesView({ requestedNoteId, onRequestHandled }: { requestedNoteId?: string; onRequestHandled?: () => void }) {
  const [state, setState] = useState<NotesState>();
  const [selected, setSelected] = useState<PortableNote>();
  const [draft, setDraft] = useState<NoteInput>();
  const [tagText, setTagText] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'write' | 'preview' | 'split'>('split');
  const [message, setMessage] = useState('');
  const [previewAttachment, setPreviewAttachment] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const savedSnapshot = useRef('');

  async function refresh(selectId?: string) {
    const next = await window.outpost.getNotes(); setState(next);
    if (selectId) {
      const note = next.notes.find((item) => item.id === selectId);
      if (note) choose(note);
    }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!requestedNoteId || !state) return;
    const note = state.notes.find((item) => item.id === requestedNoteId); if (note) choose(note); onRequestHandled?.();
  }, [requestedNoteId, state, onRequestHandled]);

  function choose(note: PortableNote) {
    const input = asInput(note); setSelected(note); setDraft(input); setTagText(note.tags.join(', '));
    savedSnapshot.current = JSON.stringify(input); setMessage(''); setConfirmDelete(false); setPreviewAttachment(undefined);
  }

  useEffect(() => {
    if (!draft?.id || JSON.stringify(draft) === savedSnapshot.current) return;
    const timer = window.setTimeout(() => {
      void window.outpost.saveNote({ ...draft, tags: parseTags(tagText) }).then((saved) => {
        const input = asInput(saved); savedSnapshot.current = JSON.stringify(input); setSelected(saved); setState((current) => current ? { ...current, notes: current.notes.map((note) => note.id === saved.id ? saved : note) } : current); setMessage('Saved locally');
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, tagText]);

  const visible = useMemo(() => (state?.notes ?? []).filter((note) => {
    if (filter === 'pinned' && !note.pinned) return false; if (filter === 'favorites' && !note.favorite) return false;
    if (filter.startsWith('folder:') && note.folder !== filter.slice(7)) return false; if (filter.startsWith('tag:') && !note.tags.includes(filter.slice(4))) return false;
    const needle = query.trim().toLowerCase(); return !needle || `${note.title} ${note.body} ${note.folder} ${note.tags.join(' ')}`.toLowerCase().includes(needle);
  }), [state, filter, query]);

  async function create(template = templates[0]) {
    const note = await window.outpost.saveNote({ title: template.title, body: template.body, folder: '', pinned: false, favorite: false, tags: [] });
    await refresh(note.id);
  }
  async function remove() { if (!selected) return; const next = await window.outpost.deleteNote(selected.id); setState(next); setSelected(undefined); setDraft(undefined); setConfirmDelete(false); }
  async function attach() { if (!selected) return; const note = await window.outpost.importNoteAttachments(selected.id); choose(note); await refresh(note.id); }
  async function removeAttachment(id: string) { if (!selected) return; const note = await window.outpost.removeNoteAttachment(selected.id, id); choose(note); await refresh(note.id); }

  if (!state) return <section className="page-panel"><p className="section-label">NOTES</p><h2>Opening your portable notebook...</h2></section>;
  return <section className="page-panel notes-panel">
    <div className="page-heading"><div><p className="section-label">PORTABLE NOTEBOOK</p><h2>{selected ? selected.title : `${state.notes.length} note${state.notes.length === 1 ? '' : 's'}`}</h2></div><div className="note-heading-actions"><select aria-label="Note template" onChange={(event) => { const template = templates[Number(event.target.value)]; if (template) void create(template); event.target.value = ''; }} defaultValue=""><option value="" disabled>NEW FROM TEMPLATE</option>{templates.map((template, index) => <option value={index} key={template.name}>{template.name}</option>)}</select><button className="primary-button" onClick={() => void create()}>+ NEW NOTE</button></div></div>
    {!selected && <div className="notes-layout"><aside className="note-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>ALL NOTES <span>{state.notes.length}</span></button><button className={filter === 'pinned' ? 'active' : ''} onClick={() => setFilter('pinned')}>PINNED</button><button className={filter === 'favorites' ? 'active' : ''} onClick={() => setFilter('favorites')}>FAVORITES</button>{state.folders.length > 0 && <><p>FOLDERS</p>{state.folders.map((folder) => <button className={filter === `folder:${folder}` ? 'active' : ''} onClick={() => setFilter(`folder:${folder}`)} key={folder}>{folder}</button>)}</>}{state.tags.length > 0 && <><p>TAGS</p>{state.tags.map((tag) => <button className={filter === `tag:${tag}` ? 'active' : ''} onClick={() => setFilter(`tag:${tag}`)} key={tag}>#{tag}</button>)}</>}</aside><div className="notes-list"><input className="note-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter note titles and contents" />{visible.map((note) => <button key={note.id} onClick={() => choose(note)}><div><b>{note.pinned ? '● ' : ''}{note.favorite ? '★ ' : ''}{note.title}</b><p>{note.body.replace(/[#*_`>[\]-]/g, ' ').replace(/\s+/g, ' ').slice(0, 150) || 'Empty note'}</p></div><span><small>{note.folder || 'UNFILED'}</small><time>{new Date(note.updatedAt).toLocaleDateString()}</time></span></button>)}{!visible.length && <div className="library-empty"><b>No notes in this view</b><p>Create a blank note or start from a reusable template.</p></div>}</div></div>}
    {selected && draft && <div className="note-editor">
      <div className="note-editor-toolbar"><button className="secondary-button" onClick={() => { setSelected(undefined); setDraft(undefined); void refresh(); }}>← ALL NOTES</button><div className="note-mode"><button className={mode === 'write' ? 'active' : ''} onClick={() => setMode('write')}>WRITE</button><button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>SPLIT</button><button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>PREVIEW</button></div><span>{message || 'Autosaves on this drive'}</span><button onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}>{draft.pinned ? 'UNPIN' : 'PIN'}</button><button onClick={() => setDraft({ ...draft, favorite: !draft.favorite })}>{draft.favorite ? '★ FAVORITE' : '☆ FAVORITE'}</button><button onClick={() => void window.outpost.exportNote(selected.id).then((result) => setMessage(result.message))}>EXPORT .MD</button><button className="note-delete" onClick={() => setConfirmDelete(true)}>DELETE</button></div>
      {confirmDelete && <div className="download-confirm library-remove-confirm"><div><b>Delete “{selected.title}”?</b><p>The note and its copied attachments will be permanently removed.</p></div><div><button className="secondary-button" onClick={() => setConfirmDelete(false)}>KEEP IT</button><button className="danger-button" onClick={() => void remove()}>DELETE NOTE</button></div></div>}
      <div className="note-metadata"><input value={draft.title} maxLength={160} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Note title" /><input value={draft.folder} maxLength={80} onChange={(event) => setDraft({ ...draft, folder: event.target.value })} placeholder="Folder" /><input value={tagText} onChange={(event) => { setTagText(event.target.value); setDraft({ ...draft, tags: parseTags(event.target.value) }); }} placeholder="Tags separated by commas" /></div>
      <div className={`note-writing mode-${mode}`}>{mode !== 'preview' && <textarea value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} spellCheck placeholder="Write in Markdown..." />}{mode !== 'write' && <article className="markdown-preview"><ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.body || '*Nothing to preview yet.*'}</ReactMarkdown></article>}</div>
      <section className="note-attachments"><div><p className="section-label">LOCAL ATTACHMENTS</p><button className="secondary-button" onClick={() => void attach()}>+ ATTACH FILES</button></div>{selected.attachments.length === 0 ? <p>No attachments. Added files are copied beneath Content/Notes on this drive.</p> : <div className="attachment-list">{selected.attachments.map((attachment) => <div key={attachment.id}><button onClick={() => setPreviewAttachment(previewAttachment === attachment.readerUrl ? undefined : attachment.readerUrl)}><b>{attachment.fileName}</b><small>{formatBytes(attachment.size)}</small></button><button onClick={() => void removeAttachment(attachment.id)}>REMOVE</button></div>)}</div>}{previewAttachment && <iframe className="attachment-preview" src={previewAttachment} title="Attachment preview" />}</section>
    </div>}
  </section>;
}
