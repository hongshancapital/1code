/**
 * Vector Store
 * LanceDB-based vector storage for semantic search
 */

import * as lancedb from "@lancedb/lancedb"
import { app } from "electron"
import path from "path"
import fs from "fs"
import { generateEmbedding, EMBEDDING_DIMENSION, EMBEDDING_MODEL } from "./embeddings"

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

/**
 * Get the LanceDB database path
 */
function getDbPath(): string {
  return path.join(app.getPath("userData"), "data", "memory-vectors")
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
    console.log(`[VectorStore] Initializing at: ${dbPath}`)

    const modelChanged = checkModelMigration(dbPath)

    try {
      db = await lancedb.connect(dbPath)

      // Check if table exists
      const tableNames = await db.tableNames()

      if (modelChanged && tableNames.includes("observations")) {
        // Embedding model changed — old vectors are incompatible, drop table
        console.log(`[VectorStore] Embedding model changed to ${EMBEDDING_MODEL}, dropping old vectors`)
        await db.dropTable("observations")
      }

      if (!modelChanged && tableNames.includes("observations")) {
        observationsTable = await db.openTable("observations")
        console.log("[VectorStore] Opened existing observations table")
      } else {
        // Create table with initial empty data (LanceDB requires data to create table)
        console.log("[VectorStore] Creating new observations table")
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

      console.log("[VectorStore] Initialized successfully")
    } catch (error) {
      // 初始化失败时重置状态，允许下次重试
      db = null
      observationsTable = null
      initPromise = null
      console.error("[VectorStore] Initialization failed:", error)
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

    console.log(`[VectorStore] Added observation: ${id}`)
  } catch (error) {
    console.error(`[VectorStore] Failed to add observation ${id}:`, error)
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
    console.error("[VectorStore] Queue processing error:", err),
  )
}

/**
 * Process the embedding queue
 */
async function processQueue(): Promise<void> {
  if (isProcessingQueue || embeddingQueue.length === 0) return

  isProcessingQueue = true

  try {
    await initVectorStore()

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
          console.warn(
            `[VectorStore] Failed to process item ${item.id} (retry ${retries + 1}/${MAX_RETRY_COUNT}):`,
            error,
          )
          embeddingQueue.push({ ...item, retryCount: retries + 1 })
        } else {
          console.error(
            `[VectorStore] Permanently failed to process item ${item.id} after ${MAX_RETRY_COUNT} retries:`,
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
    console.error("[VectorStore] Search failed:", error)
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
    console.log(`[VectorStore] Deleted observation: ${id}`)
  } catch (error) {
    console.error(`[VectorStore] Failed to delete observation ${id}:`, error)
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
    console.log(`[VectorStore] Deleted all observations for project: ${projectId}`)
  } catch (error) {
    console.error(
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
}> {
  try {
    await initVectorStore()
    if (!observationsTable) {
      return { totalVectors: 0, isReady: false }
    }

    const count = await observationsTable.countRows()
    return { totalVectors: count, isReady: true }
  } catch (error) {
    console.error("[VectorStore] getStats error:", error)
    return { totalVectors: 0, isReady: false }
  }
}

/**
 * Rebuild vector index for a project (re-embed all observations)
 * This is useful after clearing data or if embeddings are corrupted
 */
export async function rebuildIndex(projectId: string): Promise<void> {
  // This would require re-reading from SQLite and re-embedding
  // For now, just log - full implementation in Phase 3
  console.log(`[VectorStore] Rebuild index requested for project: ${projectId}`)
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
    console.log("[VectorStore] Cleared all observations")
  } catch (error) {
    console.error("[VectorStore] Failed to clear all:", error)
  }
}
