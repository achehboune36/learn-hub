import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'why-rag',
  title: 'Why RAG exists',
  summary: 'What a language model actually knows, why it invents the rest, and the three ways to fix it — only one of which scales to your data.',
  estimatedMinutes: 18,

  blocks: [
    {
      type: 'markdown',
      md: `
A language model is a very large function fitted to a very large pile of text, frozen at the
moment training stopped. Everything it "knows" is baked into its weights. That produces two
problems you cannot prompt your way out of:

1. **It does not know your data.** Your internal wiki, last quarter's incident reports, the
   customer's contract — none of it was in the training set, and none of it ever will be.
2. **It does not know that it does not know.** The model is trained to produce plausible
   continuations, not to abstain. Asked about your refund policy, it will produce a refund
   policy: fluent, specific, formatted like a real one, and invented.

That second failure is the dangerous one. A model that said "no idea" would be merely useless.
A model that fabricates a policy is a support ticket, or a lawsuit.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'The core reframing',
      md: `A hallucination is not a bug in the model's honesty. It is what happens when you ask a
text-completion system a question whose answer was never in its training data. The fix is not
to make the model more truthful — it is to **put the answer in front of it**.`,
    },
    {
      type: 'markdown',
      md: `
## Three ways to give a model knowledge

Only three approaches exist, and picking between them is the first real decision in any
LLM project.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Approach', 'How it works', 'Good for', 'Where it breaks'],
      rows: [
        ['**Fine-tuning**', 'Continue training on your data so knowledge enters the weights', 'Teaching *style*, format, tone, domain vocabulary, task behaviour', 'Facts. Retraining for every document change is absurd; you cannot cite sources; you cannot revoke a fact'],
        ['**Long-context prompting**', 'Paste everything into the prompt', 'Small, bounded corpora — one contract, one codebase file, a meeting transcript', 'Cost and latency scale with every token; attention degrades over very long inputs; corpora bigger than the window are simply impossible'],
        ['**RAG**', 'Retrieve the relevant slice at query time, put *that* in the prompt', 'Large, changing, factual corpora where answers must be attributable', 'Adds a retrieval system that can itself fail — and usually does, silently'],
      ],
      caption: 'These compose. Production systems often fine-tune for format and use RAG for facts.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The most common architectural mistake',
      md: `Reaching for fine-tuning to teach the model facts. Fine-tuning adjusts the *distribution*
of what the model says, not a lookup table it can consult. Facts learned this way come back
blurred, blended with neighbouring facts, and impossible to attribute or update. **Fine-tune for
behaviour, retrieve for knowledge.**`,
    },
    {
      type: 'markdown',
      md: `
## What RAG actually is

Strip away the tooling and RAG is one sentence:

> Before answering, search a store of your text for passages relevant to the question, then ask
> the model to answer **using only those passages**.

That's it. Every vector database, chunking strategy and reranker in the rest of this course is
an implementation detail of making that search good enough.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    Q["User question"] --> R{{"Retrieve"}}
    D[("Your documents")] --> R
    R --> C["Relevant passages"]
    C --> P["Prompt:<br/>context + question"]
    Q --> P
    P --> M["Language model"]
    M --> A["Answer<br/>+ citations"]
`.trim(),
      caption: 'RAG in one picture: the model never touches your corpus, only the passages retrieval selected.',
    },
    {
      type: 'markdown',
      md: `
## What you gain

- **Freshness.** Update a document, re-index it, and the next answer reflects it. No retraining.
- **Attribution.** You know which passages produced the answer, so you can cite them — and a
  reader can check.
- **Access control.** Retrieval can filter by permissions before the model ever sees the text.
  Fine-tuning cannot un-learn a document for one user.
- **Cost.** You pay for a few thousand tokens of relevant context instead of a million tokens
  of corpus.
- **Debuggability.** When an answer is wrong you can ask *which stage* was wrong: did retrieval
  miss the passage, or did the model ignore it? That question has an answer. "Why did the
  fine-tuned model say that?" does not.

## What you take on

RAG replaces one hard problem with a pipeline of smaller ones, each of which can fail quietly:

- The relevant passage exists but retrieval didn't return it (a recall failure — the ceiling on
  everything downstream).
- Retrieval returned it, but buried at position 14 where the model's attention is thinnest.
- Retrieval returned it, and the model ignored it in favour of its own prior.
- The chunk was split mid-table, so the number is there but the column header isn't.

None of these throw an exception. They produce a confident, wrong answer — which is exactly
what you adopted RAG to avoid. That is why evaluation (Chapter 9) is not optional garnish; it
is the only thing standing between you and a system that is wrong 20% of the time without
anyone noticing.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'analogy',
      md: `A fine-tuned model is a colleague who read your entire wiki once, a year ago, and
answers from memory. A RAG system is a colleague who says "hang on, let me look it up" and
comes back with the page open. The second is slower and depends on the search working — but you
can see what they read.`,
    },
    {
      type: 'markdown',
      md: `
## When *not* to use RAG

Reaching for RAG reflexively is its own failure mode:

- **The corpus fits in the context window and rarely changes.** Just paste it in. A 30-page
  handbook does not need a vector database.
- **The task is reasoning, not recall.** "Refactor this function" gains nothing from retrieval.
- **You need aggregate answers.** "How many tickets mentioned billing last month?" is a SQL
  query. Retrieval returns *some* relevant chunks — it has no notion of completeness, so it
  cannot count. Route the question to a database instead.
- **Latency is critical and the answer set is tiny.** A cached FAQ lookup beats a pipeline.

The instinct to develop: RAG is for **large, changing, factual corpora where answers must be
attributable**. Outside that shape, something simpler is usually correct.
`.trim(),
    },
    {
      type: 'checklist',
      title: 'Decide before you build',
      items: [
        'Is the knowledge *factual and changing*, or is it *style and behaviour*? (Retrieve vs. fine-tune)',
        'Does the corpus fit comfortably in a context window? (Then skip retrieval)',
        'Do answers need citations a human can check?',
        'Does the question need *complete* aggregation? (Then it is a database query)',
        'Do different users have access to different documents? (Then retrieval must filter first)',
      ],
    },
  ],

  flashcards: [
    { front: 'Why does fine-tuning fail as a way to teach a model *facts*?', back: 'Facts enter the weights as a blurred statistical distribution, not a lookup table. They cannot be cited, updated, revoked, or access-controlled — and every document change means retraining.' },
    { front: 'What is the single-sentence definition of RAG?', back: 'Search a store of your text for passages relevant to the question, then have the model answer using only those passages.' },
    { front: 'Which RAG failure sets the ceiling for everything downstream?', back: 'Retrieval recall. If the relevant chunk is never returned, no reranker, prompt or model can recover it.' },
    { front: 'When is RAG the wrong tool?', back: 'When the corpus fits in the context window, when the task is reasoning rather than recall, or when the question needs complete aggregation (that is a database query).' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your support bot invents a refund policy that does not exist. What is the root cause?',
      options: [
        'The model was asked a question whose answer was never in its training data, and it is built to produce plausible continuations rather than abstain',
        'The model was trained with too high a temperature setting',
        'The model is deliberately being deceptive',
        'The model needs more parameters',
      ],
      answerIndex: 0,
      explanation: 'Hallucination is not dishonesty — it is a completion system filling a gap. The model has no mechanism to know its training data lacked your policy. The fix is to put the real policy in the prompt, not to make the model "more truthful".',
    },
    {
      id: 'q2',
      prompt: 'You need the assistant to always reply in your company\'s terse, bulleted house style. Which approach fits best?',
      options: [
        'Increasing top-k',
        'Fine-tuning',
        'RAG over the style guide',
        'A larger vector index',
      ],
      answerIndex: 1,
      explanation: 'Style, tone and output format are exactly what fine-tuning is good at — they are behaviour, not facts. Retrieving the style guide on every query wastes context on something that should be baked in. The rule: fine-tune for behaviour, retrieve for knowledge.',
    },
    {
      id: 'q3',
      prompt: 'Which of these questions is a poor fit for RAG?',
      options: [
        '"What did the post-mortem say caused the March outage?"',
        '"Which clause covers early termination in the Acme contract?"',
        '"How many support tickets mentioned billing last month?"',
        '"What is our refund window for enterprise customers?"',
      ],
      answerIndex: 2,
      explanation: 'Counting requires completeness. Retrieval returns *some* relevant chunks and has no notion of having found them all, so it cannot count reliably. That question should be routed to a database. The other three are lookups of specific passages — exactly RAG\'s shape.',
    },
    {
      id: 'q4',
      prompt: 'What is the main operational advantage of RAG over fine-tuning when a document changes?',
      options: [
        'The model automatically forgets the old version during inference',
        'Fine-tuned models cannot be updated at all',
        'RAG compresses documents so updates are cheaper to store',
        'Re-index the changed document and the next answer reflects it — no retraining',
      ],
      answerIndex: 3,
      explanation: 'Knowledge lives outside the weights, so updating it is a re-indexing job measured in seconds, not a training run. Fine-tuned models *can* be retrained, but doing so per document edit is economically absurd — and you still could not revoke a single fact.',
    },
    {
      id: 'q5',
      prompt: 'A RAG answer is confidently wrong. What makes this more debuggable than the same error from a fine-tuned model?',
      options: [
        'You can inspect which passages were retrieved and separate a retrieval failure from a generation failure',
        'RAG systems log an exception when the answer is wrong',
        'The vector database stores the correct answer for comparison',
        'RAG models expose their internal confidence scores',
      ],
      answerIndex: 0,
      explanation: 'The pipeline gives you an inspection point. Look at the retrieved chunks: if the answer was not in them, retrieval failed; if it was and the model said otherwise, generation failed. Each has a different fix. A fine-tuned model offers no equivalent seam — and note that nothing here throws an error, which is why you need explicit evaluation.',
    },
  ],
};
