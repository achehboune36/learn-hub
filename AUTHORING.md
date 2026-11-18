# Adding a course

Read this before writing course content. The site discovers courses automatically — you create
a folder, you do not register it anywhere.

```
npm run validate     # after writing. It is strict, and it is the point.
```

---

## 1. Create the folder

```
src/content/courses/<course-id>/
├── meta.ts
├── course.ts
└── chapters/
    ├── 01-<slug>.ts
    ├── 02-<slug>.ts
    └── ...
```

`<course-id>` is kebab-case and **must equal `meta.id`**. The validator enforces this.

## 2. `meta.ts`

Small and eagerly bundled — it powers the dashboard card without downloading the chapters.

```ts
import type { CourseMeta } from '../../types';

export const meta: CourseMeta = {
  id: 'kubernetes',              // === folder name
  title: 'Kubernetes',
  subtitle: 'One line. What the reader will be able to do, not what the topic is.',
  icon: 'Container',             // must exist in components/Icon.tsx
  level: 'intermediate',         // beginner | intermediate | advanced
  tags: ['containers', 'ops'],
  estimatedMinutes: 210,         // ~= sum of chapter estimates
  chapterCount: 9,               // must equal chapters.length
  accent: 'sky',                 // indigo emerald amber rose sky violet teal orange
  version: 1,                    // bump when chapters are added/removed/renamed
};
```

## 3. `course.ts`

```ts
import type { Course } from '../../types';
import { meta } from './meta';
import { chapter as intro } from './chapters/01-intro';
// ...

export const course: Course = {
  ...meta,                       // never restate these fields; they must not drift
  intro: `Markdown. Two or three paragraphs on why this subject is worth the reader's month.`,
  outcomes: [
    'Concrete capability, phrased as something the reader can do',
    // 5-8 of these
  ],
  glossary: [
    { term: 'Pod', definition: 'The smallest deployable unit...', aliases: ['Pods'] },
  ],
  chapters: [intro /* , ... */],
};
```

## 4. A chapter

```ts
import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'pods',                    // kebab-case, unique, STABLE (progress keys off it)
  title: 'Pods',
  summary: 'One or two sentences for the chapter list.',
  estimatedMinutes: 20,
  blocks: [ /* see below */ ],
  flashcards: [{ front: '...', back: '...' }],
  quiz: [ /* EXACTLY 5 */ ],
};
```

---

## Block types

````ts
{ type: 'markdown', md: `GFM. Headings, lists, tables, **bold**, \`code\`, links.` }

{ type: 'callout', variant: 'note' | 'insight' | 'warning' | 'pitfall' | 'analogy',
  title?: 'Optional override', md: `...` }

{ type: 'code', lang: 'python', filename?: 'chunking.py', caption?: '...', code: `...` }

{ type: 'diagram', kind: 'mermaid', src: `flowchart LR\n  A --> B`, caption?: '...' }

{ type: 'table', headers: ['A', 'B'], rows: [['1', '2']], caption?: '...' }   // cells are markdown

{ type: 'checklist', title?: 'Before you ship', items: ['...'] }              // items are markdown

{ type: 'quote', md: '...', source?: 'Who said it' }
````

**Registered code languages**: `python`, `typescript`, `javascript`, `bash`, `json`, `sql`,
`yaml`, plus `text` for anything else. To add one, register it in `components/CodeBlock.tsx`.

---

## Quiz rules (enforced)

- Exactly **5** questions per chapter, exactly **4** options each.
- `answerIndex` 0–3, and **vary it across the five questions** — the validator warns if every
  answer sits at the same index. (Options are also reshuffled at runtime, but the source data
  should not be degenerate.)
- `explanation` is required on every question and should **teach**, not merely confirm. Say why
  the right answer is right *and* why the tempting wrong one is wrong.
- Distractors must be plausible. An option nobody would pick tests nothing.
- Passing is 4/5, so questions should be answerable by someone who read the chapter attentively
  — not by someone who skimmed, and not only by someone who already knew the material.

---

## Writing guidance

What makes these chapters worth reading rather than skimmable:

- **Lead with the problem**, then the mechanism. A reader who knows why a thing exists retains
  how it works.
- **Name the failure modes.** The most valuable paragraphs are the ones describing what goes
  wrong in practice and how it presents. Use `pitfall` and `warning` callouts for these.
- **Give numbers.** "200–400 tokens for dense factual content" beats "choose an appropriate
  chunk size."
- **One diagram per chapter minimum**, showing the actual mechanism rather than a box labelled
  with the chapter title.
- **Code should be runnable and commented at the decision points** — comment *why*, not what.
- **Close with a checklist** the reader can act on.
- Aim for **18–26 minutes** per chapter. Longer than 30 and it should be two chapters.

---

## Escaping (the one thing that will bite you)

Chapter files are TypeScript. Content in template literals must escape:

| Character | Write it as |
|---|---|
| Backtick | `` \` `` |
| `${` | `\${` |
| Backslash | `\\` |

This matters most inside `code` blocks — a Python docstring containing a backtick, or a regex
containing `\d`, will break the build with a confusing esbuild error. Prefer single-quoted
strings for short values; use template literals only for multi-line prose.

---

## Before you finish

```bash
npm run validate    # schema, quiz rules, meta/course consistency
npm run build       # type-check + production build (validate runs first)
npm run dev         # read the chapters in the browser; look at the diagrams
```

The validator catches structural errors. It cannot tell you whether a chapter is any good —
read it in the browser before calling it done.
