import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'retrieval',
  title: 'Retrieval strategies',
  summary: 'Dense and sparse retrieval fail in opposite ways. Fusing them, and fixing the query before it reaches either, is where most real-world recall comes from.',
  estimatedMinutes: 25,

  blocks: [
    {
      type: 'markdown',
      md: `
Retrieval is the stage that sets your ceiling, so it deserves more attention than it usually
gets. Three ideas do most of the work here: **hybrid search**, **rank fusion**, and **query
rewriting**. None require a better model — they are engineering, and they compound.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Sparse retrieval: BM25 and why it refuses to die

BM25 scores a document by the query terms it contains, weighted by two intuitions that have
survived forty years of attempts to replace them:

- **Term frequency, with diminishing returns.** A document mentioning "refund" eight times is
  more relevant than one mentioning it once — but not eight times more.
- **Inverse document frequency.** A term appearing in every document ("the", "system") tells
  you nothing. A term appearing in three documents ("ERR_4021") tells you almost everything.
  Rarity *is* the signal.

It is called *sparse* because the vector representation has one dimension per vocabulary term
and is almost entirely zeros.

BM25 is exact, interpretable, needs no GPU, updates instantly, and beats embeddings outright on
identifiers, error codes, proper nouns, jargon and quoted phrases. It fails on paraphrase: a
user asking *"how do I stop being billed"* against a document titled *"Cancelling your
subscription"* scores near zero.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'The complementarity argument',
      md: `Dense and sparse retrieval do not fail on the same queries. Dense handles meaning and
misses literals; sparse handles literals and misses meaning. Running both and fusing the results
is close to free — you already have the text — and it is the single largest recall improvement
most systems can make. **Hybrid is not an optimisation; it is the default.**`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    Q["User query"] --> QR["Query rewriting<br/><i>resolve, expand, decompose</i>"]
    QR --> D["Dense retrieval<br/><i>embeddings, top-50</i>"]
    QR --> S["Sparse retrieval<br/><i>BM25, top-50</i>"]
    D --> F{{"Reciprocal Rank Fusion"}}
    S --> F
    F --> C["~60 unique candidates"]
    C --> RR["Reranker<br/><i>Chapter 7</i>"]
    RR --> T["Top 5 to the prompt"]
`.trim(),
      caption: 'The standard production shape: rewrite, retrieve twice, fuse, rerank.',
    },
    {
      type: 'markdown',
      md: `
## Fusing two ranked lists

You have a BM25 list scored 0–35 and a cosine list scored 0–1. You cannot add them: the scales
are unrelated and BM25 scores are unbounded and corpus-dependent. Normalising them is possible
but fragile — score distributions shift with the query.

**Reciprocal Rank Fusion (RRF)** sidesteps the problem entirely by discarding the scores and
using only the *ranks*:

\`\`\`
RRF(d) = sum over retrievers r of   1 / (k + rank_r(d))
\`\`\`

with \`k\` conventionally 60. A document ranked #1 by one retriever scores \`1/61\`; ranked #1
by both, \`2/61\`. Appearing high in *both* lists beats appearing first in one.

RRF is parameter-light, scale-free, needs no tuning, and works remarkably well. It is the right
default. Weighted score fusion can edge past it when carefully tuned per corpus — which is
rarely worth the maintenance.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'hybrid.py',
      code: `from collections import defaultdict


def reciprocal_rank_fusion(rankings: list[list[str]], k: int = 60,
                           weights: list[float] | None = None) -> list[tuple[str, float]]:
    """Fuse ranked ID lists. Uses ranks only, so incompatible score scales don't matter."""
    weights = weights or [1.0] * len(rankings)
    scores: dict[str, float] = defaultdict(float)

    for ranking, weight in zip(rankings, weights):
        for rank, doc_id in enumerate(ranking, start=1):
            scores[doc_id] += weight / (k + rank)

    return sorted(scores.items(), key=lambda kv: -kv[1])


def hybrid_search(query: str, dense_fn, sparse_fn, k: int = 50) -> list[str]:
    """Retrieve wide from both sides, fuse, hand the union to the reranker.

    Both retrievers run over the same corpus, so the union is typically ~1.2x k,
    not 2k -- the overlap is exactly the documents both methods agree on.
    """
    dense_ids = dense_fn(query, k)     # semantic: paraphrase, concepts
    sparse_ids = sparse_fn(query, k)   # lexical: codes, names, exact phrases
    fused = reciprocal_rank_fusion([dense_ids, sparse_ids])
    return [doc_id for doc_id, _ in fused]


# Worked example: the two retrievers disagree, and RRF resolves it sensibly.
dense =  ["chunk_A", "chunk_B", "chunk_C"]
sparse = ["chunk_C", "chunk_A", "chunk_D"]

for doc_id, score in reciprocal_rank_fusion([dense, sparse]):
    print(f"{doc_id}: {score:.5f}")

# chunk_A: 0.03252   <- 1/61 + 1/62, top of one list and near-top of the other
# chunk_C: 0.03226   <- 1/63 + 1/61
# chunk_B: 0.01613   <- 1/62, dense only
# chunk_D: 0.01587   <- 1/63, sparse only`,
      caption: 'Agreement across retrievers is the strongest signal available at this stage.',
    },
    {
      type: 'markdown',
      md: `
## Fixing the query before you search

The user's question is often a bad search query. Four transformations, in rough order of value:

### 1. Contextualisation (essential for chat)
*"Does it support SSO?"* is unanswerable standalone. Rewrite against the conversation history
into *"Does Acme Cloud Enterprise support SSO?"*. Without this, multi-turn RAG breaks on turn
two — and this is the most common reason a demo works and the product does not.

### 2. Decomposition
*"How do refunds differ between Pro and Enterprise?"* needs two retrievals, not one. Split it,
retrieve for each, merge the context.

### 3. Expansion
Generate two or three paraphrases and retrieve for all of them, fusing with RRF. Directly
attacks vocabulary mismatch between user language and document language.

### 4. HyDE
Have the model draft a *hypothetical answer*, then embed **that** and retrieve with it. The
insight: questions and answers live in different regions of embedding space, and documents look
like answers. A fabricated answer — even a partly wrong one — is often geometrically closer to
the real passage than the question was.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'analogy',
      title: 'Why HyDE works',
      md: `Searching a library with your question is like looking for a book whose *cover* matches
your question. HyDE writes a rough paragraph of what the answer probably says, then looks for a
page that resembles *that*. You are matching answer-shaped text to answer-shaped text — which
is what the corpus actually contains.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'query_processing.py',
      code: `CONTEXTUALIZE = """Given the conversation, rewrite the final question so it stands alone.
Resolve every pronoun and implied reference. Change nothing else.

Conversation:
{history}

Final question: {question}
Standalone question:"""

EXPAND = """Write 3 alternative phrasings of this question, using different vocabulary
that might appear in documentation. One per line, no numbering.

Question: {question}"""

HYDE = """Write a short, confident paragraph that answers this question as if quoting
internal documentation. Invent plausible specifics. It does not need to be correct --
it is used only as a search probe.

Question: {question}"""


def prepare_query(question: str, history: list[str], complete, embed) -> dict:
    """Turn one user turn into several retrieval probes."""
    if history:
        question = complete(CONTEXTUALIZE.format(
            history="\\n".join(history[-6:]), question=question
        )).strip()

    variants = [question]
    variants += [v.strip() for v in complete(EXPAND.format(question=question)).splitlines() if v.strip()]

    hypothetical = complete(HYDE.format(question=question))

    return {
        "text_queries": variants,              # -> BM25, one search per variant
        "vectors": embed(variants + [hypothetical]),  # -> dense, HyDE probe included
    }`,
      caption: 'Each transformation costs an LLM call, so they belong behind a latency budget — see the warning below.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Query rewriting is not free',
      md: `Every rewrite is an LLM call **in the request path**, before retrieval even starts.
Contextualisation is usually worth it unconditionally in a chat product. Expansion and HyDE add
several hundred milliseconds each and should be measured, not assumed — use a small fast model,
run the variants in parallel, and cache aggressively on the normalised query.`,
    },
    {
      type: 'markdown',
      md: `
## Choosing top-k

k is the dial between recall and noise, and it means different things at different stages:

- **First-stage retrieval: k = 30–100.** Wide. You are protecting recall, and the reranker will
  discard the rest. Cheap.
- **After reranking: k = 3–8** into the prompt. Narrow. More chunks means more distractors, and
  models measurably degrade when the context is padded with near-misses.

Without a reranker, k = 5–10 is the usual compromise, and it is a genuinely worse system.
Also apply a **similarity floor**: without one, a nonsense question still returns the k
least-bad chunks and the model will dutifully try to answer from them.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Query type', 'Dense', 'Sparse', 'Winner'],
      rows: [
        ['"how do I stop being billed"', 'Strong — matches "cancel subscription"', 'Weak — no shared terms', 'Dense'],
        ['"ERR_4021"', 'Weak — no semantic content', 'Strong — rare term, high IDF', 'Sparse'],
        ['"what is idempotency"', 'Strong', 'Moderate — the term appears literally', 'Dense'],
        ['"Section 14.2(b)"', 'Weak', 'Strong', 'Sparse'],
        ['"Acme Corp renewal terms"', 'Moderate', 'Strong — proper noun', 'Hybrid'],
        ['"why is my deployment slow"', 'Strong', 'Weak', 'Dense'],
      ],
      caption: 'Neither column wins everywhere. That is the point.',
    },
    {
      type: 'checklist',
      title: 'Retrieval checklist',
      items: [
        'Both dense and sparse retrieval running, fused with RRF',
        'Conversation-aware query rewriting, if the product has multi-turn chat',
        'First-stage k set wide (30–100) with reranking downstream',
        'A similarity floor so irrelevant queries return nothing',
        'Metadata pre-filtering for permissions and recency',
        'Expansion and HyDE measured against a latency budget, not enabled by default',
      ],
    },
  ],

  flashcards: [
    { front: 'Why can\'t you just add BM25 and cosine scores together?', back: 'The scales are unrelated — BM25 is unbounded and corpus-dependent, cosine is 0–1. RRF avoids the problem by using ranks only: score = Σ 1/(60 + rank).' },
    { front: 'What is HyDE and why does it work?', back: 'Have the model draft a hypothetical answer, embed that, and retrieve with it. Questions and answers occupy different regions of embedding space, and the corpus contains answer-shaped text — so an invented answer is often geometrically closer to the real passage than the question is.' },
    { front: 'Which query transformation is essential for multi-turn chat?', back: 'Contextualisation — rewriting "does it support SSO?" into a standalone question using the conversation history. Without it, RAG chat breaks on the second turn.' },
    { front: 'What top-k values are appropriate at each stage?', back: 'First-stage retrieval: 30–100 (wide, protects recall, cheap). Into the prompt after reranking: 3–8 (narrow, since extra chunks act as distractors).' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Why does BM25 remain valuable alongside embedding search?',
      options: [
        'It excels exactly where embeddings fail: identifiers, error codes, proper nouns and exact phrases',
        'It is more accurate than embeddings on paraphrased questions',
        'It requires less storage than a vector index',
        'It can be updated without re-indexing, unlike vector search',
      ],
      answerIndex: 0,
      explanation: 'BM25 rewards term rarity, which is precisely the signal a rare literal token carries and an embedding cannot represent. The two methods fail on disjoint query types, which is why fusing them is the largest cheap recall win available.',
    },
    {
      id: 'q2',
      prompt: 'A document is ranked #1 by dense retrieval and #1 by BM25. Under RRF with k=60, what is its score?',
      options: [
        'It depends on the raw similarity scores',
        '2/61 — the sum of 1/(60+1) from each retriever',
        '1/61 — rank 1 is rank 1 regardless of how many retrievers agree',
        '1/122 — the reciprocal of the summed ranks',
      ],
      answerIndex: 1,
      explanation: 'RRF sums 1/(k + rank) across retrievers, so agreement accumulates. This is the property that makes it useful: a document both methods rank highly outranks one that only a single method loves — and none of it depends on the incompatible raw scores.',
    },
    {
      id: 'q3',
      prompt: 'Your chatbot answers the first question well but fails on "and what about the Pro plan?". What is missing?',
      options: [
        'A reranker',
        'A bigger embedding model',
        'Query contextualisation — rewriting the follow-up into a standalone question using history',
        'A larger top-k',
      ],
      answerIndex: 2,
      explanation: 'Retrieved against the corpus, "and what about the Pro plan?" has almost no usable signal — the subject lives in the previous turn. Rewriting it into "What are the refund terms for the Pro plan?" restores it. This is the most common reason a RAG demo works and the shipped chat product does not.',
    },
    {
      id: 'q4',
      prompt: 'What is the reasoning behind HyDE?',
      options: [
        'Hypothetical answers are usually correct, so they can be returned directly',
        'It reduces the number of embeddings that must be computed',
        'It lets the model bypass retrieval when it already knows the answer',
        'Documents contain answer-shaped text, so an invented answer is often closer in embedding space to the real passage than the question is',
      ],
      answerIndex: 3,
      explanation: 'It is a geometric argument, not a correctness one. Questions and answers occupy different regions of the space; searching with answer-shaped text matches answer-shaped documents. The draft can be factually wrong and still be an excellent search probe.',
    },
    {
      id: 'q5',
      prompt: 'You retrieve 50 candidates and pass all 50 to the model. What is the likely consequence?',
      options: [
        'Answer quality drops — the extra chunks act as distractors, and cost and latency rise',
        'Answer quality improves monotonically with more context',
        'The model automatically ignores irrelevant chunks at no cost',
        'Recall improves, so the answer is more likely to be correct',
      ],
      answerIndex: 0,
      explanation: 'Wide retrieval is for the reranker, not the prompt. Models measurably degrade when relevant text is buried among near-misses, and you pay for every token. The pattern is retrieve wide, rerank, then send only the surviving 3–8 chunks.',
    },
  ],
};
