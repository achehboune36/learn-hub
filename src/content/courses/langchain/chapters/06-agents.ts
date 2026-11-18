import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'agents',
  title: 'Agents and controlling the loop',
  summary: 'When letting a model decide the control flow beats writing it yourself, how create_agent assembles the loop, and the termination and cost controls without which an agent is a billing incident.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
An agent is the tool loop from the previous chapter with the model deciding when to stop. That
is the entire idea. The word carries far more weight than the mechanism deserves, and the
inflation causes real harm: teams build agents for problems that wanted a pipeline, then spend
weeks debugging nondeterminism they introduced on purpose.

The honest framing is a trade. **You give up predictable control flow and receive the ability to
handle inputs you did not anticipate.** Sometimes that is exactly right.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Situation', 'Build', 'Why'],
      rows: [
        ['Steps are always the same', 'A chain', 'Determinism is free; an agent would rediscover your pipeline each request, badly'],
        ['A few known branches', 'A chain with routing, or a graph', 'The branches are knowable, so encode them'],
        ['Steps depend on what earlier steps found', 'An agent', 'You cannot write a flowchart for a path you cannot enumerate'],
        ['The user\'s request could be almost anything', 'An agent', 'This is the case agents exist for'],
        ['Latency budget under two seconds', 'A chain', 'Each agent turn is a full model round trip; three turns rarely fit'],
        ['Every action is irreversible', 'A chain, or an agent with approval gates', 'Nondeterministic control flow over destructive actions needs a human in it'],
      ],
      caption: 'The deciding question is whether you can enumerate the steps in advance. If you can, do.',
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'agent_basic.py',
      caption: 'create_agent is the LangChain 1.0 entry point. It builds a LangGraph graph underneath, which is why checkpointing and streaming come along for free.',
      code: `from langchain.agents import create_agent
from langchain.chat_models import init_chat_model

agent = create_agent(
    model=init_chat_model("openai:gpt-4o"),
    tools=[search_orders, check_inventory, issue_refund],
    system_prompt=(
        "You are a support agent for Acme Cloud.\\n"
        "Look up facts with the tools rather than recalling them.\\n"
        "Confirm the exact amount with the customer before issuing any refund.\\n"
        "If a tool returns nothing, say so — do not retry the same search."
    ),
)

# The agent is a runnable over message state, so the whole protocol applies.
result = agent.invoke({"messages": [("user", "Where is order ORD-8891?")]})
print(result["messages"][-1].content)

# Streaming per step is what a usable interface needs: the user sees
# "searching orders…" rather than a spinner for eleven seconds.
for chunk in agent.stream(
    {"messages": [("user", question)]},
    stream_mode="updates",         # one event per node, not per token
):
    print(chunk)`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    START(["User message"]) --> AGENT["Model call<br/>with tool schemas bound"]

    AGENT --> D{"Did it request<br/>tool calls?"}

    D -->|"no"| DONE(["Answer the user"])
    D -->|"yes"| GUARD{"Guards:<br/>step count, token spend,<br/>approval required?"}

    GUARD -->|"limit hit"| STOP(["Halt and report<br/>partial progress"])
    GUARD -->|"needs approval"| HUMAN["Interrupt<br/>and wait for a human"]
    GUARD -->|"ok"| EXEC["Execute tools<br/>append ToolMessages"]

    HUMAN -->|"approved"| EXEC
    HUMAN -->|"rejected"| AGENT

    EXEC --> AGENT
`.trim(),
      caption: 'The cycle is trivial. Everything that makes an agent safe to run lives in the guard node between the decision and the execution.',
    },
    {
      type: 'markdown',
      md: `
## The failure modes, and what each one costs

Agents fail in a small number of recognisable ways. All of them are cheaper to prevent than to
diagnose.

**The infinite loop.** The model alternates between two tools, or repeats one search that keeps
returning nothing. Without a bound this runs until something else breaks. **Always set a
recursion or step limit**, and treat hitting it as an error worth alerting on rather than a
normal outcome.

**The cost blowout.** Every turn resends the entire message history. A ten-turn agent
conversation does not cost ten calls' worth of tokens; it costs roughly the sum of a growing
prefix, which is quadratic in the number of turns. An agent that occasionally takes thirty turns
is an agent with an occasional very large bill.

**Confident fabrication after a tool failure.** A tool errors, the error is swallowed, and the
model produces a plausible answer from nothing. This is the most dangerous failure because
nothing in the output signals it.

**Doing the wrong thing successfully.** The agent correctly executes a plan that was not what
the user meant. No error, no exception, and a refund issued against the wrong order.

