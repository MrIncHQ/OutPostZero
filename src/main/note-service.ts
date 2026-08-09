import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NoteInput, NotesState, PortableNote } from '../shared/contracts';
import { DatabaseService } from './database-service';
import { PortablePathService } from './portable-path';

function labels(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\s+/g, ' ').slice(0, 48)).filter(Boolean))].slice(0, 40);
}

function safeName(value: string): string {
  const extension = path.extname(value).toLowerCase();
  const stem = path.basename(value, path.extname(value)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'attachment';
  return `${stem}${extension}`;
}

export class NoteService {
  constructor(private readonly database: DatabaseService, private readonly paths: PortablePathService) {}

  state(): NotesState {
    const notes = this.database.notes();
    return { notes, folders: [...new Set(notes.map((note) => note.folder).filter(Boolean))].sort(), tags: [...new Set(notes.flatMap((note) => note.tags))].sort() };
  }

  require(noteId: string): PortableNote {
    if (!/^[0-9a-f-]{36}$/i.test(noteId)) throw new Error('Note identifier is invalid.');
    const note = this.database.note(noteId);
    if (!note) throw new Error('Note was not found on this drive.');
    return note;
  }

  save(input: NoteInput): PortableNote {
    if (input.id && !/^[0-9a-f-]{36}$/i.test(input.id)) throw new Error('Note identifier is invalid.');
    const existing = input.id ? this.database.note(input.id) : null;
    const now = new Date().toISOString();
    return this.database.saveNoteRecord({
      id: input.id ?? crypto.randomUUID(), title: input.title.trim().slice(0, 160) || 'Untitled note', body: input.body.slice(0, 2_000_000),
      folder: input.folder.trim().replace(/\s+/g, ' ').slice(0, 80), pinned: Boolean(input.pinned), favorite: Boolean(input.favorite),
      createdAt: existing?.createdAt ?? now, updatedAt: now, tags: labels(input.tags),
    });
  }

  delete(noteId: string): NotesState {
    const note = this.require(noteId);
    for (const attachment of note.attachments) {
      const file = this.paths.resolve(attachment.relativePath);
      if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    }
    const attachmentRoot = this.paths.resolve(`Content/Notes/Attachments/${note.id}`);
    if (fs.existsSync(attachmentRoot)) fs.rmSync(attachmentRoot, { recursive: true, force: true });
    this.database.deleteNoteRecord(note.id);
    return this.state();
  }

  importAttachments(noteId: string, sourcePaths: string[]): PortableNote {
    const note = this.require(noteId);
    const destinationRoot = this.paths.ensureDirectory(`Content/Notes/Attachments/${note.id}`);
    for (const sourcePath of sourcePaths.slice(0, 30)) {
      const source = path.resolve(sourcePath);
      const stats = fs.statSync(source);
      if (!stats.isFile() || stats.size > 250 * 1024 * 1024) continue;
      const id = crypto.randomUUID();
      const name = safeName(path.basename(source));
      const destination = path.join(destinationRoot, `${id}-${name}`);
      fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
      this.database.addNoteAttachment(note.id, { id, fileName: name, relativePath: path.relative(this.paths.root, destination).replace(/\\/g, '/'), size: stats.size, createdAt: new Date().toISOString() });
    }
    return this.require(note.id);
  }

  attachmentPath(attachmentId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(attachmentId)) throw new Error('Attachment identifier is invalid.');
    const attachment = this.database.noteAttachment(attachmentId);
    if (!attachment) throw new Error('Attachment was not found.');
    return this.paths.resolve(attachment.relativePath);
  }

  removeAttachment(noteId: string, attachmentId: string): PortableNote {
    this.require(noteId);
    const attachment = this.database.noteAttachment(attachmentId);
    if (!attachment || attachment.noteId !== noteId) throw new Error('Attachment was not found.');
    const file = this.paths.resolve(attachment.relativePath);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    this.database.removeNoteAttachmentRecord(noteId, attachmentId);
    return this.require(noteId);
  }

  markdown(noteId: string): { note: PortableNote; content: string } {
    const note = this.require(noteId);
    const metadata = [`# ${note.title}`, '', note.folder ? `Folder: ${note.folder}` : '', note.tags.length ? `Tags: ${note.tags.join(', ')}` : ''].filter((line, index, all) => line || index < 2 || all[index - 1]).join('\n');
    return { note, content: `${metadata}\n\n${note.body.trim()}\n` };
  }
}
