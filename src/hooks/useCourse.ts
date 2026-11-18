/** Lazily load a course by id. The chapters chunk is fetched once and cached. */
import { useEffect, useState } from 'react';
import { loadCourse } from '../content/registry';
import type { Course } from '../content/types';

export function useCourse(id: string | undefined) {
  const [course, setCourse] = useState<Course | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    if (!id) { setState('missing'); return; }
    let cancelled = false;
    setState('loading');

    void loadCourse(id).then((c) => {
      if (cancelled) return;
      setCourse(c);
      setState(c ? 'ready' : 'missing');
    });

    return () => { cancelled = true; };
  }, [id]);

  return { course, state };
}
