# LearnHub — architecture

A single-page learning site. Course content lives **in the repo**; a learner's progress and
study sessions live **in Firestore**. That split is the central design decision and everything
else follows from it.

---

## 1. The content/state split

| Data | Where | Why |
|---|---|---|
| Course text, code, diagrams, quizzes | `src/content/courses/<id>/` (TypeScript) | Zero database reads, versioned in git, reviewable in a diff, type-checked at build time |
| Chapter read flags, quiz scores | `users/{uid}/progress/{courseId}` | One small document per course |
| Study-timer sessions | `users/{uid}/sessions/{id}` | Append-only log |
| Totals, streak, identity | `users/{uid}` | Counters updated with `increment()` |

Consequence: **reading a chapter costs nothing.** The content is already in the JS bundle.
A full app session costs roughly `1 + N` document reads (profile + one per started course),
which is why this runs indefinitely on the Firebase free tier.

---

## 2. Directory map

```
src/
├── content/
│   ├── types.ts          The contract. Course / Chapter / Block / QuizQuestion.
│   ├── registry.ts       Auto-discovery via import.meta.glob. No list to maintain.
│   └── courses/<id>/
│       ├── meta.ts       Eager: dashboard card data. Small.
│       ├── course.ts     Lazy: intro, outcomes, glossary, chapter imports.
│       └── chapters/*.ts One file per chapter.
│
├── lib/
│   ├── firebase.ts       SDK init. Falls back to local mode when unconfigured.
│   ├── model.ts          Persisted shapes + day/streak helpers.
│   ├── repo.ts           All reads and writes. Firestore or localStorage.
│   └── stats.ts          Derived numbers (completion ratio, activity buckets).
│
├── store/                Zustand
│   ├── useAuth.ts        Google sign-in, or a stable local: identity.
│   ├── useProgress.ts    Progress + profile. Loaded once, written debounced.
│   └── useTimer.ts       Timestamp-driven study clock.
│
├── hooks/                useTheme · useCourse · useTimerLifecycle
├── components/           Renderers (Markdown, Callout, CodeBlock, Diagram, Quiz…) + chrome
└── pages/                Dashboard · CoursePage · ChapterPage · Profile · SignIn
```

---

## 3. Data model

```
users/{uid}
  displayName, photoURL, email, createdAt
  totalSeconds, sessionCount
  currentStreak, longestStreak, lastStudyDay   // 'YYYY-MM-DD', local time

users/{uid}/progress/{courseId}
  courseId, courseVersion, lastChapterId
  secondsSpent, startedAt, completedAt, updatedAt
  chapters: {
    [chapterId]: { read, readAt, quizBest, quizAttempts, quizPassedAt }
  }

users/{uid}/sessions/{autoId}
  startedAt, endedAt, seconds, courseId, chapterId
```

A chapter counts as **complete** when `read && quizBest >= PASS_SCORE` (4 of 5). Course
progress is `completedChapters / totalChapters`.

---

## 4. Query budget

Every design choice here exists to keep the free tier comfortable (50k reads / 20k writes per
day).

**Reads**
- App start: `getDoc(users/{uid})` + `getDocs(users/{uid}/progress)` — `1 + N`, once per session.
- Session history: `orderBy('startedAt','desc').limit(30)` on sessions, fetched **once** per
  app session via `ensureSessions()` and shared by the dashboard's activity strip and the
  profile page. Single-field index, so `firestore.indexes.json` stays empty — no composite
  indexes to deploy.
- Chapter navigation, quizzes, timer ticks: **zero**. Everything is served from the Zustand
  store.
- IndexedDB persistence is enabled, so a repeat load on the same browser is served from cache.

**Writes**
- Progress: one `setDoc(..., { merge: true })` per course, debounced 2.5 s in `useProgress`.
  Reading five chapters in a row collapses into a handful of writes, not thirty.
- Timer: **nothing while running.** On stop, one `writeBatch` — a session document plus an
  `increment()` on the profile counters. Two writes per study session, atomic, no read first.
- Identity fields are written back only when they actually changed (`syncIdentity`).

A heavy day of studying costs on the order of 100 reads and 50 writes.

---

## 5. The study timer

`src/store/useTimer.ts` never counts intervals. It stores `segmentStartedAt` and `banked`
seconds, deriving elapsed time from `Date.now()`. Consequences:

- A throttled background tab cannot desync it.
- A page refresh mid-session resumes exactly where it was (state is mirrored to `localStorage`).
- A session left paused for over 30 minutes is banked on next load rather than silently resumed.
- Hidden tab for more than 10 minutes auto-pauses (`useTimerLifecycle`).
- Sessions under 20 seconds are discarded as noise.

Time is attributed to whichever course/chapter is on screen when the session ends.

---

## 6. Rendering

`BlockRenderer` walks `chapter.blocks` and dispatches on `type`. Adding a block type means
extending the union in `types.ts`, adding a case here, and adding validation in
`scripts/validate-courses.ts`.

`Markdown` runs a small rehype pass that wraps the first two mentions of each glossary term in
a hover-definition chip, skipping code, links and headings.

`Diagram` imports mermaid dynamically and re-renders on theme change.

**Bundle discipline** (measured, not assumed):
- Routes are `React.lazy` — the markdown renderer and highlighter load with the chapter page.
- Courses are `import.meta.glob`'d lazily — a course downloads when opened.
- Mermaid and its diagram grammars split into on-demand chunks.
- `CodeBlock` registers only the Prism languages courses use; the full build costs ~640 kB.
- `Icon.tsx` is a curated map — `import * as icons from 'lucide-react'` costs over a megabyte.

Initial load is ~190 kB gzipped, most of it the Firebase SDK.

---

## 7. Auth and local mode

With `VITE_FIREBASE_*` set (committed in `.env.local`; the repo is private and these values are
public by design anyway): Google sign-in, progress synced across devices.
Without: a stable `local:<id>` identity, everything in `localStorage`, the app fully usable.

`lib/repo.ts` dispatches on the uid prefix, so no page or store knows which backend it is on.
Local progress is **not** migrated on sign-in — merging two histories silently would be worse
than not merging them.

---

## 8. Security

`firestore.rules` allows a user to touch only `users/{uid}` and its subcollections. Sessions
are create-only; the profile cannot be deleted. Field allow-lists prevent a compromised client
from writing arbitrary documents.

Quiz answer keys ship in the JS bundle. Anyone determined can read them — which is fine, since
this is a personal learning tool and the only person cheated would be the learner.

---

## 9. Extending it

- **New block type** → `types.ts` union → `BlockRenderer` case → validator rule.
- **New course** → see `AUTHORING.md`. Create a folder; nothing central to edit.
- **New course icon** → add it to the map in `components/Icon.tsx`.
- **New accent colour** → `ACCENT_CLASSES` in `Icon.tsx` and the `Accent` union in `types.ts`
  (Tailwind needs the class names to appear literally, so they cannot be interpolated).
