import type { Chapter } from '../../../types';

export const chapter: Chapter = {
  id: 'retrieval',
  title: 'Retrieval through a framework',
  summary: 'The loader, splitter, vector store and retriever interfaces, the composable retrievers worth knowing, and an honest comparison with LlamaIndex on the same ground.',
  estimatedMinutes: 22,

  blocks: [
    {
      type: 'markdown',
      md: `
This chapter is about the **abstractions**, not about retrieval theory. Chunk sizing, embedding
choice, hybrid search and reranking are covered properly in the Retrieval-Augmented Generation
course on this site, and nothing here replaces that. What follows is how those ideas are
expressed in a framework, and where the framework helps or gets in the way.

The pipeline has four interfaces, and each one is a place you can substitute an implementation
without touching the rest.

\`\`\`
DocumentLoader  ->  TextSplitter  ->  VectorStore  ->  Retriever
   source            chunks           embeddings       query time
\`\`\`
`.trim(),
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'ingest.py',
      caption: 'Metadata set at load time is what makes filtered retrieval possible later. You cannot add it afterwards without re-indexing.',
      code: `from langchain_community.document_loaders import DirectoryLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_postgres import PGVector
from langchain_openai import OpenAIEmbeddings

# A Document is page_content plus a metadata dict. There are loaders for most
# sources, and writing one is a single method returning a list of Documents.
loader = DirectoryLoader("docs/", glob="**/*.md")
docs = loader.load()

# Recursive splitting tries paragraph breaks, then sentences, then words, so
# chunks respect natural boundaries where they exist.
splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=150,
    add_start_index=True,          # lets you cite a location within the source
)
chunks = splitter.split_documents(docs)

# Metadata is retrieval infrastructure. Filtering by it is faster and far more
# accurate than hoping semantic similarity separates current from archived.
for c in chunks:
    c.metadata.update({
        "product": infer_product(c.metadata["source"]),
        "updated_at": file_mtime(c.metadata["source"]).isoformat(),
        "is_current": not c.metadata["source"].startswith("docs/archive/"),
    })

store = PGVector(
    embeddings=OpenAIEmbeddings(model="text-embedding-3-small"),
    collection_name="acme_docs",
    connection=DB_URL,
)
store.add_documents(chunks)

# A retriever is a runnable, which is what lets it drop straight into a chain.
retriever = store.as_retriever(
    search_type="mmr",             # diversity, so the top-k are not near-duplicates
    search_kwargs={
        "k": 6,
        "fetch_k": 30,             # consider 30, return the 6 most diverse
        "filter": {"is_current": True},
    },
)`,
    },
    {
      type: 'callout',
      variant: 'insight',
      title: 'A retriever is just a runnable that returns documents',
      md: `That is the whole interface: give it a string, get back a list of \`Document\`. Because it
satisfies the runnable protocol, it composes with a pipe like anything else, and **anything that
returns documents can be a retriever** — a SQL query, a web search API, a call to another service.
Some of the most effective retrievers in production are not vector searches at all.`,
    },
    {
      type: 'markdown',
      md: `
## The composable retrievers

These wrap a base retriever and are worth knowing by name, because each solves a failure you
will otherwise meet and misdiagnose.

**\`MultiQueryRetriever\`** — has the model write three or four rephrasings of the question,
retrieves for each, and takes the union. Fixes the case where the user's wording happens to sit
far from the document's wording. Costs one extra model call.

**\`ParentDocumentRetriever\`** — indexes small chunks for precise matching but returns the larger
parent section for context. This is the small-to-big pattern, and it resolves the chunk-size
tension rather than compromising on it.

**\`ContextualCompressionRetriever\`** — post-processes results, either by reranking with a
cross-encoder or by having a model strip irrelevant passages. The single most reliable quality
improvement available at query time.

**\`EnsembleRetriever\`** — fuses ranked lists from several retrievers, typically a dense vector
search and a BM25 keyword search. Hybrid search usually beats either alone, especially on error
codes, product names and identifiers, where keyword matching is simply better.

**\`SelfQueryRetriever\`** — has the model translate a natural-language question into a metadata
filter plus a search string, so "pricing docs updated this year" becomes an actual filter rather
than a hope.
`.trim(),
    },
    {
      type: 'diagram',
      kind: 'mermaid',
      src: `
flowchart TB
    Q["Question"] --> MQ["MultiQueryRetriever<br/>generates rephrasings"]

    MQ --> ENS["EnsembleRetriever"]
    ENS --> D["Dense: vector search<br/>semantic similarity"]
    ENS --> S["Sparse: BM25<br/>exact terms, error codes"]

    D --> FUSE["Fuse ranked lists"]
    S --> FUSE

    FUSE --> CC["ContextualCompression<br/>rerank, drop the rest"]
    CC --> PD["ParentDocumentRetriever<br/>swap chunk for parent section"]
    PD --> CTX["Context for the prompt"]

    CTX -.->|"each layer costs<br/>latency and money"| NOTE["Add one at a time,<br/>measure each"]
`.trim(),
      caption: 'Every layer is optional and every layer costs something. Adding all five at once means never knowing which one earned its place.',
    },
    {
      type: 'code',
      lang: 'python',
      filename: 'hybrid.py',
      caption: 'Hybrid plus reranking is the combination that most reliably improves answers. Weights are a starting point and should be tuned against an evaluation set.',
      code: `from langchain.retrievers import EnsembleRetriever, ContextualCompressionRetriever
from langchain_community.retrievers import BM25Retriever
from langchain_cohere import CohereRerank

dense = store.as_retriever(search_kwargs={"k": 20})

# BM25 here is in-memory over the chunk list. For a real corpus use the keyword
# index your search engine already provides rather than rebuilding it in Python.
sparse = BM25Retriever.from_documents(chunks)
sparse.k = 20

hybrid = EnsembleRetriever(
    retrievers=[dense, sparse],
    weights=[0.6, 0.4],     # tune on an eval set; these are a starting point
)

# Retrieve broadly, then rerank down. A cross-encoder scores the query against
# each document jointly, which is far more accurate than comparing embeddings —
# and too slow to run over the whole corpus, which is why it goes second.
retriever = ContextualCompressionRetriever(
    base_retriever=hybrid,
    base_compressor=CohereRerank(model="rerank-english-v3.0", top_n=5),
)

rag_chain = (
    {"context": retriever | format_docs, "question": RunnablePassthrough()}
    | prompt | model | StrOutputParser()
)`,
    },
    {
      type: 'callout',
      variant: 'pitfall',
      title: 'The vector store abstraction is thinner than it looks',
      md: `Every store implements \`add_documents\` and \`similarity_search\`, so simple code is
genuinely portable. The differences appear immediately past that: **metadata filter syntax is not
standardised**, hybrid search support varies, and features like namespaces, deletion by filter and
index tuning are store-specific. A filter written for one store is often silently ignored rather
than rejected by another — which means the query returns results, they are simply unfiltered.
Test filters explicitly when you switch.`,
    },
    {
      type: 'markdown',
      md: `
## Indexing and staleness

The overlooked half of retrieval is keeping the index current. Re-embedding an entire corpus
nightly is wasteful and, past a certain size, impossible within the window.

LangChain's indexing API tracks content hashes so a re-run only embeds what changed, and can
delete vectors whose source documents have disappeared. The three modes matter:

- **None** — add everything, no deduplication. Fine for a one-off load.
- **Incremental** — update changed documents and delete their old versions. The usual choice.
- **Full** — additionally delete vectors for source documents no longer present. The only mode
  that removes deleted content, and therefore the one you need for anything with a retention or
  correctness obligation.

The failure mode without this is quiet and serious: a policy document is deleted, its vectors
remain, and the assistant keeps citing a policy that no longer exists.
`.trim(),
    },
    {
      type: 'table',
      headers: ['Concern', 'LangChain', 'LlamaIndex'],
      rows: [
        ['Primary abstraction', 'Runnables and chains; retrieval is one integration among many', 'Indexes and query engines; retrieval is the centre'],
        ['Getting started on documents', 'Assemble loader, splitter, store, retriever yourself', 'A few lines to a working index over a directory'],
        ['Advanced retrieval strategies', 'Composable retrievers you assemble', 'More strategies available out of the box, including richer node relationships'],
        ['Agents and tool use', 'The stronger side, especially with LangGraph', 'Present, and less central'],
        ['Structured and mixed data', 'Workable through tools and SQL chains', 'Stronger, with dedicated query engines over structured sources'],
        ['Best fit', 'Applications where retrieval is one capability among several', 'Applications where the corpus is the product'],
      ],
      caption: 'They are not competitors so much as different centres of gravity, and using LlamaIndex retrieval inside a LangChain application is routine.',
    },
    {
      type: 'callout',
      variant: 'warning',
      title: 'Measure the retriever separately from the answer',
      md: `When answers are poor, the instinct is to change the prompt. But if the right document
was never retrieved, no prompt can recover it — the ceiling on answer quality is retrieval recall.
**Build a small set of questions with known correct documents and measure recall at k directly.**
Ten minutes of that tells you whether to work on retrieval or on generation, and teams routinely
spend weeks on the wrong one.`,
    },
    {
      type: 'checklist',
      title: 'Retrieval integration review',
      items: [
        'Metadata set at load time, including source, recency and any filter dimension',
        'Filters tested explicitly after any vector store change, since syntax is not portable',
        'Hybrid search used where exact terms such as error codes matter',
        'Reranking applied over a broad first-stage retrieval, not a narrow one',
        'One retriever layer added at a time, each measured before the next',
        'Indexing run in a mode that deletes vectors for removed source documents',
        'Recall at k measured on a labelled question set before touching the prompt',
      ],
    },
  ],

  flashcards: [
    { front: 'What is the complete retriever interface?', back: 'A runnable that takes a string and returns a list of Documents. Anything satisfying that can be a retriever, including a SQL query or a web search API.' },
    { front: 'What does ParentDocumentRetriever solve?', back: 'The chunk-size tension. It indexes small chunks for precise matching but returns the larger parent section, so you get precision and context rather than a compromise between them.' },
    { front: 'Why does the vector store abstraction leak?', back: 'Basic operations are portable, but metadata filter syntax is not standardised. A filter written for one store may be silently ignored by another, returning unfiltered results rather than an error.' },
    { front: 'Which indexing mode removes vectors for deleted source documents?', back: 'Full mode. Without it, a deleted policy document leaves its vectors behind and the assistant keeps citing content that no longer exists.' },
  ],

  quiz: [
    {
      id: 'q1',
      prompt: 'You migrate from one vector store to another. Code runs, results return, but answers get worse. What should you check first?',
      options: [
        'That the embedding model produces the same vector dimensions',
        'That your metadata filters are actually being applied, since filter syntax is not standardised and may be silently ignored',
        'That chunk_overlap survived the migration',
        'That the retriever is still wrapped in a ContextualCompressionRetriever',
      ],
      answerIndex: 1,
      explanation: 'The dangerous case is not an error but a filter that is quietly dropped, so a query intended to search only current documents now searches everything including archived material. Results still come back, which is why this survives a smoke test. Filters need explicit verification after any store change.',
    },
    {
      id: 'q2',
      prompt: 'Answers cite a policy that was deleted from the source repository months ago. What is the cause?',
      options: [
        'The retriever is caching results from before the deletion',
        'chunk_overlap is duplicating content across chunks',
        'MMR is fetching diverse results including outdated ones',
        'Indexing ran in a mode that adds and updates but never deletes vectors for removed sources',
      ],
      answerIndex: 3,
      explanation: 'Deleting a file does not delete its embeddings. Only full mode reconciles the index against the current source set and removes what is gone. This is a correctness obligation rather than a tidiness one, since the assistant will keep citing the stale content confidently.',
    },
    {
      id: 'q3',
      prompt: 'Why does reranking go after a broad first-stage retrieval rather than replacing it?',
      options: [
        'Cross-encoders score query and document jointly, which is far more accurate but too slow to run over an entire corpus',
        'Rerankers require a minimum number of candidates to calibrate their scores',
        'The first stage is needed to populate the metadata that reranking filters on',
        'Reranking only works on results that have already been fused from multiple retrievers',
      ],
      answerIndex: 0,
      explanation: 'The two stages have complementary properties. Vector search is fast enough for the whole corpus and comparatively imprecise; a cross-encoder is precise and far too slow at that scale. Retrieving broadly then reranking down uses each where it is strong.',
    },
    {
      id: 'q4',
      prompt: 'Answers are poor. What should you measure before rewriting the prompt?',
      options: [
        'Token usage per request, to check the context is not being truncated',
        'The latency of each chain stage, to find the bottleneck',
        'Recall at k on a labelled question set, since no prompt can recover a document that was never retrieved',
        'The similarity score distribution across the corpus',
      ],
      answerIndex: 2,
      explanation: 'Retrieval recall is the ceiling on answer quality. If the needed document is absent from the context, prompt work cannot help, and teams routinely spend weeks discovering this. A small labelled set answers the question in minutes and directs the effort correctly.',
    },
    {
      id: 'q5',
      prompt: 'When is LlamaIndex the more natural primary choice over LangChain?',
      options: [
        'When the application is an agent coordinating many tools',
        'When the corpus is the product and retrieval over documents is the central difficulty',
        'When you need durable conversation state across restarts',
        'When you must support several model providers interchangeably',
      ],
      answerIndex: 1,
      explanation: 'LlamaIndex centres indexes and query engines, giving more retrieval strategy out of the box for document-heavy problems. Agent coordination, durable state and provider portability are where LangChain and LangGraph are stronger, and mixing LlamaIndex retrieval into a LangChain application is a common arrangement.',
    },
  ],
};
