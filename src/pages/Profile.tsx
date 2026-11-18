/** Study history: totals, streak, per-course time, recent sessions. */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Flame, GraduationCap, LogOut, Timer, TrendingUp } from 'lucide-react';
import { useProgress } from '../store/useProgress';
import { useAuth } from '../store/useAuth';
import { formatDuration } from '../store/useTimer';
import { courseMetas } from '../content/registry';
import { activityByDay, courseStats } from '../lib/stats';
import { StatTile } from '../components/StatTile';
import { ProgressBar } from '../components/ProgressBar';
import { Icon, accent } from '../components/Icon';

export function Profile() {
  const profile = useProgress((s) => s.profile);
  const progress = useProgress((s) => s.progress);
  const sessions = useProgress((s) => s.sessions);
  const ensureSessions = useProgress((s) => s.ensureSessions);
  const account = useAuth((s) => s.account);
  const signOut = useAuth((s) => s.signOut);

  // Served from the store if the dashboard already fetched it; otherwise one
  // capped query (<= 30 reads).
  useEffect(() => { void ensureSessions(); }, [ensureSessions]);

  const activity = activityByDay(sessions, 14);
  const peak = Math.max(1, ...activity.map((d) => d.seconds));

  const perCourse = courseMetas
    .map((meta) => ({ meta, stats: courseStats(meta.chapterCount, progress[meta.id]) }))
    .filter((c) => c.stats.started)
    .sort((a, b) => b.stats.secondsSpent - a.stats.secondsSpent);

  const avgSession = profile?.sessionCount
    ? Math.round(profile.totalSeconds / profile.sessionCount)
    : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-8 flex items-center gap-4 animate-fade-up">
        {profile?.photoURL ? (
          <img
            src={profile.photoURL}
            alt=""
            referrerPolicy="no-referrer"
            className="h-14 w-14 rounded-full border border-line object-cover"
          />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface-sunken text-lg font-semibold text-content-muted">
            {(profile?.displayName ?? '?').charAt(0).toUpperCase()}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {profile?.displayName ?? 'Learner'}
          </h1>
          <p className="truncate text-sm text-content-secondary">
            {profile?.email ?? (account?.isLocal ? 'Local mode — progress stays in this browser' : '')}
          </p>
        </div>
        <button onClick={() => void signOut()} className="btn-outline shrink-0">
          <LogOut size={14} /> <span className="hidden sm:inline">Sign out</span>
        </button>
      </header>

      <div className="mb-9 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile icon={Clock} label="Total studied" value={formatDuration(profile?.totalSeconds ?? 0)} />
        <StatTile icon={Timer} label="Sessions" value={String(profile?.sessionCount ?? 0)}
                  hint={avgSession ? `avg ${formatDuration(avgSession)}` : undefined} />
        <StatTile icon={Flame} label="Streak" value={`${profile?.currentStreak ?? 0}d`}
                  hint={`best ${profile?.longestStreak ?? 0}d`} />
        <StatTile icon={GraduationCap} label="Courses started" value={String(perCourse.length)} />
      </div>

      <section className="card mb-9 animate-fade-up p-5">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp size={15} className="text-content-muted" />
          <h2 className="text-sm font-semibold">Last 14 days</h2>
        </div>
        <div className="flex h-28 items-end gap-1.5">
          {activity.map((day) => (
            <div key={day.key} className="group flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 items-end">
                <div
                  className={`w-full rounded transition-all ${day.seconds ? 'bg-brand' : 'bg-surface-sunken'}`}
                  style={{ height: `${Math.max(day.seconds ? 6 : 3, (day.seconds / peak) * 100)}%` }}
                  title={`${day.key}: ${formatDuration(day.seconds)}`}
                />
              </div>
              <span className="text-[9px] text-content-muted">{day.key.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      {perCourse.length > 0 && (
        <section className="mb-9">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-content-muted">
            By course
          </h2>
          <div className="space-y-2">
            {perCourse.map(({ meta, stats }) => {
              const a = accent(meta.accent);
              return (
                <Link key={meta.id} to={`/course/${meta.id}`} className="card flex items-center gap-4 p-4 transition-colors hover:border-line-strong">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${a.bg} ${a.text}`}>
                    <Icon name={meta.icon} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-medium">{meta.title}</span>
                      <span className="num shrink-0 text-xs text-content-muted">
                        {formatDuration(stats.secondsSpent)}
                      </span>
                    </div>
                    <ProgressBar value={stats.ratio} className="mt-2" />
                    <p className="mt-1.5 text-[11px] text-content-muted">
                      {stats.passed}/{stats.total} passed
                      {stats.avgQuiz !== null && ` · avg quiz ${stats.avgQuiz.toFixed(1)}/5`}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-content-muted">
          Recent sessions
        </h2>
        {sessions.length === 0 ? (
          <p className="card p-6 text-center text-sm text-content-muted">
            No sessions yet. Start the timer while you read and they show up here.
          </p>
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {sessions.map((s) => {
              const meta = courseMetas.find((m) => m.id === s.courseId);
              return (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="num w-24 shrink-0 text-xs text-content-muted">
                    {new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    {' · '}
                    {new Date(s.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-content-secondary">
                    {meta?.title ?? 'General study'}
                  </span>
                  <span className="num shrink-0 text-sm font-medium">{formatDuration(s.seconds)}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
