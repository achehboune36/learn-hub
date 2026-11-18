import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'why-frameworks',
  title: 'What orchestration frameworks are actually for',
  summary: 'The first model call takes ten minutes and needs no framework. The fortieth needs retries, streaming, tool loops, state and tracing. This chapter is about what accumulates in between, and the landscape of tools competing to absorb it.',
  estimatedMinutes: 22,

  blocks: [
    {
      type: 'markdown',
      md: `
Calling a language model is four lines of code. This is the fact that makes every orchestration
framework look like overkill for about two weeks.

\`\`\`python
from openai import OpenAI
response = OpenAI().chat.completions.create(
    model="gpt-4o", messages=[{"role": "user", "content": question}]
)
\`\`\`

Then the requirements arrive. The output must be JSON matching a schema. It must stream to the
browser. The model must be able to call three of your functions, and loop until it is done. The
conversation must survive a page refresh. When the provider rate-limits you, it must retry, and
when it is down for an hour you must fall back to a different one. Somebody needs to see what
prompt was actually sent. And in six months you will swap the model.

**None of that is model work. All of it is plumbing**, and it is the same plumbing in every
application, which is precisely the condition under which a framework earns its place.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'The product is the interfaces, not the convenience',
      md: `It is tempting to read LangChain as a pile of helper functions. The durable value is
narrower and more useful: **a set of interfaces that different providers and stores implement
identically.** A chat model is a thing with \`invoke\` and \`stream\`. A tool is a callable with a
schema. A vector store is a thing you can retrieve from. Once your code targets those interfaces,
swapping OpenAI for Anthropic, or Pinecone for pgvector, is a constructor change instead of a
rewrite. The helper functions are the part you will outgrow; the interfaces are the part you
keep.`,
    },
    {
      type: 'markdown',
      md: `
## The six concerns every LLM application grows

Whatever you build, you will end up implementing these. The only question is whether you write
them yourself.

1. **Model abstraction.** One interface over providers whose APIs disagree about almost
   everything: message roles, tool-call formats, streaming chunk shapes, token accounting.
2. **Prompt construction.** Templating, versioning, and the assembly of context from several
   sources into one bounded window.
3. **Structured output.** Getting a typed object back rather than prose, and handling the case
   where the model returns something that does not parse.
4. **Tool calling and the loop.** Exposing functions, executing the calls the model requests,
   feeding results back, and deciding when to stop.
5. **State.** Conversation history, intermediate results, and durability across process
   restarts.
6. **Observability.** Seeing the actual prompts, the token costs, the latency per step, and
   what the model did before it went wrong.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    APP["Your application logic"]

    APP --> ORCH["Orchestration layer"]

    subgraph ORCH_D["What the layer absorbs"]
      direction LR
      C1["Model<br/>abstraction"]
      C2["Prompts and<br/>context assembly"]
      C3["Structured<br/>output"]
      C4["Tools and<br/>the agent loop"]
      C5["State and<br/>persistence"]
      C6["Tracing and<br/>evaluation"]
    end

    ORCH --> ORCH_D

    ORCH_D --> P1["OpenAI"]
    ORCH_D --> P2["Anthropic"]
    ORCH_D --> P3["Local / open weights"]
    ORCH_D --> P4["Vector stores"]
    ORCH_D --> P5["Your own APIs"]
`.trim(),
      caption: 'The layer exists so application logic never names a provider. Everything below the dashed area is swappable.',
    },
    {
      type: 'markdown',
      md: `
## The landscape

"LangChain and things like it" is a real category with meaningfully different bets inside it.
Choosing well means knowing what each one optimises for.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Framework', 'The bet it makes', 'Strongest when', 'Cost of the bet'],
      rows: [
        ['**LangChain**', 'Broad integrations plus a composable runnable interface', 'You need many providers and stores, and want one vocabulary over them', 'Surface area is enormous; abstraction can obscure what was actually sent'],
        ['**LangGraph**', 'Applications are state machines, so model them as graphs', 'Loops, branching, human approval steps, durable long-running work', 'More upfront structure than a linear chain needs'],
        ['**LlamaIndex**', 'Retrieval is the hard part, so centre the data', 'Document-heavy question answering over your own corpus', 'Less natural for general tool-using agents'],
        ['**Haystack**', 'Explicit pipelines with declared component connections', 'Production search systems where you want the wiring visible', 'Smaller ecosystem; more verbose for simple cases'],
        ['**DSPy**', 'Stop writing prompts; compile them against a metric', 'You have an evaluation set and want measurable optimisation', 'Requires that eval set; unfamiliar mental model'],
        ['**Semantic Kernel**', 'Enterprise integration, .NET first', 'Microsoft-centric stacks and C# services', 'Python support trails the .NET line'],
        ['**Pydantic AI**', 'Type safety and dependency injection over minimal abstraction', 'You want typed agents and dislike heavy frameworks', 'Fewer integrations; you write more of the plumbing'],
      ],
      caption: 'These are not mutually exclusive. LangGraph under LangChain is the common pairing, and LlamaIndex retrieval inside a LangChain application is routine.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Most LangChain tutorials you will find are for a version that no longer exists',
      md: `LangChain 1.0 landed in late 2025 and reorganised the project substantially. The agent
entry point is now \`create_agent\`; the older \`AgentExecutor\` and \`initialize_agent\` patterns
are legacy, and much of the accumulated surface moved to a separate \`langchain-classic\` package.
LangGraph became the runtime underneath rather than an optional add-on.

Search results have not caught up. **Check the version in any tutorial before following it**, and
prefer the current documentation over a blog post, however well written. A large fraction of the
frustration people report with LangChain is really the frustration of running 0.1 code against a
1.x install.`,
    },
    {
      type: 'markdown',
      md: `
## The packages, and why there are several

The split confuses newcomers and is genuinely well motivated.

| Package | Contains | Why separate |
|---|---|---|
| \`langchain-core\` | The interfaces: messages, runnables, tools, base classes | Tiny, stable, few dependencies. Integrations depend on this alone. |
| \`langchain\` | The main entry points, including \`create_agent\` | What most applications import |
| \`langchain-openai\`, \`langchain-anthropic\`, … | One provider each | A provider SDK bump cannot break unrelated integrations |
| \`langgraph\` | The graph runtime, state and checkpointing | Usable entirely on its own |
| \`langchain-classic\` | Legacy chains and helpers from earlier versions | Keeps the main package from carrying a decade of history |

The rule that follows: **depend on \`langchain-core\` in library code**, and pull provider
packages only where you actually construct a provider.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'with_and_without.py',
      caption: 'The framework version is not shorter. It is shorter per requirement, and the gap widens with every requirement you add.',
      code: `# ---------------------------------------------------------------------------
# Raw SDK: structured output, one retry, and a provider fallback.
# This is the honest amount of code, and it is all provider-specific.
# ---------------------------------------------------------------------------
import json
from openai import OpenAI, RateLimitError

def classify_raw(ticket: str) -> dict:
    for attempt in range(3):
        try:
            r = OpenAI().chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "Classify the support ticket."},
                    {"role": "user", "content": ticket},
                ],
                response_format={"type": "json_object"},
            )
            return json.loads(r.choices[0].message.content)
        except RateLimitError:
            if attempt == 2:
                raise
            # ...and now write the backoff, and the Anthropic fallback path,
            # which uses a different client, a different message shape and a
            # different way of requesting JSON.


