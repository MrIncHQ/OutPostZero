import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { DocumentAnnotationInput, DocumentDetails, DocumentLibraryState, DocumentNoteInput, DocumentSearchResult, DocumentSummary, OcrProgress } from '../shared/contracts';

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function formatLabel(format: DocumentSummary['format']): string {
  return format === 'pdf' ? 'PDF' : format === 'markdown' ? 'MARKDOWN' : format.toUpperCase();
}

function splitLabels(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function Reader({ document, onBack, onChanged, initialPage }: { document: DocumentDetails; onBack: () => void; onChanged: (document: DocumentDetails) => void; initialPage?: number }) {
  const [page, setPage] = useState(Math.max(1, initialPage ?? document.currentPage));
  const [zoom, setZoom] = useState('page-width');
  const [readerVersion, setReaderVersion] = useState(0);
  const [text, setText] = useState('');
  const [panel, setPanel] = useState<'details' | 'bookmarks' | 'notes' | 'annotations'>('details');
  const [tags, setTags] = useState(document.tags.join(', '));
  const [collections, setCollections] = useState(document.collections.join(', '));
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [annotationText, setAnnotationText] = useState('');
  const [message, setMessage] = useState('');
  const [ocrProgress, setOcrProgress] = useState<OcrProgress>();
  const [ocrBusy, setOcrBusy] = useState(false);

  useEffect(() => {
    if (['text', 'markdown', 'html'].includes(document.format)) void window.outpost.getDocumentText(document.id).then(setText);
  }, [document.id, document.format]);

  async function updatePage(nextPage: number) {
    const bounded = Math.max(1, Math.min(document.pageCount || Number.MAX_SAFE_INTEGER, Math.floor(nextPage)));
    setPage(bounded);
    setReaderVersion((value) => value + 1);
    onChanged(await window.outpost.updateDocumentMetadata(document.id, { currentPage: bounded }));
  }

  async function toggleFavorite() {
    onChanged(await window.outpost.updateDocumentMetadata(document.id, { favorite: !document.favorite }));
  }

  async function saveOrganization() {
    onChanged(await window.outpost.updateDocumentMetadata(document.id, { tags: splitLabels(tags), collections: splitLabels(collections) }));
    setMessage('Tags and collections saved on this drive.');
  }

  async function addBookmark() {
    onChanged(await window.outpost.addDocumentBookmark(document.id, page, `Page ${page}`));
    setPanel('bookmarks');
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    const note: DocumentNoteInput = { page, title: noteTitle, body: noteBody };
    onChanged(await window.outpost.saveDocumentNote(document.id, note));
    setNoteTitle(''); setNoteBody(''); setPanel('notes');
  }

  async function saveAnnotation(event: FormEvent) {
    event.preventDefault();
    const annotation: DocumentAnnotationInput = { page, kind: 'highlight', color: '#E0A44F', text: annotationText };
    onChanged(await window.outpost.saveDocumentAnnotation(document.id, annotation));
    setAnnotationText(''); setPanel('annotations');
  }

  async function runOcr() {
    setOcrBusy(true); setMessage('Preparing offline OCR...');
    const poll = window.setInterval(() => { void window.outpost.getDocumentOcrProgress(document.id).then(setOcrProgress); }, 350);
    try {
      const result = await window.outpost.runDocumentOcr(document.id);
      setOcrProgress(result.progress); setMessage(result.message); onChanged(result.document);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'OCR failed.'); }
    finally { window.clearInterval(poll); setOcrBusy(false); }
  }

  async function cancelOcr() {
    setOcrProgress(await window.outpost.cancelDocumentOcr(document.id));
  }

  const pdfUrl = `${document.readerUrl}#page=${page}&zoom=${zoom}`;
  return <section className="document-reader">
    <div className="document-reader-heading">
      <button className="secondary-button" onClick={onBack}>← LIBRARY</button>
      <div><p className="section-label">{formatLabel(document.format)} READER</p><h2>{document.title}</h2></div>
      <button className={document.favorite ? 'primary-button' : 'secondary-button'} onClick={() => void toggleFavorite()}>{document.favorite ? '★ FAVORITE' : '☆ FAVORITE'}</button>
    </div>
    <div className="document-reader-toolbar">
      <button onClick={() => void updatePage(page - 1)} disabled={page <= 1}>PREVIOUS</button>
      <label>PAGE <input type="number" min="1" max={document.pageCount || undefined} value={page} onChange={(event) => setPage(Number(event.target.value))} onBlur={() => void updatePage(page)} /></label>
      <span>OF {document.pageCount || '—'}</span>
      <button onClick={() => void updatePage(page + 1)} disabled={document.pageCount > 0 && page >= document.pageCount}>NEXT</button>
      {document.format === 'pdf' && <><label>VIEW <select value={zoom} onChange={(event) => { setZoom(event.target.value); setReaderVersion((value) => value + 1); }}><option value="page-width">FIT WIDTH</option><option value="page-fit">FIT PAGE</option><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option><option value="200">200%</option></select></label><button onClick={() => setReaderVersion((value) => value + 1)}>RELOAD PAGE</button><small>Thumbnails, outline, search, rotate, print, continuous and page-spread controls are in the PDF toolbar.</small></>}
      <button onClick={() => void addBookmark()}>BOOKMARK PAGE</button>
    </div>
    <div className="document-reader-layout">
      <div className="document-surface">
        {document.format === 'pdf' && <iframe key={`${readerVersion}-${page}-${zoom}`} title={document.title} src={pdfUrl} />}
        {document.format === 'image' && <div className="document-image"><img src={document.readerUrl} alt={document.title} /></div>}
        {['text', 'markdown', 'html'].includes(document.format) && <article className="document-text"><pre>{text || 'This document contains no indexable text.'}</pre></article>}
      </div>
      <aside className="document-inspector">
        <nav aria-label="Document tools"><button className={panel === 'details' ? 'active' : ''} onClick={() => setPanel('details')}>DETAILS</button><button className={panel === 'bookmarks' ? 'active' : ''} onClick={() => setPanel('bookmarks')}>BOOKMARKS {document.bookmarks.length}</button><button className={panel === 'notes' ? 'active' : ''} onClick={() => setPanel('notes')}>NOTES {document.notes.length}</button><button className={panel === 'annotations' ? 'active' : ''} onClick={() => setPanel('annotations')}>MARKS {document.annotations.length}</button></nav>
        {panel === 'details' && <div className="document-tool-panel"><dl><div><dt>File</dt><dd>{document.fileName}</dd></div><div><dt>Size</dt><dd>{formatBytes(document.size)}</dd></div><div><dt>Index</dt><dd>{document.indexStatus} · {document.indexedPages} pages</dd></div><div><dt>OCR</dt><dd>{document.ocrStatus.replace('-', ' ')}{document.ocrUpdatedAt ? ` · ${new Date(document.ocrUpdatedAt).toLocaleDateString()}` : ''}</dd></div><div><dt>Progress</dt><dd>Page {document.currentPage} of {document.pageCount || '—'}</dd></div></dl>{document.indexError && <p className="form-error">Indexing error: {document.indexError}</p>}{document.ocrError && <p className="form-error">OCR error: {document.ocrError}</p>}{['image', 'pdf'].includes(document.format) && <section className="ocr-panel"><b>OFFLINE TEXT RECOGNITION</b><p>English OCR runs locally and adds recognized text to document search. The source file is never changed.</p>{ocrProgress && ocrProgress.state !== 'idle' && <><div className="ocr-progress"><span style={{ width: `${ocrProgress.percent}%` }} /></div><small>{ocrProgress.percent}% · {ocrProgress.message}</small></>}{ocrBusy ? <button className="secondary-button" onClick={() => void cancelOcr()}>CANCEL OCR</button> : <button className="primary-button" onClick={() => void runOcr()}>{document.ocrStatus === 'complete' ? 'RUN OCR AGAIN' : 'RECOGNIZE TEXT'}</button>}</section>}<label>TAGS<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="repair, wiring, medical" /></label><label>COLLECTIONS<input value={collections} onChange={(event) => setCollections(event.target.value)} placeholder="Manuals, Survival" /></label><button className="primary-button" onClick={() => void saveOrganization()}>SAVE ORGANIZATION</button>{message && <p>{message}</p>}</div>}
        {panel === 'bookmarks' && <div className="document-tool-panel marker-list"><button className="primary-button" onClick={() => void addBookmark()}>BOOKMARK PAGE {page}</button>{document.bookmarks.map((bookmark) => <div key={bookmark.id}><button onClick={() => void updatePage(bookmark.page)}><b>{bookmark.label}</b><small>Page {bookmark.page}</small></button><button className="marker-delete" onClick={() => void window.outpost.removeDocumentBookmark(document.id, bookmark.id).then(onChanged)}>×</button></div>)}</div>}
        {panel === 'notes' && <div className="document-tool-panel"><form onSubmit={(event) => void saveNote(event)}><label>NOTE TITLE<input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} maxLength={100} /></label><label>NOTE<textarea value={noteBody} onChange={(event) => setNoteBody(event.target.value)} maxLength={20000} /></label><button className="primary-button" disabled={!noteBody.trim()}>SAVE ON PAGE {page}</button></form><div className="marker-list">{document.notes.map((note) => <div key={note.id}><button onClick={() => void updatePage(note.page)}><b>{note.title}</b><small>Page {note.page} · {note.body}</small></button><button className="marker-delete" onClick={() => void window.outpost.removeDocumentNote(document.id, note.id).then(onChanged)}>×</button></div>)}</div></div>}
        {panel === 'annotations' && <div className="document-tool-panel"><p>Annotations are stored separately from the source file.</p><form onSubmit={(event) => void saveAnnotation(event)}><label>HIGHLIGHT / COMMENT<textarea value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} maxLength={5000} /></label><button className="primary-button" disabled={!annotationText.trim()}>MARK PAGE {page}</button></form><div className="marker-list">{document.annotations.map((annotation) => <div key={annotation.id}><button onClick={() => void updatePage(annotation.page)}><b>{annotation.kind.toUpperCase()} · PAGE {annotation.page}</b><small>{annotation.text}</small></button><button className="marker-delete" onClick={() => void window.outpost.removeDocumentAnnotation(document.id, annotation.id).then(onChanged)}>×</button></div>)}</div></div>}
      </aside>
    </div>
  </section>;
}

