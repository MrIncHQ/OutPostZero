import fs from 'node:fs';
import path from 'node:path';
import type { EducationCourseSummary, EducationLesson, EducationOperationResult, EducationState } from '../shared/contracts';
import { DatabaseService } from './database-service';
import { PortablePathService } from './portable-path';

interface CourseManifest {
  schemaVersion: 1;
  id: string;
  title: string;
  description: string;
  category?: string;
  author?: string;
  lessons: Array<{ id: string; title: string; file: string; durationMinutes?: number }>;
}

const STARTER_MANIFEST: CourseManifest = {
  schemaVersion: 1,
  id: 'outpost-zero-basics',
  title: 'Outpost Zero Basics',
  description: 'A short offline course covering portable-drive safety, knowledge storage, and emergency information habits.',
  category: 'Getting Started',
  author: 'Outpost Zero',
  lessons: [
    { id: 'portable-safety', title: 'Protect the portable drive', file: '01-portable-safety.md', durationMinutes: 5 },
    { id: 'offline-library', title: 'Build an offline library', file: '02-offline-library.md', durationMinutes: 7 },
    { id: 'verify-information', title: 'Verify critical information', file: '03-verify-information.md', durationMinutes: 6 },
  ],
};

const STARTER_LESSONS: Record<string, string> = {
  '01-portable-safety.md': '# Protect the portable drive\n\nKeep the complete Outpost Zero folder together. Before disconnecting an external drive, use **Prepare Drive for Removal**, close the app, and then use the operating system safe-eject control.\n\nAvoid editing files inside application runtime folders. Your documents, maps, courses, notes, and downloaded libraries live in their dedicated portable content and data folders.',
  '02-offline-library.md': '# Build an offline library\n\nChoose information you are likely to need without internet access: regional maps, repair manuals, medical references, communications procedures, and appropriately sized Kiwix archives.\n\nTest important files before relying on them. Keep enough free drive space for updates and temporary download verification.',
  '03-verify-information.md': '# Verify critical information\n\nOffline does not automatically mean accurate. Check the source, publication date, region, and revision of safety-critical material. Compare important instructions with more than one authoritative source when possible.\n\nOutpost Zero stores reference material; it does not replace trained professional judgment.',
};

function requireIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(value)) throw new Error(`${label} identifier is invalid.`);
  return value;
}

function cleanText(value: unknown, fallback: string, limit: number): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, limit) || fallback : fallback;
}

function lessonFile(value: unknown): string {
  if (typeof value !== 'string' || path.isAbsolute(value) || value.includes('\\')) throw new Error('Lesson file path is invalid.');
  const segments = value.split('/');
  if (segments.some((part) => !part || part === '.' || part === '..')) throw new Error('Lesson file path contains traversal.');
  if (!['.md', '.markdown', '.txt'].includes(path.extname(value).toLowerCase())) throw new Error('Lessons must be Markdown or text files.');
  return value;
}

function safeFolderName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^[.-]+|[.-]+$/g, '').slice(0, 80) || 'course';
}

export class EducationService {
  private readonly root: string;

  constructor(private readonly database: DatabaseService, private readonly paths: PortablePathService) {
    this.root = paths.ensureDirectory('Content/Education');
  }

