/**
 * Progress + profile state.
 *
 * Loaded ONCE per app session (1 profile read + 1 progress collection read) and
 * then served from memory. Every mutation updates memory immediately (so the UI
 * never waits on the network) and schedules a debounced write of the single
 * affected course document.
 */
import { create } from 'zustand';
import {
  emptyChapterProgress, emptyCourseProgress,
  type ChapterProgress, type CourseProgress, type StudySession, type UserProfile,
} from '../lib/model';
import {
  fetchAllProgress, fetchProfile, fetchRecentSessions,
  recordSession, saveProgress, syncIdentity,
} from '../lib/repo';
import { PASS_SCORE } from '../content/types';
import type { Account } from './useAuth';

const WRITE_DEBOUNCE_MS = 2500;

interface ProgressState {
  uid: string | null;
  profile: UserProfile | null;
  progress: Record<string, CourseProgress>;
  sessions: StudySession[];
  loading: boolean;
  loaded: boolean;
  sessionsLoaded: boolean;
  error: string | null;

  load: (account: Account) => Promise<void>;
  reset: () => void;

  courseProgress: (courseId: string, version: number) => CourseProgress;
  chapterProgress: (courseId: string, chapterId: string) => ChapterProgress;

  markChapterRead: (courseId: string, version: number, chapterId: string, totalChapters: number) => void;
  recordQuiz: (courseId: string, version: number, chapterId: string, score: number, totalChapters: number) => void;
  addStudyTime: (courseId: string | null, seconds: number) => void;
  saveSession: (input: { startedAt: number; endedAt: number; seconds: number; courseId: string | null; chapterId: string | null }) => Promise<void>;
  /** Fetch the session history once per app session; a no-op afterwards. */
  ensureSessions: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  flush: () => Promise<void>;
}

/** Pending course-doc writes, keyed by courseId, collapsed by the debounce. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useProgress = create<ProgressState>((set, get) => {
  function scheduleWrite(courseId: string) {
    const existing = timers.get(courseId);
    if (existing) clearTimeout(existing);
    timers.set(
      courseId,
      setTimeout(() => {
        timers.delete(courseId);
        void flushCourse(courseId);
      }, WRITE_DEBOUNCE_MS),
    );
  }

  async function flushCourse(courseId: string) {
    const { uid, progress } = get();
    const doc = progress[courseId];
    if (!uid || !doc) return;
    try {
      await saveProgress(uid, doc);
    } catch (e) {
      set({ error: (e as Error).message });
    }
  }

  /** Apply a change to one course doc in memory, then queue the write. */
  function mutate(courseId: string, version: number, fn: (c: CourseProgress) => CourseProgress) {
    set((state) => {
      const base = state.progress[courseId] ?? emptyCourseProgress(courseId, version);
      const next = fn({ ...base, courseVersion: version, updatedAt: Date.now() });
      return { progress: { ...state.progress, [courseId]: next } };
    });
    scheduleWrite(courseId);
  }

  return {
    uid: null,
    profile: null,
    progress: {},
    sessions: [],
    loading: false,
    loaded: false,
    sessionsLoaded: false,
    error: null,

    load: async (account) => {
      if (get().loading) return;
      set({ loading: true, error: null, uid: account.uid });
      try {
        const seed = {
          displayName: account.displayName,
          photoURL: account.photoURL,
          email: account.email,
        };
        // Two round trips, once per app session. Everything after this is memory.
        const [profile, progress] = await Promise.all([
          fetchProfile(account.uid, seed),
          fetchAllProgress(account.uid),
        ]);
        set({ profile, progress, loading: false, loaded: true });
        void syncIdentity(account.uid, profile, seed);
      } catch (e) {
        set({ loading: false, error: (e as Error).message });
      }
    },

    reset: () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      set({ uid: null, profile: null, progress: {}, sessions: [],
            loaded: false, loading: false, sessionsLoaded: false });
    },

    courseProgress: (courseId, version) =>
      get().progress[courseId] ?? emptyCourseProgress(courseId, version),

    chapterProgress: (courseId, chapterId) =>
      get().progress[courseId]?.chapters?.[chapterId] ?? emptyChapterProgress(),

    markChapterRead: (courseId, version, chapterId, totalChapters) => {
      const existing = get().progress[courseId]?.chapters?.[chapterId];
      if (existing?.read && get().progress[courseId]?.lastChapterId === chapterId) return; // nothing to write
      mutate(courseId, version, (c) => {
        const ch = c.chapters[chapterId] ?? emptyChapterProgress();
        const chapters = {
          ...c.chapters,
          [chapterId]: { ...ch, read: true, readAt: ch.readAt ?? Date.now() },
        };
        return { ...c, chapters, lastChapterId: chapterId, completedAt: completion(chapters, totalChapters, c.completedAt) };
      });
    },

    recordQuiz: (courseId, version, chapterId, score, totalChapters) => {
      mutate(courseId, version, (c) => {
        const ch = c.chapters[chapterId] ?? emptyChapterProgress();
        const best = Math.max(ch.quizBest, score);
        const chapters = {
          ...c.chapters,
          [chapterId]: {
            ...ch,
            read: true,
            readAt: ch.readAt ?? Date.now(),
            quizBest: best,
            quizAttempts: ch.quizAttempts + 1,
            quizPassedAt: ch.quizPassedAt ?? (best >= PASS_SCORE ? Date.now() : null),
          },
        };
        return { ...c, chapters, lastChapterId: chapterId, completedAt: completion(chapters, totalChapters, c.completedAt) };
      });
    },

    addStudyTime: (courseId, seconds) => {
      if (!courseId || seconds <= 0) return;
      const version = get().progress[courseId]?.courseVersion ?? 1;
      mutate(courseId, version, (c) => ({ ...c, secondsSpent: c.secondsSpent + seconds }));
    },

    saveSession: async (input) => {
      const { uid, profile } = get();
      if (!uid || !profile || input.seconds <= 0) return;
      try {
        const { session, profilePatch } = await recordSession(uid, profile, input);
        set((s) => ({
          profile: s.profile ? { ...s.profile, ...profilePatch } : s.profile,
          sessions: [session, ...s.sessions].slice(0, 30),
        }));
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },

    ensureSessions: async () => {
      // The dashboard's activity strip and the profile's history read the same
      // list, so fetch it at most once (<= 30 reads) per app session.
      if (get().sessionsLoaded) return;
      set({ sessionsLoaded: true });
      await get().refreshSessions();
    },

    refreshSessions: async () => {
      const { uid } = get();
      if (!uid) return;
      try {
        set({ sessions: await fetchRecentSessions(uid, 30), sessionsLoaded: true });
      } catch (e) {
        set({ error: (e as Error).message, sessionsLoaded: false });
      }
    },

    flush: async () => {
      const pending = [...timers.keys()];
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      await Promise.all(pending.map(flushCourse));
    },
  };
});

/** A course is complete once every chapter is read and passed. */
function completion(
  chapters: Record<string, ChapterProgress>,
  totalChapters: number,
  current: number | null,
): number | null {
  if (current) return current;
  const done = Object.values(chapters).filter((c) => c.read && c.quizBest >= PASS_SCORE).length;
  return done >= totalChapters && totalChapters > 0 ? Date.now() : null;
}
