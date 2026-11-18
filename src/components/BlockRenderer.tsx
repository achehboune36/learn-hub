/** Renders the ordered content blocks of a chapter. */
import { Check } from 'lucide-react';
import type { Block, GlossaryTerm } from '../content/types';
import { Markdown } from './Markdown';
import { Callout } from './Callout';
import { CodeBlock } from './CodeBlock';
import { Diagram } from './Diagram';

export function BlockRenderer({ blocks, glossary }: { blocks: Block[]; glossary: GlossaryTerm[] }) {
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'markdown':
            return <Markdown key={i} glossary={glossary}>{block.md}</Markdown>;

          case 'callout':
            return <Callout key={i} variant={block.variant} title={block.title} md={block.md} glossary={glossary} />;

          case 'code':
            return <CodeBlock key={i} code={block.code} lang={block.lang} filename={block.filename} caption={block.caption} />;

          case 'diagram':
            return <Diagram key={i} src={block.src} caption={block.caption} />;

          case 'table':
            return (
              <figure key={i} className="my-6">
                <div className="overflow-x-auto rounded-2xl border border-line">
                  <table className="w-full border-collapse text-sm">
                    <thead className="bg-surface-sunken">
                      <tr>
                        {block.headers.map((h) => (
                          <th key={h} className="border-b border-line px-4 py-2.5 text-left font-semibold text-content-primary">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, r) => (
                        <tr key={r} className="even:bg-surface-sunken/40">
                          {row.map((cell, c) => (
                            <td key={c} className="border-b border-line px-4 py-2.5 align-top text-content-secondary last:border-b-0">
                              <Markdown glossary={glossary} className="[&_p]:m-0 [&_code]:font-mono [&_code]:text-[0.86em]">
                                {cell}
                              </Markdown>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {block.caption && (
                  <figcaption className="mt-2 text-center text-xs text-content-muted">{block.caption}</figcaption>
                )}
              </figure>
            );

          case 'checklist':
            return (
              <div key={i} className="my-6 rounded-2xl border border-line bg-surface-sunken p-5">
                {block.title && (
                  <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-content-muted">
                    {block.title}
                  </h4>
                )}
                <ul className="space-y-2">
                  {block.items.map((item, n) => (
                    <li key={n} className="flex items-start gap-2.5 text-sm text-content-secondary">
                      <Check size={15} className="mt-0.5 shrink-0 text-positive" />
                      <Markdown glossary={glossary} className="[&_p]:m-0 flex-1">{item}</Markdown>
                    </li>
                  ))}
                </ul>
              </div>
            );

          case 'quote':
            return (
              <blockquote key={i} className="my-6 border-l-2 border-brand/50 pl-5">
                <Markdown glossary={glossary} className="prose-chapter italic [&>*:first-child]:mt-0">
                  {block.md}
                </Markdown>
                {block.source && (
                  <cite className="mt-2 block text-xs not-italic text-content-muted">— {block.source}</cite>
                )}
              </blockquote>
            );
        }
      })}
    </>
  );
}
