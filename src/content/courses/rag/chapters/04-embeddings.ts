import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'embeddings',
  title: 'Embeddings',
  summary: 'How text becomes geometry, why cosine similarity is the default, what dimensions really buy you, and the mistakes that silently destroy a vector index.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
An embedding model is a function from text to a fixed-length list of floats. Feed it
*"How do I reset my password?"* and it returns something like
\`[0.021, -0.114, 0.083, ...]\` — 768 or 1536 numbers. That list is a **point in a
high-dimensional space**, and the model has been trained so that texts with similar meanings
land near each other.

That is the entire trick. Semantic search is nearest-neighbour search in that space.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `Think of colours. Every colour is three numbers, and "similar colour" means "short
distance in RGB space" — you can compute it without ever naming the colour. Embeddings do the
same for meaning, except with 768 axes instead of 3, and the axes correspond to nothing you can
name. *"Cancel my subscription"* and *"How do I unsubscribe?"* share no significant words, but
they land in nearly the same place.`,
    },
    {
      type: 'markdown',
      md: `
## Why this beats keyword search — and where it doesn't

Keyword search matches **strings**. Embedding search matches **meaning**. So embeddings handle:

- Synonyms and paraphrase: *"cancel subscription"* ≈ *"how to unsubscribe"*
- Cross-lingual matching, with a multilingual model
- Conceptual questions where the user does not know the domain's vocabulary

And they are notably *bad* at:

