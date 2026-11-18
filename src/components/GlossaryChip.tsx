/** An inline glossary mention: dotted underline, definition on hover/focus/tap. */
import { useState, type ReactNode } from 'react';
import type { GlossaryTerm } from '../content/types';

export function GlossaryChip({ entry, children }: { entry: GlossaryTerm; children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="border-b border-dotted border-brand/70 text-content-primary hover:text-brand transition-colors"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        aria-describedby={open ? `gloss-${entry.term}` : undefined}
      >
        {children}
      </button>
      {open && (
        <span
          id={`gloss-${entry.term}`}
          role="tooltip"
          className="absolute bottom-full left-1/2 z-30 mb-2 w-72 -translate-x-1/2 rounded-xl border
                     border-line bg-surface-overlay p-3 text-left text-[13px] leading-relaxed
                     text-content-secondary shadow-pop animate-fade-up"
        >
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-brand">
            {entry.term}
          </span>
          {entry.definition}
        </span>
      )}
    </span>
  );
}
