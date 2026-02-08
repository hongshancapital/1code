/**
 * Memory Router
 * API endpoints for memory search and management
 * Borrowed from claude-mem architecture
 */

import { z } from "zod"
import { router, publicProcedure } from "../index"
import {
  chats,
  getDatabase,
  memorySessions,
  observations,
  subChats,
  userPrompts,
} from "../../db"
import { eq, desc, and, like, sql, count } from "drizzle-orm"
import type { Observation, MemorySession, UserPrompt } from "../../db/schema"
import { hybridSearch, findRelated, type HybridSearchResult } from "../../memory/hybrid-search"
import { getStats as getVectorStats, deleteProjectObservations, queueForEmbedding } from "../../memory/vector-store"
import { parseToolToObservation, buildObservationText } from "../../memory/observation-parser"

// ============ Types ============

// This type matches HybridSearchResult to ensure compatibility
export interface SearchResult {
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
  // Debug info (optional, populated by hybrid search)
  ftsScore?: number
  vectorScore?: number
}

// ============ FTS Search Helpers ============

/**
 * Full-text search on observations using FTS5
 * Falls back to LIKE search for short queries or when FTS fails
 */
async function searchObservationsFts(
  query: string,
  projectId?: string,
  limit = 20,
): Promise<SearchResult[]> {
  const db = getDatabase()
  const trimmedQuery = query.trim()

  if (!trimmedQuery) return []

  // For short queries (1-2 chars) or Chinese, use LIKE search instead of FTS
  const useSimpleSearch = trimmedQuery.length <= 2 || /[\u4e00-\u9fff]/.test(trimmedQuery)

  try {
    if (useSimpleSearch) {
      // Simple LIKE search for better single-char and Chinese support
      const likePattern = `%${trimmedQuery}%`
      const results = db.all<{
        id: string
        title: string | null
        subtitle: string | null
        narrative: string | null
        sessionId: string
        projectId: string | null
        createdAtEpoch: number | null
        toolCallId: string | null
      }>(sql`
        SELECT
          id,
          title,
          subtitle,
          narrative,
          session_id as sessionId,
          project_id as projectId,
          created_at_epoch as createdAtEpoch,
          tool_call_id as toolCallId
        FROM observations
        WHERE (title LIKE ${likePattern} OR subtitle LIKE ${likePattern} OR narrative LIKE ${likePattern})
        ${projectId ? sql`AND project_id = ${projectId}` : sql``}
        ORDER BY created_at_epoch DESC
        LIMIT ${limit}
      `)

      return results.map((r, i) => ({
        type: "observation" as const,
        id: r.id,
        title: r.title || "Untitled",
        subtitle: r.subtitle,
        excerpt: r.narrative?.slice(0, 200) || null,
        sessionId: r.sessionId,
        projectId: r.projectId,
        createdAtEpoch: r.createdAtEpoch || Date.now(),
        score: 100 - i, // Simple ranking by recency
        toolCallId: r.toolCallId,
      }))
    }

    // Build FTS5 query for longer queries
    const ftsQuery = trimmedQuery
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term}"*`)
      .join(" OR ")

    if (!ftsQuery) return []

    // Use raw SQL for FTS5 query
    const results = db.all<{
      id: string
      title: string | null
      subtitle: string | null
      narrative: string | null
      sessionId: string
      projectId: string | null
      createdAtEpoch: number | null
      toolCallId: string | null
      rank: number
    }>(sql`
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

    return results.map((r) => ({
      type: "observation" as const,
      id: r.id,
      title: r.title || "Untitled",
      subtitle: r.subtitle,
      excerpt: r.narrative?.slice(0, 200) || null,
      sessionId: r.sessionId,
      projectId: r.projectId,
      createdAtEpoch: r.createdAtEpoch || Date.now(),
      score: -r.rank, // BM25 returns negative scores, lower is better
      toolCallId: r.toolCallId,
    }))
  } catch (error) {
    console.error("[Memory] FTS search error:", error)
    return []
  }
}

/**
 * Full-text search on user prompts using FTS5
 */
async function searchPromptsFts(
  query: string,
  limit = 10,
): Promise<SearchResult[]> {
  const db = getDatabase()

  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" OR ")

  if (!ftsQuery) return []

  try {
    const results = db.all<{
      id: string
      promptText: string
      sessionId: string
      createdAtEpoch: number | null
      rank: number
    }>(sql`
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

    return results.map((r) => ({
      type: "prompt" as const,
      id: r.id,
      title: r.promptText.slice(0, 100),
      subtitle: null,
      excerpt: r.promptText.slice(0, 200),
      sessionId: r.sessionId,
      projectId: null,
      createdAtEpoch: r.createdAtEpoch || Date.now(),
      score: -r.rank,
    }))
  } catch (error) {
    console.error("[Memory] Prompt FTS search error:", error)
    return []
  }
}

