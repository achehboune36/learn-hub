import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'prompts-context',
  title: 'Prompts and context assembly',
  summary: 'Templates, message placeholders and few-shot examples, then the harder problem underneath: deciding what gets into a bounded context window when four sources all want space.',
  estimatedMinutes: 22,

  blocks: [
    {
      type: 'markdown',
      md: `
Prompt templating looks like the least interesting part of a framework. It is string formatting.

The reason it matters is that in a real application the prompt is not written by a person at
all — it is **assembled at request time** from a system instruction, a conversation history of
unknown length, some retrieved documents, a few examples, and the user's actual question. The
template is the seam where those meet, and the interesting decisions are all about what to leave
out.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'templates.py',
      caption: 'MessagesPlaceholder is the piece that makes a template work for multi-turn conversation. Everything else is formatting.',
      code: `from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

prompt = ChatPromptTemplate.from_messages([
    ("system",
     "You are a support agent for {product}. "
     "Answer only from the context provided. "
     "If the context does not contain the answer, say so plainly.\\n\\n"
     "Context:\\n{context}"),

    # A slot for an arbitrary number of prior messages. Without this you are
    # stuck with a fixed number of turns, which no real conversation has.
    MessagesPlaceholder("history"),

    ("human", "{question}"),
])

messages = prompt.invoke({
    "product": "Acme Cloud",
    "context": retrieved_text,
    "history": prior_messages,       # a list of BaseMessage, any length
    "question": "How do I rotate an API key?",
})

# partial() binds values that are known earlier than request time. Useful for
# anything constant per deployment, so the call site stays about the request.
support_prompt = prompt.partial(product="Acme Cloud")

# Literal braces must be doubled, because the template consumes single ones.
# This bites hardest when the prompt contains a JSON example.
json_prompt = ChatPromptTemplate.from_template(
    "Return an object shaped like {{\\"name\\": string, \\"age\\": number}}. "
    "Extract from: {text}"
)`,
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'A single brace in your prompt is a template variable',
      md: `Paste a JSON example, a code snippet or a regex containing \`{\` into a template and you
get a \`KeyError\` for a variable you never intended to declare. Double every literal brace, or
keep such content out of the template and pass it as a variable instead. The second option is
usually cleaner: the template stays readable, and the content is not reprocessed.`,
    },
    {
      type: 'markdown',
      md: `
## Few-shot examples

Examples outperform instructions for anything with a consistent shape — formatting, tone,
classification boundaries, edge-case handling. Three good examples routinely beat a paragraph
describing the same thing.

The choice is between a **fixed** set, which is simple and predictable, and a **selected** set
chosen per request by similarity to the input. Selection helps when the task has many distinct
subtypes and you cannot fit an example of each. It costs a retrieval step and adds a way for the
prompt to vary unpredictably, so reach for fixed examples first.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'few_shot.py',
      caption: 'Examples as messages, not as a blob of text. The model sees a demonstrated conversation shape rather than a description of one.',
      code: `from langchain_core.prompts import (
    ChatPromptTemplate, FewShotChatMessagePromptTemplate,
)

examples = [
    {"input": "my card was declined", "output": "billing|3"},
    {"input": "how do I export data?", "output": "technical|1"},
    # The valuable example is the ambiguous one. A boundary case teaches more
    # than three obvious cases, because the obvious ones were never in doubt.
    {"input": "cannot log in after changing my plan", "output": "account|4"},
]

few_shot = FewShotChatMessagePromptTemplate(
    example_prompt=ChatPromptTemplate.from_messages([
        ("human", "{input}"),
        ("ai", "{output}"),
    ]),
    examples=examples,
)

prompt = ChatPromptTemplate.from_messages([
    ("system", "Classify the ticket as category|urgency."),
    few_shot,
    ("human", "{input}"),
])`,
    },
    {
      type: 'markdown',
      md: `
## The real problem: context assembly

The window is finite and four sources compete for it. Left unmanaged, retrieved documents grow
until history is truncated, or history grows until retrieval is squeezed out, and quality drops
for reasons nobody connects to the cause.

Decide a budget explicitly. A workable default for a 128k window:
`.trim(),
    },
    {
      type: 'table',
      headers: ['Component', 'Share of budget', 'What to do when it overflows'],
      rows: [
        ['System instructions', 'Fixed, a few hundred tokens', 'Rewrite shorter; never truncate mid-instruction'],
        ['Few-shot examples', 'Fixed, 5-10%', 'Reduce the count, or select per request instead of including all'],
        ['Retrieved context', '40-60%', 'Rerank and keep the top-k that fits; drop, do not truncate a document'],
        ['Conversation history', '20-30%', 'Trim oldest turns, or summarise them into one message'],
        ['Room for the answer', '10-20%, reserved', 'Never let input consume this; truncation mid-answer is the worst failure'],
      ],
      caption: 'The reserved output budget is the line teams forget. Filling the window with input leaves nothing to answer with.',
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    Q["User question"] --> ASM["Context assembly"]

    SYS["System instructions<br/>fixed, small"] --> ASM
    FS["Few-shot examples<br/>fixed or selected"] --> ASM
    HIST["Conversation history<br/>unbounded, grows every turn"] --> TRIM["Trim or summarise<br/>to a token budget"]
    TRIM --> ASM
    RET["Retrieved documents<br/>unbounded, grows with corpus"] --> RANK["Rerank, keep top-k<br/>that fits the budget"]
    RANK --> ASM

    ASM --> CHK{"Total tokens plus<br/>reserved output<br/>within the window?"}
    CHK -->|"no"| TRIM
    CHK -->|"yes"| MODEL["Chat model"]
`.trim(),
      caption: 'Two of the four sources grow without bound. Both need an explicit budget, and the loop back exists because trimming once is not always enough.',
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'budget.py',
      caption: 'trim_messages counts with the model\'s own tokeniser, which is the only count that matters. Keeping the system message and starting on a human turn are not cosmetic details.',
      code: `from langchain_core.messages import trim_messages, SystemMessage

WINDOW = 128_000
RESERVED_OUTPUT = 4_000
SYSTEM_AND_EXAMPLES = 2_000

available = WINDOW - RESERVED_OUTPUT - SYSTEM_AND_EXAMPLES
history_budget = int(available * 0.35)
context_budget = available - history_budget


def build_messages(question: str, history: list, docs: list) -> list:
    trimmed_history = trim_messages(
        history,
        max_tokens=history_budget,
        # Counting with the model itself is the only count that matches reality.
        token_counter=model,
        strategy="last",           # keep the most recent turns
        include_system=True,       # never drop the instructions
        start_on="human",          # a history starting on a tool result confuses models
        allow_partial=False,       # drop whole messages; half a turn is worse than none
    )

    # Documents are DROPPED whole, never truncated. Half a document is a
    # document that contradicts itself, and the model has no way to know.
    kept, used = [], 0
    for doc in docs:                       # assumed already reranked, best first
        cost = count_tokens(doc.page_content)
        if used + cost > context_budget:
            break
        kept.append(doc)
        used += cost

    return prompt.invoke({
        "context": "\\n\\n".join(d.page_content for d in kept),
        "history": trimmed_history,
        "question": question,
    })`,
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Never truncate a document mid-way',
      md: `Cutting history at a message boundary loses information the model knows is missing.
Cutting a document in half produces text that reads as complete and is not — a policy whose
exceptions were in the removed paragraph, a table without its final rows. The model answers
confidently from the fragment. **Drop whole documents and keep the ones that fit**; that failure
mode is recoverable, and the other is not.`,
    },
    {
      type: 'markdown',
      md: `
## Prompts as versioned artifacts

Prompts are behaviour. A prompt change can alter output quality as much as a model swap, and it
arrives with none of the ceremony.

Three practices, in increasing order of effort:

- **Keep prompts in code, in a dedicated module.** Not scattered as inline strings across
  handlers. A prompt you cannot find is a prompt you cannot review.
- **Version them explicitly** and record which version produced a given output. When quality
  changes, the first question is what changed, and prompts are the least tracked candidate.
- **Use a prompt registry** if non-engineers edit prompts. LangSmith offers one; so does MLflow.
  The trade is that prompts stop being reviewable in a pull request, so only take it when the
  editing workflow genuinely requires it.

The failure this prevents is specific and common: output quality drops, three people investigate
the model and the retrieval, and a week later someone remembers editing the system message.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'DSPy takes the opposite position',
      md: `Rather than writing prompts, DSPy has you declare a signature — the inputs, the outputs
and the task — and then **compiles** a prompt against a metric and a training set, choosing
demonstrations and phrasing automatically. It is a genuinely different bet: it needs an
evaluation set to work at all, and in exchange the prompt stops being a hand-tuned artifact that
drifts. If you already have a labelled set and are tuning phrasing by intuition, it is worth an
afternoon of investigation.`,
    },
    {
      type: 'checklist',
      title: 'Prompt and context review',
      items: [
        'Literal braces doubled, or moved out of the template into variables',
        'MessagesPlaceholder used for history rather than a fixed number of turns',
        'An explicit token budget per component, with output tokens reserved first',
        'History trimmed with the model\'s own tokeniser, keeping the system message',
        'Documents dropped whole when they do not fit, never truncated',
        'Few-shot examples including at least one genuine boundary case',
        'Prompts in one reviewable module, versioned, with the version recorded on outputs',
      ],
    },
  ],

  flashcards: [
    { front: 'What does MessagesPlaceholder solve?', back: 'It reserves a slot for an arbitrary number of prior messages, so one template serves a conversation of any length instead of a fixed number of turns.' },
    { front: 'Why must literal braces be doubled in a prompt template?', back: 'Single braces mark template variables, so a pasted JSON example or regex raises a KeyError for a variable you never declared. Passing such content as a variable is often cleaner.' },
    { front: 'Which part of the context budget do teams most often forget?', back: 'The reserved output tokens. Filling the window with input leaves nothing to answer with, and truncation mid-answer is the worst of the failure modes.' },
    { front: 'Why drop whole documents rather than truncating them?', back: 'A truncated document reads as complete but is not, so the model answers confidently from a fragment missing its exceptions or final rows. A dropped document is a recoverable failure.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'You paste a JSON example into a ChatPromptTemplate and get a KeyError naming a word from inside the example. What happened?',
      options: [
        'The example exceeded the template length limit',
        'Single braces in the example were parsed as template variables',
        'The template requires JSON examples to be passed through partial()',
        'The system message and the example declared conflicting variables',
      ],
      answerIndex: 1,
      explanation: 'Templates consume single braces as variable markers, so the keys in a pasted JSON object become undeclared variables. Doubling the braces escapes them, and passing the example in as a variable avoids the problem entirely while keeping the template readable.',
    },
    {
      id: 'q2',
      prompt: 'Your assistant degrades noticeably in long conversations. Retrieved context appears to be missing from later turns. What is the likely cause?',
      options: [
        'The retriever returns fewer documents as the conversation grows',
        'MessagesPlaceholder caps the number of messages it will render',
        'History grew unbounded and consumed the budget that retrieved context needed',
        'The system message is being dropped once history exceeds the window',
      ],
      answerIndex: 2,
      explanation: 'History grows every turn while the window does not, so without an explicit budget it crowds out whatever shares the window. The fix is to trim or summarise history against a fixed allocation so retrieval keeps its share. Nothing about the retriever or the placeholder changes with conversation length.',
    },
    {
      id: 'q3',
      prompt: 'Which few-shot example teaches the model the most?',
      options: [
        'A clearly technical ticket labelled technical',
        'The longest available example, since it shows more of the format',
        'An ambiguous ticket that sits near a category boundary',
        'A randomly sampled example, to avoid biasing the model',
      ],
      answerIndex: 2,
      explanation: 'Obvious cases were never in doubt and consume tokens confirming what the model already does correctly. A boundary case communicates where you draw a line that the model would otherwise draw somewhere else, which is exactly the information instructions convey poorly.',
    },
    {
      id: 'q4',
      prompt: 'Why should trim_messages use the model itself as the token counter?',
      options: [
        'It avoids a separate dependency on a tokeniser library',
        'It lets the model decide semantically which messages matter',
        'It allows partial messages to be counted proportionally',
        'Tokenisation differs by model, so any other count can be wrong in the direction that overflows the window',
      ],
      answerIndex: 3,
      explanation: 'A character heuristic or another model\'s tokeniser gives an approximation, and an approximation that underestimates produces a request the provider rejects. Counting with the model that will receive the messages is the only count that corresponds to the limit being enforced.',
    },
    {
      id: 'q5',
      prompt: 'What does DSPy propose instead of hand-written prompts?',
      options: [
        'Declaring a signature and compiling the prompt against a metric and training set',
        'Storing prompts in a registry so non-engineers can edit them safely',
        'Generating prompts from the output schema\'s field descriptions',
        'Replacing prompts with fine-tuned models',
      ],
      answerIndex: 0,
      explanation: 'DSPy treats the prompt as something to be optimised rather than authored, selecting demonstrations and phrasing against a measurable objective. The requirement is an evaluation set, without which there is nothing to compile against. Registries and fine-tuning are different approaches to different problems.',
    },
  ],
};