**Silent degradation on model change.** Tool-calling reliability varies substantially between
models. An agent tuned on one and moved to another can degrade without any code change.
`.trim(),
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Token cost grows with the square of the turn count',
      md: `Turn one sends the system prompt and a question. Turn ten sends the system prompt, the
question, nine assistant messages and nine tool results — and every earlier turn resent that
prefix too. The total is quadratic, not linear. A single runaway conversation can cost more than
a thousand normal ones. **Cap turns, cap cumulative tokens per conversation, and alert on both.**
Prompt caching, where the provider supports it, reduces the constant but not the shape.`,
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'guardrails.py',
      caption: 'Middleware runs around the agent loop, which is where budget enforcement belongs. Exact hook names vary by version, so check the ones your install provides.',
      code: `from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware


class BudgetMiddleware(AgentMiddleware):
    """Stop the loop on step count or cumulative token spend."""

    def __init__(self, max_steps: int = 8, max_tokens: int = 60_000):
        self.max_steps = max_steps
        self.max_tokens = max_tokens

    def before_model(self, state, runtime):
        steps = sum(1 for m in state["messages"] if m.type == "ai")
        spent = sum(
            (m.usage_metadata or {}).get("total_tokens", 0)
            for m in state["messages"]
            if m.type == "ai"
        )

        if steps >= self.max_steps or spent >= self.max_tokens:
            # Ending deliberately beats being killed by a recursion limit:
            # the user gets a real message and you get a clean metric.
            metrics.increment("agent.budget_exhausted")
            return {
                "messages": [("assistant",
                    "I could not complete this within my step budget. "
                    f"Here is what I found so far: {summarise(state)}")],
                "jump_to": "end",
            }
        return None


agent = create_agent(
    model=model,
    tools=tools,
    system_prompt=SYSTEM,
    middleware=[BudgetMiddleware(max_steps=8)],
)

# A hard backstop underneath the soft one. recursion_limit counts graph steps,
# so it is roughly twice the number of agent turns.
result = agent.invoke(
    {"messages": [("user", question)]},
    config={"recursion_limit": 25, "metadata": {"user_id": uid}},
)`,
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'A soft stop and a hard stop do different jobs',
      md: `The recursion limit is a backstop that raises an exception — correct as a last resort,
useless as a user experience. A budget check that ends the loop deliberately can summarise what
was found, return partial progress, and record a clean metric you can alert on. **Have both.**
The soft one should almost always fire first; if the hard one is firing, something is wrong with
the soft one.`,
    },
    {
      type: 'markdown',
      md: `
## Making an agent's output usable

An agent returns a conversation, but a calling service usually wants a typed result. Two
approaches, with different trade-offs.

**A final structured pass.** Let the agent finish, then run one extraction call over the
conversation to produce your schema. Simple, predictable, one extra call.

**A response tool.** Give the agent a tool whose "execution" is simply recording the final
answer, and treat calling it as the terminal state. Saves a call and reuses the tool-calling
machinery the model is already good at. The failure mode is an agent that never calls it, so the
step bound still matters.

For anything user-facing, also consider **returning intermediate steps**. Showing which tools
ran and what they returned converts an opaque answer into an auditable one, and it is the single
most effective thing you can do for user trust in an agent.
`.trim(),
    },
    {
      type: 'markdown',
      md: `
## Multi-agent, and when it is a real answer

Once one agent works, splitting into several is tempting: a researcher, a writer, a critic. It
is occasionally right and frequently a way of turning one debugging problem into four.

**Supervisor.** One agent routes to specialists and assembles their results. The most tractable
pattern, because control is centralised and traceable.

**Handoff.** Agents transfer control to one another as peers. Flexible, and hard to reason about
once a handoff cycle appears.

**Parallel with a reducer.** Several agents work independently and a final step combines them.
Genuinely useful when subtasks are independent, such as researching five companies at once.

Before splitting, be specific about why. "Separation of concerns" is not a reason on its own —
a single agent with fifteen well-described tools frequently outperforms three agents with five
each, because it has the whole context and the handoffs cost nothing. **Split when subtasks need
genuinely different system prompts, different models, or independent parallel execution.**
`.trim(),
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Every handoff loses context',
      md: `When one agent passes work to another, the receiving agent sees a summary rather than
