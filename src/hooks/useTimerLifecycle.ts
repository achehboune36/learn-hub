/**
 * Wires the timer to the browser lifecycle, once, at app level.
 *
 *  - hidden tab for longer than the grace period  -> auto-pause (no phantom hours)
 *  - heartbeat while running                      -> bounds what a closed tab can claim
 *  - tab closing / navigating away                -> flush pending progress writes
 *  - spacebar                                     -> start/pause
 *
 * Note it deliberately does NOT pause on unload: a refresh should not end a
 * study session. `lastSeenAt` is what keeps a genuinely abandoned tab honest.
 */
import { useEffect } from 'react';
import { useTimer, IDLE_PAUSE_MS } from '../store/useTimer';
import { useProgress } from '../store/useProgress';

export function useTimerLifecycle(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    useTimer.getState().hydrate();
    let hiddenSince: number | null = null;
    let idleCheck: ReturnType<typeof setInterval> | null = null;

    // Cheap and localStorage-only: no network, no database writes.
    const beat = setInterval(() => useTimer.getState().heartbeat(), 15_000);

    const stopIdleWatch = () => {
      if (idleCheck) { clearInterval(idleCheck); idleCheck = null; }
    };

    const onVisibility = () => {
      if (document.hidden) {
        hiddenSince = Date.now();
        idleCheck = setInterval(() => {
          if (hiddenSince && Date.now() - hiddenSince >= IDLE_PAUSE_MS && useTimer.getState().running) {
            useTimer.getState().pause();
            stopIdleWatch();
          }
        }, 30_000);
      } else {
        hiddenSince = null;
        stopIdleWatch();
      }
    };

    // Best-effort flush of pending progress writes. The timer is left running:
    // its elapsed time is derived from timestamps, so it resumes correctly on
    // the next load, and `lastSeenAt` caps what an abandoned tab can claim.
    const onHide = () => {
      void useProgress.getState().flush();
      useTimer.getState().heartbeat();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.tagName === 'BUTTON')) return;
      e.preventDefault();
      useTimer.getState().toggle();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    window.addEventListener('keydown', onKey);

    return () => {
      clearInterval(beat);
      stopIdleWatch();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      window.removeEventListener('keydown', onKey);
    };
  }, [enabled]);
}
