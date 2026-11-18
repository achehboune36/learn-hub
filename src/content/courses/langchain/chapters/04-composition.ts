import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'composition',
  title: 'Composition and the runnable protocol',
  summary: 'The pipe operator, parallel branches, retries and fallbacks as configuration rather than control flow, and an honest account of where declarative composition stops being the right tool.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
Every component in LangChain implements one protocol. A prompt, a model, a parser, a retriever
and a whole composed chain all answer to the same six methods:

\`\`\`
invoke   batch   stream          (synchronous)
ainvoke  abatch  astream         (asynchronous)
\`\`\`

Because the interface is uniform, components compose with the pipe operator, and the composite
is itself a runnable with the same interface. That single property is what makes streaming
propagate through a chain nobody wrote streaming code for, and what lets \`.with_retry()\` attach
to anything.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'pipes.py',
      caption: 'The output type of each stage must match the input type of the next. Most composition errors are that mismatch, reported one stage later than you expect.',
      code: `from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain.chat_models import init_chat_model

model = init_chat_model("openai:gpt-4o")
prompt = ChatPromptTemplate.from_template("Summarise in one sentence: {text}")

# dict -> PromptValue -> AIMessage -> str
chain = prompt | model | StrOutputParser()

chain.invoke({"text": article})              # one result
chain.batch([{"text": a} for a in articles]) # concurrent, order preserved
for token in chain.stream({"text": article}):
    print(token, end="")                     # streams end to end, for free

# batch concurrency is bounded, and the bound is yours to set. Without this you
# will discover your provider's rate limit the hard way, in production.
chain.batch(inputs, config={"max_concurrency": 5})`,
    },
    {
      type: 'markdown',
      md: `
## The four primitives

Nearly every chain you will read is built from these.

**\`RunnableParallel\`** — a dict of runnables, all executed concurrently, results collected into
a dict of the same keys. Written as a plain dict inside a pipe.

**\`RunnablePassthrough\`** — forwards its input unchanged. Its real use is
\`.assign()\`, which adds computed keys to a dict while keeping what was already there.

**\`RunnableLambda\`** — wraps an ordinary function. Any plain callable inside a pipe is coerced
into one automatically, which is how you drop into normal Python mid-chain.

**\`RunnableBranch\`** — conditional routing. Useful for a small, fixed set of branches; beyond
that, a graph expresses the same thing far more legibly.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'primitives.py',
      caption: 'The retrieval-augmented pattern in its canonical form. The dict runs both branches concurrently, so retrieval and passthrough do not serialise.',
      code: `from langchain_core.runnables import RunnablePassthrough, RunnableLambda

# A bare dict inside a pipe becomes a RunnableParallel: both values are computed
# concurrently from the same input, then handed on as a dict.
rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt
    | model
    | StrOutputParser()
)

answer = rag_chain.invoke("How do I rotate an API key?")


# .assign() adds keys while preserving the existing ones — the readable way to
# accumulate state through a pipeline without rebuilding the dict each stage.
enriched = (
    RunnablePassthrough.assign(docs=lambda x: retriever.invoke(x["question"]))
    .assign(context=lambda x: format_docs(x["docs"]))
    .assign(answer=lambda x: (prompt | model | StrOutputParser()).invoke(x))
)

result = enriched.invoke({"question": q})
# result now carries question, docs, context AND answer — so the citations are
# available to the caller without a second retrieval pass.


# Any plain function is coerced into a RunnableLambda. Useful, and the usual
# place where a chain silently becomes synchronous: a blocking function inside
# an async chain blocks the event loop.
def redact(text: str) -> str:
    return EMAIL_RE.sub("[email]", text)

