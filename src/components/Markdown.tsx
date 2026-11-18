/**
 * Markdown renderer for chapter prose.
 *
 * Beyond GFM it does one extra thing: it links glossary terms inline. A small
 * rehype pass walks the rendered tree and wraps the first couple of mentions of
 * each known term, skipping code, links and headings so definitions never leak
 * into places where they would be wrong.
 */
import { memo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { GlossaryTerm } from '../content/types';
import { GlossaryChip } from './GlossaryChip';

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const SKIP_TAGS = new Set(['code', 'pre', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const MAX_MARKS_PER_TERM = 2;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** rehype plugin factory: wrap glossary mentions in <span data-glossary="term">. */
function glossaryPlugin(terms: GlossaryTerm[]) {
  if (terms.length === 0) return () => (tree: HastNode) => tree;

  // Longest first so "vector database" wins over "vector".
  const entries = terms
    .flatMap((t) => [t.term, ...(t.aliases ?? [])].map((label) => ({ label, canonical: t.term })))
    .sort((a, b) => b.label.length - a.label.length);

  const pattern = new RegExp(`\\b(${entries.map((e) => escapeRegExp(e.label)).join('|')})\\b`, 'gi');
  const lookup = new Map(entries.map((e) => [e.label.toLowerCase(), e.canonical]));

  return () => (tree: HastNode) => {
    const counts = new Map<string, number>();

    const walk = (node: HastNode) => {
      if (!node.children) return;
      const out: HastNode[] = [];

      for (const child of node.children) {
        if (child.type === 'element') {
          if (!SKIP_TAGS.has(child.tagName ?? '')) walk(child);
          out.push(child);
          continue;
        }
        if (child.type !== 'text' || !child.value) { out.push(child); continue; }

        pattern.lastIndex = 0;
        let last = 0;
        let match: RegExpExecArray | null;
        let touched = false;

        while ((match = pattern.exec(child.value)) !== null) {
          const canonical = lookup.get(match[0].toLowerCase());
          if (!canonical) continue;
          const seen = counts.get(canonical) ?? 0;
          if (seen >= MAX_MARKS_PER_TERM) continue;
          counts.set(canonical, seen + 1);
          touched = true;

          if (match.index > last) {
            out.push({ type: 'text', value: child.value.slice(last, match.index) });
          }
          out.push({
            type: 'element',
            tagName: 'span',
            properties: { 'data-glossary': canonical },
            children: [{ type: 'text', value: match[0] }],
          });
          last = match.index + match[0].length;
        }

        if (touched) {
          if (last < child.value.length) out.push({ type: 'text', value: child.value.slice(last) });
        } else {
          out.push(child);
        }
      }

      node.children = out;
    };

    walk(tree);
    return tree;
  };
}

interface Props {
  children: string;
  glossary?: GlossaryTerm[];
  className?: string;
}

export const Markdown = memo(function Markdown({ children, glossary = [], className }: Props) {
  const components: Components = {
    span: ({ node, children: kids, ...props }) => {
      const term = (props as Record<string, unknown>)['data-glossary'] as string | undefined;
      void node;
      if (term) {
        const entry = glossary.find((g) => g.term === term);
        if (entry) return <GlossaryChip entry={entry}>{kids as ReactNode}</GlossaryChip>;
      }
      return <span {...props}>{kids}</span>;
    },
    a: ({ node, ...props }) => {
      void node;
      return <a {...props} target="_blank" rel="noreferrer noopener" />;
    },
    table: ({ node, ...props }) => {
      void node;
      return (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table {...props} />
        </div>
      );
    },
  };

  return (
    <div className={className ?? 'prose-chapter'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[glossaryPlugin(glossary)]}
        components={components}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
