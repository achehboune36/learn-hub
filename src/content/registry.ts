/**
 * Course auto-discovery.
 *
 * Adding a course means creating `src/content/courses/<id>/{meta,course}.ts` —
 * there is no list to edit here. `meta.ts` is bundled eagerly (tiny, needed for
 * the dashboard); `course.ts` is code-split and only fetched when the reader
 * opens that course.
 */
import type { Course, CourseMeta } from './types';

const metaModules = import.meta.glob<{ meta: CourseMeta }>('./courses/*/meta.ts', { eager: true });
const courseModules = import.meta.glob<{ course: Course }>('./courses/*/course.ts');

function folderOf(path: string): string {
  return path.split('/')[2];
}

export const courseMetas: CourseMeta[] = Object.entries(metaModules)
  .map(([path, mod]) => {
    const folder = folderOf(path);
    if (mod.meta.id !== folder) {
      throw new Error(`Course id "${mod.meta.id}" does not match folder "${folder}"`);
    }
    return mod.meta;
  })
  .sort((a, b) => a.title.localeCompare(b.title));

export function getCourseMeta(id: string): CourseMeta | undefined {
  return courseMetas.find((m) => m.id === id);
}

const loaded = new Map<string, Course>();

/** Lazily import a full course (chapters included). Cached after first load. */
export async function loadCourse(id: string): Promise<Course | null> {
  const cached = loaded.get(id);
  if (cached) return cached;

  const entry = Object.entries(courseModules).find(([path]) => folderOf(path) === id);
  if (!entry) return null;

  const mod = await entry[1]();
  loaded.set(id, mod.course);
  return mod.course;
}
