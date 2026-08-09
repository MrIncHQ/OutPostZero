import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseService } from '../src/main/database-service';
import { DocumentService } from '../src/main/document-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';

function createRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-documents-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root);
  paths.initializeLayout();
  const database = new DatabaseService(paths);
  return { root, paths, database, service: new DocumentService(database, paths) };
}

function simplePdf(text: string): Buffer {
  const escaped = text.replace(/([\\()])/g, '\\$1');
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escaped}) Tj\nET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(source)); source += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

test('scans, indexes, searches, and organizes portable text documents', async () => {
  const runtime = createRuntime();
  try {
    fs.writeFileSync(path.join(runtime.root, 'Content', 'Documents', 'field_manual.txt'), 'Generator startup procedure. Open the fuel valve before engaging the starter.');
    fs.writeFileSync(path.join(runtime.root, 'Content', 'Documents', 'radio.md'), '# Radio\nUse the portable repeater for the ridge team.');
    const result = await runtime.service.reconcile(true);
    assert.equal(result.library.documents.length, 2);
    const match = runtime.service.search('fuel valve');
    assert.equal(match.length, 1);
    assert.equal(match[0].page, 1);
    const document = runtime.service.updateMetadata(match[0].documentId, { favorite: true, currentPage: 1, tags: ['Power', 'repair'], collections: ['Field Manuals'] });
    assert.equal(document.favorite, true);
    assert.deepEqual(document.collections, ['Field Manuals']);
    assert.deepEqual(document.tags, ['Power', 'repair']);
    assert.match(runtime.service.text(document.id), /Generator startup procedure/);
  } finally { runtime.database.close(); fs.rmSync(runtime.root, { recursive: true, force: true }); }
});

test('extracts exact pages from PDFs without an external browser', async () => {
  const runtime = createRuntime();
  try {
    fs.writeFileSync(path.join(runtime.root, 'Content', 'PDFs', 'emergency.pdf'), simplePdf('Portable emergency manual phrase'));
    await runtime.service.reconcile(true);
    const document = runtime.service.library().documents[0];
    assert.equal(document.format, 'pdf');
    assert.equal(document.pageCount, 1, document.indexError ?? undefined);
    assert.equal(document.indexStatus, 'indexed');
    assert.equal(runtime.service.search('emergency manual')[0].documentId, document.id);
    assert.match(runtime.service.details(document.id).readerUrl, /^outpost-doc:\/\/document\//);
  } finally { runtime.database.close(); fs.rmSync(runtime.root, { recursive: true, force: true }); }
});

test('keeps bookmarks, notes, and annotations separate from the source file', async () => {
  const runtime = createRuntime();
  try {
    const file = path.join(runtime.root, 'Content', 'Documents', 'medical.txt');
    fs.writeFileSync(file, 'First aid reference');
    await runtime.service.reconcile(true);
    const id = runtime.service.library().documents[0].id;
    const original = fs.readFileSync(file, 'utf8');
    let details = runtime.service.addBookmark(id, 1, 'First aid');
    details = runtime.service.saveNote(id, { page: 1, title: 'Kit', body: 'Restock gauze.' });
    details = runtime.service.saveAnnotation(id, { page: 1, kind: 'comment', color: '#abcdef', text: 'Review monthly.' });
    assert.equal(details.bookmarks.length, 1);
    assert.equal(details.notes.length, 1);
    assert.equal(details.annotations.length, 1);
    assert.equal(details.annotations[0].color, '#ABCDEF');
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    details = runtime.service.removeBookmark(id, details.bookmarks[0].id);
    details = runtime.service.removeNote(id, details.notes[0].id);
    details = runtime.service.removeAnnotation(id, details.annotations[0].id);
    assert.deepEqual([details.bookmarks.length, details.notes.length, details.annotations.length], [0, 0, 0]);
  } finally { runtime.database.close(); fs.rmSync(runtime.root, { recursive: true, force: true }); }
});

test('imports supported files once and safely removes only the selected copy', async () => {
  const runtime = createRuntime();
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-document-source-'));
  try {
    const source = path.join(sourceRoot, 'portable guide.txt');
    fs.writeFileSync(source, 'A unique portable guide.');
    let result = await runtime.service.importFiles([source]);
    assert.equal(result.library.documents.length, 1);
    result = await runtime.service.importFiles([source]);
    assert.match(result.message, /already in the library/);
    const document = result.library.documents[0];
    const copiedPath = runtime.service.filePath(document.id);
    assert.equal(fs.existsSync(copiedPath), true);
    assert.throws(() => runtime.service.details('../../outside'), /identifier is invalid/);
    result = runtime.service.remove(document.id);
    assert.equal(result.library.documents.length, 0);
    assert.equal(fs.existsSync(copiedPath), false);
    assert.equal(fs.existsSync(source), true);
  } finally { runtime.database.close(); fs.rmSync(runtime.root, { recursive: true, force: true }); fs.rmSync(sourceRoot, { recursive: true, force: true }); }
});
