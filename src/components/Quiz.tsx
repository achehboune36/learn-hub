/**
 * End-of-chapter quiz: 5 questions, 4 options, immediate feedback.
 *
 * Options are shuffled per attempt so a retry tests recall rather than muscle
 * memory of position. The result is reported once, at the end, so a partially
 * finished quiz never writes to the database.
 */
import { useMemo, useState, useEffect, useCallback } from 'react';
import { Check, X, RotateCcw, Trophy, ArrowRight } from 'lucide-react';
import { PASS_SCORE, type QuizQuestion, type GlossaryTerm } from '../content/types';
import { Markdown } from './Markdown';

interface Props {
  questions: QuizQuestion[];
  glossary: GlossaryTerm[];
  bestScore: number;
  onComplete: (score: number) => void;
  onNext?: () => void;
  nextLabel?: string;
}

interface Shuffled {
  q: QuizQuestion;
  options: { text: string; correct: boolean }[];
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function Quiz({ questions, glossary, bestScore, onComplete, onNext, nextLabel }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);

  const deck = useMemo<Shuffled[]>(
    () =>
      questions.map((q) => ({
        q,
        options: shuffle(q.options.map((text, i) => ({ text, correct: i === q.answerIndex }))),
      })),
    // A new attempt reshuffles every question's options.
    [questions, attempt],
  );

  const current = deck[index];
  const answered = picked !== null;
  const isLast = index === deck.length - 1;

  const choose = useCallback((i: number) => {
    if (picked !== null) return;
    setPicked(i);
    if (deck[index].options[i].correct) setScore((s) => s + 1);
  }, [picked, deck, index]);

  const advance = useCallback(() => {
    if (picked === null) return;
    if (isLast) {
      setDone(true);
      // `score` already includes this question — choose() counted it. This is
      // the only place the quiz reports anything.
      onComplete(score);
      return;
    }
    setIndex((i) => i + 1);
    setPicked(null);
  }, [picked, isLast, score, onComplete]);

  const retry = () => {
    setAttempt((a) => a + 1);
    setIndex(0);
    setPicked(null);
    setScore(0);
    setDone(false);
  };

  // Keyboard: 1-4 answers, Enter/→ advances.
  useEffect(() => {
    if (done) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (/^[1-4]$/.test(e.key)) { choose(Number(e.key) - 1); e.preventDefault(); }
      if ((e.key === 'Enter' || e.key === 'ArrowRight') && picked !== null) { advance(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, advance, picked, done]);

  if (done) {
    const passed = score >= PASS_SCORE;
    return (
      <div className="card animate-fade-up p-7 text-center">
        <div
          className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl
                      ${passed ? 'bg-positive/12 text-positive' : 'bg-caution/12 text-caution'}`}
        >
          {passed ? <Trophy size={24} /> : <RotateCcw size={24} />}
        </div>
        <p className="num text-3xl font-semibold text-content-primary">{score} / {deck.length}</p>
        <p className="mt-2 text-sm text-content-secondary">
          {passed
            ? 'Chapter complete — that sticks. On to the next one.'
            : `You need ${PASS_SCORE} to mark this chapter complete. Skim the parts you missed and try again.`}
        </p>
        {bestScore > score && (
          <p className="mt-1 text-xs text-content-muted">Your best on this chapter is still {bestScore}/{deck.length}.</p>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <button onClick={retry} className="btn-outline">
            <RotateCcw size={14} /> Retry
          </button>
          {passed && onNext && (
            <button onClick={onNext} className="btn-primary">
              {nextLabel ?? 'Next chapter'} <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="card animate-fade-up overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <span className="text-xs font-medium uppercase tracking-wider text-content-muted">
          Question {index + 1} of {deck.length}
        </span>
        <div className="flex gap-1.5" aria-hidden>
          {deck.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-5 rounded-full transition-colors ${
                i < index ? 'bg-brand' : i === index ? 'bg-brand/50' : 'bg-line'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="mb-5 text-[15px] font-medium leading-relaxed text-content-primary">
          <Markdown glossary={glossary} className="[&_p]:m-0 [&_code]:font-mono">{current.q.prompt}</Markdown>
        </div>

        <div className="space-y-2.5">
          {current.options.map((opt, i) => {
            const chosen = picked === i;
            const reveal = answered && opt.correct;
            const wrong = chosen && !opt.correct;

            return (
              <button
                key={opt.text}
                onClick={() => choose(i)}
                disabled={answered}
                className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm
                            transition-colors disabled:cursor-default
                  ${reveal ? 'border-positive/60 bg-positive/[0.08] text-content-primary'
                    : wrong ? 'border-negative/60 bg-negative/[0.08] text-content-primary'
                    : 'border-line text-content-secondary hover:border-line-strong hover:bg-surface-sunken'}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold
                    ${reveal ? 'border-positive bg-positive text-white'
                      : wrong ? 'border-negative bg-negative text-white'
                      : 'border-line-strong text-content-muted'}`}
                >
                  {reveal ? <Check size={12} /> : wrong ? <X size={12} /> : i + 1}
                </span>
                <span className="flex-1">{opt.text}</span>
              </button>
            );
          })}
        </div>

        {answered && (
          <div className="mt-5 animate-fade-up rounded-xl border border-line bg-surface-sunken p-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
              Why
            </p>
            <Markdown glossary={glossary} className="text-sm leading-relaxed text-content-secondary [&_p]:m-0">
              {current.q.explanation}
            </Markdown>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between">
          <span className="text-xs text-content-muted">
            {answered ? 'Press Enter to continue' : 'Press 1–4 to answer'}
          </span>
          <button onClick={advance} disabled={!answered} className="btn-primary">
            {isLast ? 'See result' : 'Next'} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
