import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'tools',
  title: 'Tools and function calling',
  summary: 'How a model calls your code: schemas as prompts, the request-execute-return cycle, why tool design matters more than prompt wording, and what to do when a tool fails.',
  estimatedMinutes: 24,

  blocks: [
    {
      type: 'markdown',
      md: `
A tool is a function the model can ask you to run. The model never executes anything — it emits
a **request** naming a tool and its arguments, your code runs it, and you return the result as a
message. Every agent in existence is that cycle, repeated.

The framing matters because it locates responsibility. Validation, authorisation, rate limiting
and error handling are yours. The model decides *what* to call and is frequently wrong about it.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'defining_tools.py',
      caption: 'The docstring and the argument descriptions are prompt text. This is the highest-leverage writing in a tool-using application.',
      code: `from typing import Literal, Annotated
from pydantic import BaseModel, Field
from langchain_core.tools import tool


@tool
def search_orders(
    customer_id: str,
    status: Literal["pending", "shipped", "delivered", "cancelled"] | None = None,
    limit: int = 10,
) -> list[dict]:
    """Look up a customer's orders, most recent first.

    Use this when the user asks about an order they have already placed.
    Do NOT use it to check stock levels — use check_inventory for that.

    Returns an empty list if the customer has no matching orders, which is a
    normal result and not an error.
    """
    return db.query_orders(customer_id, status=status, limit=limit)


# For anything with more than a couple of arguments, declare the schema
# explicitly. Field descriptions are sent to the model; type hints alone are not
# enough to convey a format constraint.
class RefundInput(BaseModel):
    order_id: str = Field(description="Order id in the form ORD-12345.")
    amount_cents: int = Field(gt=0, description="Amount in CENTS, never dollars.")
    reason: str = Field(description="One short sentence for the audit log.")


@tool("issue_refund", args_schema=RefundInput)
def issue_refund(order_id: str, amount_cents: int, reason: str) -> dict:
    """Issue a refund against an order. This moves real money.

    Only call after the customer has explicitly confirmed the amount.
    """
    return payments.refund(order_id, amount_cents, reason)`,
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'The docstring is not documentation, it is the prompt',
      md: `The model chooses tools from their names, descriptions and argument schemas. Nothing
else. A vague docstring produces wrong tool selection that no amount of system-prompt tuning
fixes, because the system prompt is not where the decision is made. **Say when to use the tool,
when not to, and what a normal empty result looks like** — that last one prevents a model
retrying a correctly-empty search five times.`,
    },
    {
      type: 'markdown',
      md: `
## The cycle, unwrapped

Before reaching for an agent abstraction, it is worth writing the loop once by hand. Everything
higher-level is this with policy attached.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'the_loop.py',
      caption: 'The whole mechanism, roughly twenty lines. Agent frameworks add termination policy, error handling, streaming and persistence on top of exactly this.',
      code: `from langchain_core.messages import HumanMessage, ToolMessage

tools = [search_orders, check_inventory, issue_refund]
tools_by_name = {t.name: t for t in tools}

# bind_tools attaches the schemas to the model. It does not change the model,
# it returns a new runnable that advertises those tools on every call.
model_with_tools = model.bind_tools(tools)

messages = [HumanMessage("Where is my order ORD-8891?")]

for _ in range(10):                       # a bound, always. See the pitfall below.
    ai = model_with_tools.invoke(messages)
    messages.append(ai)

    # No tool calls means the model is answering. That is the exit condition.
    if not ai.tool_calls:
        break

    # A single AIMessage can request SEVERAL calls. Running them concurrently is
    # usually correct and occasionally not — see the ordering pitfall.
    for call in ai.tool_calls:
        tool = tools_by_name[call["name"]]
        try:
            result = tool.invoke(call["args"])
        except Exception as exc:
            # Feed the error back as a normal result. The model can often
            # recover — fix an argument, try a different tool, or explain.
            result = f"Error: {exc}. Check the arguments and try once more."

        messages.append(
            ToolMessage(content=str(result), tool_call_id=call["id"])
        )

print(messages[-1].content)`,
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
sequenceDiagram
    participant U as User
    participant A as Your code
    participant M as Model
    participant T as Tools

    U->>A: "Where is order ORD-8891?"
    A->>M: messages plus tool schemas
    M-->>A: AIMessage with tool_calls<br/>search_orders, id=call_1

    Note over A: The model requested. It did not execute.<br/>Validation and authorisation happen here.

    A->>T: search_orders(customer_id, ...)
    T-->>A: rows, or an exception
    A->>M: messages plus ToolMessage, tool_call_id=call_1
    M-->>A: AIMessage with content, no tool_calls
    A-->>U: the answer

    Note over A,M: No tool_calls is the exit condition.<br/>Without a step bound, there may never be one.
`.trim(),
      caption: 'The model requests, your code decides. Every security control lives in the middle participant.',
    },
    {
      type: 'markdown',
      md: `
## Designing tools the model can actually use

Tool quality dominates prompt quality in agent applications. A few rules earn their keep
immediately.

**One job per tool.** \`manage_order(action, ...)\` with an action parameter forces the model to
make two decisions at once and produces invalid combinations. Separate tools have separate
schemas, and an invalid combination becomes unrepresentable.

**Names that say what happens.** \`get_data\` tells the model nothing. \`search_orders\` and
\`cancel_subscription\` tell it everything.

**Between five and about fifteen tools.** Below five, consider whether you need an agent at all.
Above fifteen or twenty, selection accuracy degrades noticeably — group them behind a router, or
expose a subset based on the conversation.

**Return text the model can read.** A tool returning a 4,000-row JSON dump wastes the context
window and buries the answer. Summarise, paginate, and say how many results were omitted.

**Make errors instructive.** \`Error: ORD-8891 not found. Order ids look like ORD-12345 and are
case-sensitive.\` lets the model self-correct. A bare stack trace does not.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Failure', 'What it looks like', 'Fix'],
      rows: [
        ['Wrong tool chosen', 'Model searches inventory when asked about an order', 'Sharpen descriptions; say explicitly when not to use each tool'],
        ['Invalid arguments', 'Dollars passed where cents are expected', 'Encode the constraint in the schema and repeat it in the field description'],
        ['Tool loops on empty results', 'Same search repeated five times', 'State in the docstring that an empty result is normal and final'],
        ['Context flooded', 'One call returns thousands of rows', 'Paginate, summarise, and report the omitted count'],
        ['Model never stops', 'Alternates between two tools indefinitely', 'A hard step bound plus a cost ceiling; see Chapter 6'],
        ['Silent wrong answer', 'Tool raised, error was swallowed, model invented a result', 'Return errors as ToolMessage content; never hide a failure'],
      ],
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'Parallel tool calls are concurrent, not ordered',
      md: `Models routinely emit several calls in one message, and running them concurrently is
the point. But nothing guarantees an order, and the model has no notion that one depends on
another. If \`create_invoice\` and \`send_invoice_email\` arrive together, you may email an invoice
that does not exist yet. **Tools that must be sequenced should not be separately callable** —
combine them, or enforce the dependency in your executor rather than hoping the model does.`,
    },
    {
      type: 'markdown',
      md: `
## The security boundary

Tool calling turns a text generator into something that acts. The threat model changes
completely, and the critical fact is this: **the model's tool call is derived from text that may
include untrusted content.** A retrieved document, an email in an inbox, a web page — any of
these can contain instructions aimed at your agent.

The mitigations that actually work are structural, not prompt-based.

- **Authorise in your code, per call, against the real user.** Never rely on the model to
  restrict itself to a customer's own records. Pass the authenticated identity into the tool from
  the request context, not from a model-supplied argument.
- **Split read from write.** Read tools can be liberal. Anything that moves money, deletes data
  or sends a message is a different category.
- **Require human approval for consequential actions.** Chapter 7 covers the interrupt mechanism
  that makes this practical.
- **Validate arguments as hostile input**, because they are. The model is an untrusted client of
  your API.
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'safe_tools.py',
      caption: 'The identity comes from the request, never from the model. An argument the model controls is an argument an attacker may control.',
      code: `from langchain_core.tools import tool, InjectedToolArg
from typing import Annotated


@tool
def get_my_orders(
    status: str | None = None,
    # InjectedToolArg is supplied by your code at execution time and is hidden
    # from the model's schema. The model cannot see it, so it cannot set it.
    user_id: Annotated[str, InjectedToolArg] = "",
) -> list[dict]:
    """List the current user's own orders. Cannot access other customers."""
    return db.query_orders(customer_id=user_id, status=status)


def execute_call(call: dict, authenticated_user_id: str) -> ToolMessage:
    tool = tools_by_name[call["name"]]

    # Injected arguments are merged in here, from the request context.
    args = {**call["args"], "user_id": authenticated_user_id}

    # Write tools are a different category and are gated separately.
    if tool.name in WRITE_TOOLS and not approvals.granted(call["id"]):
        return ToolMessage(
            content="Refused: this action requires explicit user confirmation.",
            tool_call_id=call["id"],
        )

    try:
        result = tool.invoke(args)
    except PermissionError:
        # Do not leak whether the resource exists.
        result = "Error: not permitted."
    except Exception as exc:
        result = f"Error: {exc}"

    return ToolMessage(content=str(result)[:4000], tool_call_id=call["id"])`,
    },
    {
      type: 'callout',
      variant: 'note',
      title: 'MCP is the emerging way to share tools between applications',
      md: `The Model Context Protocol standardises how tools are described and invoked across a
process boundary, so a tool server written once can be consumed by any compatible client. LangChain
can consume MCP servers, which means a tool no longer has to live in your codebase to be usable.
The trade is the usual one for a remote boundary: latency, a new failure mode, and a much more
careful conversation about what a third-party tool server is permitted to do.`,
    },
    {
      type: 'checklist',
      title: 'Before exposing a tool to a model',
      items: [
        'The docstring says when to use it, when not to, and what an empty result means',
        'Every argument has a description carrying its format and units',
        'One job per tool, with no action parameter selecting between behaviours',
        'Output bounded and summarised, with any omitted count reported',
        'Errors returned as readable text the model can act on',
        'User identity injected from the request, never accepted as a model argument',
        'Write actions separated from reads and gated behind approval',
        'Tools that must be sequenced combined, rather than trusted to the model',
      ],
    },
  ],

  flashcards: [
    { front: 'What does a model actually do when it "calls a tool"?', back: 'It emits a request naming the tool and arguments. Your code executes it and returns a ToolMessage. The model never runs anything, so all validation and authorisation are yours.' },
    { front: 'Why is a tool docstring the highest-leverage text in an agent application?', back: 'Tool selection is made from names, descriptions and argument schemas alone. A vague docstring causes wrong selection that no system-prompt tuning can fix.' },
    { front: 'What is the danger of parallel tool calls?', back: 'They are concurrent and unordered. Calls with a real dependency, such as creating then emailing an invoice, can execute in the wrong order. Sequence them in your executor or combine the tools.' },
    { front: 'How should user identity reach a tool?', back: 'Injected by your code from the authenticated request context, hidden from the model\'s schema. Any argument the model controls is one an attacker may control through injected text.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'Your agent keeps calling check_inventory when users ask about existing orders. Prompt tuning has not helped. What is the right fix?',
      options: [
        'Lower the temperature so tool selection becomes deterministic',
        'Sharpen the tool descriptions, since selection is made from names and descriptions rather than the system prompt',
        'Reduce the number of bound tools to two',
        'Move the instruction to the first human message instead of the system message',
      ],
      answerIndex: 1,
      explanation: 'The model picks tools from their names, docstrings and argument schemas. The system prompt is not where that decision happens, which is why tuning it has no effect. Stating explicitly when not to use each tool resolves most confusions of this kind.',
    },
    {
      id: 'q2',
      prompt: 'A tool raises an exception. Which handling gives the best behaviour?',
      options: [
        'Catch it and return an empty result, so the loop continues cleanly',
        'Let it propagate and fail the whole request',
        'Return the error as ToolMessage content, phrased so the model can correct itself',
        'Retry the tool silently three times before reporting anything',
      ],
      answerIndex: 2,
      explanation: 'The model can often recover by fixing an argument or choosing a different tool, but only if it is told what went wrong. Returning an empty result is the dangerous option: the model treats it as a genuine finding and answers confidently from nothing.',
    },
    {
      id: 'q3',
      prompt: 'Why should get_my_orders take user_id as an injected argument rather than a normal parameter?',
      options: [
        'Injected arguments are validated more strictly by the framework',
        'It reduces the token cost of the tool schema',
        'Normal parameters cannot carry string values reliably',
        'A normal parameter is visible to the model, so text injected into the context could cause it to request another customer\'s records',
      ],
      answerIndex: 3,
      explanation: 'Anything in the schema is something the model can set, and the model\'s decisions derive from text that may include untrusted content such as a retrieved document. Supplying identity from the authenticated request makes the attack unrepresentable rather than merely discouraged.',
    },
    {
      id: 'q4',
      prompt: 'An agent has 40 tools bound and selects the wrong one frequently. What is the most effective structural change?',
      options: [
        'Group the tools behind a router or expose a conversation-relevant subset, since selection accuracy degrades well below 40',
        'Combine them into one tool with an action parameter',
        'Increase the step bound so the agent can recover from wrong choices',
        'Add all 40 tool names to the system prompt for reinforcement',
      ],
      answerIndex: 0,
      explanation: 'Selection accuracy falls off past roughly fifteen or twenty tools, so the fix is to reduce how many the model chooses among at once. An action parameter makes it worse by forcing two decisions into one schema and allowing invalid combinations.',
    },
    {
      id: 'q5',
      prompt: 'What does the Model Context Protocol change about tool availability?',
      options: [
        'It removes the need for argument validation, since schemas are enforced by the protocol',
        'It standardises tool description and invocation across a process boundary, so a tool server can be consumed by any compatible client',
        'It allows models to execute tools directly without application code',
        'It replaces bind_tools with a registry-based discovery mechanism',
      ],
      answerIndex: 1,
      explanation: 'The protocol makes tools portable between applications rather than living inside one codebase. That introduces the usual remote-boundary costs of latency and new failure modes, and it makes the question of what a third-party server may do considerably more pressing. Validation remains your responsibility.',
    },
  ],
};
