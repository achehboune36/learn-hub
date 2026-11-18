/** Compact metric card used on the dashboard and profile. */
import type { LucideProps } from 'lucide-react';

export function StatTile({
  icon: Icon, label, value, hint,
}: {
  icon: React.ComponentType<LucideProps>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card animate-fade-up p-4">
      <div className="mb-2 flex items-center gap-1.5 text-content-muted">
        <Icon size={13} />
        <span className="text-[11px] font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="num text-xl font-semibold tracking-tight text-content-primary">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-content-muted">{hint}</p>}
    </div>
  );
}