# ---------------------------------------------------------------------------
# Same behaviour, expressed against interfaces.
# ---------------------------------------------------------------------------
from pydantic import BaseModel, Field
from langchain.chat_models import init_chat_model
from langchain_core.prompts import ChatPromptTemplate


class Ticket(BaseModel):
    category: str = Field(description="billing, technical, account or other")
    urgency: int = Field(ge=1, le=5)
    summary: str


prompt = ChatPromptTemplate.from_messages([
    ("system", "Classify the support ticket."),
    ("human", "{ticket}"),
])

# Structured output, retries and cross-provider fallback are configuration,
# not control flow you maintain.
model = init_chat_model("openai:gpt-4o").with_structured_output(Ticket)
fallback = init_chat_model("anthropic:claude-sonnet-4-5").with_structured_output(Ticket)

chain = prompt | model.with_retry(stop_after_attempt=3).with_fallbacks([fallback])

result: Ticket = chain.invoke({"ticket": "I was charged twice this month"})`,
    },
    {
      type: 'markdown',
      md: `
## When not to use one

A framework is a bet that your application will grow into its abstractions. Decline the bet
when:

- **The task is one call.** Classification, extraction, a single summarisation endpoint. Import
  the provider SDK and move on; you will not miss anything.
- **Latency is the product.** Every abstraction layer adds overhead, usually small but not zero,
  and it adds indirection to the profiling you will inevitably do.
- **You need exact control of the payload.** Fine-tuned models with unusual formats, or provider
  features that the abstraction has not yet surfaced, are easier to reach directly.
- **The team is one person shipping this week.** The framework's payoff is in maintenance and
  handover, both of which are hypothetical on that timescale.

A reasonable middle path is to use \`langchain-core\` for its message and tool interfaces without
adopting agents or chains at all. You get the vocabulary and the provider portability, and none
of the surface area.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The abstraction you cannot see through',
      md: `The recurring complaint about high-level frameworks is real: something misbehaves, and
