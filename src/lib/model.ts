/** Shapes of everything we persist per user. Kept small on purpose. */

export interface ChapterProgress {
  read: boolean;
  readAt: number | null;
  /** Best quiz score so far, 0..5 */
  quizBest: number;
  quizAttempts: number;
  quizPassedAt: number | null;
}

export interface CourseProgress {
  courseId: string;
  courseVersion: number;
  lastChapterId: string | null;
  /** Seconds of timed study attributed to this course. */
  secondsSpent: number;
  startedAt: number;
  completedAt: number | null;
  chapters: Record<string, ChapterProgress>;
  updatedAt: number;
}

export interface UserProfile {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
  email: string | null;
  createdAt: number;
  totalSeconds: number;
  sessionCount: number;
  currentStreak: number;
  longestStreak: number;
  /** 'YYYY-MM-DD' in local time of the last day with a recorded session. */
  lastStudyDay: string | null;
}

export interface StudySession {
  id: string;
  startedAt: number;
  endedAt: number;
  seconds: number;
  courseId: string | null;
  chapterId: string | null;
}

export const emptyChapterProgress = (): ChapterProgress => ({
  read: false,
  readAt: null,
  quizBest: 0,
  quizAttempts: 0,
  quizPassedAt: null,
});

export const emptyCourseProgress = (courseId: string, courseVersion: number): CourseProgress => ({
  courseId,
  courseVersion,
  lastChapterId: null,
  secondsSpent: 0,
  startedAt: Date.now(),
  completedAt: null,
  chapters: {},
  updatedAt: Date.now(),
});

/** Local-day key used for streaks; local time so "today" matches the user's day. */
export function dayKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days between two YYYY-MM-DD keys. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const ms = Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad);
  return Math.round(ms / 86_400_000);
}
