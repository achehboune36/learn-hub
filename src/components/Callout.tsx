/** Boxed asides. Variant chooses the icon, accent and default title. */
import { Info, Lightbulb, AlertTriangle, ShieldAlert, Shapes } from 'lucide-react';
import type { CalloutVariant, GlossaryTerm } from '../content/types';
import { Markdown } from './Markdown';

const STYLES: Record<CalloutVariant, { icon: typeof Info; label: string; ring: string; tint: string; text: string }> = {
  note:    { icon: Info,          label: 'Note',     ring: 'border-brand/35',    tint: 'bg-brand/[0.06]',    text: 'text-brand' },
  insight: { icon: Lightbulb,     label: 'Insight',  ring: 'border-positive/35', tint: 'bg-positive/[0.06]', text: 'text-positive' },
  warning: { icon: AlertTriangle, label: 'Watch out', ring: 'border-caution/40', tint: 'bg-caution/[0.07]',  text: 'text-caution' },
  pitfall: { icon: ShieldAlert,   label: 'Pitfall',  ring: 'border-negative/35', tint: 'bg-negative/[0.06]', text: 'text-negative' },
  analogy: { icon: Shapes,        label: 'Analogy',  ring: 'border-line-strong', tint: 'bg-surface-sunken',  text: 'text-content-muted' },
};

export function Callout({
  variant, title, md, glossary,
}: { variant: CalloutVariant; title?: string; md: string; glossary?: GlossaryTerm[] }) {
  const s = STYLES[variant];
  const Icon = s.icon;

  return (
    <aside className={`my-6 rounded-2xl border ${s.ring} ${s.tint} p-4 sm:p-5`}>
      <div className={`mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider ${s.text}`}>
        <Icon size={14} />
        {title ?? s.label}
      </div>
      <Markdown glossary={glossary} className="prose-chapter text-[14.5px] [&>*:first-child]:mt-0">
        {md}
      </Markdown>
    </aside>
  );
}
