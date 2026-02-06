/**
 * Hybrid Search Strategy
 * Combines FTS5 full-text search with LanceDB vector search using RRF
 * (Reciprocal Rank Fusion) for optimal results
 */

import { getDatabase, observations, userPrompts, memorySessions } from "../db"
import { eq, desc, sql } from "drizzle-orm"
import { searchSimilar } from "./vector-store"
import type { Observation, UserPrompt, MemorySession } from "../db/schema"

// ============ Types ============

export interface HybridSearchResult {
  type: "observation" | "prompt" | "session"
  id: string
  title: string
  subtitle: string | null
  excerpt: string | null
  sessionId: string
  projectId: string | null
  createdAtEpoch: number
  score: number
  // For scrolling to specific content after navigation
  toolCallId?: string | null
  // Debug info
  ftsScore?: number
  vectorScore?: number
}

export interface HybridSearchOptions {
  query: string
  projectId?: string
  type?: "all" | "observations" | "prompts" | "sessions"
  limit?: number
  // Weights for RRF fusion
  ftsWeight?: number
  vectorWeight?: number
}

// ============ RRF Algorithm ============

/**
 * Reciprocal Rank Fusion (RRF) algorithm
 * Combines multiple ranked lists into a single ranking
 *
 * Formula: score = sum(1 / (k + rank_i))
 * where k is a constant (typically 60) and rank_i is the rank in list i
 */
const RRF_K = 60

function calculateRrfScore(
  ftsRank: number | null,
  vectorRank: number | null,
  ftsWeight = 1.0,
  vectorWeight = 1.0,
): number {
  let score = 0

  if (ftsRank !== null) {
    score += ftsWeight * (1 / (RRF_K + ftsRank))
  }

  if (vectorRank !== null) {
    score += vectorWeight * (1 / (RRF_K + vectorRank))
  }

  return score
}

// ============ FTS5 Search ============

// Detect CJK characters (Chinese, Japanese, Korean) that FTS5 default tokenizer can't handle
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/

interface FtsResult {
  id: string
  title: string | null
  subtitle: string | null
  narrative: string | null
  sessionId: string
  projectId: string | null
  createdAtEpoch: number | null
  toolCallId: string | null
  rank: number
}

async function searchObservationsFts(
  query: string,
  projectId?: string,
  limit = 50,
): Promise<FtsResult[]> {
  const db = getDatabase()
  const trimmedQuery = query.trim()

  if (!trimmedQuery) return []

  // For short queries (1-2 chars) or CJK text, use LIKE search
  // FTS5 default tokenizer doesn't support CJK word segmentation
  const useLikeSearch = trimmedQuery.length <= 2 || CJK_REGEX.test(trimmedQuery)

  try {
    if (useLikeSearch) {
      const likePattern = `%${trimmedQuery}%`
      const results = db.all<FtsResult>(sql`
        SELECT
          id,
          title,
          subtitle,
          narrative,
          session_id as sessionId,
          project_id as projectId,
          created_at_epoch as createdAtEpoch,
          tool_call_id as toolCallId,
          0 as rank
        FROM observations
        WHERE (title LIKE ${likePattern} OR subtitle LIKE ${likePattern} OR narrative LIKE ${likePattern})
        ${projectId ? sql`AND project_id = ${projectId}` : sql``}
        ORDER BY created_at_epoch DESC
        LIMIT ${limit}
      `)

      // Assign synthetic ranks for RRF (0-based index)
      return results.map((r, i) => ({ ...r, rank: -(limit - i) }))
    }

    // Build FTS5 query with prefix matching (English/Latin text)
    const ftsQuery = trimmedQuery
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"*`)
      .join(" OR ")

    if (!ftsQuery) return []

    const results = db.all<FtsResult>(sql`
      SELECT
        o.id,
        o.title,
        o.subtitle,
        o.narrative,
        o.session_id as sessionId,
        o.project_id as projectId,
        o.created_at_epoch as createdAtEpoch,
        o.tool_call_id as toolCallId,
        bm25(observations_fts) as rank
      FROM observations_fts
      JOIN observations o ON observations_fts.rowid = o.rowid
      WHERE observations_fts MATCH ${ftsQuery}
      ${projectId ? sql`AND o.project_id = ${projectId}` : sql``}
      ORDER BY rank
      LIMIT ${limit}
    `)

    return results
  } catch (error) {
    console.error("[HybridSearch] FTS search error:", error)
    return []
  }
}

