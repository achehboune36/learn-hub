import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'memory',
  title: 'Memory and conversation state',
  summary: 'What "memory" actually means once you look closely: a growing message list, a trimming policy, a summary, and a separate store of durable facts. Four different problems that one word hides.',
  estimatedMinutes: 20,

  blocks: [
    {
      type: 'markdown',
      md: `
"Memory" is the most overloaded word in this field. Pulled apart, it is four distinct problems
with four distinct solutions, and most confusion comes from applying the answer to one of them
to another.

1. **The context window.** What the model can see on this call. Bounded, and the binding
   constraint on everything else.
2. **Conversation history.** The messages of this thread. Unbounded and growing.
3. **Durable facts.** Things that should persist across every conversation with this user, such
   as their timezone or their support tier.
4. **Retrieved knowledge.** Documents fetched per question. This is retrieval, not memory, and
   conflating the two produces strange designs.

The framework handles the second directly, gives you tools for managing it against the first,
and deliberately leaves the third to you.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'The old memory classes are gone',
      md: `Earlier LangChain shipped \`ConversationBufferMemory\`, \`ConversationSummaryMemory\` and
several relatives. They are deprecated and largely removed. The replacement is not another memory
class — it is **a checkpointer for persistence plus explicit trimming or summarisation in your
graph**. If a tutorial constructs a memory object and passes it to a chain, it predates this
change, and following it will waste an afternoon.`,
    },
    {
      type: 'markdown',
      md: `
## Persistence is the checkpointer's job

Conversation history is solved by the graph runtime, as covered in the previous chapter. Compile
with a checkpointer, pass a \`thread_id\`, and history is restored on each turn without your code
loading or storing anything.

What remains yours is the **policy**: history grows forever and the window does not, so something
must decide what to keep. There are three strategies and they compose.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Strategy', 'Keeps', 'Loses', 'Cost'],
      rows: [
        ['Full history', 'Everything', 'Nothing, until the window overflows', 'Grows quadratically; eventually fails outright'],
        ['Sliding window', 'The last N messages or tokens', 'Anything said earlier, completely and silently', 'Free'],
        ['Summarisation', 'A summary of old turns plus recent ones verbatim', 'Detail inside the summarised region', 'One model call whenever the summary is refreshed'],
        ['Summary plus retrieval', 'A summary, recent turns, and older turns fetched on relevance', 'Little, in principle', 'A vector store over messages, and more moving parts'],
      ],
      caption: 'Most applications want the sliding window. Reach for summarisation only when users demonstrably refer back beyond it.',
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'trimming.py',
      caption: 'Trimming happens when building the prompt, not when storing. The full history stays in the checkpointer, which matters for audit and for changing the policy later.',
      code: `from langchain_core.messages import trim_messages, SystemMessage


def call_model(state: State) -> dict:
    # Trim for the CALL. Do not trim what is stored — the checkpointer keeps
    # everything, so you can widen the window later or audit the conversation
    # without having destroyed the record.
    windowed = trim_messages(
        state["messages"],
        max_tokens=8_000,
        token_counter=model,        # the model's own tokeniser, not an estimate
        strategy="last",
        include_system=True,        # instructions are never the thing to drop
        start_on="human",           # a window opening on a ToolMessage confuses models
        allow_partial=False,
    )
    return {"messages": [model.invoke(windowed)]}`,
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'A window that opens on a tool result',
      md: `Trimming by token count can cut between an \`AIMessage\` requesting a tool call and the
\`ToolMessage\` answering it. The model then sees a result with no request, or a request whose
answer never arrives. Providers respond to this badly, sometimes with an outright API error about
mismatched tool call ids. \`start_on="human"\` and refusing partial messages prevent it, and they
are not optional refinements once tools are involved.`,
    },
    {
      type: 'markdown',
      md: `
## Summarisation, and what it costs

When conversations genuinely run long, replace old turns with a summary. The mechanics are
straightforward; the judgement is in the trigger and in accepting the loss.

A summary is lossy by construction. Specific numbers, order identifiers and exact phrasing are
exactly what gets compressed away, and they are exactly what users refer back to. **Keep entities
verbatim in a separate structured field** rather than trusting the summary to preserve them.

Trigger on token count rather than message count, since messages vary enormously in size, and
avoid summarising on every turn — that is a model call per turn for a change that matters every
tenth turn.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'summarise.py',
      caption: 'Entities are extracted into structured state so they survive compression. The summary carries the narrative, the fields carry the facts.',
      code: `from langchain_core.messages import RemoveMessage, SystemMessage


class State(TypedDict):
    messages: Annotated[list, add_messages]
    summary: str
    # Facts that must not be lost to compression. The summary is prose; this is
    # data, and the difference matters when a user says "the order I mentioned".
    entities: dict          # {"order_ids": [...], "account_id": "...", ...}


SUMMARY_TRIGGER_TOKENS = 6_000
KEEP_RECENT = 4


def maybe_summarise(state: State) -> dict:
    if count_tokens(state["messages"]) < SUMMARY_TRIGGER_TOKENS:
        return {}

    older = state["messages"][:-KEEP_RECENT]
    if not older:
        return {}

    prior = state.get("summary", "")
    new_summary = model.invoke([
        SystemMessage(
            "Update the running summary with the new turns. Preserve every "
            "identifier, amount and commitment made. Under 200 words."
        ),
        ("human", f"Existing summary:\\n{prior}\\n\\nNew turns:\\n{render(older)}"),
    ]).content

    return {
        "summary": new_summary,
        "entities": merge_entities(state.get("entities", {}), extract_entities(older)),
        # RemoveMessage is how add_messages is told to delete rather than append.
        "messages": [RemoveMessage(id=m.id) for m in older],
    }


def build_prompt(state: State) -> list:
    parts = [SystemMessage(BASE_INSTRUCTIONS)]
    if state.get("summary"):
        parts.append(SystemMessage(f"Conversation so far: {state['summary']}"))
    if state.get("entities"):
        # Verbatim, structured, uncompressed.
        parts.append(SystemMessage(f"Known facts: {state['entities']}"))
    return parts + state["messages"]`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    T["New turn arrives"] --> CP[("Checkpointer<br/>full history, always")]
    CP --> CHK{"History over<br/>the token trigger?"}

    CHK -->|"no"| BUILD
    CHK -->|"yes"| SUM["Summarise older turns<br/>extract entities verbatim"]
    SUM -->|"RemoveMessage"| CP
    SUM --> BUILD

    BUILD["Build the prompt"] --> P1["System instructions"]
    BUILD --> P2["Running summary"]
    BUILD --> P3["Structured entities"]
    BUILD --> P4["Recent turns verbatim"]
    BUILD --> P5["Durable user facts<br/>from your own store"]

    P1 --> M["Model call"]
    P2 --> M
    P3 --> M
    P4 --> M
    P5 --> M
`.trim(),
      caption: 'The checkpointer holds everything. The prompt is assembled from four sources, only one of which is the raw message list.',
    },
    {
      type: 'markdown',
      md: `
## Cross-conversation memory

Everything above is scoped to one thread. Remembering that a user prefers metric units, across
every conversation they ever have, is a different problem and the framework deliberately does not
solve it for you.

It is an ordinary application feature: a store keyed by user id, written when something worth
remembering appears, and read into the prompt at the start of each conversation. The interesting
questions are all product questions rather than technical ones.

- **What is worth storing?** Extracting a fact on every turn is expensive and produces a store
  full of noise. Extract on explicit statements of preference, or on a periodic pass.
- **When does a fact expire?** "Prefers email" from two years ago may be wrong. Timestamp
  everything and weight recency.
- **How does a user see and delete it?** A system that silently remembers, with no way to inspect
  or correct the record, is one users are right to distrust — and in many jurisdictions it is a
  compliance problem rather than a design preference.

LangGraph offers a store abstraction for this, and libraries such as langmem build extraction
policies on top. Both are conveniences over a table you could write yourself, and the hard part
is the policy either way.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Most "memory" failures are context assembly failures',
      md: `When users complain that the assistant forgot something, the fact is almost always
still in the checkpointer. It simply was not in the prompt for that call, because a window
trimmed it, a summary compressed it away, or nobody wrote the code to include it. **Debug memory
complaints by looking at the actual prompt sent**, not the stored history — a trace makes this a
thirty-second check and guesswork makes it an afternoon.`,
    },
    {
      type: 'checklist',
      title: 'Memory design review',
      items: [
        'Persistence handled by a checkpointer, not by a deprecated memory class',
        'Trimming applied when building the prompt, never to what is stored',
        'Window guaranteed not to open on a tool result or split a tool call pair',
        'Summarisation triggered on token count, and not on every turn',
        'Identifiers and amounts kept verbatim in structured state, outside the summary',
        'Cross-conversation facts stored per user, timestamped, with an expiry policy',
        'Users able to see and delete what has been remembered about them',
        'Memory complaints debugged from the traced prompt, not the stored history',
      ],
    },
  ],

  flashcards: [
    { front: 'What four distinct problems does the word "memory" hide?', back: 'The context window, this thread\'s conversation history, durable cross-conversation facts, and retrieved knowledge. Only the second is handled directly by the runtime.' },
    { front: 'Why trim when building the prompt rather than when storing?', back: 'The checkpointer keeps the full history, so you can widen the window later or audit the conversation. Trimming what is stored destroys the record irreversibly.' },
    { front: 'What goes wrong when a trimmed window opens on a ToolMessage?', back: 'The model sees a tool result with no matching request, and providers may reject the call outright over mismatched tool call ids. Starting on a human message prevents it.' },
    { front: 'Why keep identifiers outside the summary?', back: 'Summarisation compresses away exact numbers and identifiers, which are precisely what users refer back to. Structured entity fields preserve them verbatim while the summary carries the narrative.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'A tutorial constructs ConversationBufferMemory and passes it into a chain. What should you conclude?',
      options: [
        'It targets a pre-1.0 LangChain; persistence is now a checkpointer plus explicit trimming in your graph',
        'It is using the async variant of the memory interface',
        'Memory objects are still current but only work with agents',
        'The tutorial is correct but requires langchain-core to be installed separately',
      ],
      answerIndex: 0,
      explanation: 'The memory classes were deprecated and largely removed. The replacement is not another memory object but a division of labour: the checkpointer persists everything, and your graph decides what to include in each prompt.',
    },
    {
      id: 'q2',
      prompt: 'After adding token-based trimming, your agent starts failing with provider errors about tool call ids. Why?',
      options: [
        'The token counter is estimating rather than using the model tokeniser',
        'Trimming cut between an AIMessage requesting a tool and the ToolMessage answering it',
        'RemoveMessage was used without a matching reducer',
        'The system message was excluded from the trimmed window',
      ],
      answerIndex: 1,
      explanation: 'A token boundary does not respect the pairing between a tool request and its result, so the model receives an orphaned half. Providers validate this and reject the request. Starting the window on a human message and disallowing partial messages avoids it.',
    },
    {
      id: 'q3',
      prompt: 'Why trigger summarisation on token count rather than message count?',
      options: [
        'Token counts are cheaper to compute than message counts',
        'Message count is unavailable once RemoveMessage has been used',
        'Messages vary enormously in size, so a count of them is a poor proxy for how much window is consumed',
        'Providers bill by message rather than by token',
      ],
      answerIndex: 2,
      explanation: 'A conversation of five long tool results can consume more window than fifty short exchanges. The constraint being managed is the window, measured in tokens, so triggering on anything else fires at the wrong times in both directions.',
    },
    {
      id: 'q4',
      prompt: 'A user says the assistant forgot an order number they mentioned earlier. Where should you look first?',
      options: [
        'The checkpointer, to confirm the message was persisted',
        'The vector store, in case the message was indexed incorrectly',
        'The user memory store, to see whether the fact expired',
        'The traced prompt for that call, since the fact is usually still stored but was not included',
      ],
      answerIndex: 3,
      explanation: 'Persistence is rarely the failure. Almost always the message is in the checkpointer and was excluded from the prompt by trimming or compressed away by a summary. Reading the actual prompt that was sent turns this into a thirty-second check.',
    },
    {
      id: 'q5',
      prompt: 'What is the strongest argument for letting users inspect and delete what has been remembered about them?',
      options: [
        'It reduces the storage cost of the memory table',
        'Silent, uncorrectable memory is reasonably distrusted, and in many jurisdictions it is also a compliance obligation',
        'It improves extraction accuracy by providing corrections as training data',
        'It is required before a checkpointer can be used in production',
      ],
      answerIndex: 1,
      explanation: 'A system that remembers without disclosure and offers no correction path fails users on trust and frequently fails a legal standard as well. Storage cost is negligible by comparison, and neither extraction quality nor checkpointing depends on it.',
    },
  ],
};
