/**
 * The reading screen.
 *
 * Sticky bar: course progress on the left, study timer on the right. Below it
 * the chapter blocks, optional flashcards, then the 5-question quiz.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, ChevronLeft, ChevronRight, Moon, Sun,
} from 'lucide-react';
import { useCourse } from '../hooks/useCourse';
import { useProgress } from '../store/useProgress';
import { useTimer } from '../store/useTimer';
import { useTheme } from '../hooks/useTheme';
import { courseStats, PASS_SCORE } from '../lib/stats';
import { BlockRenderer } from '../components/BlockRenderer';
import { Flashcards } from '../components/Flashcards';
import { Quiz } from '../components/Quiz';
import { ProgressBar } from '../components/ProgressBar';
import { StudyTimer } from '../components/StudyTimer';
import { Loading, NotFound } from '../components/States';

/** Time on the page before the chapter counts as read, if not scrolled to the end. */
const READ_DWELL_MS = 45_000;

export function ChapterPage() {
  const { courseId, chapterId } = useParams();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const { course, state } = useCourse(courseId);

  const progress = useProgress((s) => (courseId ? s.progress[courseId] : undefined));
  const markChapterRead = useProgress((s) => s.markChapterRead);
  const recordQuiz = useProgress((s) => s.recordQuiz);
  const setContext = useTimer((s) => s.setContext);

  const [showQuiz, setShowQuiz] = useState(false);
  const quizRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const index = course?.chapters.findIndex((c) => c.id === chapterId) ?? -1;
  const chapter = index >= 0 ? course!.chapters[index] : null;
  const prev = index > 0 ? course!.chapters[index - 1] : null;
  const next = course && index >= 0 && index < course.chapters.length - 1 ? course.chapters[index + 1] : null;

  // Attribute timed study to whatever is on screen.
  useEffect(() => {
    setContext(courseId ?? null, chapterId ?? null);
  }, [courseId, chapterId, setContext]);

  // New chapter -> back to the top, quiz collapsed.
  useEffect(() => {
    setShowQuiz(false);
    window.scrollTo({ top: 0 });
  }, [chapterId]);

  // "Read" is earned two ways: reach the end of the body, or dwell long enough.
  useEffect(() => {
    if (!course || !chapter) return;
    let fired = false;

    const mark = () => {
      if (fired) return;
      fired = true;
      markChapterRead(course.id, course.version, chapter.id, course.chapters.length);
    };

    const timer = setTimeout(mark, READ_DWELL_MS);
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) mark(); },
      { rootMargin: '0px 0px -20% 0px' },
    );
    if (endRef.current) observer.observe(endRef.current);

    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [course, chapter, markChapterRead]);

  const chapterProgress = chapter ? progress?.chapters?.[chapter.id] : undefined;
  const stats = useMemo(
    () => courseStats(course?.chapters.length ?? 0, progress),
    [course, progress],
  );

  // j / k move between chapters.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'j' && next) navigate(`/course/${courseId}/${next.id}`);
      if (e.key === 'k' && prev) navigate(`/course/${courseId}/${prev.id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, courseId, navigate]);

  if (state === 'loading') return <Loading label="Loading chapter…" />;
  if (!course || !chapter) return <NotFound label="That chapter doesn't exist." />;

  const passed = (chapterProgress?.quizBest ?? 0) >= PASS_SCORE;

  const openQuiz = () => {
    setShowQuiz(true);
    requestAnimationFrame(() => quizRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <div>
      <div className="sticky top-0 z-40 border-b border-line bg-surface-base/95 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4 sm:px-6">
          <Link
            to={`/course/${course.id}`}
            className="flex shrink-0 items-center gap-1.5 text-sm text-content-muted hover:text-content-primary"
          >
            <ArrowLeft size={15} />
            <span className="hidden sm:inline">{course.title}</span>
          </Link>

          <div className="mx-1 hidden min-w-0 flex-1 items-center gap-3 sm:flex">
            <ProgressBar value={stats.ratio} className="flex-1" showLabel />
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
            <StudyTimer />
            <button onClick={toggle} className="btn-ghost px-2" aria-label="Toggle theme">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </div>
        <div className="sm:hidden">
          <ProgressBar value={stats.ratio} height="h-1" />
        </div>
      </div>

      <article className="mx-auto max-w-3xl px-4 py-9 sm:px-6 sm:py-12">
        <header className="mb-9 animate-fade-up">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-content-muted">
            <BookOpen size={13} />
            Chapter {index + 1} of {course.chapters.length}
            <span className="num">· {chapter.estimatedMinutes} min</span>
            {passed && (
              <span className="flex items-center gap-1 text-positive">
                <Check size={13} /> passed
              </span>
            )}
          </div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">
            {chapter.title}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-content-secondary">{chapter.summary}</p>
        </header>

        <BlockRenderer blocks={chapter.blocks} glossary={course.glossary} />

        <div ref={endRef} className="h-px" />

        {chapter.flashcards && chapter.flashcards.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-content-muted">
              Before the quiz
            </h2>
            <Flashcards cards={chapter.flashcards} />
          </section>
        )}

        <section ref={quizRef} className="mt-12 scroll-mt-20">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
              Check yourself
            </h2>
            {chapterProgress?.quizAttempts ? (
              <span className="num text-xs text-content-muted">
                best {chapterProgress.quizBest}/5 · {chapterProgress.quizAttempts} attempt
                {chapterProgress.quizAttempts === 1 ? '' : 's'}
              </span>
            ) : null}
          </div>

          {showQuiz ? (
            <Quiz
              questions={chapter.quiz}
              glossary={course.glossary}
              bestScore={chapterProgress?.quizBest ?? 0}
              onComplete={(score) =>
                recordQuiz(course.id, course.version, chapter.id, score, course.chapters.length)
              }
              onNext={next ? () => navigate(`/course/${course.id}/${next.id}`) : undefined}
              nextLabel={next ? `Chapter ${index + 2}` : undefined}
            />
          ) : (
            <button
              onClick={openQuiz}
              className="card flex w-full items-center justify-between p-5 text-left transition-colors hover:border-line-strong"
            >
              <div>
                <p className="font-medium">
                  {passed ? 'Take it again' : '5 questions on this chapter'}
                </p>
                <p className="mt-0.5 text-[13px] text-content-secondary">
                  {passed
                    ? 'Options reshuffle each attempt.'
                    : `Score ${PASS_SCORE} or more to mark the chapter complete.`}
                </p>
              </div>
              <span className="btn-primary shrink-0">Start <ArrowRight size={14} /></span>
            </button>
          )}
        </section>

        <nav className="mt-12 flex flex-col items-stretch gap-3 border-t border-line pt-6 sm:flex-row">
          {prev ? (
            <Link
              to={`/course/${course.id}/${prev.id}`}
              className="card group flex min-w-0 flex-1 items-center gap-3 p-4 transition-colors hover:border-line-strong"
            >
              <ChevronLeft size={16} className="shrink-0 text-content-muted transition-transform group-hover:-translate-x-0.5" />
              <span className="min-w-0">
                <span className="block text-[11px] uppercase tracking-wider text-content-muted">Previous</span>
                <span className="block truncate text-sm font-medium">{prev.title}</span>
              </span>
            </Link>
          ) : <div className="hidden flex-1 sm:block" />}

          {next ? (
            <Link
              to={`/course/${course.id}/${next.id}`}
              className="card group flex min-w-0 flex-1 items-center justify-end gap-3 p-4 text-right transition-colors hover:border-line-strong"
            >
              <span className="min-w-0">
                <span className="block text-[11px] uppercase tracking-wider text-content-muted">Next</span>
                <span className="block truncate text-sm font-medium">{next.title}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <Link
              to={`/course/${course.id}`}
              className="card flex min-w-0 flex-1 items-center justify-end gap-3 p-4 text-right transition-colors hover:border-line-strong"
            >
              <span>
                <span className="block text-[11px] uppercase tracking-wider text-content-muted">Last chapter</span>
                <span className="block text-sm font-medium">Back to course</span>
              </span>
            </Link>
          )}
        </nav>

        <p className="mt-6 text-center text-[11px] text-content-muted">
          <kbd className="rounded border border-line px-1">j</kbd> next ·{' '}
          <kbd className="rounded border border-line px-1">k</kbd> previous ·{' '}
          <kbd className="rounded border border-line px-1">space</kbd> timer ·{' '}
          <kbd className="rounded border border-line px-1">1–4</kbd> answer
        </p>
      </article>
    </div>
  );
}
