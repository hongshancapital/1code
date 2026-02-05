/**
 * Embeddings Generator
 * Uses @xenova/transformers for local embedding generation
 * Model: Xenova/all-MiniLM-L6-v2 (384 dimensions)
 */

import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers"
import { app } from "electron"
import path from "path"

// Configure transformers.js to use local cache
env.cacheDir = path.join(app.getPath("userData"), "models")
// Disable remote model fetching during development if needed
// env.allowRemoteModels = true

// Embedding configuration
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2"
export const EMBEDDING_DIMENSION = 384

// Singleton pipeline instance
let embeddingPipeline: FeatureExtractionPipeline | null = null
let initPromise: Promise<FeatureExtractionPipeline> | null = null

/**
 * Initialize the embedding pipeline (singleton)
 * Downloads the model on first use (~22MB)
 */
export async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) {
    return embeddingPipeline
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    console.log(`[Embeddings] Initializing pipeline with model: ${EMBEDDING_MODEL}`)
    const startTime = Date.now()

    try {
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL, {
        // Use quantized model for faster inference
        quantized: true,
      })
      embeddingPipeline = pipe as FeatureExtractionPipeline

      const duration = Date.now() - startTime
      console.log(`[Embeddings] Pipeline initialized in ${duration}ms`)

      return embeddingPipeline
    } catch (error) {
      console.error("[Embeddings] Failed to initialize pipeline:", error)
      initPromise = null
      throw error
    }
  })()

  return initPromise
}

/**
 * Generate embedding for a single text
 * Returns a Float32Array of EMBEDDING_DIMENSION size
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline()

  // Truncate very long text to avoid memory issues
  const truncatedText = text.length > 8000 ? text.slice(0, 8000) : text

  const output = await pipe(truncatedText, {
    pooling: "mean",
    normalize: true,
  })

  // output.data is a Float32Array or similar typed array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Float32Array((output as any).data)
}

/**
 * Generate embeddings for multiple texts in batch
 * More efficient than calling generateEmbedding multiple times
 */
export async function generateEmbeddings(
  texts: string[],
): Promise<Float32Array[]> {
  if (texts.length === 0) return []

  const pipe = await getEmbeddingPipeline()

  // Truncate texts
  const truncatedTexts = texts.map((t) =>
    t.length > 8000 ? t.slice(0, 8000) : t,
  )

  const results: Float32Array[] = []

  // Process in batches to avoid memory issues
  const BATCH_SIZE = 32
  for (let i = 0; i < truncatedTexts.length; i += BATCH_SIZE) {
    const batch = truncatedTexts.slice(i, i + BATCH_SIZE)

    // Process batch sequentially (pipeline doesn't support true batching well)
    for (const text of batch) {
      const output = await pipe(text, {
        pooling: "mean",
        normalize: true,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      results.push(new Float32Array((output as any).data))
    }
  }

  return results
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have the same dimension")
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  // Vectors should already be normalized, but handle edge cases
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Check if the embedding model is ready
 */
export function isEmbeddingReady(): boolean {
  return embeddingPipeline !== null
}

/**
 * Preload the embedding model (call at app startup)
 */
export async function preloadEmbeddingModel(): Promise<void> {
  try {
    await getEmbeddingPipeline()
    console.log("[Embeddings] Model preloaded successfully")
  } catch (error) {
    console.error("[Embeddings] Failed to preload model:", error)
  }
}
