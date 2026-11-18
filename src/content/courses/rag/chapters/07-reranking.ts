import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'reranking',
  title: 'Reranking and context assembly',
  summary: 'Cross-encoders fix what fast retrieval got wrong, MMR removes near-duplicates, and where you place a chunk in the prompt changes whether the model uses it.',
  estimatedMinutes: 22,

  blocks: [
    {
      type: 'markdown',
      md: `
First-stage retrieval is fast because it never actually compares the query to the document. It
compares two vectors that were computed **independently** — the document's embedding was made
months ago, in complete ignorance of your question.

That independence is what makes it scalable and what makes it imprecise. A reranker gives up
the independence to get the precision back.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Bi-encoders versus cross-encoders

**Bi-encoder** (first-stage retrieval): embed query and document separately, compare vectors.
Document embeddings are pre-computed, so searching a million chunks is one matrix multiply.
Fast, and blind to interaction between the two texts.

**Cross-encoder** (reranker): feed \`[query] [SEP] [document]\` through a transformer *together*
and output a single relevance score. Every token of the query can attend to every token of the
document. Far more accurate — and impossible to pre-compute, because the score does not exist
until the query arrives.

The cost difference is the whole story: a bi-encoder scores a million chunks in milliseconds;
a cross-encoder scores about 50 in the same time. So you use each where it belongs.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    subgraph BI["Bi-encoder - pre-computable, fast, imprecise"]
        Q1["query"] --> E1["encoder"] --> V1["vector"]
        D1["document"] --> E2["encoder"] --> V2["vector<br/><i>computed offline</i>"]
        V1 --> S1["cosine"]
        V2 --> S1
    end

    subgraph CROSS["Cross-encoder - per-query, slow, precise"]
        Q2["query"] --> J["[query] SEP [document]"]
        D2["document"] --> J
        J --> T["transformer<br/><i>full cross-attention</i>"] --> S2["relevance score"]
    end
`.trim(),
      caption: 'The reranker sees the query and the document at the same time. That is the entire advantage.',
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'The highest-ROI single addition',
      md: `If a RAG system has hybrid search and no reranker, adding one is usually the largest
quality jump available for the least work. It changes no data, requires no re-indexing, and
typically moves the genuinely relevant chunk from position 7 to position 1 — where the model
will actually use it.`,
    },
    {
      type: 'markdown',
      md: `
## Where rerankers earn their latency

They are not a uniform improvement — they specifically repair known bi-encoder weaknesses:

- **Long chunks.** A 600-token chunk about five things has a muddy average embedding. A
  cross-encoder can see that sentence four answers the question exactly.
- **Subtle distinctions.** "Refund policy for annual plans" vs. "for monthly plans" are
  neighbours in vector space; a cross-encoder reads the difference.
- **Negation and conditions.** "does not apply to enterprise customers" is a distinction
  embeddings blur and cross-attention catches.
- **Multi-hop phrasing.** Where relevance depends on a specific relationship between query
  terms rather than overall topic.

The cost is real: **50–200 ms** for 50 candidates on a hosted reranker, more if self-hosted on
CPU. Budget it, run it in parallel where possible, and cap the candidate count.

## Maximal Marginal Relevance

Reranking gives you the most relevant chunks. It does not give you *diverse* ones — with chunk
overlap and near-duplicate documents, the top 5 can easily be five phrasings of the same
sentence, wasting four fifths of your context.

MMR selects iteratively, at each step picking the candidate that maximises

\`\`\`
score = λ · relevance(query, d)  −  (1 − λ) · max similarity(d, already-selected)
\`\`\`

λ = 1 is pure relevance; λ = 0 is pure novelty; **λ ≈ 0.7** is the usual setting. It matters
most for broad questions ("what do we know about X?") and least for narrow factual lookups.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'rerank.py',
      code: `import numpy as np


def rerank(query: str, candidates: list[dict], cross_encoder,
           top_n: int = 5, min_score: float = 0.0) -> list[dict]:
    """Score every (query, chunk) pair jointly, keep the best few.

    The threshold matters as much as the ordering: it is what lets the system
    return nothing rather than the least-bad of a bad set.
    """
    pairs = [(query, c["text"]) for c in candidates]
    scores = cross_encoder.predict(pairs)          # the expensive part

    ranked = sorted(
        ({**c, "rerank_score": float(s)} for c, s in zip(candidates, scores)),
        key=lambda c: -c["rerank_score"],
    )
    return [c for c in ranked if c["rerank_score"] >= min_score][:top_n]


def mmr(query_vec: np.ndarray, candidates: list[dict], k: int = 5,
        lambda_: float = 0.7) -> list[dict]:
    """Greedy relevance/novelty trade-off, so the top-k aren't near-duplicates."""
    vectors = np.stack([c["vector"] for c in candidates])
    relevance = vectors @ query_vec

    selected: list[int] = []
    remaining = set(range(len(candidates)))

    while len(selected) < min(k, len(candidates)):
        if not selected:
            best = int(np.argmax(relevance))
        else:
            chosen = vectors[selected]
            best, best_score = -1, -np.inf
            for i in remaining:
                redundancy = float(np.max(chosen @ vectors[i]))
                score = lambda_ * relevance[i] - (1 - lambda_) * redundancy
                if score > best_score:
                    best, best_score = i, score

        selected.append(best)
        remaining.discard(best)

    return [candidates[i] for i in selected]`,
    },
    {
      type: 'markdown',
      md: `
## Lost in the middle

Models do not attend uniformly across a long context. Accuracy is highest for information at
the **beginning** and **end** of the context and measurably worse in the **middle** — a
U-shaped curve documented across model families. A chunk buried at position 8 of 15 can be
present, correct, and effectively invisible.

Two consequences:

1. **Fewer chunks is better.** Five well-chosen chunks beat fifteen mediocre ones, and not
   only for cost.
2. **Order deliberately.** Place the highest-ranked chunks at the edges of the context and the
   weakest in the middle, where they will be skimmed anyway.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    R["Reranked:<br/>1 2 3 4 5"] --> A{{"Interleave<br/>to the edges"}}
    A --> O["Prompt order:<br/><b>1</b> 3 5 4 <b>2</b>"]
    O --> N["Best two chunks<br/>sit where attention<br/>is strongest"]
`.trim(),
      caption: 'Rank 1 first, rank 2 last, the rest folded into the middle.',
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'assemble.py',
      code: `def order_for_attention(chunks: list[dict]) -> list[dict]:
    """Strongest chunks at the edges, weakest in the middle.

    Input is assumed sorted best-first. Rank 1 goes to the front, rank 2 to the
    back, and everything else folds inward.
    """
    front, back = [], []
    for i, chunk in enumerate(chunks):
        (front if i % 2 == 0 else back).append(chunk)
    return front + back[::-1]


def assemble_context(chunks: list[dict], token_budget: int = 3000, count_tokens=len) -> str:
    """Fill the budget with whole chunks, keeping citation numbers stable."""
    kept, used = [], 0
    for chunk in chunks:
        cost = count_tokens(chunk["text"])
        if used + cost > token_budget:
            continue          # skip, don't truncate: half a chunk misleads
        kept.append(chunk)
        used += cost

    ordered = order_for_attention(kept)

    # Number by final prompt position so the model's [n] citations resolve.
    return "\\n\\n---\\n\\n".join(
        f"[{n}] Source: {c['source']}"
        + (f" > {' > '.join(c['heading_path'])}" if c.get("heading_path") else "")
        + f"\\n{c['text']}"
        for n, c in enumerate(ordered, 1)
    )`,
      caption: 'Skip an over-budget chunk rather than truncating it — a half chunk is a misleading chunk.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Deduplicate before you spend context on it',
      md: `Chunk overlap guarantees near-duplicate retrievals. Without deduplication the top 5 may
be three copies of one passage. Drop candidates whose similarity to an already-selected chunk
exceeds ~0.95, or use MMR, which handles it as a side effect.`,
    },
    {
      type: 'markdown',
      md: `
## Cheaper alternatives when latency is tight

- **LLM reranking**: ask a small fast model to rank the candidates. Flexible, slower, and it
  can follow instructions ("prefer recent documents") a cross-encoder cannot.
- **Metadata boosting**: multiply scores by a recency or authority factor. Nearly free, and
  often more valuable than it sounds — freshness is frequently the real relevance signal.
- **Score thresholding alone**: no reordering, just drop everything below a similarity floor.
  Cheapest possible precision improvement.
- **ColBERT / late interaction**: per-token embeddings with a cheap interaction step. Between
  bi- and cross-encoder in both cost and accuracy, at the price of a much larger index.
`.trim(),
    },
    {
      type: 'checklist',
      title: 'Reranking and assembly checklist',
      items: [
        'Cross-encoder reranking over the fused candidate list (30–100 in, 3–8 out)',
        'A rerank score threshold so weak candidates are dropped, not merely reordered',
        'Near-duplicates removed, via similarity cutoff or MMR',
        'Chunks ordered strongest-at-the-edges to survive lost-in-the-middle',
        'Each chunk labelled with source and section for citation',
        'Over-budget chunks skipped whole rather than truncated',
      ],
    },
  ],

  flashcards: [
    { front: 'What is the difference between a bi-encoder and a cross-encoder?', back: 'A bi-encoder embeds query and document separately (pre-computable, fast, imprecise). A cross-encoder processes them together with full cross-attention (per-query, slow, accurate). Retrieve with the first, rerank with the second.' },
    { front: 'What is the "lost in the middle" effect?', back: 'Models attend most strongly to the beginning and end of a long context and measurably less to the middle. Use fewer chunks, and place the strongest ones at the edges.' },
    { front: 'What does MMR do and what is a typical λ?', back: 'Maximal Marginal Relevance trades relevance against novelty when selecting chunks, preventing near-duplicate results from consuming the context. λ ≈ 0.7 (0.7 relevance, 0.3 diversity) is the usual default.' },
    { front: 'Why skip an over-budget chunk instead of truncating it?', back: 'A truncated chunk can present data without its qualifying context — half a table, a figure without its condition — which produces confident, wrong answers. Whole chunks or none.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Why can a cross-encoder not be used for first-stage retrieval over a million chunks?',
      options: [
        'Its score depends on the query, so nothing can be pre-computed — it would need a million forward passes per query',
        'Cross-encoders cannot handle documents longer than a sentence',
        'Cross-encoders produce vectors that ANN indexes cannot store',
        'Cross-encoders require the entire corpus to fit in GPU memory',
      ],
      answerIndex: 0,
      explanation: 'The accuracy comes from processing query and document jointly — which is exactly why the result cannot exist before the query arrives. Bi-encoders trade that interaction away to make document embeddings pre-computable, which is what makes million-scale search a single matrix multiply.',
    },
    {
      id: 'q2',
      prompt: 'Your top 5 chunks are five near-identical phrasings of the same passage. What fixes this?',
      options: [
        'Removing the reranker, which is over-concentrating results',
        'MMR or a near-duplicate similarity cutoff during selection',
        'Increasing top-k so more variety appears',
        'A larger embedding model',
      ],
      answerIndex: 1,
      explanation: 'Chunk overlap makes near-duplicates inevitable, and relevance ranking alone will happily return five copies of the best passage. MMR penalises similarity to already-selected chunks; a hard cutoff around 0.95 achieves much the same. Raising top-k just adds more duplicates.',
    },
    {
      id: 'q3',
      prompt: 'You have 12 good chunks and room for all of them. Where should the two highest-ranked ones go?',
      options: [
        'Both in the middle, the centre of attention',
        'Position does not affect how a model uses context',
        'One at the very start and one at the very end of the context',
        'Both at the start, so the model reads them first',
      ],
      answerIndex: 2,
      explanation: 'Attention follows a U-shape: strongest at the edges, weakest in the middle. Putting rank 1 first and rank 2 last places both where the model reliably attends, and pushes the weaker chunks into the region that gets skimmed anyway.',
    },
    {
      id: 'q4',
      prompt: 'What kind of retrieval error does a cross-encoder reranker most reliably fix?',
      options: [
        'A relevant chunk that first-stage retrieval never returned',
        'A document that was never ingested',
        'An embedding model mismatch between queries and documents',
        'A long, multi-topic chunk whose averaged embedding hid the one sentence that answers the question',
      ],
      answerIndex: 3,
      explanation: 'Cross-attention can see that one sentence inside a muddy chunk answers the query — a distinction a single averaged vector cannot represent. But a reranker only reorders what it receives: a chunk missed by retrieval, or never indexed, is beyond its reach.',
    },
    {
      id: 'q5',
      prompt: 'A chunk would push you 200 tokens over the context budget. What is the right move?',
      options: [
        'Skip the chunk entirely and try the next one',
        'Truncate it to fit the remaining budget',
        'Truncate the chunk before it to make room',
        'Include it and let the model handle the overflow',
      ],
      answerIndex: 0,
      explanation: 'Truncation is how you get a table without its header, or a rule without its exception. The visible half looks authoritative and the qualifying half is gone, which produces confident wrong answers. Skip it — the ranking already says a later chunk is nearly as good.',
    },
  ],
};
