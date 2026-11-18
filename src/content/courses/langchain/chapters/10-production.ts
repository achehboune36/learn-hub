import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'production',
  title: 'Observability, evaluation and shipping',
  summary: 'Tracing that shows the prompt actually sent, evaluation that survives nondeterminism, the two security problems specific to these systems, and the cost and latency work that decides whether the thing is viable.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
An LLM application in production differs from an ordinary service in three ways that matter.

**It is nondeterministic**, so a bug may not reproduce and a test may pass ninety times and fail
on the ninety-first. **It has no exceptions for its worst failures** — a wrong answer returns
HTTP 200. And **it costs money per request**, in an amount that varies by an order of magnitude
depending on what the model decides to do.

Standard observability handles none of these. What follows is what does.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Tracing, and why it is not optional

A trace records the tree of a request: every model call with its exact prompt and response, every
tool invocation with arguments and result, token counts and latency at each node. It is the only
way to answer the question you will ask most often, which is *what did we actually send?*

Enabling it is two environment variables.

\`\`\`bash
export LANGSMITH_TRACING=true
export LANGSMITH_API_KEY=...
export LANGSMITH_PROJECT=support-bot-prod
\`\`\`

Nothing in your code changes. Every runnable already emits callbacks, which is what config
propagation was quietly building towards in Chapter 4.

If you would rather not add a vendor, LangChain emits **OpenTelemetry** spans, so traces can go
to whatever backend you already run. You lose the prompt-diffing and dataset features and keep
the visibility, which for many teams is the right trade.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'tracing.py',
      caption: 'Metadata set once at the entry point appears on every nested span, which is what makes traces filterable by tenant, user or version.',
      code: `# Identifiers set at the top propagate to every nested runnable. This is what
# turns a pile of traces into something you can query during an incident.
result = agent.invoke(
    {"messages": [("user", question)]},
    config={
        "run_name": "support_answer",
        "tags": ["production", f"model:{MODEL_NAME}", f"prompt:{PROMPT_VERSION}"],
        "metadata": {
            "user_id": user.id,
            "tenant": user.tenant,
            "conversation_id": conversation_id,
            "release": os.environ["GIT_SHA"],
        },
    },
)

# Sampling: full tracing on every request is expensive at volume, and the
# valuable traces are not the median ones.
import random

