import fs from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import type { DocumentAnnotation, DocumentAnnotationInput, DocumentBookmark, DocumentNote, DocumentNoteInput, DocumentSearchResult, DocumentSummary, MapPackage, MapPlace, NoteAttachment, PortableNote, UpdateStatus } from '../shared/contracts';
import { PortablePathService } from './portable-path';

interface Migration {
  version: number;
  statements: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS module_registry (
        module_id TEXT PRIMARY KEY NOT NULL,
        version TEXT,
        status TEXT NOT NULL,
        installed_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS update_settings (
        singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
        provider TEXT NOT NULL CHECK (provider IN ('none', 'github')),
        repository_owner TEXT,
        repository_name TEXT,
        channel TEXT NOT NULL CHECK (channel IN ('stable', 'preview')),
        automatic_checks INTEGER NOT NULL CHECK (automatic_checks IN (0, 1)),
        last_checked_at TEXT
      ) STRICT`,
      `INSERT OR IGNORE INTO update_settings
        (singleton_id, provider, channel, automatic_checks)
        VALUES (1, 'none', 'stable', 0)`,
    ],
  },
  {
    version: 3,
    statements: [
      `UPDATE update_settings SET
        provider = 'github',
        repository_owner = 'MrIncHQ',
        repository_name = 'OutPostZero',
        channel = 'stable',
        automatic_checks = 0
      WHERE singleton_id = 1`,
    ],
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        sha256 TEXT NOT NULL,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('pdf', 'text', 'markdown', 'html', 'image')),
        size INTEGER NOT NULL CHECK (size >= 0),
        modified_at TEXT NOT NULL,
        added_at TEXT NOT NULL,
        last_opened_at TEXT,
        current_page INTEGER NOT NULL DEFAULT 1 CHECK (current_page >= 1),
        page_count INTEGER NOT NULL DEFAULT 0 CHECK (page_count >= 0),
        favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
        index_status TEXT NOT NULL DEFAULT 'not-indexed' CHECK (index_status IN ('not-indexed', 'indexing', 'indexed', 'error')),
        index_error TEXT
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS documents_sha256_idx ON documents(sha256)`,
      `CREATE TABLE IF NOT EXISTS document_pages (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL CHECK (page_number >= 1),
        text TEXT NOT NULL,
        PRIMARY KEY (document_id, page_number)
      ) STRICT`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS document_pages_fts USING fts5(
        document_id UNINDEXED, page_number UNINDEXED, text, tokenize = 'unicode61'
      )`,
      `CREATE TABLE IF NOT EXISTS document_tags (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (document_id, tag)
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS document_collections (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        collection_name TEXT NOT NULL,
        PRIMARY KEY (document_id, collection_name)
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS document_bookmarks (
        id TEXT PRIMARY KEY NOT NULL,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL CHECK (page_number >= 1),
        label TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS document_notes (
        id TEXT PRIMARY KEY NOT NULL,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL CHECK (page_number >= 1),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS document_annotations (
        id TEXT PRIMARY KEY NOT NULL,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        page_number INTEGER NOT NULL CHECK (page_number >= 1),
        kind TEXT NOT NULL CHECK (kind IN ('highlight', 'comment')),
        color TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS portable_notes (
        id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, folder TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)), favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS portable_note_tags (
        note_id TEXT NOT NULL REFERENCES portable_notes(id) ON DELETE CASCADE, tag TEXT NOT NULL,
        PRIMARY KEY (note_id, tag)
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS portable_note_attachments (
        id TEXT PRIMARY KEY NOT NULL, note_id TEXT NOT NULL REFERENCES portable_notes(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE, size INTEGER NOT NULL CHECK (size >= 0), created_at TEXT NOT NULL
      ) STRICT`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS portable_notes_fts USING fts5(
        note_id UNINDEXED, title, body, folder, tags, tokenize = 'unicode61'
      )`,
      `CREATE TABLE IF NOT EXISTS map_packages (
        id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, file_name TEXT NOT NULL, relative_path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL CHECK (format IN ('pmtiles', 'mbtiles')), size INTEGER NOT NULL CHECK (size >= 0), added_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS map_places (
        id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
        longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180), note TEXT NOT NULL DEFAULT '',
        favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE VIRTUAL TABLE IF NOT EXISTS map_places_fts USING fts5(
        place_id UNINDEXED, name, note, tokenize = 'unicode61'
      )`,
    ],
  },
];

export class DatabaseService {
  private readonly database: DatabaseSync;
  private readonly backupDirectory: string;
  private closed = false;

  constructor(paths: PortablePathService) {
    this.backupDirectory = paths.ensureDirectory('Backups');
    this.database = new DatabaseSync(paths.resolve('Data/outpost-zero.sqlite'));
    this.database.exec('PRAGMA journal_mode = DELETE');
    this.database.exec('PRAGMA synchronous = FULL');
    this.database.exec('PRAGMA foreign_keys = ON');
    this.database.exec('PRAGMA busy_timeout = 5000');
    this.database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT`);
    this.migrate();
  }

  private migrate(): void {
    const applied = new Set(
      (this.database.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
        .map((row) => row.version),
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      this.database.exec('BEGIN IMMEDIATE');
      try {
        for (const statement of migration.statements) this.database.exec(statement);
        this.database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
          .run(migration.version, new Date().toISOString());
        this.database.exec('COMMIT');
      } catch (error) {
        this.database.exec('ROLLBACK');
        throw error;
      }
    }
  }

  schemaVersion(): number {
    const row = this.database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
      .get() as { version: number };
    return row.version;
  }

  integrityCheck(): boolean {
    const row = this.database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    return row.integrity_check === 'ok';
  }

  updateStatus(currentVersion: string): UpdateStatus {
    const row = this.database.prepare(`SELECT provider, repository_owner, repository_name,
      channel, automatic_checks, last_checked_at FROM update_settings WHERE singleton_id = 1`).get() as {
        provider: 'none' | 'github';
        repository_owner: string | null;
        repository_name: string | null;
        channel: 'stable' | 'preview';
        automatic_checks: number;
        last_checked_at: string | null;
      };
    return {
      currentVersion,
      provider: row.provider,
      repositoryOwner: row.repository_owner,
      repositoryName: row.repository_name,
      channel: row.channel,
      automaticChecks: row.automatic_checks === 1,
      lastCheckedAt: row.last_checked_at,
      configured: row.provider === 'github' && Boolean(row.repository_owner && row.repository_name),
    };
  }

  moduleRecords(): Array<{ moduleId: string; version: string | null; status: string }> {
    return (this.database.prepare('SELECT module_id, version, status FROM module_registry ORDER BY module_id').all() as Array<{
      module_id: string;
      version: string | null;
      status: string;
    }>).map((row) => ({ moduleId: row.module_id, version: row.version, status: row.status }));
  }

  setModuleInstalled(moduleId: string, version: string): void {
    if (this.closed) throw new Error('Cannot update a closed database.');
    const now = new Date().toISOString();
    this.database.prepare(`INSERT INTO module_registry
      (module_id, version, status, installed_at, updated_at) VALUES (?, ?, 'installed', ?, ?)
      ON CONFLICT(module_id) DO UPDATE SET version = excluded.version, status = 'installed', updated_at = excluded.updated_at`)
      .run(moduleId, version, now, now);
  }

  removeModule(moduleId: string): void {
    if (this.closed) throw new Error('Cannot update a closed database.');
    this.database.prepare('DELETE FROM module_registry WHERE module_id = ?').run(moduleId);
  }

  upsertDocument(record: {
    id: string; relativePath: string; sha256: string; title: string; fileName: string;
    format: DocumentSummary['format']; size: number; modifiedAt: string; addedAt: string;
  }): void {
    if (this.closed) throw new Error('Cannot update a closed database.');
    this.database.prepare(`INSERT INTO documents
      (id, relative_path, sha256, title, file_name, format, size, modified_at, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET sha256 = excluded.sha256, title = excluded.title,
        file_name = excluded.file_name, format = excluded.format, size = excluded.size,
        modified_at = excluded.modified_at,
        index_status = CASE WHEN documents.sha256 = excluded.sha256 THEN documents.index_status ELSE 'not-indexed' END,
        index_error = CASE WHEN documents.sha256 = excluded.sha256 THEN documents.index_error ELSE NULL END`)
      .run(record.id, record.relativePath, record.sha256, record.title, record.fileName, record.format,
        record.size, record.modifiedAt, record.addedAt);
  }

  documentByHash(sha256: string): DocumentSummary | null {
    const row = this.database.prepare('SELECT * FROM documents WHERE sha256 = ? ORDER BY added_at LIMIT 1').get(sha256) as Record<string, unknown> | undefined;
    return row ? this.mapDocument(row) : null;
  }

  documents(): DocumentSummary[] {
    return (this.database.prepare('SELECT * FROM documents ORDER BY COALESCE(last_opened_at, added_at) DESC').all() as Array<Record<string, unknown>>)
      .map((row) => this.mapDocument(row));
  }

  document(documentId: string): DocumentSummary | null {
    const row = this.database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as Record<string, unknown> | undefined;
    return row ? this.mapDocument(row) : null;
  }

  documentByRelativePath(relativePath: string): DocumentSummary | null {
    const row = this.database.prepare('SELECT * FROM documents WHERE relative_path = ?').get(relativePath) as Record<string, unknown> | undefined;
    return row ? this.mapDocument(row) : null;
  }

  private mapDocument(row: Record<string, unknown>): DocumentSummary {
    const id = String(row.id);
    const tags = (this.database.prepare('SELECT tag FROM document_tags WHERE document_id = ? ORDER BY tag').all(id) as Array<{ tag: string }>).map((item) => item.tag);
    const collections = (this.database.prepare('SELECT collection_name FROM document_collections WHERE document_id = ? ORDER BY collection_name').all(id) as Array<{ collection_name: string }>).map((item) => item.collection_name);
    const indexed = this.database.prepare('SELECT COUNT(*) AS count FROM document_pages WHERE document_id = ?').get(id) as { count: number };
    return {
      id, title: String(row.title), fileName: String(row.file_name), relativePath: String(row.relative_path),
      format: row.format as DocumentSummary['format'], size: Number(row.size), modifiedAt: String(row.modified_at),
      addedAt: String(row.added_at), lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : null,
      currentPage: Number(row.current_page), pageCount: Number(row.page_count), favorite: Number(row.favorite) === 1,
      indexStatus: row.index_status as DocumentSummary['indexStatus'], indexError: row.index_error ? String(row.index_error) : null,
      indexedPages: Number(indexed.count), tags, collections,
    };
  }

  setDocumentIndexStatus(documentId: string, status: DocumentSummary['indexStatus'], error: string | null = null): void {
    this.database.prepare('UPDATE documents SET index_status = ?, index_error = ? WHERE id = ?').run(status, error, documentId);
  }

  replaceDocumentPages(documentId: string, pages: Array<{ page: number; text: string }>, pageCount: number): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM document_pages WHERE document_id = ?').run(documentId);
      this.database.prepare('DELETE FROM document_pages_fts WHERE document_id = ?').run(documentId);
      const insertPage = this.database.prepare('INSERT INTO document_pages (document_id, page_number, text) VALUES (?, ?, ?)');
      const insertSearch = this.database.prepare('INSERT INTO document_pages_fts (document_id, page_number, text) VALUES (?, ?, ?)');
      for (const page of pages) {
        insertPage.run(documentId, page.page, page.text);
        insertSearch.run(documentId, page.page, page.text);
      }
      this.database.prepare(`UPDATE documents SET page_count = ?, index_status = 'indexed', index_error = NULL WHERE id = ?`).run(pageCount, documentId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  documentText(documentId: string): string {
    return (this.database.prepare('SELECT text FROM document_pages WHERE document_id = ? ORDER BY page_number').all(documentId) as Array<{ text: string }>)
      .map((row) => row.text).join('\n\n');
  }

  searchDocumentPages(ftsQuery: string, limit = 80): Array<{ documentId: string; title: string; format: DocumentSummary['format']; page: number; excerpt: string; score: number }> {
    return (this.database.prepare(`SELECT f.document_id, d.title, d.format, CAST(f.page_number AS INTEGER) AS page,
      snippet(document_pages_fts, 2, '[', ']', ' ... ', 22) AS excerpt, bm25(document_pages_fts) AS score
      FROM document_pages_fts f JOIN documents d ON d.id = f.document_id
      WHERE document_pages_fts MATCH ? ORDER BY score LIMIT ?`).all(ftsQuery, limit) as Array<{
        document_id: string; title: string; format: DocumentSummary['format']; page: number; excerpt: string; score: number;
      }>).map((row) => ({ documentId: row.document_id, title: row.title, format: row.format, page: row.page, excerpt: row.excerpt, score: row.score }));
  }

  updateDocumentMetadata(documentId: string, update: { favorite?: boolean; currentPage?: number; tags?: string[]; collections?: string[] }): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      if (update.favorite !== undefined) this.database.prepare('UPDATE documents SET favorite = ? WHERE id = ?').run(update.favorite ? 1 : 0, documentId);
      if (update.currentPage !== undefined) this.database.prepare('UPDATE documents SET current_page = ?, last_opened_at = ? WHERE id = ?').run(update.currentPage, new Date().toISOString(), documentId);
      if (update.tags) {
        this.database.prepare('DELETE FROM document_tags WHERE document_id = ?').run(documentId);
        const insert = this.database.prepare('INSERT INTO document_tags (document_id, tag) VALUES (?, ?)');
        for (const tag of update.tags) insert.run(documentId, tag);
      }
      if (update.collections) {
        this.database.prepare('DELETE FROM document_collections WHERE document_id = ?').run(documentId);
        const insert = this.database.prepare('INSERT INTO document_collections (document_id, collection_name) VALUES (?, ?)');
        for (const collection of update.collections) insert.run(documentId, collection);
      }
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  removeDocument(documentId: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM document_pages_fts WHERE document_id = ?').run(documentId);
      this.database.prepare('DELETE FROM documents WHERE id = ?').run(documentId);
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  documentBookmarks(documentId: string): DocumentBookmark[] {
    return (this.database.prepare('SELECT id, page_number, label, created_at FROM document_bookmarks WHERE document_id = ? ORDER BY page_number, created_at').all(documentId) as Array<{ id: string; page_number: number; label: string; created_at: string }>).map((row) => ({ id: row.id, page: row.page_number, label: row.label, createdAt: row.created_at }));
  }

  addDocumentBookmark(documentId: string, page: number, label: string): void {
    this.database.prepare('INSERT INTO document_bookmarks (id, document_id, page_number, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), documentId, page, label, new Date().toISOString());
  }

  removeDocumentBookmark(documentId: string, bookmarkId: string): void {
    this.database.prepare('DELETE FROM document_bookmarks WHERE id = ? AND document_id = ?').run(bookmarkId, documentId);
  }

  documentNotes(documentId: string): DocumentNote[] {
    return (this.database.prepare('SELECT id, page_number, title, body, created_at, updated_at FROM document_notes WHERE document_id = ? ORDER BY page_number, updated_at DESC').all(documentId) as Array<{ id: string; page_number: number; title: string; body: string; created_at: string; updated_at: string }>).map((row) => ({ id: row.id, page: row.page_number, title: row.title, body: row.body, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  saveDocumentNote(documentId: string, note: DocumentNoteInput): void {
    const now = new Date().toISOString();
    const id = note.id ?? crypto.randomUUID();
    this.database.prepare(`INSERT INTO document_notes (id, document_id, page_number, title, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET page_number = excluded.page_number,
      title = excluded.title, body = excluded.body, updated_at = excluded.updated_at WHERE document_id = excluded.document_id`)
      .run(id, documentId, note.page, note.title, note.body, now, now);
  }

  removeDocumentNote(documentId: string, noteId: string): void {
    this.database.prepare('DELETE FROM document_notes WHERE id = ? AND document_id = ?').run(noteId, documentId);
  }

  documentAnnotations(documentId: string): DocumentAnnotation[] {
    return (this.database.prepare('SELECT id, page_number, kind, color, text, created_at, updated_at FROM document_annotations WHERE document_id = ? ORDER BY page_number, updated_at DESC').all(documentId) as Array<{ id: string; page_number: number; kind: 'highlight' | 'comment'; color: string; text: string; created_at: string; updated_at: string }>).map((row) => ({ id: row.id, page: row.page_number, kind: row.kind, color: row.color, text: row.text, createdAt: row.created_at, updatedAt: row.updated_at }));
  }

  saveDocumentAnnotation(documentId: string, annotation: DocumentAnnotationInput): void {
    const now = new Date().toISOString();
    const id = annotation.id ?? crypto.randomUUID();
    this.database.prepare(`INSERT INTO document_annotations (id, document_id, page_number, kind, color, text, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET page_number = excluded.page_number,
      kind = excluded.kind, color = excluded.color, text = excluded.text, updated_at = excluded.updated_at WHERE document_id = excluded.document_id`)
      .run(id, documentId, annotation.page, annotation.kind, annotation.color, annotation.text, now, now);
  }

  removeDocumentAnnotation(documentId: string, annotationId: string): void {
    this.database.prepare('DELETE FROM document_annotations WHERE id = ? AND document_id = ?').run(annotationId, documentId);
  }

  notes(): PortableNote[] {
    return (this.database.prepare('SELECT * FROM portable_notes ORDER BY pinned DESC, updated_at DESC').all() as Array<Record<string, unknown>>)
      .map((row) => this.mapNote(row));
  }

  note(noteId: string): PortableNote | null {
    const row = this.database.prepare('SELECT * FROM portable_notes WHERE id = ?').get(noteId) as Record<string, unknown> | undefined;
    return row ? this.mapNote(row) : null;
  }

  private mapNote(row: Record<string, unknown>): PortableNote {
    const id = String(row.id);
    const tags = (this.database.prepare('SELECT tag FROM portable_note_tags WHERE note_id = ? ORDER BY tag').all(id) as Array<{ tag: string }>).map((item) => item.tag);
    const attachments = (this.database.prepare('SELECT * FROM portable_note_attachments WHERE note_id = ? ORDER BY created_at').all(id) as Array<Record<string, unknown>>).map((item): NoteAttachment => ({
      id: String(item.id), fileName: String(item.file_name), relativePath: String(item.relative_path), size: Number(item.size),
      createdAt: String(item.created_at), readerUrl: `outpost-attachment://file/${String(item.id)}/${encodeURIComponent(String(item.file_name))}`,
    }));
    return { id, title: String(row.title), body: String(row.body), folder: String(row.folder), pinned: Number(row.pinned) === 1,
      favorite: Number(row.favorite) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at), tags, attachments };
  }

  saveNoteRecord(note: Omit<PortableNote, 'attachments'>): PortableNote {
    const tags = [...new Set(note.tags)];
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`INSERT INTO portable_notes (id, title, body, folder, pinned, favorite, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET title = excluded.title, body = excluded.body,
        folder = excluded.folder, pinned = excluded.pinned, favorite = excluded.favorite, updated_at = excluded.updated_at`)
        .run(note.id, note.title, note.body, note.folder, note.pinned ? 1 : 0, note.favorite ? 1 : 0, note.createdAt, note.updatedAt);
      this.database.prepare('DELETE FROM portable_note_tags WHERE note_id = ?').run(note.id);
      const insertTag = this.database.prepare('INSERT INTO portable_note_tags (note_id, tag) VALUES (?, ?)');
      for (const tag of tags) insertTag.run(note.id, tag);
      this.database.prepare('DELETE FROM portable_notes_fts WHERE note_id = ?').run(note.id);
      this.database.prepare('INSERT INTO portable_notes_fts (note_id, title, body, folder, tags) VALUES (?, ?, ?, ?, ?)')
        .run(note.id, note.title, note.body, note.folder, tags.join(' '));
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return this.note(note.id)!;
  }

  deleteNoteRecord(noteId: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('DELETE FROM portable_notes_fts WHERE note_id = ?').run(noteId);
      this.database.prepare('DELETE FROM portable_notes WHERE id = ?').run(noteId);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  addNoteAttachment(noteId: string, attachment: Omit<NoteAttachment, 'readerUrl'>): void {
    this.database.prepare('INSERT INTO portable_note_attachments (id, note_id, file_name, relative_path, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(attachment.id, noteId, attachment.fileName, attachment.relativePath, attachment.size, attachment.createdAt);
  }

  noteAttachment(attachmentId: string): (Omit<NoteAttachment, 'readerUrl'> & { noteId: string }) | null {
    const row = this.database.prepare('SELECT * FROM portable_note_attachments WHERE id = ?').get(attachmentId) as Record<string, unknown> | undefined;
    return row ? { id: String(row.id), noteId: String(row.note_id), fileName: String(row.file_name), relativePath: String(row.relative_path), size: Number(row.size), createdAt: String(row.created_at) } : null;
  }

  removeNoteAttachmentRecord(noteId: string, attachmentId: string): void {
    this.database.prepare('DELETE FROM portable_note_attachments WHERE id = ? AND note_id = ?').run(attachmentId, noteId);
  }

  searchNotes(ftsQuery: string, limit = 40): Array<{ id: string; title: string; excerpt: string; context: string }> {
    return (this.database.prepare(`SELECT f.note_id AS id, n.title, snippet(portable_notes_fts, 2, '[', ']', ' ... ', 24) AS excerpt,
      CASE WHEN n.folder = '' THEN 'NOTES' ELSE 'NOTES / ' || n.folder END AS context
      FROM portable_notes_fts f JOIN portable_notes n ON n.id = f.note_id
      WHERE portable_notes_fts MATCH ? ORDER BY bm25(portable_notes_fts) LIMIT ?`).all(ftsQuery, limit) as Array<{ id: string; title: string; excerpt: string; context: string }>);
  }

  mapPackages(): MapPackage[] {
    return (this.database.prepare('SELECT * FROM map_packages ORDER BY added_at DESC').all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), title: String(row.title), fileName: String(row.file_name), relativePath: String(row.relative_path),
      format: row.format as MapPackage['format'], size: Number(row.size), addedAt: String(row.added_at),
      readerUrl: `outpost-map://package/${String(row.id)}/${encodeURIComponent(String(row.file_name))}`,
    }));
  }

  mapPackage(packageId: string): MapPackage | null {
    return this.mapPackages().find((item) => item.id === packageId) ?? null;
  }

  upsertMapPackage(item: Omit<MapPackage, 'readerUrl'>): void {
    this.database.prepare(`INSERT INTO map_packages (id, title, file_name, relative_path, format, size, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET title = excluded.title, file_name = excluded.file_name, format = excluded.format, size = excluded.size`)
      .run(item.id, item.title, item.fileName, item.relativePath, item.format, item.size, item.addedAt);
  }

  removeMapPackageRecord(packageId: string): void { this.database.prepare('DELETE FROM map_packages WHERE id = ?').run(packageId); }

  mapPlaces(): MapPlace[] {
    return (this.database.prepare('SELECT * FROM map_places ORDER BY favorite DESC, updated_at DESC').all() as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), name: String(row.name), latitude: Number(row.latitude), longitude: Number(row.longitude), note: String(row.note),
      favorite: Number(row.favorite) === 1, createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }));
  }

  saveMapPlaceRecord(place: MapPlace): MapPlace {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare(`INSERT INTO map_places (id, name, latitude, longitude, note, favorite, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, latitude = excluded.latitude,
        longitude = excluded.longitude, note = excluded.note, favorite = excluded.favorite, updated_at = excluded.updated_at`)
        .run(place.id, place.name, place.latitude, place.longitude, place.note, place.favorite ? 1 : 0, place.createdAt, place.updatedAt);
      this.database.prepare('DELETE FROM map_places_fts WHERE place_id = ?').run(place.id);
      this.database.prepare('INSERT INTO map_places_fts (place_id, name, note) VALUES (?, ?, ?)').run(place.id, place.name, place.note);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    return this.mapPlaces().find((item) => item.id === place.id)!;
  }

  deleteMapPlaceRecord(placeId: string): void {
    this.database.exec('BEGIN IMMEDIATE');
    try { this.database.prepare('DELETE FROM map_places_fts WHERE place_id = ?').run(placeId); this.database.prepare('DELETE FROM map_places WHERE id = ?').run(placeId); this.database.exec('COMMIT'); }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }

  searchMapPlaces(ftsQuery: string, limit = 40): Array<{ id: string; title: string; excerpt: string; latitude: number; longitude: number }> {
    return (this.database.prepare(`SELECT f.place_id AS id, p.name AS title, snippet(map_places_fts, 2, '[', ']', ' ... ', 20) AS excerpt,
      p.latitude, p.longitude FROM map_places_fts f JOIN map_places p ON p.id = f.place_id
      WHERE map_places_fts MATCH ? ORDER BY bm25(map_places_fts) LIMIT ?`).all(ftsQuery, limit) as Array<{ id: string; title: string; excerpt: string; latitude: number; longitude: number }>);
  }

  async createRotatingBackup(keep = 3): Promise<string> {
    if (this.closed) throw new Error('Cannot back up a closed database.');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(this.backupDirectory, `outpost-zero-${timestamp}.sqlite`);
    await backup(this.database, target);
    const backups = fs.readdirSync(this.backupDirectory)
      .filter((name) => /^outpost-zero-.*\.sqlite$/.test(name))
      .sort()
      .reverse();
    for (const obsolete of backups.slice(Math.max(1, keep))) {
      fs.unlinkSync(path.join(this.backupDirectory, obsolete));
    }
    return target;
  }

  close(): void {
    if (this.closed) return;
    this.database.exec('PRAGMA optimize');
    this.database.close();
    this.closed = true;
  }
}
