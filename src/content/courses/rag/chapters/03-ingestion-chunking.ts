import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'ingestion-chunking',
  title: 'Ingestion and chunking',
  summary: 'Where most RAG quality is won or lost: turning messy documents into clean text, then splitting that text into units that are specific enough to find and complete enough to answer.',
  estimatedMinutes: 26,

  blocks: [
    {
      type: 'markdown',
      md: `
This is the least discussed and most decisive chapter in the course. Embedding models and
vector databases are largely commodities now; **how you cut your documents is still bespoke,
and it sets the ceiling on everything else.**

A chunk is the atomic unit of retrieval. It is what gets embedded, what gets scored, and what
gets pasted into the prompt. If the answer to a question does not sit inside a single chunk,
together with enough context to be interpretable, no amount of retrieval tuning will produce a
good answer.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'The chunking tension',
      md: `**Small chunks are specific but incomplete.** One sentence embeds to a precise point in
vector space — easy to match — but often lacks the context to be useful on its own.
**Large chunks are complete but vague.** A whole page contains the answer, but its embedding is
an average of ten topics, so it matches everything weakly and nothing strongly.
Every chunking strategy is a different answer to this trade-off.`,
    },
    {
      type: 'markdown',
      md: `
## Stage 1: ingestion, or how to not destroy your data

Before splitting, you have to extract text — and extraction is where silent damage happens.

### PDFs are not documents, they are drawing instructions
A PDF stores glyphs at coordinates. There is no notion of "paragraph", "table" or "reading
order". Naive extraction produces:

- **Tables flattened into number soup.** \`Region Revenue Q1 Q2 EMEA 4.2 5.1 APAC 3.8 4.4\` —
  the numbers survive, the relationships do not. Any question about APAC's Q2 revenue is now
  unanswerable from this text.
- **Multi-column pages interleaved**, so sentences from two columns alternate mid-clause.
- **Headers and footers repeated** every page, adding noise to every chunk.
- **Scanned pages producing nothing at all** unless you run OCR.

### Practical ingestion rules

- Prefer the structured source over the rendered one. If the PDF was generated from Markdown,
  HTML or a database, ingest *that*.
- Convert tables to Markdown tables, not free text. A Markdown table keeps the header attached
  to each row, which is exactly what makes it answerable.
- Strip boilerplate: navigation, cookie banners, repeated footers, "Page 4 of 27".
- Keep the structure you extract — heading hierarchy is the most valuable metadata you will
  ever have, and it is free at this stage.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Test your parser before your retriever',
      md: `Take five representative documents, extract their text, and *read it*. Not the metrics —
the actual text. Most teams discover their tables are destroyed only after months of blaming the
embedding model. Ingestion bugs are invisible in every downstream metric except answer quality.`,
    },
    {
      type: 'markdown',
      md: `
## Stage 2: chunking strategies

### Fixed-size
Split every N characters or tokens, with an overlap. Simple, predictable, and structure-blind:
it will happily cut a sentence in half.

### Recursive character splitting
The workhorse default. Try to split on paragraph breaks; if a piece is still too big, split on
sentences; then on words. You get chunks that respect natural boundaries where possible and
degrade gracefully where not.

### Structural / document-aware
Split on the document's own structure — Markdown headings, HTML sections, code functions,
slide boundaries. Almost always the best choice when structure exists, because a section is
already a semantically coherent unit written by a human.

### Semantic
Embed each sentence, then cut where consecutive sentences become dissimilar — a topic shift.
Elegant, expensive to compute, and in practice rarely beats good structural splitting.

### Small-to-big (parent-child)
Embed *small* chunks for precise matching, but return the *larger* parent section for context.
This resolves the core tension rather than compromising on it, and it is the strategy worth
reaching for when quality matters.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    D["Section: 'Refund policy'<br/>~2000 tokens"]
    D --> C1["child 1<br/>200 tok"]
    D --> C2["child 2<br/>200 tok"]
    D --> C3["child 3<br/>200 tok"]

    Q["Query"] -.->|"matches precisely"| C2
    C2 ==>|"but returns the parent"| D
    D ==> P["Into the prompt:<br/>full section, full context"]
`.trim(),
      caption: 'Small-to-big: match on the specific child, hand the model the complete parent.',
    },
    {
      type: 'table',
      headers: ['Strategy', 'Best for', 'Cost', 'Weakness'],
      rows: [
        ['Fixed-size', 'Prototypes, uniform plain text', 'Free', 'Cuts sentences, tables, code arbitrarily'],
        ['Recursive', 'General text, unknown structure', 'Free', 'Structure-agnostic; sections still get split'],
        ['Structural', 'Markdown, HTML, code, anything with headings', 'Cheap', 'Sections vary wildly in size; needs a size cap'],
        ['Semantic', 'Long unstructured prose (transcripts, books)', 'One embedding per sentence', 'Expensive; often no better than structural'],
        ['Small-to-big', 'Production systems that need both precision and context', 'Two-tier storage', 'More moving parts; parents can be large'],
      ],
    },
    {
      type: 'markdown',
      md: `
## Sizing: the numbers that actually matter

There is no universal chunk size, but there are defensible starting points:

- **200–400 tokens** for dense factual content — FAQs, policy clauses, API reference.
- **500–800 tokens** for explanatory prose — guides, tutorials, post-mortems.
- **Whole unit** for code (a function) and tables (never split a table).

**Overlap** of 10–20% guards the boundary case: a sentence that straddles two chunks appears
whole in at least one of them. Overlap costs storage and creates near-duplicate results, which
is one of the reasons reranking and MMR exist.

The right way to choose is empirical: build an evaluation set (Chapter 9), then try two or
three sizes. Chunk size is one of the few RAG parameters where measurement beats intuition
almost every time.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Never split a table or a code block',
      md: `Half a table is worse than no table: the model sees numbers with no headers and will
happily misattribute them. Detect tables and code fences during chunking and keep them whole,
even if that means one oversized chunk. If a table is genuinely enormous, repeat the header row
in each piece.`,
    },
    {
      type: 'markdown',
      md: `
## Contextual enrichment: the highest-leverage trick

A chunk pulled out of a document loses everything the surrounding document told you. Chunk 47
of a product manual might read, in full:

> It must be enabled by an administrator and cannot be disabled once active.

What must? This chunk is unretrievable — no query embedding will find it — and useless if
retrieved. The fix is to **prepend context at index time**:

> *Document: Acme Cloud Admin Guide — Section: Audit Logging*
> It must be enabled by an administrator and cannot be disabled once active.

Now it embeds near "audit logging" and is interpretable when read. This costs one string
concatenation and is routinely worth more than switching embedding models.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'chunking.py',
      code: `import re
from dataclasses import dataclass, field


@dataclass
class Chunk:
    text: str                                  # what gets embedded
    source: str
    heading_path: list[str] = field(default_factory=list)
    parent_id: str | None = None               # for small-to-big retrieval

    @property
    def embed_text(self) -> str:
        """Context prefix so the chunk means something on its own."""
        crumbs = " > ".join(self.heading_path)
        return f"Document: {self.source} - Section: {crumbs}\\n\\n{self.text}"


HEADING = re.compile(r"^(#{1,4})\\s+(.*)$", re.MULTILINE)
FENCE = re.compile(r"\`\`\`.*?\`\`\`", re.DOTALL)


def split_markdown(text: str, source: str, max_chars: int = 1200, overlap: int = 150) -> list[Chunk]:
    """Structural split on headings, with a size cap and paragraph-aware fallback.

    Code fences are masked out first so a size-based split can never cut through one.
    """
    fences: list[str] = []

    def mask(m: re.Match) -> str:
        fences.append(m.group(0))
        return f"\\x00FENCE{len(fences) - 1}\\x00"

    def unmask(s: str) -> str:
        return re.sub(r"\\x00FENCE(\\d+)\\x00", lambda m: fences[int(m.group(1))], s)

    masked = FENCE.sub(mask, text)

    # Walk headings, tracking the heading path so each section knows where it sits.
    sections: list[tuple[list[str], str]] = []
    path: list[str] = []
    cursor = 0
    for m in HEADING.finditer(masked):
        body = masked[cursor:m.start()].strip()
        if body:
            sections.append((path.copy(), body))
        level, title = len(m.group(1)), m.group(2).strip()
        path = path[: level - 1] + [title]
        cursor = m.end()
    tail = masked[cursor:].strip()
    if tail:
        sections.append((path.copy(), tail))

    chunks: list[Chunk] = []
    for heading_path, body in sections:
        body = unmask(body)
        if len(body) <= max_chars:
            chunks.append(Chunk(body, source, heading_path))
            continue

        # Section too large: fall back to paragraph packing with overlap.
        buf = ""
        for para in body.split("\\n\\n"):
            if len(buf) + len(para) + 2 > max_chars and buf:
                chunks.append(Chunk(buf.strip(), source, heading_path))
                buf = buf[-overlap:] + "\\n\\n"        # carry a tail forward
            buf += para + "\\n\\n"
        if buf.strip():
            chunks.append(Chunk(buf.strip(), source, heading_path))

    return chunks`,
      caption: 'Structural first, size cap second, overlap only where the fallback kicks in.',
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'Metadata is retrieval infrastructure, not decoration',
      md: `Capture source, heading path, document type, author, and — critically — **dates**, at
ingestion. Metadata lets you filter before you search ("only current policy documents"), which
is both faster and more accurate than hoping the embedding sorts it out. You cannot add
metadata later without re-indexing, so over-collect now.`,
    },
    {
      type: 'checklist',
      title: 'Chunking review',
      items: [
        'Read the extracted text of five real documents with your own eyes',
        'Tables converted to Markdown, never flattened; never split across chunks',
        'Split on structure where structure exists; size cap as the fallback',
        '10–20% overlap on the size-based fallback path',
        'Every chunk prefixed with its document and heading path before embedding',
        'Source, section, type and date captured as metadata for pre-filtering',
        'Chunk size chosen by measurement on an eval set, not by copying a tutorial default',
      ],
    },
  ],

  flashcards: [
    { front: 'State the chunking tension in one line.', back: 'Small chunks are specific but incomplete; large chunks are complete but vague. Every strategy is a different resolution of that trade-off.' },
    { front: 'What is small-to-big (parent-child) retrieval?', back: 'Embed small chunks for precise matching, but return the larger parent section as context. It resolves the size tension instead of compromising on it.' },
    { front: 'What is contextual enrichment and why does it matter so much?', back: 'Prepending the document title and heading path to each chunk before embedding. It makes otherwise-orphaned chunks ("It must be enabled by an administrator...") both retrievable and interpretable, for the cost of a string concatenation.' },
    { front: 'Why is a naively parsed PDF table dangerous?', back: 'Extraction flattens it into a stream of numbers with no headers. The values survive but the relationships do not, so any question about a specific cell becomes unanswerable — and no downstream metric reveals this.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your chunks are single sentences. Retrieval matches well but answers are incomplete and lack context. Which strategy addresses this most directly?',
      options: [
        'Small-to-big: keep embedding the small chunks, but return their parent section',
        'Increase top-k from 5 to 50',
        'Switch to a larger embedding model',
        'Remove chunk overlap to reduce duplicates',
      ],
      answerIndex: 0,
      explanation: 'The precision of small-chunk matching is working — do not throw it away. Small-to-big keeps the precise match and hands the model the complete parent section. Raising top-k would return more fragments, not more complete ones, and a bigger embedding model does nothing about missing context.',
    },
    {
      id: 'q2',
      prompt: 'Why prepend the document title and heading path to a chunk before embedding it?',
      options: [
        'It prevents chunks from exceeding the model\'s input limit',
        'Otherwise a chunk full of pronouns ("It must be enabled by...") is neither retrievable nor interpretable',
        'It reduces the number of tokens that need embedding',
        'Embedding models require a title field',
      ],
      answerIndex: 1,
      explanation: 'A chunk lifted out of a document loses everything its surroundings supplied. Prefixing the heading path restores the subject, so the chunk lands near the right region of vector space and makes sense when read. It is one of the cheapest large wins available.',
    },
    {
      id: 'q3',
      prompt: 'You are indexing a financial report with many tables. What is the most important rule?',
      options: [
        'Strip tables entirely and index only the prose',
        'Increase overlap to 50% so table rows always appear twice',
        'Convert tables to Markdown and never split one across chunks',
        'Use the smallest chunk size possible so each number is precise',
      ],
      answerIndex: 2,
      explanation: 'Half a table is worse than none: the model sees numbers detached from their headers and misattributes them confidently. Markdown keeps the header row bound to the data, and keeping the table whole preserves the row/column relationships that make it answerable at all.',
    },
    {
      id: 'q4',
      prompt: 'What is chunk overlap for?',
      options: [
        'To increase the total number of chunks and therefore recall',
        'To let the embedding model see each chunk twice for stability',
        'To reduce storage by deduplicating repeated text',
        'So a sentence spanning a chunk boundary still appears whole in at least one chunk',
      ],
      answerIndex: 3,
      explanation: 'Overlap is boundary insurance. It costs storage and produces near-duplicate results — which is part of why reranking and MMR exist downstream. Note it only matters on the size-based fallback path: a clean structural split rarely needs it.',
    },
    {
      id: 'q5',
      prompt: 'Which of these should be captured at ingestion time rather than added later?',
      options: [
        'Metadata such as source, heading path, document type and date',
        'The embedding vectors, which can always be recomputed cheaply',
        'The reranker scores for common queries',
        'The final answer text for frequently asked questions',
      ],
      answerIndex: 0,
      explanation: 'Metadata enables pre-filtering — restricting the search to current policy documents, say — which is both faster and more accurate than hoping similarity sorts it out. Adding it later means re-indexing the whole corpus, so over-collect while the documents are open in front of you.',
    },
  ],
};
