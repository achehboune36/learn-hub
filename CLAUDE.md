# LearnHub — working notes for Claude

A personal learning site. **Courses are written as code in this repo**; a learner's progress and
study sessions live in Firestore. Read `ARCHITECTURE.md` for how it fits together and
`AUTHORING.md` before writing any course content.

## The one thing to know

Course content is bundled into the JS build, not stored in the database. That is deliberate:
reading a chapter costs **zero** Firestore reads, which is what keeps this inside the free tier.
Never move course content into Firestore.

## Adding a course (the common task)

1. Read `AUTHORING.md` in full — it has the schema, the block types, the quiz rules and the
   escaping gotchas.
2. Create `src/content/courses/<id>/` with `meta.ts`, `course.ts` and `chapters/NN-slug.ts`.
   There is **no registry to edit** — `import.meta.glob` discovers it.
3. `npm run validate` — strict, and the point. It enforces exactly 5 questions per chapter,
   4 options each, a valid `answerIndex`, a required `explanation`, and `meta`/`course` agreement.
4. Read the result in the browser. The validator checks structure, not quality.

Chapters run 18–26 minutes. Every chapter needs at least one mermaid diagram, flashcards, and a
closing checklist. Lead with the problem, name the real failure modes, give concrete numbers.

## Commands

```bash
npm run dev        # http://localhost:5173
npm run validate   # course contract check
npm run build      # validate + typecheck + build
npm run deploy     # build + firebase deploy   (live: https://learnhub-35520.web.app)
```

## Setup on a new machine

`npm install` and go — `.env.local` is committed (the repo is private, and the Firebase web
config in it is public by design: it ships in the client bundle). Without it the app still runs,
in local mode, storing progress in the browser.

The Firebase CLI lives at `~/.firebase-cli` (isolated install — `firebase-tools` v13 conflicts
with this project's `firebase` SDK over an ESM-only `uuid`, and v14 needs Node 20).

## Gotchas that have already bitten

- **Backticks and `${` inside chapter template literals must be escaped.** A Python docstring
  containing a backtick breaks the build with a confusing esbuild error.
- **Never `import * as icons from 'lucide-react'`** — it pulls ~1,500 icons (>1 MB) into the
  eager bundle. `components/Icon.tsx` is a curated map on purpose.
- **Tailwind cannot see interpolated class names.** Accent colours are spelled out literally in
  `ACCENT_CLASSES`.
- **Firebase Hosting header rules match the request path, not the rewritten file.** A rule on
  `/index.html` does not cover `/course/rag/embeddings`.
- **Chapter ids are progress keys.** Renaming one orphans a learner's completion record.
