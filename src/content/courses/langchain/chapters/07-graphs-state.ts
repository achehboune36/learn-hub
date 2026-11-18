import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'graphs-state',
  title: 'LangGraph: state, cycles and durability',
  summary: 'Modelling an application as a state machine: reducers that define how state merges, conditional edges for real branching, checkpointers that make a conversation survive a restart, and interrupts for human approval.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
A chain is a function: input in, output out, nothing remembered. That model breaks against three
requirements which turn up in almost every serious application — **loops**, **branching that
merges**, and **state that outlives the call**.

LangGraph replaces the function with a state machine. You declare a state shape, write nodes
that return partial updates to it, and connect them with edges that may be conditional and may
form cycles. The runtime handles merging, persistence and resumption.

It is more upfront structure than a pipe, and it buys three things a pipe cannot offer: a
conversation that survives a process restart, a workflow that can pause for a human and resume
days later, and the ability to inspect and replay any past state.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'state.py',
      caption: 'The reducer is the concept to understand. Without one, a node returning a key replaces it; with one, the node\'s value is merged into what is there.',
      code: `from typing import Annotated, TypedDict, Literal
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class State(TypedDict):
    # Annotated[..., reducer] says HOW updates combine. add_messages appends
    # rather than replacing, and handles message ids so a re-emitted message
    # updates in place instead of duplicating.
    messages: Annotated[list[BaseMessage], add_messages]

    # No reducer: a node returning this key REPLACES the value. That is the
    # right default for scalars and the wrong one for anything accumulating.
    intent: str
    retrieved: list[str]
    escalate: bool


def classify(state: State) -> dict:
    """Nodes return PARTIAL updates. Untouched keys keep their values."""
    result = classifier.invoke(state["messages"][-1].content)
    return {"intent": result.category, "escalate": result.urgency >= 4}


def retrieve(state: State) -> dict:
    docs = retriever.invoke(state["messages"][-1].content)
    return {"retrieved": [d.page_content for d in docs]}


def answer(state: State) -> dict:
    response = model.invoke(build_prompt(state))
    # add_messages appends this to the existing list.
    return {"messages": [response]}


def escalate_to_human(state: State) -> dict:
    ticket = helpdesk.create(state["messages"], intent=state["intent"])
    return {"messages": [("assistant", f"Escalated as ticket {ticket.id}.")]}


# Conditional edges are functions returning the NAME of the next node.
def route(state: State) -> Literal["escalate", "retrieve"]:
    return "escalate" if state["escalate"] else "retrieve"


builder = StateGraph(State)
builder.add_node("classify", classify)
builder.add_node("retrieve", retrieve)
builder.add_node("answer", answer)
builder.add_node("escalate", escalate_to_human)

builder.add_edge(START, "classify")
builder.add_conditional_edges("classify", route)
builder.add_edge("retrieve", "answer")
builder.add_edge("answer", END)
builder.add_edge("escalate", END)

graph = builder.compile()`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    S(["START"]) --> C["classify<br/>sets intent, escalate"]

    C --> R{"route<br/>conditional edge"}
    R -->|"escalate is true"| E["escalate<br/>creates a ticket"]
    R -->|"otherwise"| RET["retrieve<br/>sets retrieved"]

    RET --> A["answer<br/>appends a message"]
    A --> Q{"needs another<br/>retrieval pass?"}
    Q -->|"yes"| RET
    Q -->|"no"| END1(["END"])
    E --> END1

    CP[("Checkpointer")] -.->|"state saved after<br/>every node"| A
    CP -.-> RET
    CP -.-> C
`.trim(),
      caption: 'The cycle between answer and retrieve is the thing a pipe cannot express. The checkpointer writes state after every node, which is what makes resumption possible.',
    },
    {
      type: 'markdown',
      md: `
## Reducers, and the bug you get without them

A node returns a dict of updates. What happens to a key already in state depends entirely on
whether that key has a reducer.

- **No reducer** — the returned value replaces the old one. Correct for \`intent\`, a scalar
  describing the current situation.
- **A reducer** — the returned value is combined with the old one by that function. \`add_messages\`
  appends; \`operator.add\` concatenates lists or sums numbers; a custom function does whatever
  your merge semantics require.

The bug is specific and common: a node meant to add documents returns \`{"retrieved": new_docs}\`
against a key with no reducer, and every earlier document silently vanishes. Nothing errors. The
answer is simply built from less context than intended, and it takes a while to notice.

Reducers also make **parallel nodes** work. When two nodes run concurrently and both write the
same key, the reducer defines the merge. Without one, you get a conflict error — which is
genuinely better than a silent last-writer-wins.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'A missing reducer loses data quietly',
      md: `Replacement is the default because it is right for most scalar keys, but it is exactly