async function searchPromptsFts(
  query: string,
  limit = 20,
): Promise<
  Array<{
    id: string
    promptText: string
    sessionId: string
    createdAtEpoch: number | null
    rank: number
  }>
> {
  const db = getDatabase()
  const trimmedQuery = query.trim()

  if (!trimmedQuery) return []

  const useLikeSearch = trimmedQuery.length <= 2 || CJK_REGEX.test(trimmedQuery)

  try {
    if (useLikeSearch) {
      const likePattern = `%${trimmedQuery}%`
      const results = db.all<{
        id: string
        promptText: string
        sessionId: string
        createdAtEpoch: number | null
        rank: number
      }>(sql`
        SELECT
          id,
          prompt_text as promptText,
          session_id as sessionId,
          created_at_epoch as createdAtEpoch,
          0 as rank
        FROM user_prompts
        WHERE prompt_text LIKE ${likePattern}
        ORDER BY created_at_epoch DESC
        LIMIT ${limit}
      `)

      return results.map((r, i) => ({ ...r, rank: -(limit - i) }))
    }

    const ftsQuery = trimmedQuery
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"*`)
      .join(" OR ")

    if (!ftsQuery) return []

    return db.all(sql`
      SELECT
        p.id,
        p.prompt_text as promptText,
        p.session_id as sessionId,
        p.created_at_epoch as createdAtEpoch,
        bm25(user_prompts_fts) as rank
      FROM user_prompts_fts
      JOIN user_prompts p ON user_prompts_fts.rowid = p.rowid
      WHERE user_prompts_fts MATCH ${ftsQuery}
      ORDER BY rank
      LIMIT ${limit}
    `)
  } catch (error) {
    console.error("[HybridSearch] Prompts FTS error:", error)
    return []
  }
}

// ============ Hybrid Search ============

/**
 * Perform hybrid search combining FTS and vector search
 */
export async function hybridSearch(
  options: HybridSearchOptions,
): Promise<HybridSearchResult[]> {
  const {
    query,
    projectId,
    type = "all",
    limit = 20,
    ftsWeight = 1.0,
    vectorWeight = 1.0,
  } = options

  const results: HybridSearchResult[] = []

  // Search observations
  if (type === "all" || type === "observations") {
    const obsResults = await searchObservationsHybrid(
      query,
      projectId,
      limit,
      ftsWeight,
      vectorWeight,
    )
    results.push(...obsResults)
  }

  // Search prompts (FTS only, no vectors for prompts yet)
  if (type === "all" || type === "prompts") {
    const promptResults = await searchPromptsFts(query, Math.ceil(limit / 3))
    results.push(
      ...promptResults.map((r, idx) => ({
        type: "prompt" as const,
        id: r.id,
        title: r.promptText.slice(0, 100),
        subtitle: null,
        excerpt: r.promptText.slice(0, 200),
        sessionId: r.sessionId,
        projectId: null,
        createdAtEpoch: r.createdAtEpoch || Date.now(),
        score: calculateRrfScore(idx, null, ftsWeight, vectorWeight),
        ftsScore: -r.rank,
      })),
    )
  }

  // Sort by combined score
  results.sort((a, b) => b.score - a.score)

  return results.slice(0, limit)
}

/**
 * Hybrid search for observations: FTS + Vector + RRF
 */
