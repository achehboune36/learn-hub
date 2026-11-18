import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'pipeline',
  title: 'The pipeline end to end',
  summary: 'The eight stages every RAG system has, split into an offline half and an online half — and the failure each stage owns.',
  estimatedMinutes: 22,

  blocks: [
    {
      type: 'markdown',
      md: `
Every RAG system, from a weekend prototype to a platform serving millions of queries, is the
same eight stages. Frameworks differ in what they name them and how many they hide from you.
Knowing the stages by heart is what lets you debug a system you did not build.

The first thing to internalise is that the pipeline has **two halves that run at completely
different times**.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    subgraph OFF["OFFLINE - runs when documents change"]
        direction LR
        A["1. Ingest<br/><i>parse to text</i>"] --> B["2. Chunk<br/><i>split</i>"]
        B --> C["3. Embed<br/><i>text to vectors</i>"]
        C --> D["4. Index<br/><i>store + build ANN</i>"]
    end

    D --> S[("Vector store<br/>+ keyword index")]

    subgraph ON["ONLINE - runs per query, on the clock"]
        direction LR
        E["5. Query<br/><i>rewrite, embed</i>"] --> F["6. Retrieve<br/><i>top-k candidates</i>"]
        F --> G["7. Rerank<br/><i>shortlist, order</i>"]
        G --> H["8. Generate<br/><i>answer + cite</i>"]
    end

    S --> F
`.trim(),
      caption: 'Offline work is amortised across every future query; online work is paid on every single one.',
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Why the split matters',
      md: `Anything you can move from the online half to the offline half is free at query time.
Generating a summary per chunk, extracting metadata, pre-computing keywords — all expensive
offline, all free online. Conversely, every online stage adds directly to the latency a user
feels. **Push work left.**`,
    },
    {
      type: 'markdown',
      md: `
## The offline half: building the index

### 1. Ingest
Get raw bytes into clean text. PDFs, HTML, Confluence pages, Slack exports, code, scanned
images. This is the least glamorous stage and the one that quietly destroys the most quality:
a PDF table flattened into a stream of numbers with no headers is now unanswerable, no matter
how good your embeddings are.

### 2. Chunk
Split text into retrievable units. A chunk must be small enough to be *specific* (so its
embedding means one thing) and large enough to be *self-contained* (so the answer is complete
without its neighbours). This tension is the whole of Chapter 3.

### 3. Embed
Turn each chunk into a vector. Same model, same normalisation, for both documents and queries —
mixing embedding models is a silent, total failure.

### 4. Index
Store vectors in a structure that supports fast approximate nearest-neighbour search, plus the
original text and metadata for filtering and display.

## The online half: answering a question

### 5. Query processing
The raw user question is often a poor search query: pronouns unresolved ("does *it* support
SSO?"), several questions at once, or phrased nothing like the documents. Rewriting here
raises the ceiling for everything after it.

### 6. Retrieve
Fetch the top-k candidates — usually dense (vector) and sparse (keyword) in parallel, then
fused. Cast a *wide* net here: this stage decides your recall, and nothing downstream can
recover a chunk that was never fetched.

### 7. Rerank
Take the ~50 candidates and score them properly with a cross-encoder, keeping the best ~5.
Cheap wide retrieval followed by expensive narrow reranking is the standard shape, and for
good reason.

### 8. Generate
Assemble the surviving chunks into a prompt, instruct the model to answer only from them and to
cite, and stream the answer out.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'Retrieve wide, rerank narrow',
      md: `First-stage retrieval is fast and approximate: it compares pre-computed vectors, so
fetching 50 candidates costs barely more than fetching 5. Reranking is slow and accurate: it
runs a model over each *(query, chunk)* pair. Doing the cheap thing broadly and the expensive
thing selectively is the single most reliable structural improvement to a RAG system.`,
    },
    {
      type: 'markdown',
      md: `
## A minimal but honest implementation

Framework-free, so you can see every stage. Roughly 60 lines covers the whole pipeline.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'minimal_rag.py',
      code: `import numpy as np

# ---------- OFFLINE ----------

def chunk(text: str, size: int = 800, overlap: int = 120) -> list[str]:
    """Naive character chunking. Chapter 3 replaces this with something structural."""
    step = size - overlap
    return [text[i:i + size] for i in range(0, len(text), step) if text[i:i + size].strip()]


def build_index(documents: list[dict], embed) -> dict:
    chunks, sources = [], []
    for doc in documents:
        for piece in chunk(doc["text"]):
            chunks.append(piece)
            sources.append(doc["source"])          # keep provenance for citations

    vectors = embed(chunks)                        # (n_chunks, dim)
    # Normalise once, offline: cosine similarity then reduces to a dot product.
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    return {"chunks": chunks, "sources": sources, "vectors": vectors}


# ---------- ONLINE ----------

def retrieve(index: dict, question: str, embed, k: int = 5) -> list[dict]:
    q = embed([question])[0]
    q /= np.linalg.norm(q)

    scores = index["vectors"] @ q                  # cosine, because both sides are unit length
    top = np.argsort(-scores)[:k]

    return [
        {"text": index["chunks"][i], "source": index["sources"][i], "score": float(scores[i])}
        for i in top
    ]


PROMPT = """Answer the question using ONLY the context below.
If the context does not contain the answer, say "I don't have that information."
Cite the source of each claim as [n].

Context:
{context}

Question: {question}"""


def answer(index: dict, question: str, embed, complete, k: int = 5) -> str:
    hits = retrieve(index, question, embed, k)
    context = "\\n\\n".join(
        f"[{n}] (source: {h['source']})\\n{h['text']}" for n, h in enumerate(hits, 1)
    )
    return complete(PROMPT.format(context=context, question=question))`,
      caption: 'Every stage is visible. Production systems replace each function — the shape stays identical.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Normalise once, offline',
      md: `Notice the vectors are normalised at index time. After that, cosine similarity is just
a dot product — one matrix multiply instead of a division per query. It is a small thing, but it
is the difference between the brute-force approach being viable for 50k chunks and not.`,
    },
    {
      type: 'markdown',
      md: `
## Which stage owns which failure

When an answer is wrong, the useful question is never "why is the model bad?" — it is "which
stage failed?" Retrieval failures and generation failures look identical from the outside and
have nothing in common as fixes.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Symptom', 'Likely stage', 'First thing to check'],
      rows: [
        ['Answer invents a fact that is nowhere in the corpus', 'Generation (8)', 'Was the prompt actually constraining? Print the assembled context'],
        ['"I don\'t have that information" but the doc exists', 'Retrieval (6) or Chunking (2)', 'Search the chunk store for the answer text — is it even a chunk?'],
        ['Right document, wrong detail — a number without its label', 'Chunking (2)', 'Was a table or list split across a chunk boundary?'],
        ['Answer is generic and hedged', 'Rerank (7) or top-k', 'Too many low-relevance chunks diluting the context'],
        ['Works for keywords, fails for paraphrases', 'Retrieval (6)', 'Dense retrieval missing; you may be keyword-only'],
        ['Fails on exact codes, IDs, error strings', 'Retrieval (6)', 'Sparse/BM25 retrieval missing; you may be dense-only'],
        ['Correct yesterday, wrong today', 'Index (4)', 'Stale index — was the changed document re-embedded?'],
        ['Follow-up questions break', 'Query processing (5)', 'Pronouns not resolved against conversation history'],
      ],
      caption: 'Keep this table. It converts "the bot is bad" into a specific stage to instrument.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The one diagnostic to build first',
      md: `Before any tuning, build a way to **see the retrieved chunks for a given query** —
a debug view, a log line, anything. Teams routinely spend weeks tuning prompts to fix what is a
retrieval problem, because they never looked at what retrieval returned. If the answer isn't in
the context, the prompt was never the issue.`,
    },
    {
      type: 'checklist',
      title: 'The eight stages, from memory',
      items: [
        '**Ingest** — bytes to clean text (quality ceiling starts here)',
        '**Chunk** — split into specific-yet-self-contained units',
        '**Embed** — text to vectors, same model both sides',
        '**Index** — ANN structure + text + metadata',
        '**Query** — rewrite, expand, resolve context',
        '**Retrieve** — wide net, dense + sparse',
        '**Rerank** — narrow to the genuinely best few',
        '**Generate** — answer from context only, with citations',
      ],
    },
  ],

  flashcards: [
    { front: 'Which RAG stages are offline and which are online?', back: 'Offline (on document change): ingest, chunk, embed, index. Online (per query): query processing, retrieve, rerank, generate. Push work leftward — offline work is free at query time.' },
    { front: 'What does "retrieve wide, rerank narrow" mean and why does it work?', back: 'Fetch ~50 candidates with cheap approximate vector search, then re-score them with an expensive but accurate cross-encoder and keep ~5. Wide retrieval protects recall; narrow reranking protects precision.' },
    { front: 'A RAG system answers "I don\'t have that information" although the document exists. Which stages are suspect?', back: 'Retrieval or chunking — check whether the answer text even exists as a chunk, then whether retrieval returned it. Not the prompt.' },
    { front: 'Why normalise embedding vectors at index time?', back: 'With unit-length vectors, cosine similarity reduces to a dot product, so scoring is a single matrix multiply per query instead of a per-vector division.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Which set of stages runs offline, when documents change rather than when a user asks a question?',
      options: [
        'Ingest, chunk, embed, index',
        'Retrieve, rerank, generate, cite',
        'Chunk, retrieve, rerank, generate',
        'Embed, query rewrite, retrieve, index',
      ],
      answerIndex: 0,
      explanation: 'The offline half turns documents into a searchable index and is amortised across every future query. Everything after — query processing, retrieval, reranking, generation — is paid on every single request, so its cost shows up as user-visible latency.',
    },
    {
      id: 'q2',
      prompt: 'Your system handles paraphrased questions well but fails whenever a user pastes an exact error code. Which stage is at fault?',
      options: [
        'Ingestion — error codes are being stripped during parsing',
        'Retrieval — you are dense-only and need a sparse/BM25 component',
        'Chunking — the chunks are too large',
        'Generation — the prompt needs to mention error codes',
      ],
      answerIndex: 1,
      explanation: 'Embeddings capture meaning, and a rare literal token like "ERR_4021" has almost no semantic content to capture — it lands nowhere useful in vector space. Keyword search scores exactly this case well, because the term is rare and therefore highly discriminative. This is the standard argument for hybrid search.',
    },
    {
      id: 'q3',
      prompt: 'Why is retrieval recall considered the ceiling on the whole pipeline?',
      options: [
        'Rerankers require high recall to run at all',
        'Low recall causes the model to exceed its context window',
        'No later stage can use a chunk that retrieval never returned',
        'Recall is the metric most vector databases optimise for',
      ],
      answerIndex: 2,
      explanation: 'Reranking can only reorder what it is given, and generation can only use what survives reranking. A missed chunk is unrecoverable downstream — which is why first-stage retrieval should cast a deliberately wide net and let the reranker do the discarding.',
    },
    {
      id: 'q4',
      prompt: 'A team spends two weeks rewriting prompts to stop the bot saying "I don\'t have that information". What should they have done first?',
      options: [
        'Increased the model temperature',
        'Switched to a larger language model',
        'Reduced top-k to remove noise',
        'Inspected the chunks actually retrieved for those queries',
      ],
      answerIndex: 3,
      explanation: 'If the answer is not in the retrieved context, the model is behaving correctly by refusing — no prompt can fix that. A debug view showing the retrieved chunks per query is the single highest-value diagnostic in a RAG system, and it distinguishes retrieval failures from generation failures in seconds.',
    },
    {
      id: 'q5',
      prompt: 'You want to attach an LLM-generated summary to every chunk to improve retrieval. Where does this belong?',
      options: [
        'Offline, during indexing — the cost is paid once and is free at query time',
        'Online, during retrieval, so summaries reflect the current query',
        'Online, during generation, so the model can summarise as it answers',
        'It should be avoided; summaries always hurt retrieval',
      ],
      answerIndex: 0,
      explanation: 'This is the "push work left" principle. An LLM call per chunk is far too slow to sit in the request path, but as an indexing step it is a one-off cost amortised over every future query. Anything not dependent on the specific question belongs in the offline half.',
    },
  ],
};
