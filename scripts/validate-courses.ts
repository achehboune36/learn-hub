/**
 * Course validator — runs on `npm run validate` and as a prebuild step.
 *
 * The app trusts course content completely (it is bundled, never fetched), so
 * this script is the only guard against a malformed course shipping. It fails
 * loudly with file-scoped messages rather than throwing at runtime in the UI.
 */
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Course, Block } from '../src/content/types.ts';
import { QUIZ_LENGTH, OPTION_COUNT } from '../src/content/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COURSES_DIR = join(ROOT, 'src/content/courses');

const ACCENTS = ['indigo', 'emerald', 'amber', 'rose', 'sky', 'violet', 'teal', 'orange'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const BLOCK_TYPES = ['markdown', 'callout', 'code', 'diagram', 'table', 'checklist', 'quote'];
const CALLOUT_VARIANTS = ['note', 'insight', 'warning', 'pitfall', 'analogy'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const errors: string[] = [];
const warnings: string[] = [];

function err(where: string, msg: string) { errors.push(`${where}: ${msg}`); }
function warn(where: string, msg: string) { warnings.push(`${where}: ${msg}`); }

function validateBlock(where: string, block: Block, i: number) {
  const at = `${where} block[${i}]`;
  if (!block || typeof block !== 'object' || !('type' in block)) {
    return err(at, 'block must be an object with a "type"');
  }
  if (!BLOCK_TYPES.includes(block.type)) {
    return err(at, `unknown block type "${block.type}" (expected one of ${BLOCK_TYPES.join(', ')})`);
  }
  switch (block.type) {
    case 'markdown':
      if (!block.md?.trim()) err(at, 'markdown block is empty');
      break;
    case 'callout':
      if (!block.md?.trim()) err(at, 'callout has no body');
      if (!CALLOUT_VARIANTS.includes(block.variant)) {
        err(at, `callout variant "${block.variant}" is not one of ${CALLOUT_VARIANTS.join(', ')}`);
      }
      break;
    case 'code':
      if (!block.code?.trim()) err(at, 'code block is empty');
      if (!block.lang?.trim()) err(at, 'code block needs a "lang"');
      break;
    case 'diagram':
      if (block.kind !== 'mermaid') err(at, `diagram kind "${block.kind}" is unsupported`);
      if (!block.src?.trim()) err(at, 'diagram has no source');
      break;
    case 'table':
      if (!block.headers?.length) err(at, 'table has no headers');
      block.rows?.forEach((row, r) => {
        if (row.length !== block.headers.length) {
          err(at, `table row ${r} has ${row.length} cells, expected ${block.headers.length}`);
        }
      });
      break;
    case 'checklist':
      if (!block.items?.length) err(at, 'checklist has no items');
      break;
    case 'quote':
      if (!block.md?.trim()) err(at, 'quote is empty');
      break;
  }
}

function validateCourse(folder: string, course: Course) {
  const C = `[${folder}]`;

  if (course.id !== folder) err(C, `course.id "${course.id}" must equal folder name "${folder}"`);
  if (!KEBAB.test(course.id)) err(C, `course.id "${course.id}" must be kebab-case`);
  if (!course.title?.trim()) err(C, 'missing title');
  if (!course.subtitle?.trim()) err(C, 'missing subtitle');
  if (!course.icon?.trim()) err(C, 'missing icon (a lucide-react icon name)');
  if (!course.intro?.trim()) err(C, 'missing intro');
  if (!LEVELS.includes(course.level)) err(C, `level "${course.level}" is not one of ${LEVELS.join(', ')}`);
  if (!ACCENTS.includes(course.accent)) err(C, `accent "${course.accent}" is not one of ${ACCENTS.join(', ')}`);
  if (!Number.isInteger(course.version) || course.version < 1) err(C, 'version must be an integer >= 1');
  if (!course.outcomes?.length) err(C, 'needs at least one entry in outcomes');
  if (!course.tags?.length) warn(C, 'has no tags');
  if (!course.chapters?.length) return err(C, 'has no chapters');

  // Glossary
  const terms = new Set<string>();
  for (const g of course.glossary ?? []) {
    const key = g.term.toLowerCase();
    if (terms.has(key)) err(C, `glossary term "${g.term}" is defined more than once`);
    terms.add(key);
    for (const alias of g.aliases ?? []) {
      const a = alias.toLowerCase();
      if (terms.has(a)) err(C, `glossary alias "${alias}" collides with another term`);
      terms.add(a);
    }
    if (!g.definition?.trim()) err(C, `glossary term "${g.term}" has no definition`);
  }

  // Chapters
  const chapterIds = new Set<string>();
  let estimateSum = 0;

  course.chapters.forEach((ch, ci) => {
    const CH = `${C} chapter[${ci}] "${ch.id ?? '??'}"`;
    if (!ch.id || !KEBAB.test(ch.id)) err(CH, 'chapter id must be kebab-case');
    if (chapterIds.has(ch.id)) err(CH, 'duplicate chapter id');
    chapterIds.add(ch.id);
    if (!ch.title?.trim()) err(CH, 'missing title');
    if (!ch.summary?.trim()) err(CH, 'missing summary');
    if (!ch.estimatedMinutes || ch.estimatedMinutes < 1) err(CH, 'estimatedMinutes must be >= 1');
    estimateSum += ch.estimatedMinutes ?? 0;

    if (!ch.blocks?.length) err(CH, 'has no content blocks');
    ch.blocks?.forEach((b, bi) => validateBlock(CH, b, bi));

    ch.flashcards?.forEach((f, fi) => {
      if (!f.front?.trim() || !f.back?.trim()) err(CH, `flashcard[${fi}] needs both front and back`);
    });

    // Quiz — the strictest part of the contract.
    if (!Array.isArray(ch.quiz) || ch.quiz.length !== QUIZ_LENGTH) {
      err(CH, `quiz must have exactly ${QUIZ_LENGTH} questions (found ${ch.quiz?.length ?? 0})`);
    }
    const qIds = new Set<string>();
    ch.quiz?.forEach((q, qi) => {
      const Q = `${CH} q[${qi}]`;
      if (!q.id?.trim()) err(Q, 'question needs an id');
      if (qIds.has(q.id)) err(Q, `duplicate question id "${q.id}"`);
      qIds.add(q.id);
      if (!q.prompt?.trim()) err(Q, 'question has no prompt');
      if (!Array.isArray(q.options) || q.options.length !== OPTION_COUNT) {
        err(Q, `must have exactly ${OPTION_COUNT} options (found ${q.options?.length ?? 0})`);
      }
      if (new Set(q.options ?? []).size !== (q.options?.length ?? 0)) {
        err(Q, 'options contain duplicates');
      }
      if (q.options?.some((o) => !o?.trim())) err(Q, 'has an empty option');
      if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= OPTION_COUNT) {
        err(Q, `answerIndex ${q.answerIndex} is out of range 0-${OPTION_COUNT - 1}`);
      }
      if (!q.explanation?.trim()) err(Q, 'explanation is required — teach, do not just confirm');
    });

    // A quiz where every answer sits at the same index is a tell, not a test.
    const spread = new Set(ch.quiz?.map((q) => q.answerIndex) ?? []);
    if (spread.size === 1 && (ch.quiz?.length ?? 0) > 1) {
      warn(CH, 'every correct answer is at the same index — vary answerIndex');
    }
  });

  const drift = Math.abs(estimateSum - course.estimatedMinutes);
  if (drift > Math.max(5, estimateSum * 0.15)) {
    warn(C, `estimatedMinutes (${course.estimatedMinutes}) is far from the chapter sum (${estimateSum})`);
  }
}

async function main() {
  if (!existsSync(COURSES_DIR)) {
    console.error(`No courses directory at ${COURSES_DIR}`);
    process.exit(1);
  }

  const folders = readdirSync(COURSES_DIR).filter((f: string) => statSync(join(COURSES_DIR, f)).isDirectory());
  if (folders.length === 0) {
    console.error('No courses found.');
    process.exit(1);
  }

  const ids = new Set<string>();

  for (const folder of folders) {
    const metaPath = join(COURSES_DIR, folder, 'meta.ts');
    const coursePath = join(COURSES_DIR, folder, 'course.ts');
    if (!existsSync(metaPath)) { err(`[${folder}]`, 'missing meta.ts'); continue; }
    if (!existsSync(coursePath)) { err(`[${folder}]`, 'missing course.ts'); continue; }

    const metaMod = await import(pathToFileURL(metaPath).href);
    const courseMod = await import(pathToFileURL(coursePath).href);

    if (!metaMod.meta) { err(`[${folder}]`, 'meta.ts must export `meta`'); continue; }
    if (!courseMod.course) { err(`[${folder}]`, 'course.ts must export `course`'); continue; }

    if (ids.has(metaMod.meta.id)) err(`[${folder}]`, `duplicate course id "${metaMod.meta.id}"`);
    ids.add(metaMod.meta.id);

    // meta.ts and course.ts must not disagree — the dashboard reads one, the
    // course page the other.
    if (metaMod.meta.chapterCount !== courseMod.course.chapters?.length) {
      err(`[${folder}]`, `meta.chapterCount (${metaMod.meta.chapterCount}) != actual chapter count (${courseMod.course.chapters?.length ?? 0})`);
    }

    for (const key of ['id', 'title', 'subtitle', 'icon', 'level', 'accent', 'version', 'estimatedMinutes'] as const) {
      if (JSON.stringify(metaMod.meta[key]) !== JSON.stringify(courseMod.course[key])) {
        err(`[${folder}]`, `meta.${key} (${JSON.stringify(metaMod.meta[key])}) != course.${key} (${JSON.stringify(courseMod.course[key])})`);
      }
    }

    validateCourse(folder, courseMod.course as Course);
  }

  const total = folders.length;
  for (const w of warnings) console.warn(`  warn  ${w}`);

  if (errors.length) {
    console.error(`\n✗ ${errors.length} problem(s) across ${total} course(s):\n`);
    for (const e of errors) console.error(`  error  ${e}`);
    console.error('');
    process.exit(1);
  }

  console.log(`✓ ${total} course(s) valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}`);
}

main().catch((e) => {
  console.error('Validator crashed:', e);
  process.exit(1);
});