// ============ Router ============

export const memoryRouter = router({
  /**
   * Search memories using hybrid search (FTS + Vector + RRF)
   */
  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1),
        projectId: z.string().optional(),
        type: z
          .enum(["all", "observations", "prompts", "sessions"])
          .default("all"),
        limit: z.number().default(20),
        // Search mode: hybrid (default) or fts (fallback)
        mode: z.enum(["hybrid", "fts"]).default("hybrid"),
      }),
    )
    .query(async ({ input }) => {
      // Use hybrid search by default
      if (input.mode === "hybrid") {
        try {
          return await hybridSearch({
            query: input.query,
            projectId: input.projectId,
            type: input.type,
            limit: input.limit,
          })
        } catch (error) {
          console.error("[Memory] Hybrid search failed, falling back to FTS:", error)
          // Fall through to FTS
        }
      }

      // FTS fallback
      const results: SearchResult[] = []

      if (input.type === "all" || input.type === "observations") {
        const obsResults = await searchObservationsFts(
          input.query,
          input.projectId,
          input.limit,
        )
        results.push(...obsResults)
      }

      if (input.type === "all" || input.type === "prompts") {
        const promptResults = await searchPromptsFts(
          input.query,
          Math.ceil(input.limit / 3),
        )
        results.push(...promptResults)
      }

      // Sort by score (higher is better after negation)
      return results.sort((a, b) => b.score - a.score)
    }),

  /**
   * Find related observations using vector similarity
   */
  findRelated: publicProcedure
    .input(
      z.object({
        observationId: z.string(),
        projectId: z.string().optional(),
        limit: z.number().default(10),
      }),
    )
    .query(async ({ input }) => {
      return findRelated(input.observationId, {
        projectId: input.projectId,
        limit: input.limit,
      })
    }),

  /**
   * Get observations for a specific session
   */
  getSessionObservations: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db
        .select()
        .from(observations)
        .where(eq(observations.sessionId, input.sessionId))
        .orderBy(desc(observations.createdAtEpoch))
        .all()
    }),

  /**
   * Get recent memories (timeline view)
   */
  getRecentMemories: publicProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        limit: z.number().default(50),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()

      // Get observations - if no projectId, get all
      const obs = input.projectId
        ? db
            .select()
            .from(observations)
            .where(eq(observations.projectId, input.projectId))
            .orderBy(desc(observations.createdAtEpoch))
            .limit(input.limit)
            .all()
        : db
            .select()
            .from(observations)
            .orderBy(desc(observations.createdAtEpoch))
            .limit(input.limit)
            .all()

      console.log(`[Memory] getRecentMemories: projectId=${input.projectId} found ${obs.length} observations`)

      // Get sessions with observation counts
      const sessionsWithCounts = db.all<{
        id: string
        projectId: string | null
        chatId: string | null
        subChatId: string | null
        status: string
        startedAtEpoch: number | null
        completedAtEpoch: number | null
        summaryRequest: string | null
        summaryLearned: string | null
        summaryCompleted: string | null
        observationCount: number
        promptCount: number
      }>(sql`
        SELECT
          ms.id,
          ms.project_id as projectId,
          ms.chat_id as chatId,
          ms.sub_chat_id as subChatId,
          ms.status,
          ms.started_at_epoch as startedAtEpoch,
          ms.completed_at_epoch as completedAtEpoch,
          ms.summary_request as summaryRequest,
          ms.summary_learned as summaryLearned,
          ms.summary_completed as summaryCompleted,
          (SELECT COUNT(*) FROM observations WHERE session_id = ms.id) as observationCount,
          (SELECT COUNT(*) FROM user_prompts WHERE session_id = ms.id) as promptCount
        FROM memory_sessions ms
        ${input.projectId ? sql`WHERE ms.project_id = ${input.projectId}` : sql``}
        ORDER BY ms.started_at_epoch DESC
        LIMIT ${Math.ceil(input.limit / 5)}
      `)

      return { observations: obs, sessions: sessionsWithCounts }
    }),

  /**
   * Get memory statistics
   */
  getStats: publicProcedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(async ({ input }) => {
      const db = getDatabase()

      // Count observations - if no projectId, count all
      let obsCount: { count: number } | undefined
      if (input.projectId) {
        obsCount = db
          .select({ count: count() })
          .from(observations)
          .where(eq(observations.projectId, input.projectId))
          .get()
      } else {
        obsCount = db
          .select({ count: count() })
          .from(observations)
          .get()
      }

      // Count sessions
      let sessionCount: { count: number } | undefined
      if (input.projectId) {
        sessionCount = db
          .select({ count: count() })
          .from(memorySessions)
          .where(eq(memorySessions.projectId, input.projectId))
          .get()
      } else {
        sessionCount = db
          .select({ count: count() })
          .from(memorySessions)
          .get()
      }

      const promptCount = db.select({ count: count() }).from(userPrompts).get()

      // Get vector store stats
      let vectorStats = { totalVectors: 0, isReady: false }
      try {
        vectorStats = await getVectorStats()
      } catch {
        // Vector store not initialized yet
      }

      return {
        observations: obsCount?.count || 0,
        sessions: sessionCount?.count || 0,
        prompts: promptCount?.count || 0,
        vectors: vectorStats.totalVectors,
        vectorStoreReady: vectorStats.isReady,
      }
    }),

  /**
   * Get a single observation by ID
   */
  getObservation: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db
        .select()
        .from(observations)
        .where(eq(observations.id, input.id))
        .get()
    }),

  /**
   * Delete a single observation
   */
  deleteObservation: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      db.delete(observations).where(eq(observations.id, input.id)).run()
      // Also delete from vector store
      const { deleteObservation: deleteVector } = await import("../../memory/vector-store")
      await deleteVector(input.id).catch(console.error)
      return { success: true }
    }),

  /**
   * Clear all memory for a project
   */
  clearProjectMemory: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      // Delete sessions (will cascade to observations and prompts via FK)
      db.delete(memorySessions)
        .where(eq(memorySessions.projectId, input.projectId))
        .run()
      // Clear vector store for project
      await deleteProjectObservations(input.projectId).catch(console.error)
      return { success: true }
    }),

  /**
   * Clear ALL memory (all projects)
   */
  clearAllMemory: publicProcedure.mutation(async () => {
    const db = getDatabase()
    // Delete all data
    db.delete(observations).run()
    db.delete(userPrompts).run()
    db.delete(memorySessions).run()
    // Clear entire vector store
    const { clearAll } = await import("../../memory/vector-store")
    await clearAll().catch(console.error)
    return { success: true }
  }),

  /**
   * Get session by ID
   */
  getSession: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db
        .select()
        .from(memorySessions)
        .where(eq(memorySessions.id, input.id))
        .get()
    }),

  /**
   * Get sessions for a project
   */
  getProjectSessions: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        limit: z.number().default(20),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()
      return db
        .select()
        .from(memorySessions)
        .where(eq(memorySessions.projectId, input.projectId))
        .orderBy(desc(memorySessions.startedAtEpoch))
        .limit(input.limit)
        .all()
    }),

  /**
   * Generate context markdown for injection
   * Phase 3: Full context builder implementation
   */
  generateContext: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: z.string().optional(),
        limit: z.number().default(20),
      }),
    )
    .query(async ({ input }) => {
      const db = getDatabase()

      // Get recent sessions with summaries (always stable context)
      const sessions = db
        .select()
        .from(memorySessions)
        .where(eq(memorySessions.projectId, input.projectId))
        .orderBy(desc(memorySessions.startedAtEpoch))
        .limit(5)
        .all()

      // Get observations: prefer semantic search if query provided
      let obs: Observation[] = []
      if (input.query) {
        try {
          const results = await hybridSearch({
            projectId: input.projectId,
            query: input.query,
            limit: input.limit,
          })
          obs = results
            .filter((r) => r.score > 0.005 && r.type !== "response")
            .map((r) => r as unknown as Observation)
        } catch {
          // Fallback to recent observations on search failure
        }
      }

      // Fallback: recent observations excluding noisy response type
      if (obs.length === 0) {
        obs = db
          .select()
          .from(observations)
          .where(
            and(
              eq(observations.projectId, input.projectId),
              sql`${observations.type} != 'response'`,
            ),
          )
          .orderBy(desc(observations.createdAtEpoch))
          .limit(input.limit)
          .all()
      }

      // Build context markdown
      const lines: string[] = []

      if (sessions.length > 0) {
        lines.push("## Recent Sessions\n")
        for (const session of sessions) {
          if (session.summaryRequest) {
            lines.push(`- **${session.summaryRequest}**`)
            if (session.summaryLearned) {
              lines.push(`  - Learned: ${session.summaryLearned}`)
            }
            if (session.summaryCompleted) {
              lines.push(`  - Completed: ${session.summaryCompleted}`)
            }
          }
        }
        lines.push("")
      }

      if (obs.length > 0) {
        lines.push("## Recent Observations\n")
        for (const o of obs) {
          lines.push(`- [${o.type}] ${o.title}`)
          if (o.narrative) {
            lines.push(`  > ${o.narrative.slice(0, 200)}`)
          }
        }
      }

      return lines.join("\n")
    }),

  /**
   * Sync all historical SubChat data to memory database
   * Used to initialize memory for existing chats
   * Includes deduplication check
   */
  syncAllHistoricalData: publicProcedure.mutation(async () => {
    const db = getDatabase()

    // Get all SubChats with messages
    const allSubChats = db
      .select({
        id: subChats.id,
        chatId: subChats.chatId,
        messages: subChats.messages,
        createdAt: subChats.createdAt,
        updatedAt: subChats.updatedAt,
      })
      .from(subChats)
      .all()

    let synced = 0
    let skipped = 0
    let failed = 0

    for (const subChat of allSubChats) {
      // Deduplication check: skip if already synced
      const existing = db
        .select({ id: memorySessions.id })
        .from(memorySessions)
        .where(eq(memorySessions.subChatId, subChat.id))
        .get()

      if (existing) {
        skipped++
        continue
      }

      try {
        // Get parent chat info
        const chat = db
          .select({ projectId: chats.projectId })
          .from(chats)
          .where(eq(chats.id, subChat.chatId))
          .get()

        // Parse messages JSON
        const messages = JSON.parse(subChat.messages || "[]") as Array<{
          id?: string
          role: string
          parts?: Array<{
            type: string
            text?: string
            name?: string
            input?: Record<string, unknown>
            id?: string
          }>
        }>

        // Create memory session
        const createdAtDate = subChat.createdAt ? new Date(subChat.createdAt) : new Date()
        const updatedAtDate = subChat.updatedAt ? new Date(subChat.updatedAt) : new Date()

        const session = db
          .insert(memorySessions)
          .values({
            subChatId: subChat.id,
            chatId: subChat.chatId,
            projectId: chat?.projectId,
            status: "completed",
            startedAt: createdAtDate,
            startedAtEpoch: createdAtDate.getTime(),
            completedAt: updatedAtDate,
            completedAtEpoch: updatedAtDate.getTime(),
          })
          .returning()
          .get()

        if (!session) {
          console.error(`[Memory] Failed to create session for SubChat ${subChat.id}`)
          failed++
          continue
        }

        let promptNumber = 0

        for (const msg of messages) {
          // Extract user prompts
          if (msg.role === "user" && msg.parts) {
            const textPart = msg.parts.find((p) => p.type === "text")
            if (textPart?.text) {
              promptNumber++
              db.insert(userPrompts)
                .values({
                  sessionId: session.id,
                  promptText: textPart.text,
                  promptNumber,
                  createdAtEpoch: Date.now(),
                })
                .run()
            }
          }

          // Extract tool calls from assistant messages
          if (msg.role === "assistant" && msg.parts) {
            for (const part of msg.parts) {
              if (part.type === "tool_use" && part.name && part.input) {
                const parsed = parseToolToObservation(
                  part.name,
                  part.input,
                  null, // output not in message structure
                  part.id,
                )

                if (parsed) {
                  const obs = db
                    .insert(observations)
                    .values({
                      sessionId: session.id,
                      projectId: chat?.projectId,
                      type: parsed.type,
                      title: parsed.title,
                      subtitle: parsed.subtitle,
                      narrative: parsed.narrative,
                      facts: JSON.stringify(parsed.facts),
                      concepts: JSON.stringify(parsed.concepts),
                      filesRead: JSON.stringify(parsed.filesRead),
                      filesModified: JSON.stringify(parsed.filesModified),
                      toolName: parsed.toolName,
                      toolCallId: parsed.toolCallId,
                      promptNumber,
                      createdAtEpoch: Date.now(),
                    })
                    .returning()
                    .get()

                  if (obs) {
                    // Queue for vector embedding (async, fire-and-forget)
                    const text = buildObservationText(parsed)
                    queueForEmbedding(
                      obs.id,
                      text,
                      chat?.projectId || null,
                      parsed.type,
                      obs.createdAtEpoch || Date.now(),
                    )
                  }
                }
              }
            }
          }
        }

        synced++
      } catch (error) {
        console.error(`[Memory] Failed to sync SubChat ${subChat.id}:`, error)
        failed++
      }
    }

    console.log(`[Memory] Historical sync completed: synced=${synced}, skipped=${skipped}, failed=${failed}`)
    return { synced, skipped, failed, total: allSubChats.length }
  }),
})