finding out what prompt was actually sent means reading library source. This is a genuine cost
and it is largely solvable, but only if you decide early. **Turn on tracing on day one**, before
you need it. An application built with full visibility into every call is pleasant to debug; the
same application with tracing bolted on during an incident is not.`,
    },
    {
      type: 'checklist',
      title: 'Choosing your layer',
      items: [
        'Count the six concerns your application will actually need; two or fewer means skip the framework',
        'Check the version of any tutorial before following it, and prefer current docs',
        'Depend on langchain-core in library code, provider packages only at construction sites',
        'Pick LangGraph early if the flow has loops, branches or human approval steps',
        'Consider LlamaIndex for retrieval-centred work, and mixing it in rather than choosing sides',
        'Enable tracing before you write the second chain, not during the first incident',
      ],
    },
  ],

  flashcards: [
    { front: 'What are the six concerns every LLM application grows into?', back: 'Model abstraction, prompt construction, structured output, tool calling and the loop, state and persistence, and observability. A framework is worthwhile when you need most of them.' },
    { front: 'What is the durable value of LangChain, as opposed to its convenience helpers?', back: 'The interfaces. Chat models, tools and vector stores implemented identically across providers, so swapping one is a constructor change rather than a rewrite.' },
    { front: 'Why is langchain-core a separate package from langchain?', back: 'It holds only the stable interfaces with few dependencies, so every integration can depend on it without pulling in the full framework. Library code should target it.' },
    { front: 'What changed in LangChain 1.0 that invalidates most tutorials?', back: 'create_agent replaced AgentExecutor and initialize_agent, LangGraph became the underlying runtime, and much legacy surface moved to langchain-classic.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'You are building an endpoint that classifies a support ticket with one model call and returns JSON. What is the reasonable choice?',
      options: [
        'Adopt LangGraph, since classification is a state machine with one state',
        'Use the provider SDK directly, since a single call needs almost none of what a framework absorbs',
        'Adopt LangChain for the structured output helper alone',
        'Use DSPy so the prompt can be optimised automatically',
      ],
      answerIndex: 1,
      explanation: 'A framework is a bet that you will grow into its abstractions, and one call with no tools, state or loop grows into none of them. The provider SDK plus a schema validation library covers it. If the endpoint later needs fallbacks and tracing, adopting a framework then is cheap because the surface being replaced is tiny.',
    },
    {
      id: 'q2',
      prompt: 'A colleague reports that a LangChain tutorial does not work: initialize_agent cannot be imported. What is the most likely explanation?',
      options: [
        'The langchain-core package was installed without the main langchain package',
        'Agents now require a LangSmith API key to construct',
        'The tutorial predates LangChain 1.0, where agent construction moved to create_agent and legacy surface moved to langchain-classic',
        'The provider integration package for their model is missing',
      ],
      answerIndex: 2,
      explanation: 'Version skew between tutorials and installed code is the single largest source of reported LangChain frustration. The 1.0 reorganisation moved agent construction and retired the older entry points. Checking the version a tutorial targets before following it avoids nearly all of this.',
    },
    {
      id: 'q3',
      prompt: 'Which framework choice best matches an application whose central difficulty is answering questions over ten thousand internal documents?',
      options: [
        'Semantic Kernel, for its planner abstraction',
        'DSPy, so the retrieval prompt can be compiled',
        'Pydantic AI, for typed responses over the documents',
        'LlamaIndex, possibly used inside a LangChain application, since it centres the data and retrieval concerns',
      ],
      answerIndex: 3,
      explanation: 'LlamaIndex makes retrieval the primary abstraction rather than one integration among many, which fits a corpus-centred problem. The frameworks are not exclusive, and using its retrieval inside a broader LangChain application is a common and reasonable arrangement.',
    },
    {
      id: 'q4',
      prompt: 'Why should library code depend on langchain-core rather than langchain?',
      options: [
        'langchain-core holds the stable interfaces with few dependencies, so your library does not force the full framework and its provider packages on consumers',
        'langchain-core is the only package that receives security updates',
        'The main langchain package cannot be imported without a provider key configured',
        'Only langchain-core supports asynchronous invocation',
      ],
      answerIndex: 0,
      explanation: 'The split exists so that integrations and libraries can target a small, slow-moving interface surface. Depending on the full framework drags in entry points and transitive dependencies your consumers may not want. Async support and updates are present throughout.',
    },
    {
      id: 'q5',
      prompt: 'What is the strongest response to the criticism that frameworks hide what was actually sent to the model?',
      options: [
        'The criticism is outdated, since LangChain 1.0 no longer transforms prompts',
        'It is a real cost, largely fixed by enabling tracing from the first day rather than during an incident',
        'It only applies to agents, not to composed chains',
        'Reading the library source is the intended debugging workflow',
      ],
      answerIndex: 1,
      explanation: 'The complaint is legitimate rather than a misunderstanding. What resolves it is visibility, and visibility is cheap to add up front and painful to add under pressure. An application traced from the beginning shows the exact prompt, the tokens and the latency of every step.',
    },
  ],
};
