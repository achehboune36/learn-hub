import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'models-messages',
  title: 'Chat models, messages and structured output',
  summary: 'The interface everything else is built on: the message types, how provider differences leak through the abstraction anyway, and the three mechanisms for getting a typed object back instead of prose.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
Everything in this course composes chat models, so the interface is worth knowing precisely
rather than by imitation.

A chat model takes a **list of messages** and returns **one message**. That is the whole
contract. Prompts, chains, agents and graphs are all machinery for deciding what goes into that
list and what to do with what comes back.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## The message types

| Message | Role | Notes |
|---|---|---|
| \`SystemMessage\` | Instructions and persona | Usually first, and often the only thing you control across turns |
| \`HumanMessage\` | User input | May carry images and files, not only text |
| \`AIMessage\` | Model output | Carries \`tool_calls\` when the model wants a function run |
| \`ToolMessage\` | The result of running a tool | Must carry the \`tool_call_id\` it answers |

The pair that trips people up is the last two. When a model decides to call a tool it does not
return text; it returns an \`AIMessage\` whose \`content\` may be empty and whose \`tool_calls\` list
is populated. You run the tool, append a \`ToolMessage\` carrying the result and the matching id,
and call the model again. **That loop is the entire mechanism behind agents**, and Chapter 6 is
mostly about controlling it.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'basics.py',
      caption: 'init_chat_model resolves a provider string at runtime, which is what makes the model a configuration value rather than an import.',
      code: `from langchain.chat_models import init_chat_model
from langchain_core.messages import SystemMessage, HumanMessage

# The provider prefix keeps the choice in configuration. Swapping providers is
# an environment variable, not a code change.
model = init_chat_model("openai:gpt-4o", temperature=0)

response = model.invoke([
    SystemMessage("You are a terse assistant. Never exceed two sentences."),
    HumanMessage("Why does my Docker build ignore .dockerignore?"),
])

print(response.content)
print(response.usage_metadata)     # input_tokens, output_tokens, total_tokens
print(response.response_metadata)  # provider-specific: finish reason, model id, safety

# Every runnable exposes the same five methods. Learn them once.
model.invoke(messages)          # one call, one result
model.batch([m1, m2, m3])       # concurrent, order preserved
for chunk in model.stream(msgs):  # incremental chunks
    print(chunk.content, end="")
await model.ainvoke(messages)   # async variants throughout
await model.abatch([m1, m2])

# Sugar that saves nothing important but appears in every example:
model.invoke("just a string")            # becomes [HumanMessage(...)]
model.invoke([("system", "..."), ("human", "...")])   # tuples become messages`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart LR
    subgraph IN["Input: a list of messages"]
      S["SystemMessage<br/>instructions"]
      H["HumanMessage<br/>user turn"]
      A0["AIMessage<br/>prior turn"]
      T0["ToolMessage<br/>prior tool result"]
    end

    IN --> M["Chat model"]

    M --> OUT{"What did it return?"}
    OUT -->|"content is text"| DONE["AIMessage with content<br/>→ show the user"]
    OUT -->|"tool_calls populated"| TC["AIMessage with tool_calls<br/>→ run them, append ToolMessage,<br/>call the model again"]

    TC -.->|"loop"| IN
`.trim(),
      caption: 'One call, two possible outcomes. The lower branch, followed repeatedly, is what an agent is.',
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Everything is a Runnable, and that is the whole composition story',
      md: `Models, prompts, output parsers, retrievers and entire chains all implement the same
