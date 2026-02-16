/**
 * Vector Store
 * LanceDB-based vector storage for semantic search
 */

import * as lancedb from "@lancedb/lancedb"
import { app } from "electron"
import path from "path"
import fs from "fs"
import { generateEmbedding, getEmbeddingPipeline, EMBEDDING_DIMENSION, EMBEDDING_MODEL } from "./embeddings"
import { createLogger } from "../../../lib/logger"

const vectorStoreLog = createLogger("VectorStore")


// LanceDB connection and table
let db: lancedb.Connection | null = null
let observationsTable: lancedb.Table | null = null
let initPromise: Promise<void> | null = null

// Queue for async embedding generation
interface EmbeddingQueueItem {
  id: string
  text: string
  projectId: string | null
  type: string
  createdAtEpoch: number
  retryCount?: number
}

const MAX_RETRY_COUNT = 2

const embeddingQueue: EmbeddingQueueItem[] = []
let isProcessingQueue = false
let queueRetryTimer: ReturnType<typeof setTimeout> | null = null
const QUEUE_RETRY_DELAY_MS = 15_000

/**
 * Schedule a delayed retry for processQueue when infrastructure is not ready.
 */
function scheduleQueueRetry(): void {
  if (queueRetryTimer || embeddingQueue.length === 0) return
  vectorStoreLog.info(`Scheduling queue retry in ${QUEUE_RETRY_DELAY_MS / 1000}s`)
  queueRetryTimer = setTimeout(() => {
    queueRetryTimer = null
    processQueue().catch(() => {})
  }, QUEUE_RETRY_DELAY_MS)
  if (queueRetryTimer.unref) queueRetryTimer.unref()
}

/**
 * Get the LanceDB database path
 */
function getDbPath(): string {
  return path.join(app.getPath("userData"), "data", "memory-vectors")
}

/**
 * Check if vector store is ready (already initialized)
 * Returns true if db and table are ready, false otherwise
 */
export function isVectorStoreReady(): boolean {
  return db !== null && observationsTable !== null
}

/**
 * Initialize LanceDB connection and tables
 */
/**
 * Check if the embedding model has changed since last initialization.
 * If changed, drop the existing table so vectors are re-indexed with the new model.
 */
function checkModelMigration(dbPath: string): boolean {
  const metaPath = path.join(dbPath, ".embedding-model")

  try {
    if (fs.existsSync(metaPath)) {
      const stored = fs.readFileSync(metaPath, "utf-8").trim()
      if (stored === EMBEDDING_MODEL) return false // no change
    }
  } catch {
    // file doesn't exist or unreadable — treat as needing migration
  }

  // Write current model name
  fs.mkdirSync(dbPath, { recursive: true })
  fs.writeFileSync(metaPath, EMBEDDING_MODEL, "utf-8")
  return true
}

export async function initVectorStore(): Promise<void> {
  if (db) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    if (db) return // 双重检查，防止 Promise 等待期间另一个调用已完成

    const dbPath = getDbPath()
    vectorStoreLog.info(`Initializing at: ${dbPath}`)

    const modelChanged = checkModelMigration(dbPath)

    try {
      db = await lancedb.connect(dbPath)

      // Check if table exists
      const tableNames = await db.tableNames()

      if (modelChanged && tableNames.includes("observations")) {
        // Embedding model changed — old vectors are incompatible, drop table
        vectorStoreLog.info(`Embedding model changed to ${EMBEDDING_MODEL}, dropping old vectors`)
        await db.dropTable("observations")
      }

      if (!modelChanged && tableNames.includes("observations")) {
        observationsTable = await db.openTable("observations")
        vectorStoreLog.info("Opened existing observations table")
      } else {
        // Create table with initial empty data (LanceDB requires data to create table)
        vectorStoreLog.info("Creating new observations table")
        observationsTable = await db.createTable("observations", [
          {
            id: "__placeholder__",
            vector: Array.from({ length: EMBEDDING_DIMENSION }, () => 0),
            projectId: "", // Use empty string, not null (LanceDB can't infer null type)
            type: "placeholder",
            createdAtEpoch: 0,
          },
        ])
        // Delete the placeholder
        await observationsTable.delete('id = "__placeholder__"')
      }

      vectorStoreLog.info("Initialized successfully")

      // 初始化成功后，排空积压的 embedding 队列
      if (embeddingQueue.length > 0) {
        vectorStoreLog.info(`Recovery succeeded, draining ${embeddingQueue.length} queued items`)
        processQueue().catch(() => {})
      }
    } catch (error) {
      // 初始化失败时直接 throw，由 InitManager 统一管理重试
      vectorStoreLog.error("Initialization failed:", error)
      initPromise = null // 允许 InitManager 重新触发初始化
      throw error
    }
  })()

  return initPromise
}