- **Exact identifiers.** \`ERR_4021\`, \`INV-2024-8891\`, a specific SKU. A rare token carries
  almost no semantic signal, so it lands nowhere meaningful. Keyword search nails exactly this
  case, because rarity is precisely what BM25 rewards.
- **Negation.** *"documents that mention Acme"* and *"documents that do not mention Acme"*
  embed close together. Embeddings capture topic far better than logical polarity.
- **Precise numeric or date constraints.** "Contracts signed after March 2024" is a metadata
  filter, not a similarity question.

This asymmetry is the whole argument for hybrid search in Chapter 6. Neither method is
strictly better; they fail in different places.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    subgraph SPACE["Embedding space (2 of 768 dims shown)"]
        direction TB
        A["'reset my password'"]
        B["'I forgot my login'"]
        C["'how to change password'"]
        D["'billing invoice date'"]
        E["'when am I charged'"]
    end

    A -.->|"near"| B
    A -.->|"near"| C
    D -.->|"near"| E
    A ==>|"far"| D
`.trim(),
      caption: 'Meaning becomes distance. Retrieval is then just "what is nearby?"',
    },
    {
      type: 'markdown',
      md: `
## Measuring similarity

Three metrics appear in practice, and the differences matter less than people think — provided
you normalise.

**Cosine similarity** — the angle between two vectors, ignoring magnitude. Ranges −1 to 1.
The default for text, because embedding magnitude tends to track *length and verbosity* rather
than meaning, and you do not want long documents to win by being long.

**Dot product** — magnitude-sensitive. On **normalised** vectors it is *identical* to cosine,
and it is one fused multiply-add instead of a division, so it is what production indexes
actually compute.

**Euclidean (L2) distance** — straight-line distance. On normalised vectors it is a monotonic
transform of cosine, so it produces the same ranking.

The practical rule: **normalise your vectors once at index time, then use dot product.** All
three metrics collapse into the same thing and you get the fastest one for free.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'similarity.py',
      code: `import numpy as np


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def normalize(v: np.ndarray) -> np.ndarray:
    """Row-wise L2 normalisation. Do this once, at index time."""
    return v / np.linalg.norm(v, axis=-1, keepdims=True)


# After normalisation these are all the same ranking:
a, b = normalize(np.random.randn(2, 768))

print(cosine(a, b))                      # 0.0213...
print(a @ b)                             # 0.0213...  (identical, and faster)
print(1 - np.linalg.norm(a - b) ** 2 / 2)  # 0.0213...  (L2, monotonically related)

# Scoring a whole index: one matrix multiply, no per-row division.
index = normalize(np.random.randn(50_000, 768))   # 50k chunks
query = normalize(np.random.randn(768))
scores = index @ query                             # (50_000,)
top_5 = np.argpartition(-scores, 5)[:5]            # cheaper than a full sort`,
      caption: 'argpartition, not argsort: you need the top 5, not a total ordering of 50,000.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The three ways to silently break a vector index',
      md: `**1. Different models for documents and queries.** The two vector spaces are unrelated.
Similarity scores become noise — and nothing errors. Everything just gets subtly, inexplicably
worse.
**2. Forgetting an asymmetric model's prefixes.** Several models (E5, BGE, and others) require
\`query: \` and \`passage: \` prefixes. Omit them and you lose a large chunk of quality, again
with no error.
**3. Changing the embedding model without re-indexing.** New queries land in a space your old
vectors do not share. **Any model change means a full re-index. Budget for it.**`,
    },
    {
      type: 'markdown',
      md: `
## Choosing a model

Four axes, in roughly the order they matter:

**Dimensions.** 384, 768, 1024, 1536, 3072. More dimensions can encode finer distinctions but
cost linearly in storage, memory and search time. 1536 dims × 4 bytes × 1M chunks ≈ **6 GB**
just for vectors. The quality gain from 768 → 1536 is real but modest; the cost is not. Some
modern models support **Matryoshka truncation** — trained so you can simply chop the vector to
256 or 512 dims and lose surprisingly little.

**Max sequence length.** How much text the model reads before truncating. 512 tokens is common
and is a hard constraint on chunk size: text beyond the limit is silently discarded, so a
1,000-token chunk fed to a 512-token model is *half indexed*.

**Domain fit.** General-purpose models underperform on legal, medical and code corpora.
Domain-specific or fine-tuned embedding models are one of the higher-yield upgrades available,
and fine-tuning an embedding model is far cheaper than fine-tuning an LLM.

**Symmetric vs. asymmetric.** Symmetric models compare like with like (sentence ↔ sentence).
Asymmetric models are trained for short-query ↔ long-passage, which is exactly the RAG shape.
Prefer asymmetric, and respect their prefixes.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Decision', 'Default', 'Reconsider when'],
      rows: [
        ['Dimensions', '768–1024', 'Corpus > 1M chunks (go smaller, or truncate Matryoshka-style)'],
        ['Metric', 'Cosine via normalised dot product', 'Practically never'],
        ['Model type', 'Asymmetric, retrieval-tuned', 'You are matching sentence to sentence, e.g. deduplication'],
        ['Domain', 'General-purpose to start', 'Specialist vocabulary — legal, medical, code, internal jargon'],
        ['Hosting', 'API for prototypes', 'Cost at scale, latency, or data cannot leave your network'],
      ],
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'Batch, cache, and quantise',
      md: `Embedding a corpus is embarrassingly parallel — batch 64–256 texts per call and the
throughput difference is an order of magnitude. **Cache by content hash** so re-indexing an
unchanged document is free. And when memory bites, **scalar quantisation** to int8 cuts vector
storage by 4× for typically 1–2% recall loss; it is almost always a better trade than dropping
dimensions.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'embed_pipeline.py',
      code: `import hashlib
import numpy as np


class EmbeddingCache:
    """Content-addressed cache: re-indexing unchanged documents costs nothing."""

    def __init__(self, embed_fn, batch_size: int = 128):
        self.embed_fn = embed_fn
        self.batch_size = batch_size
        self.store: dict[str, np.ndarray] = {}

    @staticmethod
    def key(text: str) -> str:
        return hashlib.sha256(text.encode()).hexdigest()

    def embed(self, texts: list[str]) -> np.ndarray:
        keys = [self.key(t) for t in texts]
        missing = [(i, t) for i, (k, t) in enumerate(zip(keys, texts)) if k not in self.store]

        # Only pay for what changed, and pay for it in batches.
        for start in range(0, len(missing), self.batch_size):
            batch = missing[start:start + self.batch_size]
            vectors = self.embed_fn([t for _, t in batch])
            vectors = vectors / np.linalg.norm(vectors, axis=1, keepdims=True)  # normalise once
            for (i, _), vec in zip(batch, vectors):
                self.store[keys[i]] = vec

        return np.stack([self.store[k] for k in keys])


def quantize_int8(vectors: np.ndarray) -> tuple[np.ndarray, float]:
    """4x smaller, typically 1-2% recall loss. Usually beats reducing dimensions."""
    scale = np.abs(vectors).max() / 127.0
    return np.round(vectors / scale).astype(np.int8), scale`,
    },
    {
      type: 'markdown',
      md: `
## What embeddings cannot do

Worth stating plainly, because it prevents a lot of wasted tuning:

- They do not **reason**. Similarity is not entailment. A chunk that contradicts the answer can
  sit right next to one that confirms it.
- They do not understand **negation** or logical structure.
- They have **no notion of time or recency** unless you filter on metadata.
- They cannot express **"none of these are relevant"**. Nearest-neighbour search always returns
  k results — the top hit for a nonsense question still has a score. Set a similarity floor, or
  your system will answer questions it has nothing to say about.
`.trim(),
    },
    {
      type: 'checklist',
      title: 'Embedding checklist',
      items: [
        'Same model, same prefixes, same normalisation on both documents and queries',
        'Vectors L2-normalised once at index time; scoring by dot product',
        'Chunk sizes fit inside the model\'s max sequence length',
        'Embeddings cached by content hash; batched 64–256 per call',
        'A similarity floor so irrelevant queries return nothing rather than the least-bad chunk',
        'A re-indexing plan written down before the model is ever changed',
      ],
    },
  ],

  flashcards: [
    { front: 'Why is cosine similarity the default for text embeddings?', back: 'It ignores magnitude, and embedding magnitude tends to track length and verbosity rather than meaning. On normalised vectors it is identical to the dot product, which is faster to compute.' },
    { front: 'What happens if you embed documents with one model and queries with another?', back: 'The two vector spaces are unrelated, so similarity scores become noise. Nothing errors — quality just degrades inexplicably. The same applies to changing models without re-indexing.' },
    { front: 'Why do embeddings fail on exact identifiers like ERR_4021?', back: 'A rare literal token carries almost no semantic content, so it lands nowhere meaningful in the space. Keyword search excels here precisely because rarity is what it rewards.' },
    { front: 'What is Matryoshka truncation?', back: 'Embedding models trained so the vector can be chopped to fewer dimensions (e.g. 1536 → 512) with surprisingly little quality loss — a cheap way to cut storage and search cost.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'You L2-normalise all vectors at index time. What follows?',
      options: [
        'Cosine similarity and dot product become identical, so you can use the cheaper dot product',
        'Euclidean distance becomes meaningless',
        'You must switch to a magnitude-sensitive metric',
        'Vector storage requirements halve',
      ],
      answerIndex: 0,
      explanation: 'Cosine is the dot product divided by both magnitudes; if both are 1, the division is a no-op. Doing it once offline turns per-query scoring into a single matrix multiply. (L2 distance also stays valid — it becomes a monotonic transform of cosine, giving the same ranking.)',
    },
    {
      id: 'q2',
      prompt: 'Users search for invoice numbers like INV-2024-8891 and get irrelevant results, though paraphrased questions work well. Why?',
      options: [
        'The chunk size is too large for the identifiers to matter',
        'Rare literal tokens carry almost no semantic signal, so they embed to no meaningful location',
        'The embedding model has too few dimensions',
        'The vectors were not normalised',
      ],
      answerIndex: 1,
      explanation: 'Embeddings encode meaning, and an arbitrary identifier has essentially none to encode. Keyword search handles it well because BM25 rewards exactly this rarity. This asymmetry — embeddings for paraphrase, keywords for literals — is the core argument for hybrid search.',
    },
    {
      id: 'q3',
      prompt: 'Your embedding model has a 512-token limit and you are indexing 1,000-token chunks. What happens?',
      options: [
        'The model automatically splits the chunk into two vectors',
        'The chunk is embedded at lower precision',
        'Roughly half of each chunk is silently truncated and never indexed',
        'The model raises an error and indexing stops',
      ],
      answerIndex: 2,
      explanation: 'Truncation is silent — no error, no warning. The tail of every chunk simply does not exist as far as retrieval is concerned, so answers living in the second half become unfindable. A model\'s max sequence length is a hard constraint on chunk size.',
    },
    {
      id: 'q4',
      prompt: 'Your 1M-chunk index at 1536 dimensions no longer fits in memory. What is usually the best first move?',
      options: [
        'Drop to a 384-dimension model and re-index',
        'Delete the oldest half of the corpus',
        'Move to Euclidean distance, which uses less memory',
        'Scalar-quantise the vectors to int8 — 4× smaller for roughly 1–2% recall loss',
      ],
      answerIndex: 3,
      explanation: 'int8 quantisation gives a 4× reduction for a small, measurable recall cost and requires no model change. Dropping to a much smaller model usually costs more quality and forces a full re-index; the metric you choose has no bearing on memory at all.',
    },
    {
      id: 'q5',
      prompt: 'A user asks something entirely unrelated to your corpus. What does pure vector retrieval return?',
      options: [
        'The k nearest chunks with real scores, because nearest-neighbour search always returns k results',
        'An empty result set, since nothing is similar',
        'An error indicating no match was found',
        'The chunk with the highest keyword overlap',
      ],
      answerIndex: 0,
      explanation: 'Similarity search has no concept of "nothing relevant" — it returns the least-bad neighbours regardless. Without a similarity floor, those irrelevant chunks flow into the prompt and the model tries to answer from them. Thresholding is what lets a system say "I don\'t have that information".',
    },
  ],
};
