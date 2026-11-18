/** Optional per-chapter recall deck. Click or press space to flip, arrows to move. */
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { Flashcard } from '../content/types';
import { Markdown } from './Markdown';

export function Flashcards({ cards }: { cards: Flashcard[] }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const go = (delta: number) => {
    setFlipped(false);
    setI((n) => (n + delta + cards.length) % cards.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (cards.length === 0) return null;
  const card = cards[i];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="text-xs font-medium uppercase tracking-wider text-content-muted">
          Recall cards
        </span>
        <span className="num text-xs text-content-muted">{i + 1} / {cards.length}</span>
      </div>

      <button
        onClick={() => setFlipped((f) => !f)}
        className="flex min-h-[168px] w-full flex-col items-center justify-center gap-3 px-6 py-8 text-center
                   transition-colors hover:bg-surface-sunken"
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest text-content-muted">
          {flipped ? 'Answer' : 'Prompt'}
        </span>
        <Markdown className={`max-w-xl ${flipped ? 'text-[15px] text-content-secondary' : 'text-lg font-medium text-content-primary'} [&_p]:m-0`}>
          {flipped ? card.back : card.front}
        </Markdown>
        {!flipped && (
          <span className="mt-1 flex items-center gap-1.5 text-xs text-content-muted">
            <RefreshCw size={12} /> Click to reveal
          </span>
        )}
      </button>

      <div className="flex items-center justify-between border-t border-line px-3 py-2">
        <button onClick={() => go(-1)} className="btn-ghost" aria-label="Previous card">
          <ChevronLeft size={16} />
        </button>
        <div className="flex gap-1" aria-hidden>
          {cards.map((_, n) => (
            <span key={n} className={`h-1.5 w-1.5 rounded-full ${n === i ? 'bg-brand' : 'bg-line-strong'}`} />
          ))}
        </div>
        <button onClick={() => go(1)} className="btn-ghost" aria-label="Next card">
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
