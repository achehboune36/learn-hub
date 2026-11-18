/**
 * Mermaid diagram.
 *
 * Mermaid is imported lazily (it is large) and re-rendered when the theme flips
 * so diagrams never sit on the wrong background.
 */
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../hooks/useTheme';

let mermaidPromise: Promise<typeof import('mermaid').default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => m.default);
  }
  return mermaidPromise;
}

let idCounter = 0;

const DARK_VARS = {
  background: 'transparent',
  primaryColor: '#1c2030',
  primaryTextColor: '#e9ecf3',
  primaryBorderColor: '#3b4256',
  lineColor: '#5b6478',
  secondaryColor: '#232839',
  tertiaryColor: '#191d28',
  fontSize: '14px',
};

const LIGHT_VARS = {
  background: 'transparent',
  primaryColor: '#eef0fd',
  primaryTextColor: '#161a22',
  primaryBorderColor: '#c3c8f0',
  lineColor: '#8a91a6',
  secondaryColor: '#f4f5f9',
  tertiaryColor: '#fafbfc',
  fontSize: '14px',
};

export function Diagram({ src, caption }: { src: string; caption?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const mermaid = await loadMermaid();
      if (cancelled) return;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'Inter, system-ui, sans-serif',
        themeVariables: theme === 'dark' ? DARK_VARS : LIGHT_VARS,
      });

      try {
        const { svg } = await mermaid.render(`mmd-${++idCounter}`, src.trim());
        if (!cancelled && hostRef.current) hostRef.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();

    return () => { cancelled = true; };
  }, [src, theme]);

  if (error) {
    return (
      <div className="my-6 rounded-xl border border-negative/40 bg-negative/5 p-4 text-sm text-negative">
        Diagram failed to render: {error}
      </div>
    );
  }

  return (
    <figure className="my-7 overflow-hidden rounded-2xl border border-line bg-surface-sunken">
      <div ref={hostRef} className="mermaid-host flex justify-center overflow-x-auto p-5" />
      {caption && (
        <figcaption className="border-t border-line px-4 py-2 text-center text-xs text-content-muted">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
