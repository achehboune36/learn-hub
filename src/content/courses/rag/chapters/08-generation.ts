import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'generation',
  title: 'Generation, grounding and citations',
  summary: 'The prompt is the contract between your retrieval and your answer: how to structure it, how to make refusal an acceptable outcome, and how to get citations that actually resolve.',
  estimatedMinutes: 22,

  blocks: [
    {
      type: 'markdown',
      md: `
Everything so far has been about putting the right text in front of the model. This chapter is
about making sure it *uses* that text — and admits when the text does not contain the answer.

Two failure modes dominate:

- **Ignoring the context** and answering from parametric memory. The model has opinions about
  refund policies; yours may differ.
- **Answering anyway** when the context is insufficient, producing something plausible from
  fragments.

Both are prompt-and-evaluation problems, not model-capability problems.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Anatomy of a grounded prompt

Six parts, in this order, and each is doing work:
`.trim(),
    },
    {
      type: 'code',
      lang: 'text',
      filename: 'prompt_structure.txt',
      code: `1. ROLE          Who the assistant is, what corpus it speaks for
2. RULES         Answer only from context. Say so when you cannot. Cite everything.
3. CONTEXT       Numbered, source-labelled chunks
4. QUESTION      The user's actual question (restated after the context)
5. FORMAT        Shape of the expected answer
6. (optional)    A worked example of the refusal case`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'prompt.py',
      code: `SYSTEM = """You are a support assistant for Acme Cloud. You answer strictly from the
documentation excerpts provided in each request.

Rules:
1. Use ONLY the numbered context below. Do not use outside knowledge, even if you are
   confident it is correct.
2. Cite the excerpt number for every factual claim, like this: [2].
3. If the context does not contain the answer, reply exactly:
   "I don't have that information in the documentation."
   Do not guess, and do not assemble an answer from loosely related excerpts.
4. If excerpts disagree, say so and cite both.
5. Answer in at most 150 words unless the user asks for detail."""

USER = """Context:
{context}

Question: {question}"""


def build_messages(question: str, context: str) -> list[dict]:
    # The question is repeated AFTER the context: it lands at the end, where
    # attention is strongest, and frames what the model should look for.
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": USER.format(context=context, question=question)},
    ]`,
      caption: 'Rule 3 is the one most systems omit, and the one that prevents most hallucinations.',
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Make refusal a first-class outcome',
      md: `A model will not refuse unless refusing is clearly permitted, given exact wording, and
demonstrated. "If you don't know, say so" is too weak — models read it as a soft suggestion and
prefer to be helpful. Give the **exact refusal string**, and evaluate refusal as a *success*
case, not a failure. A system that refuses 8% of the time and is right the other 92% is far more
useful than one that always answers and is right 85% of the time.`,
    },
    {
      type: 'markdown',
      md: `
## Citations that actually resolve

Citations are the difference between an answer a user can verify and one they must trust. Three
approaches:

**Inline numbers** — \`[2]\` referring to the numbered chunk. Cheap, reliable, easy to render as
a link back to the source. The default.

**Structured output** — the model returns JSON with an answer field and a list of supporting
chunk IDs per claim. More rigorous, easier to validate programmatically, slightly more failure-
prone.

**Post-hoc attribution** — generate freely, then match each sentence back to the context with a
second model. Most robust, doubles the cost.

Whichever you choose, **validate the citations**. Models cite \`[7]\` when only five chunks were
supplied. A three-line check catches it, and a citation pointing nowhere is worse than none.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'validate_citations.py',
      code: `import re


def validate_citations(answer: str, n_chunks: int) -> tuple[bool, list[int]]:
    """Catch citations pointing at excerpts that were never supplied."""
    cited = {int(n) for n in re.findall(r"\\[(\\d+)\\]", answer)}
    invalid = sorted(n for n in cited if not 1 <= n <= n_chunks)
    return not invalid, invalid


def has_uncited_claims(answer: str) -> bool:
    """Flag substantive sentences carrying no citation at all.

    Deliberately crude -- it is a monitoring signal, not a gate.
    """
    refusal_markers = ("I don't have", "not in the documentation")
    if any(m in answer for m in refusal_markers):
        return False

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\\s+", answer) if len(s.strip()) > 40]
    return any("[" not in s for s in sentences)`,
    },
    {
      type: 'markdown',
      md: `
## Handling conflict and insufficiency

Real corpora contradict themselves — a 2022 policy and its 2024 replacement both sit in the
index. Silently picking one is the worst outcome. Instruct the model to surface the conflict and
cite both, and use metadata (dates, document status) to let it prefer the current one:

> The 2024 policy states a 30-day refund window [1]. An earlier 2022 document states 14 days
> [4]. The 2024 document appears to supersede it.

Similarly, distinguish **partial** answers from refusals. If the context covers half the
question, say which half — that is more useful than a flat refusal and more honest than a
complete-sounding answer.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    C["Retrieved context"] --> D{"Does context<br/>contain the answer?"}
    D -->|"Fully"| A["Answer + cite"]
    D -->|"Partially"| P["Answer the covered part,<br/>state what is missing"]
    D -->|"No"| R["Exact refusal string"]
    D -->|"Conflicting"| X["Present both,<br/>cite both, note recency"]

    A --> V{"Citations valid?"}
    P --> V
    V -->|"no"| L["Log + flag for review"]
    V -->|"yes"| OUT["Return to user"]
`.trim(),
      caption: 'Four outcomes, not two. Most systems only implement the first.',
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Temperature is not the hallucination dial',
      md: `Setting temperature to 0 makes the model *deterministic*, not *grounded*. It will
produce the same ungrounded answer every time. Grounding comes from what is in the context and
what the prompt permits — temperature only controls sampling variance. Use a low temperature
for consistency, but do not mistake it for a correctness mechanism.`,
    },
    {
      type: 'markdown',
      md: `
## Streaming and the citation problem

Users want the first token fast, but citations often need validating against the whole answer.
The practical resolution:

- Stream the prose immediately.
- Buffer citation markers and resolve them to links as they complete.
- Run validation on the finished answer and, if it fails, append a correction or flag the
  response — do not silently ship a broken citation.
- Show retrieved sources in the UI *before* generation finishes. Users start reading them, and
  perceived latency drops sharply.

## Choosing a generation model

Bigger is not automatically better here, because the task is unusual: the knowledge is supplied,
so what you need is **instruction-following and faithfulness**, not world knowledge.

- A smaller, faster model with excellent instruction-following often beats a larger one that
  "helpfully" embellishes.
- Long-context capability matters less than you would think — you should be sending 3–8 chunks,
  not 50.
- Test specifically for *faithfulness under pressure*: give the model context that contradicts
  its training data and see whether it defers to the context. That single test separates
  candidates faster than any benchmark.
`.trim(),
    },
    {
      type: 'checklist',
      title: 'Generation checklist',
      items: [
        'Prompt states "use only the context" and gives the exact refusal string',
        'Question repeated after the context, where attention is strongest',
        'Every chunk numbered and source-labelled for citation',
        'Citations validated against the number of chunks actually supplied',
        'Conflicting sources surfaced rather than silently resolved',
        'Partial answers distinguished from refusals',
        'Sources shown in the UI before generation completes',
        'Model chosen by faithfulness under contradiction, not by size',
      ],
    },
  ],

  flashcards: [
    { front: 'Why does "if you don\'t know, say so" usually fail?', back: 'Models read it as a soft suggestion and default to being helpful. Refusal needs an exact string, explicit permission, and to be evaluated as a success case rather than a failure.' },
    { front: 'Does temperature=0 prevent hallucination?', back: 'No. It makes output deterministic, not grounded — you get the same ungrounded answer every time. Grounding comes from the context and the prompt constraints.' },
    { front: 'Why repeat the question after the context rather than before?', back: 'It lands at the end of the prompt where attention is strongest, and it frames what the model should look for in text it has just read.' },
    { front: 'What are the four outcomes a grounded RAG answer should support?', back: 'Full answer with citations; partial answer stating what is missing; explicit refusal; and conflict — presenting both sources with citations and noting recency.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your system confidently answers questions its documentation does not cover. What is the most effective fix?',
      options: [
        'Give the prompt an exact refusal string and treat refusal as a success case in evaluation',
        'Lower the temperature to 0',
        'Switch to a larger generation model',
        'Increase top-k so more context is available',
      ],
      answerIndex: 0,
      explanation: 'Models default to helpfulness and will assemble an answer from loosely related fragments unless refusing is explicitly permitted and demonstrated. Temperature only affects sampling variance; a larger model is often *more* fluent at ungrounded answers; and more context makes assembling a plausible non-answer easier, not harder.',
    },
    {
      id: 'q2',
      prompt: 'The model cites [7] but only 5 chunks were supplied. What should the system do?',
      options: [
        'Retry with a lower temperature',
        'Detect it with a validation check and flag or correct the response',
        'Silently drop the citation and return the answer',
        'Ignore it — citation numbers are cosmetic',
      ],
      answerIndex: 1,
      explanation: 'A citation that resolves to nothing is worse than no citation: it manufactures the appearance of verifiability. Comparing the cited numbers against the count of supplied chunks is a three-line check and catches a real, recurring failure.',
    },
    {
      id: 'q3',
      prompt: 'Retrieval returns a 2022 policy and a 2024 policy that contradict each other. What is the best behaviour?',
      options: [
        'Refuse to answer because the context is inconsistent',
        'Average the two policies into a single statement',
        'Present both, cite both, and note which appears to supersede the other',
        'Return the higher-scoring chunk only',
      ],
      answerIndex: 2,
      explanation: 'Silently picking one hides a real problem from the user — and retrieval scores have no notion of currency, so the wrong one may well win. Surfacing the conflict with both citations lets the user judge, and using date metadata lets the model point at the likely current version.',
    },
    {
      id: 'q4',
      prompt: 'When choosing a generation model for RAG, what matters most?',
      options: [
        'The breadth of its world knowledge',
        'Its maximum context window',
        'Its performance on general reasoning benchmarks',
        'Faithfulness — whether it defers to supplied context that contradicts its training data',
      ],
      answerIndex: 3,
      explanation: 'In RAG the knowledge is supplied, so world knowledge is nearly irrelevant and a very large context window is unnecessary if you are sending 3–8 chunks. What you need is a model that follows the "use only this context" instruction under pressure — testing it with context that contradicts its priors separates candidates fast.',
    },
    {
      id: 'q5',
      prompt: 'Why show retrieved sources in the UI before generation finishes?',
      options: [
        'Users begin reading immediately, which sharply reduces perceived latency and builds trust',
        'It is required for citations to render correctly',
        'It lets the model retrieve additional context mid-generation',
        'It reduces the number of tokens the model must generate',
      ],
      answerIndex: 0,
      explanation: 'The sources exist the moment retrieval completes, well before the first generated token. Showing them turns dead waiting time into useful reading time, and it makes the system legible — the user can see what it is answering from, which is much of the point of RAG.',
    },
  ],
};
