import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'evaluation',
  title: 'Evaluation',
  summary: 'Separating retrieval metrics from generation metrics, building a golden set that is worth having, and using LLM judges without fooling yourself.',
  estimatedMinutes: 26,

  blocks: [
    {
      type: 'markdown',
      md: `
RAG systems fail silently. There is no exception, no 500, no red line on a dashboard — just an
answer that reads perfectly and is wrong. Without evaluation you cannot tell a change that
helped from one that hurt, which means every subsequent decision is a guess.

The single most important structural idea: **evaluate retrieval and generation separately.**
An end-to-end score tells you the system is 71% good and nothing about what to fix. Retrieval
metrics and generation metrics have different causes and different remedies.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    Q["Question"] --> R["Retrieval"]
    R --> G["Generation"]
    G --> A["Answer"]

    R -.-> RM["<b>Retrieval metrics</b><br/>recall@k, precision@k<br/>MRR, NDCG<br/><i>needs: relevance labels</i>"]
    G -.-> GM["<b>Generation metrics</b><br/>faithfulness, relevance<br/>completeness<br/><i>needs: the context</i>"]
    A -.-> EM["<b>End-to-end</b><br/>correctness, refusal rate<br/><i>needs: reference answers</i>"]
`.trim(),
      caption: 'Three measurement points, three different diagnoses.',
    },
    {
      type: 'markdown',
      md: `
## Retrieval metrics

**Recall@k** — of the chunks that are genuinely relevant, what fraction appeared in the top k?
**This is the metric that matters most**, because it is the ceiling: a chunk not retrieved
cannot be used. Measure it at your first-stage k (say 50), not at the final k.

**Precision@k** — of the k returned, what fraction are relevant? Matters after reranking, where
low precision means distractors in the prompt.

**MRR (Mean Reciprocal Rank)** — 1/(rank of the first relevant result), averaged. Good when
there is one right answer and its position matters.

**NDCG@k** — position-discounted gain with graded relevance. The most informative and the most
work to label, since it needs relevance grades rather than binary judgements.

**Hit rate** — did *any* relevant chunk appear in the top k? Crude, but a good production
canary.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Recall first, precision second',
      md: `Improve recall at first-stage retrieval (wider k, hybrid search, better chunking) and
precision after reranking. Optimising precision at stage one is the classic mistake: it narrows
the funnel and permanently discards chunks the reranker would have rescued.`,
    },
    {
      type: 'markdown',
      md: `
## Generation metrics

These need no reference answer — they compare the answer to the *context*, which makes them
cheap enough to run continuously:

**Faithfulness** — is every claim supported by the retrieved context? Decompose the answer into
atomic claims and check each against the context. This is your hallucination detector.

**Answer relevance** — does the answer actually address the question? A faithful answer can
still be beside the point.

**Context precision** — were the useful chunks ranked above the useless ones?

**Context recall** — does the retrieved context contain everything needed to produce the
reference answer? (This one *does* need a reference.)

Together these four are roughly what the RAGAS framework standardised, and the vocabulary is
worth adopting even if you write the checks yourself.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Symptom', 'Metric that catches it', 'Where to fix it'],
      rows: [
        ['Answer contains invented facts', 'Faithfulness ↓', 'Prompt constraints, generation model'],
        ['"I don\'t have that information" for answerable questions', 'Recall@k ↓', 'Chunking, hybrid search, wider k'],
        ['Rambling, unfocused answers', 'Answer relevance ↓', 'Fewer chunks, better reranking'],
        ['Right documents, wrong ranking', 'MRR / NDCG ↓', 'Add or tune the reranker'],
        ['Context has the answer but the model missed it', 'Faithfulness OK, correctness ↓', 'Chunk ordering, prompt, lost-in-the-middle'],
        ['Good on average, terrible on a query class', 'Per-segment breakdown', 'Depends — but you must segment to see it'],
      ],
    },
    {
      type: 'markdown',
      md: `
## The golden set

Everything depends on having a labelled evaluation set. It is a day of work and it pays for
itself in the first week.

**Aim for 50–200 questions.** Below 50, differences are noise. Above 200, maintenance cost
outweighs the extra signal — for a first set.

**Cover the real distribution**, deliberately including the awkward cases:

- Simple factual lookups (the easy majority)
- Multi-hop questions requiring two documents
- Questions with **no answer in the corpus** — these measure refusal, and omitting them is the
  most common flaw in a golden set
- Ambiguous questions with several valid readings
- Exact-identifier queries (error codes, IDs)
- Follow-up questions that depend on conversation history
- Questions whose answer changed between document versions

**Label per question:** the reference answer, the chunk IDs that should be retrieved, and a
category tag so you can segment results.

**Generate a draft, then curate by hand.** Have a model produce questions from your chunks —
then read every one. Ungrounded synthetic questions produce a benchmark that measures nothing.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'evaluate.py',
      code: `from dataclasses import dataclass
from statistics import mean


@dataclass
class EvalCase:
    question: str
    reference_answer: str | None       # None => this question SHOULD be refused
    relevant_chunk_ids: set[str]
    category: str                      # "factual" | "multi_hop" | "unanswerable" | ...


def recall_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    if not relevant:
        return 1.0                     # nothing to find; not a failure
    return len(set(retrieved[:k]) & relevant) / len(relevant)


def precision_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    if not retrieved[:k]:
        return 0.0
    return len(set(retrieved[:k]) & relevant) / len(retrieved[:k])


def mrr(retrieved: list[str], relevant: set[str]) -> float:
    for rank, doc_id in enumerate(retrieved, start=1):
        if doc_id in relevant:
            return 1.0 / rank
    return 0.0


def evaluate(cases: list[EvalCase], run, k: int = 10) -> dict:
    """run(question) -> (retrieved_chunk_ids, answer). Report by segment, not just overall."""
    rows = []
    for case in cases:
        retrieved, answer = run(case.question)
        refused = "I don't have that information" in answer

        rows.append({
            "category": case.category,
            "recall": recall_at_k(retrieved, case.relevant_chunk_ids, k),
            "precision": precision_at_k(retrieved, case.relevant_chunk_ids, k),
            "mrr": mrr(retrieved, case.relevant_chunk_ids),
            # For unanswerable questions, refusing IS the correct behaviour.
            "correct_refusal": refused if case.reference_answer is None else None,
            "wrongly_refused": refused if case.reference_answer is not None else None,
        })

    def avg(field: str, subset: list[dict]) -> float | None:
        values = [r[field] for r in subset if r[field] is not None]
        return round(mean(values), 3) if values else None

    report = {"overall": {m: avg(m, rows) for m in
                          ("recall", "precision", "mrr", "correct_refusal", "wrongly_refused")}}

    # The averages hide the interesting failures; always break down by category.
    for category in sorted({r["category"] for r in rows}):
        subset = [r for r in rows if r["category"] == category]
        report[category] = {m: avg(m, subset) for m in ("recall", "precision", "mrr")}

    return report`,
      caption: 'Note that refusing an unanswerable question counts as correct — a metric set without that is misleading.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'The averages hide everything interesting',
      md: `A system at 85% recall overall might be at 95% on factual lookups and 40% on multi-hop
questions. The average is stable while a whole query class is broken. **Always report by
segment.** Regressions almost always appear in one category before they touch the mean.`,
    },
    {
      type: 'markdown',
      md: `
## LLM-as-judge, used honestly

Human labelling does not scale, so a model grades the outputs. This works, with discipline:

- **Ask for binary or 3-point judgements**, not a 1–10 score. Models are unreliable at fine
  gradations and will cluster everything at 7.
- **Give the judge the criteria and the context**, and require a one-line justification before
  the verdict. Reasoning first measurably improves the verdict.
- **Calibrate against humans.** Label 50 cases by hand, run the judge on the same 50, and
  measure agreement. Below ~80%, fix the rubric before trusting the judge.
- **Use a different model** from the generator where you can — models favour their own outputs.
- **Judge one dimension per call.** "Rate faithfulness and relevance and completeness" produces
  one blended number that means nothing.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'judge.py',
      code: `FAITHFULNESS_JUDGE = """You are checking whether an answer is supported by its context.

Context:
{context}

Answer:
{answer}

List each factual claim in the answer. For each, state SUPPORTED or UNSUPPORTED with a
short reason. Then output a final line:
VERDICT: FAITHFUL   (every claim supported)
VERDICT: UNFAITHFUL (one or more claims unsupported)"""


def judge_faithfulness(context: str, answer: str, complete) -> bool:
    # Claim-by-claim reasoning BEFORE the verdict; a bare score is far less reliable.
    result = complete(FAITHFULNESS_JUDGE.format(context=context, answer=answer))
    return "VERDICT: FAITHFUL" in result


def calibrate(cases: list[dict], judge_fn, human_labels: list[bool]) -> float:
    """Agreement with human labels. Below ~0.8, fix the rubric before trusting the judge."""
    verdicts = [judge_fn(c["context"], c["answer"]) for c in cases]
    return sum(v == h for v, h in zip(verdicts, human_labels)) / len(cases)`,
    },
    {
      type: 'markdown',
      md: `
## Running evaluation as part of the work

- **On every change** to chunking, embeddings, retrieval or prompts — the whole point is
  attribution of cause.
- **In CI**, with thresholds. A pull request that drops recall@10 by 5% should fail.
- **On production traffic**, sampled. Run faithfulness on 1% of live answers; it needs no
  reference answer, only the context.
- **Log everything**: query, retrieved chunk IDs and scores, final context, answer, latency per
  stage. Production logs become your next golden set, and they are the only source of the
  queries users actually ask.
`.trim(),
    },
    {
      type: 'checklist',
      title: 'Evaluation checklist',
      items: [
        'A golden set of 50–200 questions, hand-curated, including unanswerable ones',
        'Retrieval and generation measured separately',
        'Recall@k measured at first-stage k, precision after reranking',
        'Results broken down by query category, never only averaged',
        'LLM judges calibrated against human labels before being trusted',
        'Evaluation wired into CI with regression thresholds',
        'Full per-stage logging in production, sampled for faithfulness',
      ],
    },
  ],

  flashcards: [
    { front: 'Why evaluate retrieval and generation separately?', back: 'They have different causes and different fixes. An end-to-end score tells you the system is 71% good but not whether the chunk was missing or the model ignored it.' },
    { front: 'What is faithfulness and why is it cheap to measure?', back: 'Whether every claim in the answer is supported by the retrieved context. It compares the answer to the context rather than to a reference answer, so it needs no labels and can run on live production traffic.' },
    { front: 'What is the most commonly omitted category in a golden set?', back: 'Questions with no answer in the corpus. Without them you never measure refusal, and a system that answers everything scores well while hallucinating freely.' },
    { front: 'Why ask an LLM judge for binary verdicts rather than a 1–10 score?', back: 'Models are unreliable at fine gradations and cluster scores around 7. Binary or 3-point judgements with a written justification before the verdict are far more consistent.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Overall recall is a healthy 85%, but users complain constantly. What is the most likely explanation?',
      options: [
        'A specific query category is failing badly while the average stays stable',
        'Recall is not a meaningful metric',
        'The generation model is too small',
        'The golden set is too large',
      ],
      answerIndex: 0,
      explanation: 'Averages hide category failures — 95% on factual lookups and 40% on multi-hop questions averages to something that looks fine. Users experience the categories, not the mean. This is why every evaluation report should break down by segment.',
    },
    {
      id: 'q2',
      prompt: 'Which metric detects hallucination without needing a reference answer?',
      options: [
        'MRR',
        'Faithfulness — checking each claim in the answer against the retrieved context',
        'Recall@k',
        'NDCG',
      ],
      answerIndex: 1,
      explanation: 'Faithfulness compares the answer to the context that was actually supplied, which is available for every request. That makes it the one quality metric you can run continuously on sampled production traffic — the others all require labels.',
    },
    {
      id: 'q3',
      prompt: 'Why must a golden set include questions the corpus cannot answer?',
      options: [
        'They test the vector index\'s error handling',
        'They are needed to compute recall correctly',
        'They are the only way to measure refusal behaviour, and refusal is a success case',
        'They increase the size of the evaluation set cheaply',
      ],
      answerIndex: 2,
      explanation: 'Without unanswerable questions, a system that confidently answers everything scores perfectly while hallucinating freely. Including them means "I don\'t have that information" is scored as correct — which is what makes refusal a target rather than a failure.',
    },
    {
      id: 'q4',
      prompt: 'You are optimising first-stage retrieval. Which metric should you target?',
      options: [
        'Precision@5, to keep the prompt clean',
        'Faithfulness, since it reflects final answer quality',
        'Latency, since retrieval dominates response time',
        'Recall@k at the first-stage k — it is the ceiling for everything downstream',
      ],
      answerIndex: 3,
      explanation: 'The first stage exists to not miss anything; the reranker handles precision afterwards. Optimising precision here narrows the funnel and permanently discards chunks reranking would have promoted. (Retrieval also rarely dominates latency — the LLM call does.)',
    },
    {
      id: 'q5',
      prompt: 'Before trusting an LLM judge, what must you do?',
      options: [
        'Calibrate it against human labels on ~50 cases and measure agreement',
        'Use the largest available model as the judge',
        'Have it output a 1–10 score for finer resolution',
        'Use the same model that generated the answers, for consistency',
      ],
      answerIndex: 0,
      explanation: 'An uncalibrated judge produces numbers that look like measurement but may not track human judgement at all. Measure agreement first; below roughly 80%, fix the rubric. Also prefer a *different* model from the generator — models systematically favour their own outputs.',
    },
  ],
};