safe_chain = chain | redact`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    IN["Input: question string"]

    IN --> P{"RunnableParallel<br/>both branches concurrently"}
    P --> B1["retriever then format_docs<br/>→ context"]
    P --> B2["RunnablePassthrough<br/>→ question"]

    B1 --> D["dict: context, question"]
    B2 --> D

    D --> PR["ChatPromptTemplate"]
    PR --> M["Chat model"]
    M --> O["StrOutputParser"]
    O --> OUT["Output: string"]

    M -.->|"with_retry, with_fallbacks<br/>attach here as configuration"| M
`.trim(),
      caption: 'Concurrency is expressed by the shape of the data, not by scheduling code. Resilience attaches to a stage rather than wrapping it.',
    },
    {
      type: 'markdown',
      md: `
## Resilience as configuration

The methods below return a new runnable rather than mutating the original, so they compose
freely and can be applied at exactly the stage that needs them.

| Method | Effect |
|---|---|
| \`.with_retry()\` | Retry with exponential backoff on failure |
| \`.with_fallbacks([...])\` | Try alternatives in order when the primary raises |
| \`.bind(**kwargs)\` | Fix arguments for every later call, such as \`stop\` or \`tools\` |
| \`.with_config(...)\` | Attach tags, metadata, callbacks and concurrency limits |
| \`.with_types(...)\` | Declare input and output types for validation and schema generation |

Attaching a retry to the model rather than to the whole chain matters: a chain-level retry
re-runs retrieval too, which is wasted work and, if retrieval has side effects, wrong.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'resilience.py',
      caption: 'Fallbacks degrade rather than fail. The ordering encodes a preference: correct and expensive first, cheap and adequate second.',
      code: `primary = init_chat_model("openai:gpt-4o")
secondary = init_chat_model("anthropic:claude-sonnet-4-5")
cheap = init_chat_model("openai:gpt-4o-mini")

resilient_model = (
    primary
    .with_retry(
        stop_after_attempt=3,
        wait_exponential_jitter=True,     # jitter matters: without it, every
                                          # client retries in lockstep
    )
    .with_fallbacks([secondary, cheap])   # tried in order, only on exception
)

# Retry attached to the MODEL, not the chain. A chain-level retry would re-run
# retrieval on every attempt: wasted work, and wrong if retrieval has side effects.
chain = {"context": retriever, "question": RunnablePassthrough()} | prompt | resilient_model

# Config propagates down through every nested runnable, which is what makes
# per-request tracing and tagging work without threading arguments everywhere.
answer = chain.invoke(
    question,
    config={
        "tags": ["support-bot", "production"],
        "metadata": {"user_id": user_id, "tenant": tenant},
        "run_name": "support_answer",
        "max_concurrency": 5,
        "recursion_limit": 25,
    },
)`,
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Config propagation is why tracing works at all',
      md: `The \`config\` you pass at the top flows into every nested runnable automatically. That
is how a single \`metadata\` entry ends up attached to the model call four layers down, and how
callbacks see every step without you wiring them through. The practical consequence: **set
tenant, user and request identifiers once at the entry point**, and every trace, error and cost
record downstream carries them.`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'A blocking function in an async chain blocks the event loop',
      md: `\`RunnableLambda\` accepts any callable, including a synchronous one that makes a network
request or reads a file. In an async chain, that call blocks the entire loop, and the symptom is
throughput that collapses under concurrency while CPU sits idle. Provide an async implementation
for anything that does input or output, or push the blocking work to a thread explicitly.`,
    },
    {
      type: 'markdown',
      md: `
## When to stop composing

Declarative composition is excellent for a linear flow with some concurrency. It degrades badly
in three specific situations, and recognising them early saves a rewrite.

**Loops.** A chain is a directed acyclic graph. Anything that repeats until a condition holds —
which is every agent — does not fit, and the workarounds are worse than the problem.

**Non-trivial branching.** Two branches are fine. Five branches, some of which merge back and
some of which do not, becomes a chain nobody can read and nobody can step through in a debugger.

**State that outlives the call.** A chain is a function. Conversation state, checkpointing and
resumption after a crash are not function concerns, and bolting them on produces something that
is a state machine with the wrong syntax.

All three are what LangGraph exists for, and Chapter 7 covers it. The useful instinct: **if you
find yourself simulating control flow with runnables, you have outgrown them.** Reaching for a
plain Python function is also entirely legitimate — a composed chain is not more virtuous than
an ordinary function that calls two runnables.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Shape of the problem', 'Use', 'Why'],
      rows: [
        ['Prompt, model, parse', 'A pipe', 'Linear, and the composite streams for free'],
        ['Several independent lookups feeding one prompt', '`RunnableParallel`, written as a dict', 'Concurrency comes from the data shape, not scheduling code'],
        ['Accumulating fields through stages', '`RunnablePassthrough.assign`', 'Later stages and the caller both keep access to earlier results'],
        ['Two or three fixed routes', '`RunnableBranch`, or a plain function', 'Readable at this size; a function is often clearer'],
        ['A loop until some condition', 'LangGraph', 'Cycles are not expressible in a pipe'],
        ['Persistent state across requests', 'LangGraph with a checkpointer', 'A chain is a function and has no memory'],
        ['Complex imperative logic', 'Plain Python calling runnables', 'Composition is a tool, not an obligation'],
      ],
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'Haystack makes the opposite trade',
      md: `Where LangChain infers the wiring from a pipe expression, Haystack has you declare
components and connect their named outputs to named inputs explicitly. It is more verbose for a
three-stage chain and considerably clearer for a twenty-component pipeline, because the graph is
written down rather than implied. If you have ever lost an afternoon to a type mismatch three
stages downstream, you can see the appeal.`,
    },
    {
      type: 'checklist',
      title: 'Composition review',
      items: [
        'Each stage\'s output type matches the next stage\'s input type',
        'Retries attached to the failing stage, not to the whole chain',
        'Fallbacks ordered by preference, degrading rather than failing',
        'max_concurrency set on any batch that hits a rate-limited provider',
        'Tenant, user and request identifiers set in config at the entry point',
        'Async implementations for anything doing input or output inside an async chain',
        'Loops, real branching and persistent state moved to a graph rather than simulated',
      ],
    },
  ],

  flashcards: [
    { front: 'What does the runnable protocol consist of?', back: 'invoke, batch and stream, plus their async counterparts. Uniformity across every component is what makes piping, streaming propagation and attachable retries possible.' },
    { front: 'What does a bare dict inside a pipe become?', back: 'A RunnableParallel: each value is executed concurrently against the same input and the results are collected into a dict with the same keys.' },
    { front: 'Why attach a retry to the model rather than the whole chain?', back: 'A chain-level retry re-runs every earlier stage including retrieval, which wastes work and is incorrect if any stage has side effects.' },
    { front: 'What are the three signs you have outgrown declarative composition?', back: 'A loop until a condition holds, branching beyond two or three routes, and state that must survive the call. All three point to a graph.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your chain works with invoke but throughput collapses under concurrent async load, while CPU sits idle. What is the most likely cause?',
      options: [
        'batch was called without max_concurrency',
        'The output parser cannot handle concurrent invocations',
        'Config propagation is serialising the nested runnables',
        'A synchronous input-output function wrapped in a RunnableLambda is blocking the event loop',
      ],
      answerIndex: 3,
      explanation: 'Idle CPU with collapsed throughput is the signature of a blocked event loop rather than a compute bottleneck. A plain callable in a pipe is coerced into a RunnableLambda without becoming async, so any network or file access inside it stops everything. Provide an async implementation or move the work to a thread.',
    },
    {
      id: 'q2',
      prompt: 'Why is RunnablePassthrough.assign preferable to rebuilding the dict at each stage?',
      options: [
        'It executes stages concurrently, which manual dict construction cannot',
        'It adds computed keys while preserving existing ones, so later stages and the caller retain access to earlier results',
        'It is the only construct that propagates config to nested runnables',
        'It validates types between stages automatically',
      ],
      answerIndex: 1,
      explanation: 'Accumulation is the point. Rebuilding the dict discards earlier values, so retrieved documents are gone by the time you want to return citations alongside the answer. Concurrency comes from RunnableParallel, and config propagates regardless.',
    },
    {
      id: 'q3',
      prompt: 'You set tags and metadata in the config passed to the top-level chain. Where do they apply?',
      options: [
        'To every nested runnable, since config propagates down through the composition',
        'Only to the top-level runnable, unless explicitly forwarded',
        'Only to runnables that declare matching types with with_types',
        'To the model call alone, which is the only stage that emits traces',
      ],
      answerIndex: 0,
      explanation: 'Automatic propagation is what makes observability practical. Identifiers set once at the entry point appear on every trace, error and cost record produced deeper in the chain, without threading arguments through each layer.',
    },
    {
      id: 'q4',
      prompt: 'A colleague has built an agent loop using RunnableBranch and a recursive lambda. What is the appropriate advice?',
      options: [
        'Increase the recursion_limit in the config so the loop can run longer',
        'Convert the branch into a RunnableParallel over the possible next steps',
        'A chain is a directed acyclic graph, so simulating a loop this way should move to LangGraph, which expresses cycles natively',
        'Wrap the recursion in with_retry so each iteration is retried on failure',
      ],
      answerIndex: 2,
      explanation: 'Composition has no cycle construct, so a loop must be faked, and the result is hard to read, hard to debug and impossible to checkpoint. A graph makes the cycle explicit along with its termination condition. Raising the recursion limit treats a symptom of the wrong abstraction.',
    },
    {
      id: 'q5',
      prompt: 'How does Haystack\'s approach to pipelines differ from LangChain\'s pipe composition?',
      options: [
        'It infers connections from type annotations rather than from a pipe expression',
        'It requires components to be declared and their named outputs connected to named inputs explicitly',
        'It executes all components concurrently by default',
        'It represents pipelines as configuration files rather than code',
      ],
      answerIndex: 1,
      explanation: 'Haystack writes the graph down instead of implying it. That costs verbosity on a small chain and pays off on a large one, where an explicitly declared connection is much easier to follow than a type mismatch surfacing three stages downstream.',
    },
  ],
};
