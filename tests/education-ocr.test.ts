import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { DatabaseService } from '../src/main/database-service';
import { DocumentService } from '../src/main/document-service';
import { EducationService } from '../src/main/education-service';
import { OcrService } from '../src/main/ocr-service';
import { PortablePathService, ROOT_MARKER } from '../src/main/portable-path';

function runtime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-learning-'));
  fs.writeFileSync(path.join(root, ROOT_MARKER), 'test');
  const paths = new PortablePathService(root); paths.initializeLayout();
  const database = new DatabaseService(paths);
  const documents = new DocumentService(database, paths);
  return { root, paths, database, documents, education: new EducationService(database, paths), ocr: new OcrService(database, paths, documents) };
}

function textImage(text: string): Buffer {
  const canvas = createCanvas(900, 180); const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#000000'; context.font = 'bold 52px sans-serif'; context.fillText(text, 35, 105);
  return canvas.toBuffer('image/png');
}

function imagePdf(jpeg: Buffer, width = 900, height = 180): Buffer {
  const content = Buffer.from(`q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('endstream')]),
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')]; const offsets = [0]; let length = parts[0].length;
  objects.forEach((object, index) => { offsets.push(length); const wrapped = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); parts.push(wrapped); length += wrapped.length; });
  const xref = length; const trailer = Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat([...parts, trailer]);
}

test('adds, reads, tracks, and removes a portable education course', () => {
  const app = runtime();
  try {
    let result = app.education.addStarterCourse();
    assert.equal(result.ok, true);
    assert.equal(result.state.courses.length, 1);
    const course = result.state.courses[0];
    const lesson = app.education.lesson(course.id, course.lessons[0].id);
    assert.match(lesson.body, /portable drive/i);
    const progressed = app.education.setComplete(course.id, lesson.id, true);
    assert.equal(progressed.completedLessons, 1);
    assert.equal(progressed.courses[0].progressPercent, 33);
    result = app.education.remove(course.id);
    assert.equal(result.state.courses.length, 0);
  } finally { app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('imports only validated course manifests and lesson files', () => {
  const app = runtime(); const source = fs.mkdtempSync(path.join(os.tmpdir(), 'outpost-zero-course-'));
  try {
    fs.writeFileSync(path.join(source, 'lesson.md'), '# Water\nBoil and safely store drinking water.');
    fs.writeFileSync(path.join(source, 'course.json'), JSON.stringify({ schemaVersion: 1, id: 'water-basics', title: 'Water Basics', description: 'Safe water handling', lessons: [{ id: 'boiling', title: 'Boiling water', file: 'lesson.md', durationMinutes: 8 }] }));
    const result = app.education.importDirectory(source);
    assert.equal(result.ok, true);
    assert.equal(result.state.courses[0].title, 'Water Basics');
    assert.equal(app.education.importDirectory(source).ok, false);
  } finally { app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); fs.rmSync(source, { recursive: true, force: true }); }
});

test('recognizes image text entirely offline and adds it to document search', { timeout: 40_000 }, async () => {
  const app = runtime();
  try {
    fs.writeFileSync(path.join(app.root, 'Content', 'Documents', 'supply.png'), textImage('Emergency Water Supply'));
    await app.documents.reconcile(true);
    const document = app.documents.library().documents[0];
    const result = await app.ocr.run(document.id);
    assert.equal(result.ok, true, result.message);
    assert.equal(result.document.ocrStatus, 'complete');
    assert.equal(result.progress.percent, 100);
    assert.equal(app.documents.search('emergency water')[0].documentId, document.id);
  } finally { await app.ocr.cancelAll(); app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); }
});

test('renders and recognizes an image-only PDF page', { timeout: 40_000 }, async () => {
  const app = runtime();
  try {
    const canvas = createCanvas(900, 180); const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height); context.fillStyle = '#000000'; context.font = 'bold 52px sans-serif'; context.fillText('Shelter Repair Manual', 35, 105);
    fs.writeFileSync(path.join(app.root, 'Content', 'PDFs', 'scanned.pdf'), imagePdf(canvas.toBuffer('image/jpeg', 95)));
    await app.documents.reconcile(true);
    const document = app.documents.library().documents[0];
    assert.equal(app.documents.search('shelter repair').length, 0);
    const result = await app.ocr.run(document.id);
    assert.equal(result.ok, true, result.message);
    assert.equal(app.documents.search('shelter repair')[0].documentId, document.id);
  } finally { await app.ocr.cancelAll(); app.database.close(); fs.rmSync(app.root, { recursive: true, force: true }); }
});
