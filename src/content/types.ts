/**
 * LearnHub content contract.
 *
 * Every course in `src/content/courses/<id>/` must satisfy these types AND the
 * extra rules enforced by `scripts/validate-courses.ts` (run `npm run validate`).
 * Read AUTHORING.md before adding a course.
 */

export type Level = 'beginner' | 'intermediate' | 'advanced';

/** Small, eagerly-loaded descriptor. Powers the dashboard without pulling chapters. */
export interface CourseMeta {
  /** kebab-case; MUST equal the folder name under src/content/courses/ */
  id: string;
  title: string;
  /** One line, shown under the title on the dashboard card. */
  subtitle: string;
  /** A lucide-react icon name in PascalCase, e.g. 'Database'. */
  icon: string;
  level: Level;
  tags: string[];
  /** Rough total reading time; the sum of chapter estimates. */
  estimatedMinutes: number;
  /** Number of chapters. Duplicated here so the dashboard can show progress
   *  without downloading the (much larger) course file. */
  chapterCount: number;
  /** Tailwind palette key used as the course accent: indigo | emerald | amber | rose | sky | violet | teal | orange */
  accent: Accent;
  /** Bump whenever chapters are added/removed/renamed. */
  version: number;
}

export type Accent =
  | 'indigo' | 'emerald' | 'amber' | 'rose'
  | 'sky' | 'violet' | 'teal' | 'orange';

export interface GlossaryTerm {
  term: string;
  definition: string;
  /** Other spellings that should also link to this definition. */
  aliases?: string[];
}

export interface Flashcard {
  front: string;
  back: string;
}

export interface QuizQuestion {
  /** Stable, unique within the chapter. */
  id: string;
  prompt: string;
  /** Exactly 4 options. */
  options: string[];
  /** Index into `options`, 0-3. */
  answerIndex: number;
  /** Shown after answering, whether right or wrong. Teach here, don't just confirm. */
  explanation: string;
}

export type CalloutVariant = 'note' | 'insight' | 'warning' | 'pitfall' | 'analogy';

export type Block =
  | { type: 'markdown'; md: string }
  | { type: 'callout'; variant: CalloutVariant; title?: string; md: string }
  | { type: 'code'; lang: string; filename?: string; code: string; caption?: string }
  | { type: 'diagram'; kind: 'mermaid'; src: string; caption?: string }
  | { type: 'table'; headers: string[]; rows: string[][]; caption?: string }
  | { type: 'checklist'; title?: string; items: string[] }
  | { type: 'quote'; md: string; source?: string };

export interface Chapter {
  /** kebab-case, unique within the course. Progress is keyed off this — never rename casually. */
  id: string;
  title: string;
  /** One or two sentences; shown in the chapter list. */
  summary: string;
  estimatedMinutes: number;
  blocks: Block[];
  flashcards?: Flashcard[];
  /** EXACTLY 5 questions. Enforced by the validator. */
  quiz: QuizQuestion[];
}

export interface Course extends CourseMeta {
  /** Long-form intro shown on the course landing page (markdown). */
  intro: string;
  /** What the reader can do after finishing. */
  outcomes: string[];
  glossary: GlossaryTerm[];
  chapters: Chapter[];
}

/** Score (out of 5) required to count a chapter as complete. */
export const PASS_SCORE = 4;
/** Required question count per chapter quiz. */
export const QUIZ_LENGTH = 5;
/** Required option count per question. */
export const OPTION_COUNT = 4;
