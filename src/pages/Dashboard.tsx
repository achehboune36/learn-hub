/** Course library + at-a-glance study stats. */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, Flame, GraduationCap, Layers } from 'lucide-react';
import { courseMetas } from '../content/registry';
import { useProgress } from '../store/useProgress';
import { courseStats, activityByDay } from '../lib/stats';
import { formatDuration } from '../store/useTimer';
import { ProgressBar, ProgressRing } from '../components/ProgressBar';
import { Icon, accent } from '../components/Icon';
import { StatTile } from '../components/StatTile';

export function Dashboard() {
  const profile = useProgress((s) => s.profile);
  const progress = useProgress((s) => s.progress);
  const sessions = useProgress((s) => s.sessions);
  const ensureSessions = useProgress((s) => s.ensureSessions);

  useEffect(() => { void ensureSessions(); }, [ensureSessions]);

  const perCourse = courseMetas.map((meta) => {
    const p = progress[meta.id];
    return { meta, progress: p, stats: courseStats(meta.chapterCount, p), touched: Boolean(p) };
  });

  const chaptersDone = Object.values(progress).reduce(
    (n, c) => n + Object.values(c.chapters).filter((ch) => ch.quizBest >= 4).length,
    0,
  );
  const quizScores = Object.values(progress).flatMap((c) =>
    Object.values(c.chapters).filter((ch) => ch.quizAttempts > 0).map((ch) => ch.quizBest),
  );
  const avgQuiz = quizScores.length
    ? (quizScores.reduce((a, b) => a + b, 0) / quizScores.length).toFixed(1)
    : '—';

  const activity = activityByDay(sessions, 7);
  const peak = Math.max(1, ...activity.map((d) => d.seconds));
  const firstName = profile?.displayName?.split(' ')[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="mb-8 animate-fade-up">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {firstName ? `Welcome back, ${firstName}.` : 'Welcome back.'}
        </h1>
        <p className="mt-1.5 text-sm text-content-secondary">
          {profile?.currentStreak
            ? `${profile.currentStreak}-day streak. Keep it going.`
            : 'Start the timer when you sit down — that is how the streak begins.'}
        </p>
      </div>

      <div className="mb-9 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Clock} label="Time studied" value={formatDuration(profile?.totalSeconds ?? 0)} />
        <StatTile icon={Flame} label="Current streak" value={`${profile?.currentStreak ?? 0}d`}
                  hint={profile?.longestStreak ? `best ${profile.longestStreak}d` : undefined} />
        <StatTile icon={CheckCircle2} label="Chapters passed" value={String(chaptersDone)} />
        <StatTile icon={GraduationCap} label="Avg quiz" value={avgQuiz === '—' ? '—' : `${avgQuiz}/5`} />
      </div>

      {sessions.length > 0 && (
        <div className="card mb-9 animate-fade-up p-5">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">This week</h2>
            <span className="text-xs text-content-muted">
              {formatDuration(activity.reduce((n, d) => n + d.seconds, 0))} total
            </span>
          </div>
          <div className="flex h-24 items-end gap-2">
            {activity.map((day) => (
              <div key={day.key} className="flex flex-1 flex-col items-center gap-2">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full rounded-md transition-all ${day.seconds ? 'bg-brand' : 'bg-surface-sunken'}`}
                    style={{ height: `${Math.max(day.seconds ? 8 : 4, (day.seconds / peak) * 100)}%` }}
                    title={`${day.key}: ${formatDuration(day.seconds)}`}
                  />
                </div>
                <span className="text-[10px] uppercase text-content-muted">{day.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2">
        <Layers size={16} className="text-content-muted" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-content-muted">
          Courses ({courseMetas.length})
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {perCourse.map(({ meta, stats, touched }) => {
          const a = accent(meta.accent);
          return (
            <Link
              key={meta.id}
              to={`/course/${meta.id}`}
              className="card group animate-fade-up p-5 transition-colors hover:border-line-strong"
            >
              <div className="flex items-start gap-4">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${a.border} ${a.bg} ${a.text}`}>
                  <Icon name={meta.icon} size={19} />
                </span>

                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold tracking-tight">{meta.title}</h3>
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-content-secondary">
                    {meta.subtitle}
                  </p>
                </div>

                {touched && <ProgressRing value={stats.ratio} size={40} stroke={3.5} />}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="chip capitalize">{meta.level}</span>
                <span className="chip">{Math.round(meta.estimatedMinutes / 60)}h read</span>
                {meta.tags.slice(0, 2).map((t) => <span key={t} className="chip">{t}</span>)}
              </div>

              {touched && (
                <div className="mt-4">
                  <ProgressBar value={stats.ratio} />
                  <div className="mt-2 flex items-center justify-between text-xs text-content-muted">
                    <span>{stats.passed} chapter{stats.passed === 1 ? '' : 's'} passed</span>
                    <span>{formatDuration(stats.secondsSpent)} spent</span>
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-brand">
                {touched ? 'Continue' : 'Start course'}
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
