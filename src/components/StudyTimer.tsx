/**
 * The top-right study timer.
 *
 * Re-renders once a second only while running; the value itself comes from
 * timestamps, so a throttled background tab or a refresh cannot desync it.
 */
import { useEffect, useState } from 'react';
import { Pause, Play, Square, Timer as TimerIcon } from 'lucide-react';
import { useTimer, formatClock, IDLE_PAUSE_MS } from '../store/useTimer';

export function StudyTimer({ compact = false }: { compact?: boolean }) {
  const running = useTimer((s) => s.running);
  const sessionStartedAt = useTimer((s) => s.sessionStartedAt);
  const elapsedSeconds = useTimer((s) => s.elapsedSeconds);
  const toggle = useTimer((s) => s.toggle);
  const stop = useTimer((s) => s.stop);

  const [, force] = useState(0);
  const active = sessionStartedAt !== null;
  const elapsed = elapsedSeconds();

  // Tick only while running.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  return (
    <div
      className={`flex items-center gap-1 rounded-xl border px-1.5 py-1 transition-colors
        ${running ? 'border-brand/45 bg-brand/[0.07]' : 'border-line bg-surface-raised'}`}
      title={running ? `Studying — auto-pauses after ${IDLE_PAUSE_MS / 60000} min in a hidden tab` : 'Study timer'}
    >
      <TimerIcon
        size={14}
        className={`ml-1.5 shrink-0 ${running ? 'animate-pulse-ring text-brand' : 'text-content-muted'}`}
      />
      <span className={`num min-w-[52px] px-1 text-sm font-semibold tabular-nums
                        ${running ? 'text-content-primary' : active ? 'text-content-secondary' : 'text-content-muted'}`}>
        {formatClock(elapsed)}
      </span>

      <button
        onClick={toggle}
        className="rounded-lg p-1.5 text-content-secondary transition-colors hover:bg-surface-sunken hover:text-content-primary"
        aria-label={running ? 'Pause study timer' : 'Start study timer'}
      >
        {running ? <Pause size={15} /> : <Play size={15} />}
      </button>

      {active && !compact && (
        <button
          onClick={() => void stop()}
          className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-surface-sunken hover:text-negative"
          aria-label="End session and save"
          title="End session and save"
        >
          <Square size={14} />
        </button>
      )}
    </div>
  );
}
