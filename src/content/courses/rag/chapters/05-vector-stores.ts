import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'vector-stores',
  title: 'Vector stores and indexing',
  summary: 'Why exact search stops scaling, how HNSW and IVF trade recall for speed, why metadata filtering is harder than it looks, and how to choose a store without regret.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
Comparing a query against every vector — a *flat* or brute-force search — gives perfect recall
and is trivially correct. For 10,000 chunks it takes single-digit milliseconds. It is genuinely
the right answer for small corpora, and reaching for a distributed vector database at that
scale is a mistake people make constantly.

It stops working somewhere around a million vectors, where a single query means a
1M × 1536 matrix multiply. At that point you trade a little accuracy for a lot of speed:
**approximate nearest neighbour** search.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'What "approximate" costs you',
      md: `An ANN index might return 95 of the true top 100 neighbours instead of all 100 — and do
it 100× faster. That missing 5% is your **recall**, and it is a knob, not a fixed property.
Every ANN index exposes a parameter that trades recall for latency. Know which one, and measure
where you actually sit on that curve.`,
    },
    {
      type: 'markdown',
      md: `
## HNSW: the default worth understanding

Hierarchical Navigable Small World is what most vector databases use, and its intuition is
worth carrying around.

Picture a road network built in layers. The top layer has only motorways connecting distant
cities. Lower layers add A-roads, then local streets. To find an address you start on the
motorway layer, travel greedily toward your destination until you cannot get closer, then drop
a layer and repeat with finer roads. A handful of hops gets you anywhere.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    subgraph L2["Layer 2 - sparse, long links"]
        A2(("entry")) --- B2(("far node"))
    end
    subgraph L1["Layer 1 - medium density"]
        A1(("."))  --- B1(("."))  --- C1(("."))
    end
    subgraph L0["Layer 0 - all vectors, short links"]
        A0(("."))  --- B0(("."))  --- C0(("."))  --- D0(("target"))
    end

    A2 -->|"descend"| B1
    B1 -->|"descend"| C0
    C0 --> D0
`.trim(),
      caption: 'Coarse hops first, fine hops last. Logarithmic search instead of linear.',
    },
    {
      type: 'markdown',
      md: `
**The parameters you will actually touch:**

- \`M\` — links per node. Higher means better recall and more memory. 16–48 is the usual range.
- \`ef_construction\` — how hard the index works while building. Higher builds slower but
  produces a better graph. Set it high; you pay once.
- \`ef_search\` — how many candidates to explore per query. **This is your runtime
  recall/latency dial.** Raise it when recall is poor, lower it when latency hurts. It requires
  no rebuild, which makes it the first thing to tune.

**HNSW's weaknesses**, which matter in production: it is memory-hungry (the graph sits on top
of the vectors), deletions are soft — marked, not removed — so a high-churn index degrades and
needs periodic rebuilds.

## IVF: the memory-frugal alternative

Inverted File indexing clusters vectors into \`nlist\` groups with k-means and stores each
group as a list. A query is compared against the cluster centroids, then searched inside the
\`nprobe\` nearest clusters only.

- Much smaller memory footprint than HNSW, and far faster to build.
- \`nprobe\` is the recall/latency dial.
- The characteristic failure: a vector near a cluster **boundary** can be missed entirely
  because its region was never probed. Raising \`nprobe\` mitigates this at a cost.
- Usually paired with **product quantisation** (IVF-PQ) to compress vectors — the standard
  choice at very large scale.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Index', 'Build', 'Query', 'Memory', 'Use when'],
      rows: [
        ['**Flat** (exact)', 'None', 'O(n)', 'Vectors only', '< ~100k chunks. Perfect recall, zero tuning, no regrets'],
        ['**HNSW**', 'Slow', 'O(log n)', 'High (graph overhead)', 'The general default: high recall, low latency, moderate churn'],
        ['**IVF-Flat**', 'Fast', 'Sublinear', 'Moderate', 'Large corpora where build time and memory matter'],
        ['**IVF-PQ**', 'Fast', 'Sublinear', 'Very low', 'Tens of millions of vectors; accepts real recall loss'],
        ['**ScaNN / DiskANN**', 'Slow', 'Fast', 'Low RAM, uses SSD', 'Corpora too large for memory'],
      ],
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Do not reach for a vector database too early',
      md: `Under ~100k chunks, a normalised NumPy matrix or SQLite with an extension will serve
queries in milliseconds with **perfect** recall and no operational surface. Running a
distributed vector database for 20,000 chunks buys you tuning parameters, an extra failure mode
and a bill, in exchange for nothing. Scale when you measure a problem.`,
    },
    {
      type: 'markdown',
      md: `
## Metadata filtering: harder than it looks

"Search only current policy documents" sounds trivial and is the source of most surprising
production behaviour. There are three strategies and they are not equivalent.

**Post-filtering** — retrieve top-k, then discard non-matching results. Simple, and it
*silently under-delivers*: ask for 10, filter, receive 2. Worse, if no result in the top-k
matches the filter, you get nothing while relevant documents sit just outside the window.

**Pre-filtering** — apply the filter first, then search only the surviving subset. Correct
results, but a naive implementation degenerates to brute-force over the subset, and it can
break the ANN graph's connectivity assumptions.

**Filtered ANN** — the graph traversal itself skips non-matching nodes. What good vector
databases implement, and the reason to use one. Check that yours does this rather than
post-filtering, because the difference only shows up under selective filters.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    subgraph POST["Post-filter: asked for 10, got 2"]
        P1["ANN search top-10"] --> P2["apply filter"] --> P3["2 results"]
    end
    subgraph PRE["Pre-filter: correct but can be slow"]
        R1["apply filter"] --> R2["search subset"] --> R3["10 results"]
    end
    subgraph FILT["Filtered ANN: correct and fast"]
        F1["traverse graph,<br/>skipping non-matches"] --> F3["10 results"]
    end
`.trim(),
      caption: 'The same query, three implementations, three different answers.',
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'store.py',
      code: `import numpy as np


class FlatStore:
    """Exact search. Genuinely the right choice below ~100k chunks.

    Pre-filtering is trivial here because there is no graph to break.
    """

    def __init__(self, dim: int):
        self.vectors = np.empty((0, dim), dtype=np.float32)
        self.payloads: list[dict] = []

    def add(self, vectors: np.ndarray, payloads: list[dict]) -> None:
        vectors = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
        self.vectors = np.vstack([self.vectors, vectors.astype(np.float32)])
        self.payloads.extend(payloads)

    def search(self, query: np.ndarray, k: int = 10,
               where: dict | None = None, min_score: float = 0.0) -> list[dict]:
        query = query / np.linalg.norm(query)

        # Pre-filter: restrict the candidate set BEFORE scoring, so k is honoured.
        if where:
            mask = np.array([
                all(p.get(key) == val for key, val in where.items())
                for p in self.payloads
            ])
            candidates = np.flatnonzero(mask)
        else:
            candidates = np.arange(len(self.payloads))

        if candidates.size == 0:
            return []

        scores = self.vectors[candidates] @ query

        # A similarity floor is what lets the system say "I don't know" instead of
        # returning the least-bad neighbours for an unrelated question.
        keep = scores >= min_score
        candidates, scores = candidates[keep], scores[keep]
        if candidates.size == 0:
            return []

        k = min(k, candidates.size)
        top = candidates[np.argpartition(-scores, k - 1)[:k]]
        top = top[np.argsort(-(self.vectors[top] @ query))]

        return [
            {**self.payloads[i], "score": float(self.vectors[i] @ query)}
            for i in top
        ]`,
      caption: 'Filter before scoring, then threshold. Both habits carry over to any real store.',
    },
    {
      type: 'markdown',
      md: `
## Choosing a store

The honest decision procedure:

1. **Under 100k chunks?** NumPy, SQLite + \`sqlite-vec\`, or DuckDB. Perfect recall, no ops.
2. **Already running Postgres?** \`pgvector\` — one system, real transactions, joins against
   your existing tables, and now decent HNSW support. The pragmatic default for most teams.
3. **Need scale, hybrid search and filtering as first-class features?** A dedicated store —
   Qdrant, Weaviate, Milvus, Vespa — or a managed one if you would rather not operate it.
4. **Already have Elasticsearch/OpenSearch?** It does vectors *and* BM25, which makes hybrid
   search (Chapter 6) considerably less work.

The features that actually differentiate them: filtered ANN (not post-filtering), native hybrid
search, incremental updates without full rebuilds, and quantisation support. Raw benchmark QPS
is rarely your bottleneck — the LLM call dominates end-to-end latency anyway.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Plan the re-index before you need it',
      md: `You will change embedding model, chunking strategy, or both. That means rebuilding the
entire index. Design for it now: keep the **source text and metadata outside the vector store**
so you can rebuild without re-ingesting, and support **atomic index swaps** (build alongside,
flip an alias) so re-indexing does not mean downtime.`,
    },
    {
      type: 'checklist',
      title: 'Index checklist',
      items: [
        'Corpus size measured before choosing anything more complex than flat search',
        'Recall measured against exact search on a sample — not assumed',
        'The runtime recall dial identified (`ef_search` for HNSW, `nprobe` for IVF)',
        'Confirmed the store does filtered ANN rather than post-filtering',
        'A similarity floor set so irrelevant queries return nothing',
        'Source text and metadata stored outside the index so it can be rebuilt',
        'Atomic index swap possible, for zero-downtime re-indexing',
      ],
    },
  ],

  flashcards: [
    { front: 'What does ef_search control in HNSW?', back: 'How many candidates the search explores per query — the runtime recall/latency dial. It can be changed without rebuilding the index, which makes it the first knob to try when recall is poor.' },
    { front: 'What is IVF\'s characteristic failure mode?', back: 'A vector near a cluster boundary can be missed entirely because its cluster was never probed. Raising nprobe mitigates it at the cost of latency.' },
    { front: 'Why is post-filtering dangerous?', back: 'It searches first and filters after, so asking for 10 results may yield 2 — or none — while relevant documents sit just outside the retrieved window. Pre-filtering or filtered ANN gives correct results.' },
    { front: 'When is brute-force flat search the right answer?', back: 'Below roughly 100k chunks. It gives perfect recall in milliseconds with no tuning and no operational surface — a dedicated vector database at that scale adds cost and failure modes for nothing.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'You have 40,000 chunks and answer a few queries per minute. What index should you use?',
      options: [
        'Flat exact search — perfect recall, milliseconds, no tuning',
        'HNSW with a high ef_construction',
        'IVF-PQ to keep memory low',
        'A managed distributed vector database for future-proofing',
      ],
      answerIndex: 0,
      explanation: 'At this scale a normalised matrix multiply is a few milliseconds and gives exact results. Introducing ANN adds tuning parameters, a recall cliff and operational surface in exchange for solving a problem you do not have. Scale when you measure a bottleneck.',
    },
    {
      id: 'q2',
      prompt: 'Recall has dropped since your corpus grew, and you use HNSW. What is the first thing to try?',
      options: [
        'Reduce the embedding dimensions',
        'Raise ef_search — it trades latency for recall and needs no rebuild',
        'Raise M and rebuild the index',
        'Switch to IVF-PQ',
      ],
      answerIndex: 1,
      explanation: 'ef_search is the runtime dial: raise it, measure recall and latency, and you have an answer in minutes. M and ef_construction are build-time parameters requiring a full rebuild, so they are second resorts — and changing the embedding model would make recall worse, not better.',
    },
    {
      id: 'q3',
      prompt: 'You filter to "department = legal" and ask for 10 results, but get 3. What is happening?',
      options: [
        'The similarity threshold is set too high',
        'HNSW cannot return more than 3 results per cluster',
        'The store is post-filtering: it retrieves top-10 globally, then discards non-matches',
        'The legal department only has 3 documents',
      ],
      answerIndex: 2,
      explanation: 'Post-filtering applies the predicate after the ANN search, so a selective filter eats most of the window — and relevant legal documents just outside the top-10 are never considered. This is the single most important capability to verify in a vector store: it should do filtered ANN, not post-filtering.',
    },
    {
      id: 'q4',
      prompt: 'Why keep source text and metadata outside the vector store?',
      options: [
        'Vector stores cannot store text, only vectors',
        'It reduces query latency significantly',
        'It is required for metadata filtering to work',
        'So the index can be rebuilt after a model or chunking change without re-ingesting documents',
      ],
      answerIndex: 3,
      explanation: 'Re-indexing is not a hypothetical — you will change the embedding model or chunking strategy. Keeping the parsed text and metadata in your own storage turns that from a full re-ingestion (re-parsing every PDF) into an embed-and-load job, and enables atomic index swaps for zero downtime.',
    },
    {
      id: 'q5',
      prompt: 'Your team already runs Postgres and has around 500k chunks. What is the pragmatic choice?',
      options: [
        'pgvector — one system to operate, transactions, and joins against existing tables',
        'A dedicated distributed vector database, since 500k exceeds Postgres capacity',
        'Flat NumPy search loaded into application memory',
        'IVF-PQ on disk, since 500k vectors cannot fit in memory',
      ],
      answerIndex: 0,
      explanation: 'pgvector handles this scale comfortably with HNSW, and staying on one database means one backup story, one access-control model, and the ability to join chunks against the tables you already have. 500k × 1536 × 4 bytes is about 3 GB — large for application memory, unremarkable for a database server.',
    },
  ],
};