wrong for anything accumulating. Ask of every key: *if two nodes both write this, what should
happen?* If the answer is "both values should be kept", it needs a reducer. Finding this out
later means debugging an answer that is merely worse rather than broken.`,
    },
    {
      type: 'markdown',
      md: `
## Checkpointers: state that outlives the process

Compile with a checkpointer and every node transition is persisted. Each conversation is a
**thread**, identified by a \`thread_id\` you supply in the config. Invoke against the same thread
and the graph resumes from stored state rather than starting fresh.

This is what makes conversation memory a property of the runtime rather than something you build.
You do not load history and pass it in; you name the thread and the history is there.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'persistence.py',
      caption: 'Thread id is the whole API for conversation memory. Choosing a durable checkpointer is the only decision.',
      code: `from langgraph.checkpoint.postgres import PostgresSaver

# InMemorySaver is for tests and demos. It loses everything on restart, which
# is a surprise best encountered before production rather than during it.
with PostgresSaver.from_conn_string(DB_URL) as checkpointer:
    checkpointer.setup()                       # creates tables on first use
    graph = builder.compile(checkpointer=checkpointer)

    config = {"configurable": {"thread_id": f"conv-{conversation_id}"}}

    # Turn one.
    graph.invoke({"messages": [("user", "My order has not arrived")]}, config)

    # Turn two, possibly on a different process, a different machine, or a week
    # later. History is restored from the checkpointer, not passed in.
    graph.invoke({"messages": [("user", "It was ORD-8891")]}, config)

    # Inspect the current state, including which node runs next.
    snapshot = graph.get_state(config)
    print(snapshot.values["intent"], snapshot.next)

    # Full history, newest first. This is a debugging superpower: you can see
    # exactly what the state was before the step that went wrong.
    for past in graph.get_state_history(config):
        print(past.config["configurable"]["checkpoint_id"], past.next)

    # Rewind, edit, and re-run from an earlier point — "what if the classifier
    # had said billing?" answered without reproducing the conversation.
    forked = graph.update_state(
        past_checkpoint_config, {"intent": "billing"}
    )
    graph.invoke(None, forked)`,
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'Time travel is a debugging tool, not a party trick',
      md: `Because every transition is checkpointed, you can list the history, pick the state just
before a bad decision, change one field and re-run from there. For a nondeterministic system this
is the difference between "we could not reproduce it" and a five-minute investigation. It is
worth choosing a durable checkpointer for this reason alone, independent of resumption.`,
    },
    {
      type: 'markdown',
      md: `
## Human in the loop

Anything consequential — a refund, an email, a deletion — should have a person in the path.
\`interrupt()\` pauses the graph mid-node, persists everything, and returns control to your
application. The process can exit. Hours later, resume with a \`Command\` carrying the human's
decision and execution continues from exactly where it stopped.

This is only possible because of checkpointing. Without persisted state, a pause is just a
blocked thread waiting to be lost to a deploy.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'approval.py',
      caption: 'The interrupt returns a value to your application and the resume value comes back into the node. Between the two, the process may restart freely.',
      code: `from langgraph.types import interrupt, Command


def issue_refund_node(state: State) -> dict:
    amount = state["refund_amount_cents"]

    # Small refunds proceed; large ones need a person. The threshold is policy,
    # and policy belongs in your code rather than in the system prompt.
    if amount > 5_000:
        decision = interrupt({
            "action": "refund",
            "order_id": state["order_id"],
            "amount_cents": amount,
            "reason": state["refund_reason"],
        })
        # Execution stops here. State is persisted. The process may exit.
        # It resumes at this line with whatever the human sent back.
        if not decision.get("approved"):
            return {"messages": [("assistant",
                f"Refund declined by review: {decision.get('note', 'no reason given')}")]}

    receipt = payments.refund(state["order_id"], amount)
    return {"messages": [("assistant", f"Refund issued: {receipt.id}")]}


# In the request handler: an interrupt surfaces in the result.
result = graph.invoke({"messages": [("user", text)]}, config)
if "__interrupt__" in result:
    payload = result["__interrupt__"][0].value
    queue_for_review(payload, thread_id=config["configurable"]["thread_id"])
    return {"status": "awaiting_approval", "details": payload}

# Later — a different process, after the reviewer decides.
graph.invoke(Command(resume={"approved": True}), config)`,
    },
    {
      type: 'table',
      headers: ['Streaming mode', 'Emits', 'Use for'],
      rows: [
        ['`values`', 'The full state after each step', 'Debugging, and small state'],
        ['`updates`', 'Only what each node changed', 'Progress indicators such as "searching…"'],
        ['`messages`', 'Model tokens as they are generated', 'Token-by-token display to the user'],
        ['`custom`', 'Whatever a node writes to the stream writer', 'Domain progress such as "processed 40 of 200"'],
        ['`debug`', 'Everything, verbosely', 'Local development only'],
      ],
      caption: 'Modes combine. A real interface usually streams updates for progress and messages for text at the same time.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Everything in state is serialised on every step',
      md: `Checkpointing writes the whole state after each node. Put a large object in there — a