  private readManifest(directory: string): CourseManifest {
    const realDirectory = fs.realpathSync(directory);
    const manifestPath = path.join(directory, 'course.json');
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) throw new Error('The selected folder does not contain course.json.');
    if (fs.statSync(manifestPath).size > 256 * 1024) throw new Error('Course manifest is too large.');
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<CourseManifest>;
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.lessons) || raw.lessons.length < 1 || raw.lessons.length > 500) throw new Error('Course manifest is invalid.');
    const ids = new Set<string>();
    const lessons = raw.lessons.map((lesson) => {
      const id = requireIdentifier(lesson.id, 'Lesson');
      if (ids.has(id)) throw new Error(`Duplicate lesson identifier: ${id}`);
      ids.add(id);
      const file = lessonFile(lesson.file);
      const source = path.join(directory, ...file.split('/'));
      if (!fs.existsSync(source) || !fs.statSync(source).isFile() || fs.lstatSync(source).isSymbolicLink()) throw new Error(`Lesson file is missing: ${file}`);
      const realSource = fs.realpathSync(source);
      if (!realSource.startsWith(`${realDirectory}${path.sep}`)) throw new Error(`Lesson file leaves the course folder: ${file}`);
      if (fs.statSync(source).size > 5 * 1024 * 1024) throw new Error(`Lesson file is too large: ${file}`);
      return { id, title: cleanText(lesson.title, id, 120), file, durationMinutes: Math.max(1, Math.min(480, Math.floor(Number(lesson.durationMinutes) || 10))) };
    });
    return {
      schemaVersion: 1,
      id: requireIdentifier(raw.id, 'Course'),
      title: cleanText(raw.title, 'Untitled course', 140),
      description: cleanText(raw.description, 'Offline course', 1000),
      category: cleanText(raw.category, 'General', 80),
      author: cleanText(raw.author, 'Unknown author', 120),
      lessons,
    };
  }

  private courses(): Array<{ manifest: CourseManifest; directory: string; relativePath: string }> {
    const courses: Array<{ manifest: CourseManifest; directory: string; relativePath: string }> = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const directory = path.join(this.root, entry.name);
      try {
        courses.push({ manifest: this.readManifest(directory), directory, relativePath: path.relative(this.paths.root, directory).replace(/\\/g, '/') });
      } catch { /* Invalid folders stay untouched but are not exposed as courses. */ }
    }
    return courses.sort((a, b) => a.manifest.title.localeCompare(b.manifest.title));
  }

  state(): EducationState {
    const progress = new Map(this.database.educationProgress().map((item) => [`${item.courseId}:${item.lessonId}`, item.completed]));
    const courses: EducationCourseSummary[] = this.courses().map(({ manifest, relativePath }) => {
      const lessons = manifest.lessons.map((lesson) => ({ id: lesson.id, title: lesson.title, durationMinutes: lesson.durationMinutes ?? 10, completed: progress.get(`${manifest.id}:${lesson.id}`) === true }));
      const completedLessons = lessons.filter((lesson) => lesson.completed).length;
      return { id: manifest.id, title: manifest.title, description: manifest.description, category: manifest.category ?? 'General', author: manifest.author ?? 'Unknown author', relativePath, lessonCount: lessons.length, completedLessons, progressPercent: Math.round(completedLessons / lessons.length * 100), lessons };
    });
    return { courses, completedLessons: courses.reduce((total, course) => total + course.completedLessons, 0), totalLessons: courses.reduce((total, course) => total + course.lessonCount, 0) };
  }

  importDirectory(sourceDirectory: string): EducationOperationResult {
    const source = path.resolve(sourceDirectory);
    if (!fs.statSync(source).isDirectory() || fs.lstatSync(source).isSymbolicLink()) throw new Error('Select a normal course folder.');
    const manifest = this.readManifest(source);
    if (this.courses().some((course) => course.manifest.id === manifest.id)) return { ok: false, message: `${manifest.title} is already installed.`, state: this.state() };
    let destination = path.join(this.root, safeFolderName(path.basename(source)));
    if (fs.existsSync(destination)) destination = path.join(this.root, `${safeFolderName(path.basename(source))}-${manifest.id}`);
    fs.mkdirSync(destination, { recursive: false });
    try {
      fs.copyFileSync(path.join(source, 'course.json'), path.join(destination, 'course.json'), fs.constants.COPYFILE_EXCL);
      for (const lesson of manifest.lessons) {
        const target = path.join(destination, ...lesson.file.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(source, ...lesson.file.split('/')), target, fs.constants.COPYFILE_EXCL);
      }
      this.readManifest(destination);
    } catch (error) {
      fs.rmSync(destination, { recursive: true, force: true });
      throw error;
    }
    return { ok: true, message: `${manifest.title} was copied to this drive.`, state: this.state() };
  }

  addStarterCourse(): EducationOperationResult {
    if (this.courses().some((course) => course.manifest.id === STARTER_MANIFEST.id)) return { ok: false, message: 'The starter course is already installed.', state: this.state() };
    const destination = path.join(this.root, STARTER_MANIFEST.id);
    if (fs.existsSync(destination)) throw new Error('The starter course folder already exists but is not valid.');
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'course.json'), `${JSON.stringify(STARTER_MANIFEST, null, 2)}\n`, 'utf8');
    for (const [fileName, body] of Object.entries(STARTER_LESSONS)) fs.writeFileSync(path.join(destination, fileName), `${body}\n`, 'utf8');
    return { ok: true, message: 'The starter course was added to this drive.', state: this.state() };
  }

  lesson(courseId: string, lessonId: string): EducationLesson {
    const safeCourseId = requireIdentifier(courseId, 'Course');
    const safeLessonId = requireIdentifier(lessonId, 'Lesson');
    const course = this.courses().find((item) => item.manifest.id === safeCourseId);
    if (!course) throw new Error('Course was not found on this drive.');
    const lesson = course.manifest.lessons.find((item) => item.id === safeLessonId);
    if (!lesson) throw new Error('Lesson was not found in this course.');
    const progress = this.database.educationProgress().find((item) => item.courseId === safeCourseId && item.lessonId === safeLessonId);
    return { id: lesson.id, courseId: safeCourseId, courseTitle: course.manifest.title, title: lesson.title, durationMinutes: lesson.durationMinutes ?? 10, completed: progress?.completed === true, body: fs.readFileSync(path.join(course.directory, ...lesson.file.split('/')), 'utf8'), format: path.extname(lesson.file).toLowerCase() === '.txt' ? 'text' : 'markdown' };
  }

  setComplete(courseId: string, lessonId: string, completed: boolean): EducationState {
    this.lesson(courseId, lessonId);
    this.database.setEducationLessonComplete(courseId, lessonId, completed);
    return this.state();
  }

  remove(courseId: string): EducationOperationResult {
    const safeCourseId = requireIdentifier(courseId, 'Course');
    const course = this.courses().find((item) => item.manifest.id === safeCourseId);
    if (!course) return { ok: false, message: 'Course was not found on this drive.', state: this.state() };
    fs.rmSync(course.directory, { recursive: true, force: false });
    this.database.removeEducationProgress(safeCourseId);
    return { ok: true, message: `${course.manifest.title} was removed from this drive.`, state: this.state() };
  }
}