def trace_config(request) -> dict:
    should_trace = (
        request.is_internal                 # always trace ourselves
        or request.user_reported_issue      # always trace complaints
        or random.random() < 0.05           # 5% baseline for aggregate stats
    )
    return {"callbacks": [tracer] if should_trace else []}`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    REQ["Request"] --> APP["Application"]

    APP --> T1["Trace: the exact prompt,<br/>tokens, latency per node"]
    APP --> M1["Metrics: p50 and p99 latency,<br/>cost per request, error rate"]
    APP --> L1["Logs: tool errors,<br/>refusals, budget stops"]

    T1 --> DS["Traces of real failures<br/>become evaluation cases"]
    DS --> EV["Evaluation set"]

    EV --> CI{"CI gate:<br/>does the change<br/>regress the set?"}
    CI -->|"no"| SHIP["Ship"]
    CI -->|"yes"| BLOCK["Block, with the<br/>failing cases named"]

    SHIP -.->|"new failures<br/>feed back"| DS
`.trim(),
      caption: 'The loop that matters: production failures become test cases, and the test set gates the next change. Without the feedback edge, the evaluation set decays into a museum.',
    },
    {
      type: 'markdown',
      md: `
## Evaluation

Unit tests assume a deterministic output. Almost nothing here has one, so evaluation works
differently: a dataset of inputs, a set of scorers, and a comparison against the previous
version rather than against an absolute standard.

Prefer cheap deterministic checks wherever the requirement can be stated exactly, and reserve
model-based judges for what genuinely needs semantic understanding.

| Scorer | Checks | Cost |
|---|---|---|
| Exact or fuzzy match | Extraction and classification against a known answer | Free |
| Schema validity | Structured output parses and satisfies constraints | Free |
| Contains or excludes | A required citation marker; a forbidden phrase | Free |
| Tool trajectory | The expected tools were called, in a sensible order | Free |
| Groundedness judge | Whether the answer is supported by retrieved context | A model call |
| Correctness judge | Semantic match against a reference answer | A model call |

The most valuable dataset is not a synthetic one. It is **the failures your users found**, added
one at a time as they occur. Fifty real cases beat five hundred generated ones, because the real
ones encode the distribution you actually serve.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'A judge is a model, and it needs its own evaluation',
      md: `LLM-as-judge scores are estimates from a system with its own biases — towards longer
answers, towards its own phrasing, and towards whatever its provider changed last week. **Grade
fifty examples by hand and measure agreement before trusting a judge to gate anything.** If it
agrees with you seventy percent of the time, a three-point movement in its score means nothing.
Pin the judge model version, or your quality bar drifts silently underneath you.`,
    },
    {
      type: 'markdown',
      md: `
## The two security problems

**Prompt injection.** Any untrusted text that reaches the model can carry instructions: a
retrieved document, an email, a web page, a filename. There is no reliable prompt-level defence,
and treating this as a prompt engineering problem is the mistake. The defences that work are
structural.

- Authorise every tool call in your code against the authenticated user, never against what the
  model asked for.
- Keep untrusted content clearly delimited and label it as data, which helps at the margin and is
  not sufficient alone.
- Require human approval for consequential actions, especially anything that sends data outward.
- Assume any tool the model can call may be called with attacker-influenced arguments, and design
  the tool so that is survivable.

**Data exfiltration.** The subtler one. An agent with a web-fetch tool and access to your data
can be induced to place that data in a URL it fetches. Rendering model-authored markdown images
does the same thing through the browser. Allowlist outbound destinations, and never render
untrusted URLs from model output without validation.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The lethal trifecta',
      md: `An agent that has **access to private data**, **exposure to untrusted content**, and **a
way to communicate outward** can be made to exfiltrate the data. Any two are usually fine; all
three together is the dangerous configuration, and it appears easily — a support agent reading
customer records, summarising an inbound email, and able to send a reply. **Audit your agents for
this combination specifically**, and break one of the three legs where you find it.`,
    },
    {
      type: 'markdown',
      md: `
## Cost and latency

Both are dominated by a small number of decisions, and neither responds well to micro-optimisation.

**Cost.** Model choice moves it by an order of magnitude, so route by difficulty: a small model
handles most traffic and escalates what it cannot. Prompt caching, where the provider supports
it, substantially reduces the cost of a long stable system prompt resent every turn. Agent turn
count is the other big lever, since cost grows quadratically with it.

**Latency.** Streaming does not reduce it but transforms the experience, and time-to-first-token
is the number users actually feel. Run independent work concurrently rather than sequentially,
which is what \`RunnableParallel\` is for. Retrieval and reranking are often a larger share than
people expect, so measure per stage before optimising the model call.

Track cost per request as a metric with the same seriousness as latency. A change that improves
quality slightly and triples cost is a change somebody should decide on deliberately.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'production_wrapper.py',
      caption: 'Timeouts, cost recording and graceful degradation. An LLM call is a network call to a slow, expensive, occasionally unavailable third party, and deserves the same treatment.',
      code: `import asyncio
import time

COST_PER_1K = {"gpt-4o": (0.0025, 0.01), "gpt-4o-mini": (0.00015, 0.0006)}


async def answer(question: str, user, timeout_s: float = 25.0) -> dict:
    started = time.perf_counter()
    try:
        # Always a timeout. Without one, a hung provider connection holds a
        # request slot until something else gives up first.
        result = await asyncio.wait_for(
            chain.ainvoke(
                {"question": question},
                config={"metadata": {"user_id": user.id, "tenant": user.tenant}},
            ),
            timeout=timeout_s,
        )
    except asyncio.TimeoutError:
        metrics.increment("llm.timeout")
        # Degrade to something useful rather than returning an error page.
        return {"answer": fallback_search_results(question), "degraded": True}

    usage = result.response_metadata.get("token_usage", {})
    in_rate, out_rate = COST_PER_1K[MODEL_NAME]
    cost = (usage.get("prompt_tokens", 0) / 1000 * in_rate
            + usage.get("completion_tokens", 0) / 1000 * out_rate)

    # Cost as a first-class metric, tagged the same way latency is.
    metrics.histogram("llm.cost_usd", cost, tags={"tenant": user.tenant})
    metrics.histogram("llm.latency_s", time.perf_counter() - started)
    metrics.histogram("llm.tokens_in", usage.get("prompt_tokens", 0))

    return {"answer": result, "cost_usd": cost, "degraded": False}`,
    },
    {
      type: 'table',
      headers: ['Concern', 'What to do', 'Why it is easy to skip'],
      rows: [
        ['Provider outage', 'Fallbacks to a second provider, configured on the model', 'It works fine until the first outage'],
        ['Rate limits', 'Bounded concurrency, backoff with jitter, a request queue', 'Load testing rarely reproduces provider-side limits'],
        ['Hung connections', 'An explicit timeout on every call', 'The default is often no timeout at all'],
        ['Repeated identical questions', 'A semantic or exact-match cache', 'Feels like premature optimisation until you see the duplicate rate'],
        ['Prompt changes', 'Version them and record the version on every trace', 'A prompt edit looks smaller than a deploy and is not'],
        ['Quality drift', 'Scheduled evaluation runs, not just CI', 'Providers update models underneath you without notice'],
      ],
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'The model can change without you changing anything',
      md: `A provider updating a model behind a stable alias can shift behaviour overnight, and
nothing in your deployment pipeline will show it. **Pin to dated model versions where the provider
offers them**, and run your evaluation set on a schedule rather than only in CI. A weekly job that
catches a regression before your users do is inexpensive insurance.`,
    },
    {
      type: 'checklist',
      title: 'Before this handles real users',
      items: [
        'Tracing enabled, with tenant, user and prompt version on every request',
        'Sampling that always traces internal traffic and reported issues',
        'An evaluation set built from real failures, growing as new ones appear',
        'Deterministic scorers wherever the requirement can be stated exactly',
        'Judge agreement with human grading measured before any judge gates a release',
        'Every agent audited for private data, untrusted content and outbound communication together',
        'Tool authorisation in code against the authenticated user, never the model\'s argument',
        'Timeout on every model call, with a degraded path rather than an error',
        'Cost per request tracked as a metric and alerted on',
        'Model versions pinned, with evaluation running on a schedule',
      ],
    },
    {
      type: 'quote',
      md: 'The framework decides how quickly you build the first version. Tracing, evaluation and the security audit decide whether the second version is better than the first.',
    },
  ],

  flashcards: [
    { front: 'Why does standard observability fall short for LLM applications?', back: 'They are nondeterministic, their worst failures return HTTP 200 rather than an exception, and cost per request varies by an order of magnitude with what the model decides to do.' },
    { front: 'What makes the best evaluation dataset?', back: 'Real failures found by users, added one at a time. Fifty real cases beat five hundred synthetic ones because they encode the distribution you actually serve.' },
    { front: 'What is the lethal trifecta?', back: 'Access to private data, exposure to untrusted content, and a way to communicate outward. Any two are usually fine; all three together allows exfiltration, so break one leg.' },
    { front: 'Why pin dated model versions and run evaluation on a schedule?', back: 'A provider can update a model behind a stable alias, changing behaviour overnight with nothing in your pipeline to show it. Scheduled runs catch the regression before users do.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'What is the strongest reason to enable tracing before you have a problem rather than during one?',
      options: [
        'Traces cannot be enabled retroactively for a running deployment',
        'Tracing reduces token cost by caching repeated prompts',
        'It is the only way to see the exact prompt that was sent, which is the question you will ask most often and cannot answer from logs',
        'Provider rate limits are only visible through trace metadata',
      ],
      answerIndex: 2,
      explanation: 'Prompts are assembled at request time from history, retrieval and templates, so no static reading of the code tells you what was actually sent. A trace answers it directly. Enabling it costs two environment variables, and the cost of not having it is paid entirely during incidents.',
    },
    {
      id: 'q2',
      prompt: 'Your support agent reads customer records, summarises inbound emails from strangers, and can send replies. Why is this configuration dangerous?',
      options: [
        'Summarising email consumes context that the customer records need',
        'It combines private data access, untrusted content and outbound communication, which together permit exfiltration',
        'Email content cannot be reliably tokenised, risking truncation',
        'Reply sending is an irreversible action and needs a step budget',
      ],
      answerIndex: 1,
      explanation: 'Each capability is reasonable alone. Together they let instructions hidden in an inbound email direct the agent to place customer data into an outgoing reply. The mitigation is structural: remove one leg, or gate the outbound action behind human approval.',
    },
    {
      id: 'q3',
      prompt: 'You want to gate deployments on a correctness judge. What must happen first?',
      options: [
        'Measure the judge\'s agreement with human grading on a sample, and pin its model version',
        'Confirm the judge uses a different provider from the application model',
        'Expand the evaluation set to at least five hundred synthetic cases',
        'Replace all deterministic scorers with the judge for consistency',
      ],
      answerIndex: 0,
      explanation: 'A judge is an estimator with unknown error until measured. If it agrees with human grading seventy percent of the time, small score movements carry no signal and the gate is noise. Pinning its version prevents the bar from drifting when the provider updates the model.',
    },
    {
      id: 'q4',
      prompt: 'Which change is most likely to reduce cost by an order of magnitude?',
      options: [
        'Enabling streaming so partial results are returned sooner',
        'Reducing chunk overlap in the retrieval index',
        'Trimming the system prompt by a few hundred tokens',
        'Routing by difficulty so a small model handles most traffic and escalates only what it cannot',
      ],
      answerIndex: 3,
      explanation: 'Price differences between model tiers are large, so moving the bulk of traffic to a cheaper model dominates every other lever. Streaming changes perceived latency rather than cost, and prompt and index trimming produce percentage improvements rather than multiples.',
    },
    {
      id: 'q5',
      prompt: 'Why should every model call carry an explicit timeout?',
      options: [
        'Providers reject requests that do not declare one',
        'Timeouts are required for fallbacks to trigger',
        'A hung provider connection otherwise holds a request slot indefinitely, and the default is frequently no timeout at all',
        'It prevents the model from generating beyond max_tokens',
      ],
      answerIndex: 2,
      explanation: 'An LLM call is a network call to a slow third party that occasionally stops responding without closing the connection. Without a deadline, those requests accumulate and exhaust capacity. A timeout paired with a degraded response keeps the service answering rather than failing.',
    },
  ],
};
