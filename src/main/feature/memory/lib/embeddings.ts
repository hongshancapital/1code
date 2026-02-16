/**
 * Embeddings Generator
 * Uses @xenova/transformers for local embedding generation
 * Model: Xenova/multilingual-e5-small (384 dimensions, 100+ languages including Chinese)
 *
 * NOTE: E5 models require input prefixes:
 *   - "query: " for search queries
 *   - "passage: " for documents being indexed
 * Callers (vector-store.ts) are responsible for adding the correct prefix.
 */

import { pipeline, env, type FeatureExtractionPipeline } from "@xenova/transformers"
import { app } from "electron"
import path from "path"
import fs from "fs"
import { createLogger } from "../../../lib/logger"

const embeddingsLog = createLogger("Embeddings")


// Configure transformers.js to use local cache
env.cacheDir = path.join(app.getPath("userData"), "models")
// Disable remote model fetching during development if needed
// env.allowRemoteModels = true

// Embedding configuration
export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small"
export const EMBEDDING_DIMENSION = 384

// The key file that indicates the model is fully downloaded
const MODEL_KEY_FILE = "onnx/model_quantized.onnx"

// Singleton pipeline instance
let embeddingPipeline: FeatureExtractionPipeline | null = null
let initPromise: Promise<FeatureExtractionPipeline> | null = null

// 模型下载/加载超时：5 分钟（首次下载 ~135MB 需要更多时间）
const PIPELINE_INIT_TIMEOUT_MS = 300_000

// ============ Model status tracking ============

export type EmbeddingModelStatus =
  | "not_downloaded"
  | "downloading"
  | "ready"
  | "error"

interface ModelStatusInfo {
  status: EmbeddingModelStatus
  progress?: number    // 0-100, only set during downloading
  error?: string
  modelName: string
}

let currentStatus: EmbeddingModelStatus = "not_downloaded"
let downloadProgress = 0
let lastError: string | null = null

/**
 * Get the model cache directory path
 */
function getModelDir(): string {
  return path.join(env.cacheDir, ...EMBEDDING_MODEL.split("/"))
}

/**
 * Check if the embedding model files exist locally
 */
export function isModelDownloaded(): boolean {
  const modelDir = getModelDir()
  const keyFile = path.join(modelDir, MODEL_KEY_FILE)
  return fs.existsSync(keyFile)
}

/**
 * Clear model cache: delete downloaded model files and reset module state.
 * Used for debugging / re-testing the download flow.
 */
export function clearModelCache(): void {
  const modelDir = getModelDir()
  embeddingsLog.info(`Clearing model cache at: ${modelDir}`)

  // Reset module state
  embeddingPipeline = null
  initPromise = null
  currentStatus = "not_downloaded"
  downloadProgress = 0
  lastError = null

  // Delete model directory
  if (fs.existsSync(modelDir)) {
    fs.rmSync(modelDir, { recursive: true, force: true })
    embeddingsLog.info("Model cache cleared")
  }
}

/**
 * Get current embedding model status
 */
export function getModelStatus(): ModelStatusInfo {
  // If pipeline is ready, always report ready
  if (embeddingPipeline) {
    return { status: "ready", modelName: EMBEDDING_MODEL }
  }

  // If actively downloading / initializing
  if (currentStatus === "downloading") {
    return { status: "downloading", progress: downloadProgress, modelName: EMBEDDING_MODEL }
  }

  // Model files exist but pipeline not loaded yet — report as ready (will load on demand)
  if (isModelDownloaded()) {
    if (currentStatus === "error") {
      return { status: "error", error: lastError ?? undefined, modelName: EMBEDDING_MODEL }
    }
    return { status: "ready", modelName: EMBEDDING_MODEL }
  }

  // Not downloaded
  if (lastError) {
    return { status: "error", error: lastError, modelName: EMBEDDING_MODEL }
  }
  return { status: "not_downloaded", modelName: EMBEDDING_MODEL }
}

/**
 * Progress callback for transformers.js pipeline initialization.
 * Tracks overall download progress across multiple files.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onPipelineProgress(event: any): void {
  if (event.status === "download") {
    currentStatus = "downloading"
    embeddingsLog.info(`Downloading: ${event.file}`)
  } else if (event.status === "progress") {
    currentStatus = "downloading"
    // event.progress is per-file 0-100, use it directly
    // (model_quantized.onnx dominates total size, so per-file is close enough)
    downloadProgress = Math.round(event.progress ?? 0)
  } else if (event.status === "done") {
    embeddingsLog.info(`Downloaded: ${event.file}`)
  }
}

/**
 * Initialize the embedding pipeline (singleton)
 * Downloads the model on first use (~135MB)
 */
export async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (embeddingPipeline) {
    return embeddingPipeline
  }

  if (initPromise) {
    return initPromise
  }

  initPromise = (async () => {
    embeddingsLog.info(`Initializing pipeline with model: ${EMBEDDING_MODEL}`)
    const startTime = Date.now()
    currentStatus = isModelDownloaded() ? "ready" : "downloading"
    downloadProgress = 0
    lastError = null

    try {
      const pipelinePromise = pipeline("feature-extraction", EMBEDDING_MODEL, {
        quantized: true,
        progress_callback: onPipelineProgress,
      })

      let timeoutTimer: ReturnType<typeof setTimeout> | null = null
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          reject(new Error(`Pipeline init timed out after ${PIPELINE_INIT_TIMEOUT_MS / 1000}s`))
        }, PIPELINE_INIT_TIMEOUT_MS)
        if (timeoutTimer.unref) timeoutTimer.unref()
      })

      const pipe = await Promise.race([pipelinePromise, timeoutPromise])
      if (timeoutTimer) clearTimeout(timeoutTimer)
      embeddingPipeline = pipe as FeatureExtractionPipeline
      currentStatus = "ready"
      downloadProgress = 100
      lastError = null

      const duration = Date.now() - startTime
      embeddingsLog.info(`Pipeline initialized in ${duration}ms`)

      return embeddingPipeline
    } catch (error) {
      embeddingsLog.error("Failed to initialize pipeline:", error)
      currentStatus = "error"
      lastError = error instanceof Error ? error.message : String(error)
      initPromise = null
      throw error
    }
  })()

  return initPromise
}

/**
 * Explicitly trigger model download.
 * Returns immediately if model is already downloaded or downloading.
 * The caller can poll getModelStatus() for progress.
 */
export async function ensureModelDownloaded(): Promise<void> {
  if (embeddingPipeline) return
  if (initPromise) {
    await initPromise
    return
  }

  // 立即标记为 downloading，让前端 poll 时能看到状态变化
  if (!isModelDownloaded()) {
    currentStatus = "downloading"
    downloadProgress = 0
  }

  // Start pipeline initialization (which triggers download if needed)
  await getEmbeddingPipeline()
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
    embeddingsLog.info("Model preloaded successfully")
  } catch (error) {
    embeddingsLog.error("Failed to preload model:", error)
  }
}
