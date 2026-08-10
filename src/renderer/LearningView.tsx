import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { EducationCourseSummary, EducationLesson, EducationState } from '../shared/contracts';
import './learning.css';

export function LearningView() {
  const [state, setState] = useState<EducationState>();
  const [selectedCourseId, setSelectedCourseId] = useState<string>();
  const [lesson, setLesson] = useState<EducationLesson>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedCourse = useMemo(() => state?.courses.find((course) => course.id === selectedCourseId), [state, selectedCourseId]);

  useEffect(() => { void window.outpost.getEducation().then(setState); }, []);

  async function openLesson(course: EducationCourseSummary, lessonId: string) {
    setSelectedCourseId(course.id);
    setLesson(await window.outpost.getEducationLesson(course.id, lessonId));
  }

  async function importCourse() {
    setBusy(true);
    try { const result = await window.outpost.importEducationCourse(); setState(result.state); setMessage(result.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Course import failed.'); }
    finally { setBusy(false); }
  }

  async function addStarter() {
    setBusy(true);
    try { const result = await window.outpost.addStarterCourse(); setState(result.state); setMessage(result.message); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Starter course could not be added.'); }
    finally { setBusy(false); }
  }

  async function toggleComplete() {
    if (!lesson) return;
    const next = await window.outpost.setEducationLessonComplete(lesson.courseId, lesson.id, !lesson.completed);
    setState(next); setLesson({ ...lesson, completed: !lesson.completed });
  }

  async function removeCourse(course: EducationCourseSummary) {
    if (!window.confirm(`Remove ${course.title} and its copied lesson files from this drive?`)) return;
    const result = await window.outpost.removeEducationCourse(course.id);
    setState(result.state); setMessage(result.message);
    if (selectedCourseId === course.id) { setSelectedCourseId(undefined); setLesson(undefined); }
  }

  if (!state) return <section className="page-panel"><p className="section-label">EDUCATION CENTER</p><h2>Loading offline courses...</h2></section>;
  if (lesson && selectedCourse) {
    const lessonIndex = selectedCourse.lessons.findIndex((item) => item.id === lesson.id);
    const nextLesson = selectedCourse.lessons[lessonIndex + 1];
    return <section className="page-panel learning-reader">
      <div className="learning-reader-heading"><button className="secondary-button" onClick={() => setLesson(undefined)}>← COURSES</button><div><p className="section-label">{lesson.courseTitle}</p><h2>{lesson.title}</h2></div><span>{lesson.durationMinutes} MIN</span></div>
      <div className="learning-reader-layout">
        <aside><p className="section-label">COURSE LESSONS</p>{selectedCourse.lessons.map((item, index) => <button className={item.id === lesson.id ? 'active' : ''} key={item.id} onClick={() => void openLesson(selectedCourse, item.id)}><span>{item.completed ? '✓' : String(index + 1).padStart(2, '0')}</span><b>{item.title}</b></button>)}</aside>
        <article className="lesson-content">{lesson.format === 'markdown' ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{lesson.body}</ReactMarkdown> : <pre>{lesson.body}</pre>}<div className="lesson-completion"><button className={lesson.completed ? 'secondary-button' : 'primary-button'} onClick={() => void toggleComplete()}>{lesson.completed ? 'MARK INCOMPLETE' : '✓ MARK LESSON COMPLETE'}</button>{nextLesson && <button className="secondary-button" onClick={() => void openLesson(selectedCourse, nextLesson.id)}>NEXT LESSON →</button>}</div></article>
      </div>
    </section>;
  }

  return <section className="page-panel learning-panel">
    <div className="page-heading"><div><p className="section-label">OFFLINE EDUCATION</p><h2>Education Center</h2></div><div className="document-heading-actions"><button className="secondary-button" onClick={() => void addStarter()} disabled={busy}>ADD STARTER COURSE</button><button className="primary-button" onClick={() => void importCourse()} disabled={busy}>{busy ? 'WORKING...' : '+ IMPORT COURSE FOLDER'}</button></div></div>
    <p className="page-intro">Courses, lessons, and progress stay entirely on this drive. Import a folder containing a validated <code>course.json</code> and Markdown or text lessons.</p>
    {message && <div className="module-result" role="status">{message}</div>}
    <div className="learning-summary"><div><strong>{state.courses.length}</strong><span>COURSES</span></div><div><strong>{state.completedLessons}</strong><span>LESSONS COMPLETE</span></div><div><strong>{state.totalLessons}</strong><span>TOTAL LESSONS</span></div></div>
    {!state.courses.length && <div className="library-empty"><b>Your education shelf is empty</b><p>Add the small starter course or import your own portable course folder. No online account is used.</p></div>}
    <div className="course-grid">{state.courses.map((course) => <article key={course.id}><div className="course-card-heading"><span>{course.category}</span><button onClick={() => void removeCourse(course)} title="Remove course">×</button></div><h3>{course.title}</h3><p>{course.description}</p><small>BY {course.author.toUpperCase()}</small><div className="course-progress"><div><span style={{ width: `${course.progressPercent}%` }} /></div><b>{course.progressPercent}%</b></div><ol>{course.lessons.map((item, index) => <li key={item.id}><button onClick={() => void openLesson(course, item.id)}><span>{item.completed ? '✓' : String(index + 1).padStart(2, '0')}</span><div><b>{item.title}</b><small>{item.durationMinutes} MIN</small></div><i>OPEN →</i></button></li>)}</ol></article>)}</div>
  </section>;
}