list of full documents, a dataframe, a file's contents — and you pay that serialisation cost on
every transition, and store it forever in the checkpoint table. **Keep identifiers and summaries
in state, and the bulk in your own store.** A graph that slows down as the conversation grows is
almost always carrying too much state.`,
    },
    {
      type: 'checklist',
      title: 'Designing a graph',
      items: [
        'Every accumulating key has a reducer; every scalar deliberately does not',
        'Nodes return partial updates, never the whole state',
        'A durable checkpointer in production, never InMemorySaver',
        'thread_id derived from a real conversation identifier',
        'State holds identifiers and summaries, not document bodies',
        'Consequential actions wrapped in interrupt with the threshold in code, not the prompt',
        'Recursion limit set, since cycles can now genuinely run forever',
        'State history used when debugging, rather than trying to reproduce from scratch',
      ],
    },
  ],

  flashcards: [
    { front: 'What does a reducer do in a graph state schema?', back: 'It defines how a node\'s update combines with the existing value. Without one the value is replaced, which silently loses data for any accumulating key.' },
    { front: 'What is a thread in LangGraph?', back: 'One conversation, identified by a thread_id in the config. Invoking against the same thread resumes from checkpointed state, so history is a runtime property rather than something you pass in.' },
    { front: 'How does interrupt() differ from simply blocking?', back: 'It persists all state and returns control to your application, so the process can exit entirely and resume hours later with a Command carrying the decision.' },
    { front: 'Why keep large objects out of graph state?', back: 'The full state is serialised after every node and stored in the checkpoint table forever. Keep identifiers and summaries in state and the bulk in your own store.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'A node appends retrieved documents by returning {"retrieved": new_docs}. Earlier documents keep disappearing, with no error. Why?',
      options: [
        'The checkpointer is overwriting the key on each transition',
        'The key has no reducer, so the returned value replaces the existing one',
        'Nodes must return the complete state, not partial updates',
        'Conditional edges reset state keys not used in routing',
      ],
      answerIndex: 1,
      explanation: 'Replacement is the default and is right for scalars, but wrong for anything that accumulates. Annotating the key with a reducer such as operator.add makes the update merge instead. The absence of an error is what makes this bug survive so long.',
    },
    {
      id: 'q2',
      prompt: 'What does compiling with a checkpointer give you that a chain cannot provide?',
      options: [
        'Concurrent execution of independent nodes',
        'Automatic retry of failed nodes',
        'Conversation state that survives a process restart, plus inspectable and replayable history',
        'Type validation of the state schema at runtime',
      ],
      answerIndex: 2,
      explanation: 'A chain is a function with no memory between calls. Persisting state after each transition makes a conversation resumable across processes and machines, and makes every past state available for inspection and replay. Concurrency and retries are available without persistence.',
    },
    {
      id: 'q3',
      prompt: 'Why can interrupt() allow a workflow to pause for hours while the process exits?',
      options: [
        'It holds an open connection to the client until resumed',
        'It spawns a background worker that waits for the decision',
        'It serialises the pending node into the message history',
        'State is checkpointed at the interrupt, so resumption reconstructs execution from storage rather than from a live thread',
      ],
      answerIndex: 3,
      explanation: 'Persistence is what makes the pause durable. Nothing is held in memory waiting, so a deploy or a crash between the interrupt and the decision costs nothing. Resuming with a Command reconstructs state and continues at the interrupt point.',
    },
    {
      id: 'q4',
      prompt: 'Your graph slows steadily as conversations get longer, and the checkpoint table grows quickly. What is the likely cause?',
      options: [
        'The recursion limit is too high, allowing extra cycles',
        'Full document bodies are being kept in state, so the whole payload is serialised on every node transition',
        'The messages key is using add_messages instead of replacement',
        'Conditional edges re-evaluate the entire state on each routing decision',
      ],
      answerIndex: 1,
      explanation: 'Checkpointing writes the complete state after each node, so anything bulky is paid for repeatedly and stored permanently. Keeping identifiers and summaries in state while the documents live in your own store removes both costs. Appending messages is expected and comparatively small.',
    },
    {
      id: 'q5',
      prompt: 'A bug appeared once in production and cannot be reproduced. How does a checkpointed graph help?',
      options: [
        'It automatically retries the failed transition with the same inputs',
        'It records the model\'s random seed so generation can be replayed exactly',
        'State history lets you find the checkpoint before the bad decision, change one field, and re-run from there',
        'It logs the full prompt for every node to your tracing backend',
      ],
      answerIndex: 2,
      explanation: 'Every transition is stored, so the sequence of states is available afterwards. You can inspect the state preceding the failure and fork from it with a modified value, which converts an unreproducible incident into a directed experiment. Tracing is valuable too but is a separate mechanism.',
    },
  ],
};