async function searchObservationsHybrid(
  query: string,
  projectId?: string,
  limit = 20,
  ftsWeight = 1.0,
  vectorWeight = 1.0,
): Promise<HybridSearchResult[]> {
  // Step 1: Get FTS results
  const ftsResults = await searchObservationsFts(query, projectId, limit * 2)

  // Step 2: Get vector search results
  let vectorResults: Array<{
    id: string
    score: number
    projectId: string | null
    type: string
    createdAtEpoch: number
  }> = []

  try {
    vectorResults = await searchSimilar(query, {
      projectId,
      limit: limit * 2,
    })
  } catch (error) {
    console.error("[HybridSearch] Vector search failed, using FTS only:", error)
  }

  // Step 3: Build rank maps
  const ftsRankMap = new Map<string, number>()
  ftsResults.forEach((r, idx) => ftsRankMap.set(r.id, idx))

  const vectorRankMap = new Map<string, number>()
  vectorResults.forEach((r, idx) => vectorRankMap.set(r.id, idx))

  // Step 4: Merge and score using RRF
  const allIds = new Set([
    ...ftsResults.map((r) => r.id),
    ...vectorResults.map((r) => r.id),
  ])

  const scoredResults: Array<{
    id: string
    score: number
    ftsRank: number | null
    vectorRank: number | null
    ftsResult?: FtsResult
    vectorResult?: (typeof vectorResults)[0]
  }> = []

  for (const id of allIds) {
    const ftsRank = ftsRankMap.has(id) ? ftsRankMap.get(id)! : null
    const vectorRank = vectorRankMap.has(id) ? vectorRankMap.get(id)! : null
    const score = calculateRrfScore(ftsRank, vectorRank, ftsWeight, vectorWeight)

    scoredResults.push({
      id,
      score,
      ftsRank,
      vectorRank,
      ftsResult: ftsResults.find((r) => r.id === id),
      vectorResult: vectorResults.find((r) => r.id === id),
    })
  }

  // Step 5: Sort by RRF score
  scoredResults.sort((a, b) => b.score - a.score)

  // Step 6: Hydrate results
  const topResults = scoredResults.slice(0, limit)
  const hydratedResults: HybridSearchResult[] = []

  for (const result of topResults) {
    if (result.ftsResult) {
      hydratedResults.push({
        type: "observation",
        id: result.id,
        title: result.ftsResult.title || "Untitled",
        subtitle: result.ftsResult.subtitle,
        excerpt: result.ftsResult.narrative?.slice(0, 200) || null,
        sessionId: result.ftsResult.sessionId,
        projectId: result.ftsResult.projectId,
        createdAtEpoch: result.ftsResult.createdAtEpoch || Date.now(),
        score: result.score,
        toolCallId: result.ftsResult.toolCallId,
        ftsScore: result.ftsRank !== null ? 1 / (RRF_K + result.ftsRank) : undefined,
        vectorScore:
          result.vectorRank !== null
            ? 1 / (RRF_K + result.vectorRank)
            : undefined,
      })
    } else if (result.vectorResult) {
      // Need to hydrate from database
      const db = getDatabase()
      const obs = db
        .select()
        .from(observations)
        .where(eq(observations.id, result.id))
        .get()

      if (obs) {
        hydratedResults.push({
          type: "observation",
          id: obs.id,
          title: obs.title || "Untitled",
          subtitle: obs.subtitle,
          excerpt: obs.narrative?.slice(0, 200) || null,
          sessionId: obs.sessionId,
          projectId: obs.projectId,
          createdAtEpoch: obs.createdAtEpoch || Date.now(),
          score: result.score,
          toolCallId: obs.toolCallId,
          ftsScore: result.ftsRank !== null ? 1 / (RRF_K + result.ftsRank) : undefined,
          vectorScore:
            result.vectorRank !== null
              ? 1 / (RRF_K + result.vectorRank)
              : undefined,
        })
      }
    }
  }

  return hydratedResults
}

/**
 * Get related observations for a given observation ID
 * Uses vector similarity to find semantically similar items
 */
export async function findRelated(
  observationId: string,
  options: {
    projectId?: string
    limit?: number
  } = {},
): Promise<HybridSearchResult[]> {
  const { projectId, limit = 10 } = options
  const db = getDatabase()

  // Get the source observation
  const source = db
    .select()
    .from(observations)
    .where(eq(observations.id, observationId))
    .get()

  if (!source) return []

  // Build text for similarity search
  const text = [source.title, source.subtitle, source.narrative]
    .filter(Boolean)
    .join(" ")

  // Search for similar
  const similar = await searchSimilar(text, {
    projectId: projectId || source.projectId || undefined,
    limit: limit + 1, // +1 to exclude self
  })

  // Filter out self and hydrate
  const filtered = similar.filter((r) => r.id !== observationId).slice(0, limit)

  const results: HybridSearchResult[] = []
  for (const item of filtered) {
    const obs = db
      .select()
      .from(observations)
      .where(eq(observations.id, item.id))
      .get()

    if (obs) {
      results.push({
        type: "observation",
        id: obs.id,
        title: obs.title || "Untitled",
        subtitle: obs.subtitle,
        excerpt: obs.narrative?.slice(0, 200) || null,
        sessionId: obs.sessionId,
        projectId: obs.projectId,
        createdAtEpoch: obs.createdAtEpoch || Date.now(),
        score: item.score,
        toolCallId: obs.toolCallId,
        vectorScore: item.score,
      })
    }
  }

  return results
}