/**
 * Add an observation to the vector store
 */
export async function addObservation(
  id: string,
  text: string,
  projectId: string | null,
  type: string,
  createdAtEpoch: number,
): Promise<void> {
  await initVectorStore()
  if (!observationsTable) throw new Error("Vector store not initialized")

  try {
    // E5 models require "passage: " prefix for documents being indexed
    const embedding = await generateEmbedding(`passage: ${text}`)

    await observationsTable.add([
      {
        id,
        vector: Array.from(embedding),
        projectId: projectId || "", // Use empty string instead of null
        type,
        createdAtEpoch,
      },
    ])

    vectorStoreLog.info(`Added observation: ${id}`)
  } catch (error) {
    vectorStoreLog.error(`Failed to add observation ${id}:`, error)
    throw error
  }
}

/**
 * Queue an observation for async embedding generation
 * Use this for fire-and-forget embedding in hooks
 */
export function queueForEmbedding(
  id: string,
  text: string,
  projectId: string | null,
  type: string,
  createdAtEpoch: number,
): void {
  embeddingQueue.push({ id, text, projectId, type, createdAtEpoch })
  processQueue().catch((err) =>
    vectorStoreLog.error("Queue processing error:", err),
  )
}

/**
 * Process the embedding queue.
 * 两阶段：先确保基础设施就绪（vector store + embedding model），再逐条处理。
 * 基础设施未就绪时保留队列等恢复，不消耗 item 重试次数。
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue || embeddingQueue.length === 0) return

  isProcessingQueue = true

  // 检查 InitManager 状态
  const { MemoryInitManager } = await import("./init-manager")
  const initStatus = MemoryInitManager.getInstance().getStatus()

  // 如果 InitManager 失败且不再重试，记录 error 并清空队列
  if (initStatus.state === "failed" && initStatus.nextRetryAt === 0) {
    vectorStoreLog.error(
      `Memory system initialization failed permanently, dropping ${embeddingQueue.length} queued items`,
    )
    embeddingQueue.length = 0 // 清空队列
    isProcessingQueue = false
    return
  }

  // 如果正在初始化或等待重试，安排短延迟重试（不消耗重试次数）
  if (
    initStatus.state === "initializing" ||
    initStatus.state === "retrying" ||
    (initStatus.state === "failed" && initStatus.nextRetryAt > 0)
  ) {
    isProcessingQueue = false
    vectorStoreLog.info(
      `Infrastructure not ready (${embeddingQueue.length} items queued), will retry when init completes`,
    )
    scheduleQueueRetry()
    return
  }

  // Phase 1: 确保 vector store 和 embedding pipeline 都就绪
  try {
    await initVectorStore()
    await getEmbeddingPipeline()
  } catch (error) {
    isProcessingQueue = false
    vectorStoreLog.warn(
      `Infrastructure not ready (${embeddingQueue.length} items queued):`,
      error instanceof Error ? error.message : error,
    )
    // 安排延迟重试，等基础设施恢复后排空队列
    scheduleQueueRetry()
    return
  }

  // 队列积压超过 100 条时，记录 warn 日志
  if (embeddingQueue.length > 100) {
    vectorStoreLog.warn(`Large queue backlog: ${embeddingQueue.length} items pending`)
  }

  // Phase 2: 基础设施就绪，处理队列（isProcessingQueue 保持 true，无竞态窗口）
  try {
    while (embeddingQueue.length > 0) {
      const item = embeddingQueue.shift()
      if (!item) continue

      try {
        await addObservation(
          item.id,
          item.text,
          item.projectId,
          item.type,
          item.createdAtEpoch,
        )
      } catch (error) {
        const retries = item.retryCount ?? 0
        if (retries < MAX_RETRY_COUNT) {
          vectorStoreLog.warn(
            `Failed to process item ${item.id} (retry ${retries + 1}/${MAX_RETRY_COUNT}):`,
            error,
          )
          embeddingQueue.push({ ...item, retryCount: retries + 1 })
        } else {
          vectorStoreLog.error(
            `Permanently failed to process item ${item.id} after ${MAX_RETRY_COUNT} retries:`,
            error,
          )
        }
      }
    }
  } finally {
    isProcessingQueue = false
  }
}

/**
 * Search for similar observations using vector similarity
 */