export function DocumentsView({ requestedDocument, onRequestHandled }: { requestedDocument?: { id: string; page: number }; onRequestHandled?: () => void }) {
  const [library, setLibrary] = useState<DocumentLibraryState>();
  const [selected, setSelected] = useState<DocumentDetails>();
  const [initialPage, setInitialPage] = useState<number>();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([]);
  const [busy, setBusy] = useState<'loading' | 'importing' | 'scanning' | 'removing' | null>('loading');
  const [message, setMessage] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<DocumentSummary>();

  async function refresh() {
    const next = await window.outpost.getDocumentLibrary();
    setLibrary(next); setBusy(null);
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!requestedDocument) return;
    void window.outpost.getDocument(requestedDocument.id).then((document) => { setSelected(document); setInitialPage(requestedDocument.page); onRequestHandled?.(); });
  }, [requestedDocument, onRequestHandled]);

  const visible = useMemo(() => (library?.documents ?? []).filter((document) => {
    if (filter === 'favorites' && !document.favorite) return false;
    if (filter === 'recent' && !document.lastOpenedAt) return false;
    if (filter.startsWith('collection:') && !document.collections.includes(filter.slice(11))) return false;
    if (filter.startsWith('tag:') && !document.tags.includes(filter.slice(4))) return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || `${document.title} ${document.fileName} ${document.tags.join(' ')} ${document.collections.join(' ')}`.toLocaleLowerCase().includes(needle);
  }), [library, filter, query]);

  async function open(documentId: string, page?: number) {
    const document = await window.outpost.getDocument(documentId);
    const opened = await window.outpost.updateDocumentMetadata(documentId, { currentPage: page ?? document.currentPage });
    setInitialPage(page); setSelected(opened);
  }
  async function importDocuments() { setBusy('importing'); const result = await window.outpost.importDocuments(); setLibrary(result.library); setMessage(result.message); setBusy(null); }
  async function scanDocuments() { setBusy('scanning'); const result = await window.outpost.scanDocuments(); setLibrary(result.library); setMessage(result.message); setBusy(null); }
  async function removeDocument() { if (!confirmRemove) return; setBusy('removing'); const result = await window.outpost.removeDocument(confirmRemove.id); setLibrary(result.library); setMessage(result.message); setConfirmRemove(undefined); setBusy(null); }
  async function search(event: FormEvent) { event.preventDefault(); setSearchResults(await window.outpost.searchDocuments(query)); }

  if (selected) return <Reader document={selected} initialPage={initialPage} onBack={() => { setSelected(undefined); setInitialPage(undefined); void refresh(); }} onChanged={setSelected} />;
  if (!library) return <section className="page-panel"><p className="section-label">DOCUMENTS</p><h2>Scanning portable documents...</h2></section>;
  return <section className="page-panel documents-panel">
    <div className="page-heading"><div><p className="section-label">PORTABLE DOCUMENTS</p><h2>{library.documents.length} document{library.documents.length === 1 ? '' : 's'} ready</h2></div><div className="document-heading-actions"><button className="secondary-button" onClick={() => void scanDocuments()} disabled={busy !== null}>{busy === 'scanning' ? 'INDEXING...' : 'SCAN FOLDERS'}</button><button className="primary-button" onClick={() => void importDocuments()} disabled={busy !== null}>{busy === 'importing' ? 'IMPORTING AND INDEXING...' : '+ IMPORT DOCUMENTS'}</button></div></div>
    {message && <div className="module-result">{message}</div>}
    {confirmRemove && <div className="download-confirm library-remove-confirm"><div><p className="section-label">REMOVE DOCUMENT</p><b>{confirmRemove.title}</b><p>This permanently removes the copied document and its separate index, bookmarks, notes, and annotations. It frees {formatBytes(confirmRemove.size)}.</p></div><div><button className="secondary-button" onClick={() => setConfirmRemove(undefined)}>KEEP IT</button><button className="danger-button" onClick={() => void removeDocument()}>DELETE FROM DRIVE</button></div></div>}
    <div className="documents-layout">
      <aside className="document-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>ALL DOCUMENTS <span>{library.documents.length}</span></button><button className={filter === 'recent' ? 'active' : ''} onClick={() => setFilter('recent')}>RECENTLY OPENED</button><button className={filter === 'favorites' ? 'active' : ''} onClick={() => setFilter('favorites')}>FAVORITES</button>{library.collections.length > 0 && <><p>COLLECTIONS</p>{library.collections.map((collection) => <button key={collection} className={filter === `collection:${collection}` ? 'active' : ''} onClick={() => setFilter(`collection:${collection}`)}>{collection}</button>)}</>}{library.tags.length > 0 && <><p>TAGS</p>{library.tags.map((tag) => <button key={tag} className={filter === `tag:${tag}` ? 'active' : ''} onClick={() => setFilter(`tag:${tag}`)}>#{tag}</button>)}</>}</aside>
      <div className="documents-workspace">
        <div className="document-search-row"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter titles, tags, and collections" /><form onSubmit={(event) => void search(event)}><button className="secondary-button">SEARCH INSIDE DOCUMENTS</button></form></div>
        {searchResults.length > 0 && <section className="document-search-results"><div><b>PAGE-LEVEL RESULTS</b><button onClick={() => setSearchResults([])}>CLEAR</button></div>{searchResults.map((result, index) => <button key={`${result.documentId}-${result.page}-${index}`} onClick={() => void open(result.documentId, result.page)}><span><b>{result.title}</b><small>Page {result.page}</small></span><p>{result.excerpt}</p><i>OPEN PAGE {result.page} →</i></button>)}</section>}
        {!visible.length && <div className="library-empty"><b>No documents in this view</b><p>Import files with the button above, or copy supported files into Content/PDFs and Content/Documents and scan.</p></div>}
        <div className="document-grid">{visible.map((document) => <article key={document.id}><button className="document-open" onClick={() => void open(document.id)}><span className={`document-format format-${document.format}`}>{formatLabel(document.format)}</span><div><b>{document.favorite ? '★ ' : ''}{document.title}</b><small>{document.fileName}</small></div><dl><div><dt>Size</dt><dd>{formatBytes(document.size)}</dd></div><div><dt>Pages</dt><dd>{document.pageCount || '—'}</dd></div><div><dt>Index</dt><dd>{document.indexStatus}</dd></div><div><dt>Progress</dt><dd>{document.pageCount ? `${Math.round(document.currentPage / document.pageCount * 100)}%` : '—'}</dd></div></dl></button><div className="document-card-actions"><button onClick={() => void window.outpost.updateDocumentMetadata(document.id, { favorite: !document.favorite }).then(() => refresh())}>{document.favorite ? 'UNFAVORITE' : 'FAVORITE'}</button><button onClick={() => setConfirmRemove(document)}>REMOVE</button></div></article>)}</div>
      </div>
    </div>
  </section>;
}
