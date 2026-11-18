/** Course landing page: progress, outcomes, chapter list, glossary. */
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, BookMarked, Check, Clock, PlayCircle, Trophy,
} from 'lucide-react';
import { useCourse } from '../hooks/useCourse';
import { useProgress } from '../store/useProgress';
import { courseStats, nextChapterId, PASS_SCORE } from '../lib/stats';
import { formatDuration } from '../store/useTimer';
import { ProgressBar } from '../components/ProgressBar';
import { Markdown } from '../components/Markdown';
import { Icon, accent } from '../components/Icon';
import { Loading, NotFound } from '../components/States';

export function CoursePage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { course, state } = useCourse(courseId);
  const progress = useProgress((s) => (courseId ? s.progress[courseId] : undefined));

  if (state === 'loading') return <Loading label="Loading course…" />;
  if (state === 'missing' || !course) return <NotFound label="That course doesn't exist." />;

  const stats = courseStats(course.chapters.length, progress);
  const a = accent(course.accent);
  const resumeId = nextChapterId(course, progress);
  const resumeIndex = course.chapters.findIndex((c) => c.id === resumeId);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content-primary">
        <ArrowLeft size={14} /> All courses
      </Link>

      <header className="animate-fade-up">
        <div className="flex items-start gap-4">
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border ${a.border} ${a.bg} ${a.text}`}>
            <Icon name={course.icon} size={24} />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{course.title}</h1>
            <p className="mt-1 text-content-secondary">{course.subtitle}</p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          <span className="chip capitalize">{course.level}</span>
          <span className="chip"><Clock size={11} /> {Math.round(course.estimatedMinutes / 60)}h</span>
          <span className="chip"><BookMarked size={11} /> {course.chapters.length} chapters</span>
          <span className="chip"><Trophy size={11} /> {course.chapters.length * 5} questions</span>
          {course.tags.map((t) => <span key={t} className="chip">{t}</span>)}
        </div>
      </header>

      <div className="card mt-7 animate-fade-up p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {stats.complete ? 'Course complete' : `${stats.passed} of ${course.chapters.length} chapters passed`}
          </span>
          <span className="num text-content-muted">
            {stats.secondsSpent > 0 && `${formatDuration(stats.secondsSpent)} · `}
            {Math.round(stats.ratio * 100)}%
          </span>
        </div>
        <ProgressBar value={stats.ratio} className="mt-3" height="h-2" />
        <button
          onClick={() => navigate(`/course/${course.id}/${resumeId}`)}
          className="btn-primary mt-4 w-full sm:w-auto"
        >
          <PlayCircle size={15} />
          {stats.started
            ? `Resume — chapter ${resumeIndex + 1}`
            : 'Start chapter 1'}
        </button>
      </div>

      <section className="mt-9 animate-fade-up">
        <Markdown glossary={course.glossary}>{course.intro}</Markdown>
      </section>

      <section className="mt-8 animate-fade-up rounded-2xl border border-line bg-surface-sunken p-5">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
          By the end you can
        </h2>
        <ul className="space-y-2">
          {course.outcomes.map((o) => (
            <li key={o} className="flex items-start gap-2.5 text-sm text-content-secondary">
              <Check size={15} className={`mt-0.5 shrink-0 ${a.text}`} />
              {o}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-content-muted">Chapters</h2>
        <ol className="space-y-2">
          {course.chapters.map((ch, i) => {
            const p = progress?.chapters?.[ch.id];
            const passed = (p?.quizBest ?? 0) >= PASS_SCORE;
            const started = Boolean(p?.read);

            return (
              <li key={ch.id}>
                <Link
                  to={`/course/${course.id}/${ch.id}`}
                  className="card group flex items-start gap-4 p-4 transition-colors hover:border-line-strong"
                >
                  <span
                    className={`num mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold
                      ${passed ? 'bg-positive/12 text-positive'
                        : started ? `${a.bg} ${a.text}`
                        : 'bg-surface-sunken text-content-muted'}`}
                  >
                    {passed ? <Check size={15} /> : i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium tracking-tight">{ch.title}</h3>
                    <p className="mt-1 text-[13px] leading-snug text-content-secondary">{ch.summary}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-content-muted">
                      <span className="num">{ch.estimatedMinutes} min</span>
                      {p?.quizAttempts ? (
                        <span className={`num ${passed ? 'text-positive' : 'text-caution'}`}>
                          quiz {p.quizBest}/5
                        </span>
                      ) : (
                        <span>5 questions</span>
                      )}
                      {ch.flashcards?.length ? <span>{ch.flashcards.length} cards</span> : null}
                    </div>
                  </div>

                  <ArrowRight
                    size={16}
                    className="mt-1 shrink-0 text-content-muted transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      {course.glossary.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-content-muted">Glossary</h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {course.glossary.map((g) => (
              <div key={g.term} className="rounded-xl border border-line bg-surface-sunken p-4">
                <dt className={`text-sm font-semibold ${a.text}`}>{g.term}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-content-secondary">{g.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
