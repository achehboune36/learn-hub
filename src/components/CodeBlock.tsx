/**
 * Syntax-highlighted code with a copy button.
 *
 * Uses the "light" Prism build with only the languages courses actually use.
 * The full build registers every grammar and costs ~640 kB; this costs a
 * fraction of that. Add a language here when a course needs one.
 */
import { useState } from 'react';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Check, Copy } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('yaml', yaml);

interface Props {
  code: string;
  lang: string;
  filename?: string;
  caption?: string;
}

export function CodeBlock({ code, lang, filename, caption }: Props) {
  const { theme } = useTheme();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard blocked */ }
  };

  return (
    <figure className="my-6 overflow-hidden rounded-2xl border border-line bg-surface-sunken">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-content-muted">
          {filename ?? lang}
        </span>
        <button
          onClick={copy}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium
                     text-content-muted transition-colors hover:bg-surface-raised hover:text-content-primary"
          aria-label="Copy code"
        >
          {copied ? <Check size={13} className="text-positive" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={lang}
          style={theme === 'dark' ? oneDark : oneLight}
          customStyle={{
            margin: 0,
            padding: '1rem 1.1rem',
            background: 'transparent',
            fontSize: '13px',
            lineHeight: 1.65,
          }}
          codeTagProps={{ style: { fontFamily: 'JetBrains Mono, ui-monospace, monospace' } }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
      {caption && (
        <figcaption className="border-t border-line px-4 py-2 text-xs text-content-muted">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
