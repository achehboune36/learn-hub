/** Derived numbers shared by the dashboard, course page and profile. */
import { PASS_SCORE, QUIZ_LENGTH, type Course } from '../content/types';
import type { CourseProgress, StudySession } from './model';
import { dayKey } from './model';

export interface CourseStats {
  total: number;
  read: number;
  passed: number;
  /** 0..1 — a chapter counts only when it is read AND the quiz is passed. */
  ratio: number;
  /** Average best-quiz score across attempted chapters, 0..5, or null. */
  avgQuiz: number | null;
  secondsSpent: number;
  started: boolean;
  complete: boolean;
}

export function courseStats(totalChapters: number, progress?: CourseProgress): CourseStats {
  const chapters = Object.values(progress?.chapters ?? {});
  const read = chapters.filter((c) => c.read).length;
  const passed = chapters.filter((c) => c.quizBest >= PASS_SCORE).length;
  const attempted = chapters.filter((c) => c.quizAttempts > 0);

  return {
    total: totalChapters,
    read,
    passed,
    ratio: totalChapters ? passed / totalChapters : 0,
    avgQuiz: attempted.length
      ? attempted.reduce((sum, c) => sum + c.quizBest, 0) / attempted.length
      : null,
    secondsSpent: progress?.secondsSpent ?? 0,
    started: read > 0 || (progress?.secondsSpent ?? 0) > 0,
    complete: totalChapters > 0 && passed >= totalChapters,
  };
}

/** The chapter the reader should land on when they hit "Resume". */
export function nextChapterId(course: Course, progress?: CourseProgress): string {
  const firstUnfinished = course.chapters.find((ch) => {
    const p = progress?.chapters?.[ch.id];
    return !p || !p.read || p.quizBest < PASS_SCORE;
  });
  return firstUnfinished?.id ?? progress?.lastChapterId ?? course.chapters[0].id;
}

export interface DayBucket {
  key: string;
  label: string;
  seconds: number;
}

/** Last `days` days of study time, oldest first — for the activity strip. */
export function activityByDay(sessions: StudySession[], days = 7): DayBucket[] {
  const buckets: DayBucket[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    buckets.push({
      key: dayKey(d.getTime()),
      label: d.toLocaleDateString(undefined, { weekday: 'narrow' }),
      seconds: 0,
    });
  }

  const index = new Map(buckets.map((b, i) => [b.key, i]));
  for (const s of sessions) {
    const i = index.get(dayKey(s.startedAt));
    if (i !== undefined) buckets[i].seconds += s.seconds;
  }
  return buckets;
}

export { PASS_SCORE, QUIZ_LENGTH };
