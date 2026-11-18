/**
 * Persistence layer.
 *
 * Two interchangeable backends behind one interface:
 *   - Firestore, when Firebase is configured and a user is signed in
 *   - localStorage, otherwise (lets the app run before Firebase is set up)
 *
 * Free-tier discipline lives here:
 *   - A whole app session costs 1 profile read + 1 collection read of progress.
 *   - Progress writes are merged into ONE doc per course and debounced by the caller.
 *   - Timer sessions write once per session, batched with an increment() on the
 *     profile totals — never a read-modify-write.
 */
import {
  doc, getDoc, setDoc, collection, getDocs, query, orderBy, limit,
  writeBatch, increment,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  dayKey, daysBetween, emptyCourseProgress,
  type CourseProgress, type StudySession, type UserProfile,
} from './model';

const LS_PREFIX = 'learnhub.local';

function lsKey(uid: string, part: string) { return `${LS_PREFIX}.${uid}.${part}`; }

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function lsWrite(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

/** True when reads and writes should hit Firestore rather than localStorage. */
function remote(uid: string) {
  return Boolean(db) && !uid.startsWith('local:');
}

// ---------------------------------------------------------------- profile

export async function fetchProfile(
  uid: string,
  seed: Pick<UserProfile, 'displayName' | 'photoURL' | 'email'>,
): Promise<UserProfile> {
  const blank: UserProfile = {
    uid, ...seed,
    createdAt: Date.now(),
    totalSeconds: 0,
    sessionCount: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastStudyDay: null,
  };

  if (!remote(uid)) {
    const stored = lsRead<UserProfile | null>(lsKey(uid, 'profile'), null);
    if (stored) return { ...blank, ...stored, uid };
    lsWrite(lsKey(uid, 'profile'), blank);
    return blank;
  }

  const ref = doc(db!, 'users', uid);
  const snap = await getDoc(ref);           // read #1
  if (!snap.exists()) {
    // Client epoch millis rather than serverTimestamp(): everything else in the
    // model is a number, and a session-length calculation must not mix the two.
    await setDoc(ref, blank);
    return blank;
  }
  const data = snap.data() as Partial<UserProfile>;
  return {
    ...blank,
    ...data,
    uid,
    // Auth is the source of truth for identity; refresh it cheaply on the client
    // and only write it back if it actually drifted (see syncIdentity).
    ...seed,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : blank.createdAt,
  };
}

/** Write identity fields back only when they changed — avoids a pointless daily write. */
export async function syncIdentity(uid: string, current: UserProfile, seed: Partial<UserProfile>) {
  const changed = (['displayName', 'photoURL', 'email'] as const).some((k) => current[k] !== seed[k]);
  if (!changed) return;
  if (!remote(uid)) return lsWrite(lsKey(uid, 'profile'), { ...current, ...seed });
  await setDoc(doc(db!, 'users', uid), seed, { merge: true });
}

// --------------------------------------------------------------- progress

/** One collection read for every course the user has touched. */
export async function fetchAllProgress(uid: string): Promise<Record<string, CourseProgress>> {
  if (!remote(uid)) {
    return lsRead<Record<string, CourseProgress>>(lsKey(uid, 'progress'), {});
  }
  const snap = await getDocs(collection(db!, 'users', uid, 'progress'));
  const out: Record<string, CourseProgress> = {};
  snap.forEach((d) => { out[d.id] = d.data() as CourseProgress; });
  return out;
}

/**
 * Persist a course's progress document. Always a full merge-write of one small
 * doc — cheaper and simpler than field-path surgery, and the doc stays well
 * under a kilobyte even for a 20-chapter course.
 */
export async function saveProgress(uid: string, progress: CourseProgress): Promise<void> {
  if (!remote(uid)) {
    const all = lsRead<Record<string, CourseProgress>>(lsKey(uid, 'progress'), {});
    all[progress.courseId] = progress;
    return lsWrite(lsKey(uid, 'progress'), all);
  }
  await setDoc(doc(db!, 'users', uid, 'progress', progress.courseId), progress, { merge: true });
}

// --------------------------------------------------------------- sessions

export interface SessionResult {
  session: StudySession;
  profilePatch: Pick<UserProfile, 'totalSeconds' | 'sessionCount' | 'currentStreak' | 'longestStreak' | 'lastStudyDay'>;
}

/**
 * Record one finished study session.
 *
 * Firestore cost: exactly 2 writes (session doc + profile counters), in one
 * atomic batch. Streak is derived on the client from `lastStudyDay` so we never
 * have to scan the session history.
 */
export async function recordSession(
  uid: string,
  profile: UserProfile,
  input: { startedAt: number; endedAt: number; seconds: number; courseId: string | null; chapterId: string | null },
): Promise<SessionResult> {
  const today = dayKey(input.endedAt);
  let { currentStreak, longestStreak } = profile;

  if (profile.lastStudyDay !== today) {
    const gap = profile.lastStudyDay ? daysBetween(profile.lastStudyDay, today) : Infinity;
    currentStreak = gap === 1 ? currentStreak + 1 : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
  } else if (currentStreak === 0) {
    currentStreak = 1;
    longestStreak = Math.max(longestStreak, 1);
  }

  const profilePatch = {
    totalSeconds: profile.totalSeconds + input.seconds,
    sessionCount: profile.sessionCount + 1,
    currentStreak,
    longestStreak,
    lastStudyDay: today,
  };

  if (!remote(uid)) {
    const id = `s_${input.endedAt}_${Math.random().toString(36).slice(2, 7)}`;
    const session: StudySession = { id, ...input };
    const list = lsRead<StudySession[]>(lsKey(uid, 'sessions'), []);
    list.unshift(session);
    lsWrite(lsKey(uid, 'sessions'), list.slice(0, 200));
    lsWrite(lsKey(uid, 'profile'), { ...profile, ...profilePatch });
    return { session, profilePatch };
  }

  const sessionRef = doc(collection(db!, 'users', uid, 'sessions'));
  const batch = writeBatch(db!);
  batch.set(sessionRef, input);
  batch.set(doc(db!, 'users', uid), {
    // increment() means we never read the counters back before writing them,
    // and concurrent devices can't clobber each other.
    totalSeconds: increment(input.seconds),
    sessionCount: increment(1),
    currentStreak,
    longestStreak,
    lastStudyDay: today,
  }, { merge: true });
  await batch.commit();

  return { session: { id: sessionRef.id, ...input }, profilePatch };
}

/** Profile page history. Single-field index on startedAt — no composite index needed. */
export async function fetchRecentSessions(uid: string, take = 30): Promise<StudySession[]> {
  if (!remote(uid)) {
    return lsRead<StudySession[]>(lsKey(uid, 'sessions'), []).slice(0, take);
  }
  const q = query(
    collection(db!, 'users', uid, 'sessions'),
    orderBy('startedAt', 'desc'),
    limit(take),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudySession, 'id'>) }));
}

export { emptyCourseProgress };
