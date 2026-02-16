/**
 * Memory Module
 * Main entry point for the Memory engine
 */

export { memoryHooks } from "./hooks"
export {
  parseToolToObservation,
  isMetaObservation,
  buildObservationText,
} from "./observation-parser"
export * from "./types"

// Summarizer (LLM-enhanced observations)
export {
  setSummaryModelConfig,
  isSummaryModelConfigured,
  enhanceObservation,
  generateSessionSummary,
  type SessionSummary,
  type MemoryLLMUsage,
  type EnhanceResult,
  type SessionSummaryResult,
} from "./summarizer"

// Vector store
export {
  initVectorStore,
  addObservation,
  searchSimilar,
  deleteObservation,
  deleteProjectObservations,
  queueForEmbedding,
  getStats as getVectorStats,
} from "./vector-store"

// Embeddings
export {
  generateEmbedding,
  generateEmbeddings,
  preloadEmbeddingModel,
  isEmbeddingReady,
  isModelDownloaded,
  getModelStatus,
  ensureModelDownloaded,
  clearModelCache,
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSION,
  type EmbeddingModelStatus,
} from "./embeddings"

// Hybrid search
export { hybridSearch, findRelated, type HybridSearchResult } from "./hybrid-search"
