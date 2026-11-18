/** Linear and circular progress indicators, both driven by a 0..1 value. */

export function ProgressBar({
  value, className = '', showLabel = false, height = 'h-1.5',
}: { value: number; className?: string; showLabel?: boolean; height?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className={`relative flex-1 overflow-hidden rounded-full bg-surface-sunken ${height}`}>
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {showLabel && <span className="num shrink-0 text-xs font-medium text-content-secondary">{pct}%</span>}
    </div>
  );
}

export function ProgressRing({
  value, size = 44, stroke = 4, children,
}: { value: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const pct = Math.min(1, Math.max(0, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
                className="stroke-surface-sunken" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className="stroke-brand transition-[stroke-dashoffset] duration-700 ease-out"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <span className="num absolute text-[11px] font-semibold text-content-primary">
        {children ?? `${Math.round(pct * 100)}%`}
      </span>
    </div>
  );
}
