/**
 * Study timer.
 *
 * Driven entirely off timestamps, so it is immune to interval drift, background
 * tab throttling and page refreshes. Nothing is written to the database while it
 * runs: the elapsed time is derived, and a single session document is written
 * when the session ends (stop, tab close, or an abandoned paused session).
 */
import { create } from 'zustand';
import { useProgress } from './useProgress';

const KEY = 'learnhub.timer';
/** A paused session older than this is banked on next load rather than resumed. */
const STALE_PAUSE_MS = 30 * 60 * 1000;
/** Hidden-tab grace period before the timer pauses itself. */
export const IDLE_PAUSE_MS = 10 * 60 * 1000;
/** Sessions shorter than this are noise, not study. */
const MIN_SESSION_SECONDS = 20;

interface Persisted {
  running: boolean;
  /** Start of the current running segment, null while paused. */
  segmentStartedAt: number | null;
  /** Seconds banked from earlier segments of this session. */
  banked: number;
  /** When the session as a whole began. */
  sessionStartedAt: number | null;
  pausedAt: number | null;
  /**
   * Last moment the page was known to be open, refreshed by a heartbeat while
   * running. It bounds how much time a crashed or closed tab can claim.
   */
  lastSeenAt: number | null;
  courseId: string | null;
  chapterId: string | null;
}

interface TimerState extends Persisted {
  hydrated: boolean;
  hydrate: () => void;
  /** Called by the lifecycle hook so a closed tab cannot accrue time forever. */
  heartbeat: () => void;
  setContext: (courseId: string | null, chapterId: string | null) => void;
  start: () => void;
  pause: () => void;
  toggle: () => void;
  stop: () => Promise<void>;
  discard: () => void;
  elapsedSeconds: () => number;
}

const blank: Persisted = {
  running: false,
  segmentStartedAt: null,
  banked: 0,
  sessionStartedAt: null,
  pausedAt: null,
  lastSeenAt: null,
  courseId: null,
  chapterId: null,
};

function persist(state: Persisted) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function readPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...blank, ...(JSON.parse(raw) as Persisted) } : null;
  } catch { return null; }
}

export const useTimer = create<TimerState>((set, get) => {
  const snapshot = (): Persisted => {
    const { running, segmentStartedAt, banked, sessionStartedAt, pausedAt,
            lastSeenAt, courseId, chapterId } = get();
    return { running, segmentStartedAt, banked, sessionStartedAt, pausedAt,
             lastSeenAt, courseId, chapterId };
  };

  const commit = (patch: Partial<Persisted>) => {
    set(patch as Partial<TimerState>);
    persist({ ...snapshot(), ...patch });
  };

  return {
    ...blank,
    hydrated: false,

    hydrate: () => {
      const stored = readPersisted();
      if (!stored || !stored.sessionStartedAt) {
        set({ ...blank, hydrated: true });
        return;
      }

      // A session left paused for a long time (laptop closed, tab forgotten)
      // gets banked as-is rather than silently resumed hours later.
      if (!stored.running && stored.pausedAt && Date.now() - stored.pausedAt > STALE_PAUSE_MS) {
        void bank(stored, stored.pausedAt);
        set({ ...blank, hydrated: true });
        persist(blank);
        return;
      }

      // A running session that survived a refresh keeps counting -- elapsed time
      // is recomputed from segmentStartedAt, so a reload costs nothing. But a
      // tab closed hours ago must not claim those hours: if the heartbeat went
      // quiet for longer than the idle grace period, bank the time up to the
      // last confirmed sighting and start fresh.
      if (stored.running && stored.lastSeenAt && Date.now() - stored.lastSeenAt > IDLE_PAUSE_MS) {
        void bank(stored, stored.lastSeenAt);
        set({ ...blank, hydrated: true });
        persist(blank);
        return;
      }

      set({ ...stored, hydrated: true, lastSeenAt: Date.now() });
    },

    heartbeat: () => {
      if (!get().running) return;
      commit({ lastSeenAt: Date.now() });
    },

    setContext: (courseId, chapterId) => {
      const s = get();
      if (s.courseId === courseId && s.chapterId === chapterId) return;
      // Attribute time to whatever the reader is on now; the session keeps running.
      commit({ courseId, chapterId });
    },

    start: () => {
      const s = get();
      if (s.running) return;
      const now = Date.now();
      commit({
        running: true,
        segmentStartedAt: now,
        pausedAt: null,
        lastSeenAt: now,
        sessionStartedAt: s.sessionStartedAt ?? now,
      });
    },

    pause: () => {
      const s = get();
      if (!s.running || !s.segmentStartedAt) return;
      const now = Date.now();
      commit({
        running: false,
        banked: s.banked + Math.round((now - s.segmentStartedAt) / 1000),
        segmentStartedAt: null,
        pausedAt: now,
        lastSeenAt: now,
      });
    },

    toggle: () => (get().running ? get().pause() : get().start()),

    stop: async () => {
      const s = get();
      if (!s.sessionStartedAt) return;
      await bank(snapshot(), Date.now());
      set({ ...blank, hydrated: true });
      persist(blank);
    },

    discard: () => {
      set({ ...blank, hydrated: true });
      persist(blank);
    },

    elapsedSeconds: () => {
      const s = get();
      const live = s.running && s.segmentStartedAt ? (Date.now() - s.segmentStartedAt) / 1000 : 0;
      return Math.floor(s.banked + live);
    },
  };
});

/** Turn a timer snapshot into one persisted session + course time attribution. */
async function bank(state: Persisted, endedAt: number) {
  const live = state.running && state.segmentStartedAt
    ? Math.round((endedAt - state.segmentStartedAt) / 1000)
    : 0;
  const seconds = Math.max(0, state.banked + live);
  if (!state.sessionStartedAt || seconds < MIN_SESSION_SECONDS) return;

  const progress = useProgress.getState();
  progress.addStudyTime(state.courseId, seconds);
  await progress.saveSession({
    startedAt: state.sessionStartedAt,
    endedAt,
    seconds,
    courseId: state.courseId,
    chapterId: state.chapterId,
  });
}

/** Format seconds as h:mm:ss or m:ss. */
export function formatClock(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

/** Human duration for summaries: "1h 20m", "45m", "30s". */
export function formatDuration(total: number): string {
  const s = Math.max(0, Math.floor(total));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