export async function searchSimilar(
  query: string,
  options: {
    projectId?: string
    limit?: number
    type?: string
  } = {},
): Promise<
  Array<{
    id: string
    score: number
    projectId: string | null
    type: string
    createdAtEpoch: number
  }>
> {
  await initVectorStore()
  if (!observationsTable) throw new Error("Vector store not initialized")

  const { projectId, limit = 20, type } = options

  try {
    // E5 models require "query: " prefix for search queries
    const queryEmbedding = await generateEmbedding(`query: ${query}`)

    // Build the search query
    const searchQuery = observationsTable
      .vectorSearch(Array.from(queryEmbedding))
      .limit(limit * 2) // Get more results for filtering

    // Execute search
    const results = await searchQuery.toArray()

    // Filter and map results
    const filtered = results
      .filter((r) => {
        // Empty string is stored as null equivalent
        const rProjectId = r.projectId === "" ? null : r.projectId
        if (projectId && rProjectId !== projectId) return false
        if (type && r.type !== type) return false
        return true
      })
      .slice(0, limit)
      .map((r) => ({
        id: r.id as string,
        score: r._distance !== undefined ? 1 - r._distance : 0, // Convert distance to similarity
        projectId: (r.projectId === "" ? null : r.projectId) as string | null,
        type: r.type as string,
        createdAtEpoch: r.createdAtEpoch as number,
      }))

    return filtered
  } catch (error) {
    vectorStoreLog.error("Search failed:", error)
    return []
  }
}

/**
 * Delete an observation from the vector store
 */
export async function deleteObservation(id: string): Promise<void> {
  await initVectorStore()
  if (!observationsTable) return

  try {
    await observationsTable.delete(`id = "${id}"`)
    vectorStoreLog.info(`Deleted observation: ${id}`)
  } catch (error) {
    vectorStoreLog.error(`Failed to delete observation ${id}:`, error)
  }
}

/**
 * Delete all observations for a project
 */
export async function deleteProjectObservations(
  projectId: string,
): Promise<void> {
  await initVectorStore()
  if (!observationsTable) return

  try {
    await observationsTable.delete(`projectId = "${projectId}"`)
    vectorStoreLog.info(`Deleted all observations for project: ${projectId}`)
  } catch (error) {
    vectorStoreLog.error(
      `[VectorStore] Failed to delete project observations:`,
      error,
    )
  }
}

/**
 * Get statistics about the vector store
 */
export async function getStats(): Promise<{
  totalVectors: number
  isReady: boolean
  status: "ready" | "initializing" | "failed"
  error?: string
}> {
  try {
    await initVectorStore()
    if (!observationsTable) {
      return { totalVectors: 0, isReady: false, status: "failed", error: "Table not created" }
    }

    const count = await observationsTable.countRows()
    lastInitError = null
    return { totalVectors: count, isReady: true, status: "ready" }
  } catch (error) {
    vectorStoreLog.error("getStats error:", error)
    const errorMsg = lastInitError || (error instanceof Error ? error.message : String(error))
    return { totalVectors: 0, isReady: false, status: "failed", error: errorMsg }
  }
}

/**
 * Rebuild vector index for a project (re-embed all observations)
 * This is useful after clearing data or if embeddings are corrupted
 */
export async function rebuildIndex(projectId: string): Promise<void> {
  // This would require re-reading from SQLite and re-embedding
  // For now, just log - full implementation in Phase 3
  vectorStoreLog.info(`Rebuild index requested for project: ${projectId}`)
}

/**
 * Reset module state and immediately retry initialization.
 * Does NOT delete the database — data may be temporarily locked, not corrupted.
 */
export async function resetVectorStore(): Promise<void> {
  vectorStoreLog.info("Resetting vector store state and retrying initialization")

  // Cancel pending timers
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  if (queueRetryTimer) {
    clearTimeout(queueRetryTimer)
    queueRetryTimer = null
  }

  // Clear module state
  db = null
  observationsTable = null
  initPromise = null
  lastInitError = null
  consecutiveFailures = 0

  // Immediately retry
  await initVectorStore()
}

/**
 * Clear all vectors from the store
 */
export async function clearAll(): Promise<void> {
  await initVectorStore()
  if (!observationsTable) return

  try {
    // Delete all rows
    await observationsTable.delete("id IS NOT NULL")
    vectorStoreLog.info("Cleared all observations")
  } catch (error) {
    vectorStoreLog.error("Failed to clear all:", error)
  }
}