the full history — that is usually the point, and it is also the leak. Details the second agent
needed but the first did not think to include are simply gone, and the symptom is a confidently
wrong answer with no obvious cause. **Trace across the boundary** so a handoff is inspectable, and
be explicit about what each handoff is contracted to carry.`,
    },
    {
      type: 'checklist',
      title: 'Before an agent handles real traffic',
      items: [
        'You can articulate why a chain would not work for this problem',
        'A soft step and token budget that ends the loop with a real message',
        'A hard recursion limit underneath it as a backstop',
        'Cumulative token spend per conversation tracked and alerted on',
        'Tool errors returned to the model, never swallowed',
        'Irreversible actions gated behind human approval',
        'Intermediate steps surfaced to the user for anything consequential',
        'Re-evaluated after any model change, since tool-calling reliability varies',
      ],
    },
  ],

  flashcards: [
    { front: 'What is the trade an agent makes?', back: 'It gives up predictable control flow in exchange for handling inputs you could not enumerate in advance. If you can write the flowchart, a chain is better.' },
    { front: 'Why does agent cost grow quadratically with turns?', back: 'Every turn resends the entire message history, so the total is the sum of a growing prefix rather than a fixed cost per call. An occasional thirty-turn run is an occasional very large bill.' },
    { front: 'Why have both a budget check and a recursion limit?', back: 'The recursion limit raises an exception, which is a poor user experience. A budget check ends the loop deliberately, returning partial progress and a clean metric. The soft one should fire first.' },
    { front: 'When is splitting into multiple agents actually justified?', back: 'When subtasks need genuinely different system prompts, different models, or independent parallel execution. Separation of concerns alone is not a reason, since one agent with more tools keeps full context.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'A workflow always performs the same three steps in the same order. A colleague proposes building it as an agent. What is the objection?',
      options: [
        'Agents cannot guarantee that all three tools are called',
        'The steps are enumerable, so an agent rediscovers a known pipeline each request, less reliably and at higher cost',
        'Agents require a checkpointer, which adds infrastructure',
        'Three tools is below the minimum for reliable tool selection',
      ],
      answerIndex: 1,
      explanation: 'Nondeterministic control flow is a cost you accept to handle unenumerable paths. When the path is known, encoding it directly gives determinism, lower latency and lower cost for free. The agent adds variance with nothing in return.',
    },
    {
      id: 'q2',
      prompt: 'Your agent occasionally runs thirty turns and produces an unusually large bill. Beyond capping turns, what explains the disproportionate cost?',
      options: [
        'Each turn resends the whole history, so total tokens grow with the square of the turn count',
        'Long conversations force the provider onto a more expensive model tier',
        'Tool results are billed separately from model tokens',
        'Streaming charges per chunk rather than per token',
      ],
      answerIndex: 0,
      explanation: 'The thirtieth call carries twenty-nine turns of context, and every earlier call carried its own growing prefix. Summing those gives quadratic growth, which is why a rare long run costs far more than its turn count suggests. Prompt caching reduces the constant but leaves the shape.',
    },
    {
      id: 'q3',
      prompt: 'Which agent failure is most dangerous, and why?',
      options: [
        'Hitting the recursion limit, because the request fails outright',
        'Choosing a suboptimal tool, because it wastes a turn',
        'Fabricating an answer after a swallowed tool error, because nothing in the output signals that it happened',
        'Exceeding the latency budget, because users abandon the request',
      ],
      answerIndex: 2,
      explanation: 'The other failures announce themselves through an exception, a metric or user behaviour. A confident answer built on a hidden tool failure looks exactly like a correct answer, so it reaches the user and is believed. Returning errors to the model as readable text prevents it.',
    },
    {
      id: 'q4',
      prompt: 'What is the main argument against splitting one working agent into a researcher, a writer and a critic?',
      options: [
        'Multi-agent systems cannot share a checkpointer',
        'Each handoff loses context, and one agent with more tools keeps the full history at no handoff cost',
        'Running three agents triples latency in all cases',
        'Specialist agents cannot be given different system prompts',
      ],
      answerIndex: 1,
      explanation: 'A handoff passes a summary, and whatever the sender did not think to include is gone. That produces confidently wrong output with no obvious cause. Splitting is justified by genuinely different prompts, models or parallelism, not by an aesthetic preference for separated concerns.',
    },
    {
      id: 'q5',
      prompt: 'You need a typed object from an agent rather than a conversation. What does the response-tool approach trade against a final extraction call?',
      options: [
        'It requires a checkpointer, whereas extraction does not',
        'It cannot express nested schemas',
        'It saves a model call and reuses tool calling, but risks the agent never invoking it, so the step bound still matters',
        'It produces the object without any schema validation',
      ],
      answerIndex: 2,
      explanation: 'Treating a tool call as the terminal state avoids an extra round trip and leans on machinery the model handles well. The exposure is that nothing forces the agent to call it, so the loop can run on without ever terminating properly, which is exactly what the step bound is for.',
    },
  ],
};