protocol: \`invoke\`, \`batch\`, \`stream\` and their async twins. That uniformity is why the pipe
operator works, why streaming propagates through a chain you never wrote streaming code for, and
why \`.with_retry()\` can be attached to anything. Learn the protocol once and every component in
the ecosystem becomes predictable.`,
    },
    {
      type: 'markdown',
      md: `
## Where the abstraction leaks

The interface is uniform. The models behind it are not, and pretending otherwise causes real
bugs.

**System message handling differs.** Some providers treat it as a first-class field, others fold
it into the first user turn. Models differ substantially in how strictly they obey it.

**Token accounting differs.** \`usage_metadata\` is normalised where possible, but cached tokens,
reasoning tokens and image tokens are reported inconsistently, and they are exactly the ones that
dominate a surprising bill.

**Tool-calling ability varies enormously.** Not just whether it is supported, but how reliably
the model produces valid arguments, whether it can emit several calls at once, and how it
behaves when no tool fits.

**Reasoning models behave differently.** Models that think before answering may ignore
\`temperature\`, take much longer, and return reasoning content as separate blocks. Code written
around a fast non-reasoning model often needs its timeouts revisited.

**Context windows and rate limits are wildly different**, which turns a working prompt into a
failure the moment you swap the model underneath it.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Portable does not mean identical',
      md: `The interface guarantees your code runs against another provider. It does not guarantee
the output is as good, the latency is comparable, or the prompt still works. **Treat a model swap
as a change requiring re-evaluation**, not a configuration tweak. Teams that skip this ship a
quiet quality regression and discover it from user complaints weeks later.`,
    },
    {
      type: 'markdown',
      md: `
## Structured output

Most production use needs an object, not prose. There are three mechanisms, and choosing among
them is mostly about what your provider supports.

**Tool-calling based.** The schema is presented to the model as a function it must call. Widely
supported and generally the most reliable, because providers have invested heavily in valid
argument generation.

**Native structured output.** The provider constrains generation so the result must match the
schema. Strongest guarantee where available, since it is enforced during decoding rather than
requested.

**Prompt and parse.** Ask for JSON, parse the text, retry on failure. The fallback for models
with neither of the above. Expect to handle markdown fences, preamble text and truncation.

\`with_structured_output\` picks a mechanism appropriate to the provider and gives you the same
call site regardless.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'structured.py',
      caption: 'Field descriptions are not documentation. They are part of the prompt the model sees, and they do more work than most of your system message.',
      code: `from typing import Literal, Optional
from pydantic import BaseModel, Field
from langchain.chat_models import init_chat_model


class TicketAnalysis(BaseModel):
    """Structured analysis of an inbound support ticket."""

    # Every description here is sent to the model. Vague descriptions produce
    # vague fields, and this is the highest-leverage text in the file.
    category: Literal["billing", "technical", "account", "other"] = Field(
        description="The single best-fitting category."
    )
    urgency: int = Field(
        ge=1, le=5,
        description="1 = informational, 5 = service is down for a paying customer.",
    )
    summary: str = Field(description="One sentence, under 20 words, no pleasantries.")

    # Optional with a default is how you let the model decline to guess.
    # Without this, models invent an account id rather than return nothing.
    account_id: Optional[str] = Field(
        default=None,
        description="Account id if one appears verbatim in the ticket, else null.",
    )


model = init_chat_model("openai:gpt-4o", temperature=0)
structured = model.with_structured_output(TicketAnalysis)

result = structured.invoke("Hi, I have been charged twice for account AC-2291 this month.")
print(result.category, result.urgency, result.account_id)   # billing 3 AC-2291

# include_raw keeps the underlying AIMessage so you can inspect token usage and
# recover gracefully when parsing fails instead of raising into your request handler.
safe = model.with_structured_output(TicketAnalysis, include_raw=True)
out = safe.invoke(ticket)
if out["parsing_error"]:
    log.warning("schema miss: %s", out["parsing_error"])
    analysis = fallback_classifier(ticket)
else:
    analysis = out["parsed"]`,
    },
    {
      type: 'table',
      headers: ['Symptom', 'Cause', 'Fix'],
      rows: [
        ['A field is invented rather than left empty', 'The schema makes it required, so the model must produce something', 'Make it `Optional` with a default and say "else null" in the description'],
        ['An enum field gets values outside the enum', 'Prompt-and-parse mode; the enum was a suggestion', 'Use a provider with tool-calling or native structured output, and validate'],
        ['Parsing fails on long outputs', 'Truncation at the token limit mid-JSON', 'Raise `max_tokens`, or split into smaller extractions'],
        ['Nested objects come back flat', 'Deep schemas are unreliable on weaker models', 'Flatten, or extract in two passes'],
        ['Works on one provider, fails on another', 'Different structured-output mechanism selected', 'Test the schema per provider; do not assume portability'],
      ],
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'A required field forces the model to lie',
      md: `This is the most common structured-output bug and the least obvious. If \`account_id\` is
a required string, the model has no way to say "not present" — the schema forbids it. So it
produces something plausible, and you now have a fabricated identifier flowing into your system
with the full confidence of a validated type. **Anything that might legitimately be absent must
be optional**, and the description should say explicitly what absence looks like.`,
    },
    {
      type: 'markdown',
      md: `
## Streaming, and what actually streams

\`stream()\` yields chunks as they arrive. The important detail is that streaming propagates
through composition: a chain of prompt, model and parser streams end to end, because each
component knows how to handle partial input.

The exception is anything that must see the whole output before it can act. A structured-output
call cannot stream a validated object, because validation needs the complete JSON. Some parsers
can emit partial objects as they fill in, but a strict Pydantic model is all-or-nothing.

For a token-by-token user experience alongside structured data, the workable pattern is two
calls: stream the prose for the user, and extract the structure separately.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'streaming.py',
      code: `# Token streaming: chunks are AIMessageChunk, and they add together.
full = None
for chunk in model.stream("Explain the CAP theorem briefly."):
    print(chunk.content, end="", flush=True)
    full = chunk if full is None else full + chunk   # chunks are additive

print(full.usage_metadata)     # available on the accumulated message

# astream_events gives structured events from EVERY step of a chain, which is
# what you need to show "searching…" then "writing…" in a UI. Note the version
# argument: the event schema is explicitly versioned.
async for event in chain.astream_events({"question": q}, version="v2"):
    kind = event["event"]
    if kind == "on_retriever_end":
        yield {"status": "found", "docs": len(event["data"]["output"])}
    elif kind == "on_chat_model_stream":
        yield {"token": event["data"]["chunk"].content}`,
    },
    {
      type: 'checklist',
      title: 'Working with models',
      items: [
        'Model chosen through init_chat_model with a provider prefix, kept in configuration',
        'Every optional field in a schema actually marked Optional with a stated null case',
        'Field descriptions written as prompt text, because that is what they are',
        'include_raw used where a parsing failure must not become a 500',
        'Token usage recorded from usage_metadata, not estimated',
        'A model swap treated as a change requiring re-evaluation, never a config tweak',
        'Timeouts revisited when moving to or from a reasoning model',
      ],
    },
  ],

  flashcards: [
    { front: 'What is the complete contract of a chat model?', back: 'It takes a list of messages and returns one message. Everything else in the framework decides what goes into that list and what to do with the result.' },
    { front: 'What does an AIMessage carrying tool_calls mean?', back: 'The model wants functions run rather than producing text. You execute them, append a ToolMessage carrying the matching tool_call_id, and call the model again. Repeating that is an agent.' },
    { front: 'Why does a required schema field cause fabricated values?', back: 'The schema forbids absence, so a model with no real value must invent a plausible one. Fields that can legitimately be missing must be Optional with the null case described.' },
    { front: 'Why can a structured-output call not stream a validated object?', back: 'Validation needs the complete JSON, so nothing can be guaranteed until generation finishes. Streaming prose and extracting structure separately is the workable pattern.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your extraction schema has account_id as a required string. Tickets without an account id come back with plausible-looking identifiers that do not exist. Why?',
      options: [
        'The schema leaves the model no way to express absence, so it must produce something',
        'The temperature is too high, causing the model to sample unlikely tokens',
        'Structured output was falling back to prompt-and-parse mode',
        'The field description was too short for the model to understand',
      ],
      answerIndex: 0,
      explanation: 'A required field is a constraint the model has to satisfy, and inventing a value is the only way to satisfy it when none exists. Making the field optional with a default, and saying in the description what absence looks like, removes the pressure. Temperature zero does not help, because the constraint is structural.',
    },
    {
      id: 'q2',
      prompt: 'What must a ToolMessage carry for the model to interpret it correctly?',
      options: [
        'The full schema of the tool that produced it',
        'The name of the model that requested the call',
        'The tool_call_id matching the call it answers',
        'A timestamp, so the model can order concurrent results',
      ],
      answerIndex: 2,
      explanation: 'A single AIMessage can request several tool calls at once, so results must be attributable to specific requests. The id is what pairs a result with its call. Without it the model cannot tell which answer belongs to which question.',
    },
    {
      id: 'q3',
      prompt: 'You swap your application from one provider to another. The code runs unchanged. What should you still do?',
      options: [
        'Nothing further; the interface guarantees equivalent behaviour',
        'Re-evaluate output quality, latency and prompt behaviour, since portability of the interface is not portability of results',
        'Rewrite prompts to the new provider\'s recommended template format',
        'Switch structured output to prompt-and-parse for consistency',
      ],
      answerIndex: 1,
      explanation: 'The abstraction guarantees the call succeeds, not that the answer is as good. System-message adherence, tool-calling reliability, context limits and latency all differ. Treating the swap as a change requiring evaluation catches the quiet quality regression that otherwise surfaces through user complaints.',
    },
    {
      id: 'q4',
      prompt: 'Why does field description text deserve more care than most of the system message?',
      options: [
        'Descriptions are validated against the model\'s training data',
        'They are only used when the provider falls back to prompt-and-parse',
        'They determine the order in which fields are generated',
        'They are sent to the model as part of the schema, so they directly shape each extracted field',
      ],
      answerIndex: 3,
      explanation: 'The schema, descriptions included, becomes part of what the model sees. A vague description produces a vague field, and a precise one such as naming the exact enum semantics or the null case does more work than a paragraph of general instruction.',
    },
    {
      id: 'q5',
      prompt: 'You need a token-by-token user experience and a validated structured object from the same interaction. What works?',
      options: [
        'Stream the structured output call and validate each partial chunk',
        'Use batch instead of stream, which returns both forms',
        'Two calls: stream the prose for the user, and extract the structure separately',
        'Enable include_raw, which streams the raw message while validating',
      ],
      answerIndex: 2,
      explanation: 'Validation requires the complete output, so a strict schema cannot be guaranteed mid-stream. Splitting the concerns gives the user immediate text while a separate extraction produces the typed object. Neither batching nor include_raw changes the fundamental constraint.',
    },
  ],
};
