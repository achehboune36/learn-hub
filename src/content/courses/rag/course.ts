import type { Course } from '../../types';
import { meta } from './meta';

import { chapter as whyRag } from './chapters/01-why-rag';
import { chapter as pipeline } from './chapters/02-pipeline';
import { chapter as ingestion } from './chapters/03-ingestion-chunking';
import { chapter as embeddings } from './chapters/04-embeddings';
import { chapter as vectorStores } from './chapters/05-vector-stores';
import { chapter as retrieval } from './chapters/06-retrieval';
import { chapter as reranking } from './chapters/07-reranking';
import { chapter as generation } from './chapters/08-generation';
import { chapter as evaluation } from './chapters/09-evaluation';
import { chapter as production } from './chapters/10-production';

export const course: Course = {
  ...meta,

  intro: `
Large language models are frozen at training time and confidently fill gaps they cannot see.
Retrieval-Augmented Generation is the standard answer: **look things up first, then write the
answer from what you found.**

This course follows one thread all the way through — a support assistant answering questions
over a company's own documents. Each chapter takes one stage of that system, explains what
actually happens inside it, and shows where it breaks in production. By the end you should be
able to look at a RAG system that "sometimes gives wrong answers" and know which of the eight
stages to instrument first.

The code is Python and deliberately provider-neutral: the ideas outlive whichever vector
database or embedding API is fashionable this quarter.
`.trim(),

  outcomes: [
    'Explain when RAG is the right tool and when fine-tuning or long-context prompting beats it',
    'Design a chunking strategy from the shape of your documents rather than by copying a default',
    'Reason about embeddings, similarity metrics and index structures well enough to choose between them',
    'Combine dense and sparse retrieval, and know why hybrid search usually wins',
    'Add reranking and assemble context that survives the lost-in-the-middle effect',
    'Write prompts that ground answers in retrieved text and cite their sources',
    'Measure a RAG system with retrieval and generation metrics instead of vibes',
    'Diagnose the usual production failures: stale indexes, latency, cost, and prompt injection through documents',
  ],

  glossary: [
    { term: 'RAG', definition: 'Retrieval-Augmented Generation: retrieve relevant text from an external store, then have a language model answer using that text as context.', aliases: ['Retrieval-Augmented Generation'] },
    { term: 'chunk', definition: 'A slice of a source document small enough to embed and retrieve independently. The unit of retrieval in almost every RAG system.', aliases: ['chunks', 'chunking'] },
    { term: 'embedding', definition: 'A fixed-length vector of floats representing the meaning of a piece of text, produced by an embedding model. Similar meanings land close together.', aliases: ['embeddings', 'vector'] },
    { term: 'cosine similarity', definition: 'Similarity measured as the cosine of the angle between two vectors — magnitude-independent, which is why it is the default for text embeddings.' },
    { term: 'vector database', definition: 'A store that indexes embeddings for fast approximate nearest-neighbour search, usually alongside metadata filters.', aliases: ['vector store', 'vector databases'] },
    { term: 'ANN', definition: 'Approximate Nearest Neighbour search: trades a little recall for a large speed-up over comparing the query against every vector.', aliases: ['approximate nearest neighbour'] },
    { term: 'HNSW', definition: 'Hierarchical Navigable Small World: a graph-based ANN index. Fast and high-recall, at the cost of memory and slower inserts.' },
    { term: 'BM25', definition: 'A ranking function for keyword search that scores documents by term frequency and rarity. Strong on exact terms, error codes and names.' },
    { term: 'hybrid search', definition: 'Running dense (embedding) and sparse (keyword) retrieval together and fusing the two ranked lists.' },
    { term: 'reranker', definition: 'A model — usually a cross-encoder — that re-scores a shortlist of retrieved chunks against the query with far more accuracy than the first-stage retriever.', aliases: ['reranking', 'cross-encoder'] },
    { term: 'top-k', definition: 'The number of chunks the retriever returns for a query. The main dial trading recall against context size, cost and noise.' },
    { term: 'grounding', definition: 'Constraining the model to answer only from supplied context, and to say so when the context does not contain the answer.', aliases: ['grounded'] },
    { term: 'hallucination', definition: 'A fluent, confident statement from a model that is not supported by its context or by fact.', aliases: ['hallucinations', 'hallucinate'] },
    { term: 'recall', definition: 'The share of the genuinely relevant chunks that retrieval actually returned. The ceiling on RAG answer quality — nothing downstream can recover a chunk that was never fetched.' },
    { term: 'precision', definition: 'The share of returned chunks that are actually relevant. Low precision fills the context window with distractors.' },
    { term: 'faithfulness', definition: 'Whether the generated answer is fully supported by the retrieved context. A faithful answer may still be unhelpful, but an unfaithful one is a hallucination.' },
    { term: 'query rewriting', definition: 'Transforming the user question before retrieval — expanding, decomposing, or resolving pronouns against conversation history.' },
    { term: 'HyDE', definition: 'Hypothetical Document Embeddings: have the model draft a plausible answer, embed that draft, and retrieve with it — often closer in vector space to real answer passages than the question was.' },
    { term: 'MMR', definition: 'Maximal Marginal Relevance: a selection rule that trades relevance against novelty so the top results are not near-duplicates.' },
    { term: 'chunk overlap', definition: 'Repeating a tail of one chunk at the head of the next so a sentence spanning the boundary still appears whole somewhere.' },
    { term: 'prompt injection', definition: 'Malicious instructions hidden inside data the model reads — in RAG, inside a retrieved document — that attempt to override the system prompt.' },
  ],

  chapters: [
    whyRag,
    pipeline,
    ingestion,
    embeddings,
    vectorStores,
    retrieval,
    reranking,
    generation,
    evaluation,
    production,
  ],
};
