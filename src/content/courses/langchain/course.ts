import type { Course } from '../../types';
import { meta } from './meta';

import { chapter as whyFrameworks } from './chapters/01-why-frameworks';
import { chapter as modelsMessages } from './chapters/02-models-messages';
import { chapter as promptsContext } from './chapters/03-prompts-context';
import { chapter as composition } from './chapters/04-composition';
import { chapter as tools } from './chapters/05-tools';
import { chapter as agents } from './chapters/06-agents';
import { chapter as graphsState } from './chapters/07-graphs-state';
import { chapter as retrieval } from './chapters/08-retrieval';
import { chapter as memory } from './chapters/09-memory';
import { chapter as production } from './chapters/10-production';

export const course: Course = {
  ...meta,

  intro: `
The first call to a language model takes ten minutes and needs no framework. The fortieth needs
retries, streaming, structured output, a tool loop, conversation state that survives a restart,
and some way to see what was actually sent. None of that is model work. All of it is the same
plumbing in every application, which is the condition under which a framework earns its place.

This course is about that layer. It centres on **LangChain and LangGraph**, because together they
are the most widely deployed answer, and it covers the alternatives — LlamaIndex, Haystack, DSPy,
Semantic Kernel, Pydantic AI — where they make a genuinely different bet worth knowing about. The
running example is a support assistant that looks up orders, answers from documentation and can
issue a refund, because that one application touches every concern in the course.

Two warnings shape the writing. LangChain 1.0 reorganised the project substantially, so most
tutorials you will find describe a version that no longer exists; the code here targets the
current API and says so where a call has moved. And the common criticism that these frameworks
hide what was sent to the model is fair rather than a misunderstanding — so tracing appears early
and is treated as a requirement rather than a nicety.
`.trim(),

  outcomes: [
    'Decide honestly whether a problem needs an orchestration framework, a plain SDK call, or a graph',
    'Compose prompts, models and parsers into chains that stream, retry and fall back without bespoke control flow',
    'Get reliable structured output, and recognise the schema mistakes that make models fabricate values',
    'Design tools a model can actually select correctly, and execute them behind a real authorisation boundary',
    'Build an agent with step and cost budgets that fail gracefully instead of producing a billing incident',
    'Model an application as a LangGraph state machine with durable state, cycles and human approval steps',
    'Assemble context from history, retrieval and examples against an explicit token budget',
    'Trace, evaluate and secure an LLM application, including the exfiltration risk specific to agents',
  ],

  glossary: [
    { term: 'runnable', definition: 'Any component implementing invoke, batch and stream plus their async forms. The uniform protocol is what makes piping, streaming propagation and attachable retries work.', aliases: ['runnables'] },
    { term: 'LCEL', definition: 'LangChain Expression Language: composing runnables with the pipe operator so the composite is itself a runnable with the same interface.', aliases: ['LangChain Expression Language'] },
    { term: 'chat model', definition: 'A component that takes a list of messages and returns one message. That is the entire contract everything else is built on.', aliases: ['chat models'] },
    { term: 'init_chat_model', definition: 'The factory that resolves a provider-prefixed string such as openai:gpt-4o at runtime, keeping the model a configuration value rather than an import.' },
    { term: 'AIMessage', definition: 'A model response. Its content may be empty when tool_calls is populated, which means the model is requesting functions rather than answering.' },
    { term: 'ToolMessage', definition: 'The result of executing a tool, returned to the model. Must carry the tool_call_id of the request it answers, since one message can request several calls.' },
    { term: 'MessagesPlaceholder', definition: 'A prompt template slot for an arbitrary number of prior messages, so one template serves a conversation of any length.' },
    { term: 'structured output', definition: 'Getting a validated object rather than prose, via tool calling, provider-native constrained decoding, or prompt-and-parse. with_structured_output selects a mechanism per provider.' },
    { term: 'tool', definition: 'A function the model may request. Selection is made from its name, description and argument schema alone, which makes the docstring prompt text rather than documentation.', aliases: ['tools'] },
    { term: 'tool call', definition: 'A request emitted by the model naming a tool and arguments. The model never executes anything, so validation and authorisation remain your responsibility.', aliases: ['tool_calls', 'tool calling'] },
    { term: 'bind_tools', definition: 'Attaches tool schemas to a model, returning a new runnable that advertises them on every call. It does not mutate the original model.' },
    { term: 'InjectedToolArg', definition: 'A tool argument supplied by your code at execution time and hidden from the model schema. The correct way to pass authenticated user identity into a tool.' },
    { term: 'agent', definition: 'The tool loop with the model deciding when to stop. It trades predictable control flow for the ability to handle inputs you could not enumerate in advance.', aliases: ['agents'] },
    { term: 'create_agent', definition: 'The LangChain 1.0 entry point for building an agent. It constructs a LangGraph graph underneath, which is why checkpointing and streaming come with it.' },
    { term: 'middleware', definition: 'Code running around the agent loop, typically before or after each model call. The right place for step budgets, token ceilings and approval gates.' },
    { term: 'LangGraph', definition: 'The state-machine runtime underneath modern LangChain. It provides cycles, conditional branching, persistence and interrupts that a chain cannot express.' },
    { term: 'StateGraph', definition: 'A graph defined by a state schema plus nodes returning partial updates and edges that may be conditional or cyclic.' },
    { term: 'reducer', definition: 'A function declaring how a node update combines with the existing value for a state key. Without one the value is replaced, which silently loses data on accumulating keys.', aliases: ['reducers'] },
    { term: 'add_messages', definition: 'The standard reducer for message lists. It appends rather than replacing and matches on message ids, so a re-emitted message updates in place.' },
    { term: 'checkpointer', definition: 'Persistence for graph state, written after every node transition. It is what makes conversations survive restarts and makes past states inspectable and replayable.', aliases: ['checkpointing'] },
    { term: 'thread', definition: 'One conversation, identified by a thread_id in the config. Invoking against the same thread resumes from checkpointed state rather than starting fresh.', aliases: ['thread_id'] },
    { term: 'interrupt', definition: 'A pause that persists all state and returns control to your application, so a process can exit and resume days later with a Command carrying a human decision.' },
    { term: 'retriever', definition: 'A runnable that takes a string and returns documents. Anything satisfying that interface qualifies, including a SQL query or a search API.', aliases: ['retrievers'] },
    { term: 'MCP', definition: 'Model Context Protocol: a standard for describing and invoking tools across a process boundary, so a tool server written once can serve any compatible client.', aliases: ['Model Context Protocol'] },
    { term: 'prompt injection', definition: 'Instructions hidden in untrusted content the model reads, aiming to override your intent. There is no reliable prompt-level defence; the mitigations are structural.' },
    { term: 'lethal trifecta', definition: 'Private data access, exposure to untrusted content, and a way to communicate outward. Any two are usually safe; all three together permit exfiltration.' },
    { term: 'trace', definition: 'The recorded tree of a request: every prompt, response, tool call, token count and latency. The only reliable answer to what was actually sent to the model.', aliases: ['tracing'] },
    { term: 'LLM-as-judge', definition: 'Using a model to score outputs against a rubric. An estimator with its own biases, so its agreement with human grading must be measured before it gates anything.' },
  ],

  chapters: [
    whyFrameworks,
    modelsMessages,
    promptsContext,
    composition,
    tools,
    agents,
    graphsState,
    retrieval,
    memory,
    production,
  ],
};
