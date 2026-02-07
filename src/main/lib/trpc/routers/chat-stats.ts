/**
 * Chat Statistics Router
 * Handles file stats, token usage, and preview data for chats and sub-chats
 */

import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm"
import { z } from "zod"
import { getDatabase, modelUsage, subChats } from "../../db"
import { publicProcedure, router } from "../index"
import {
  aggregateInputs,
  computePreviewStatsFromMessages,
  lazyMigrateStats,
  resolveSubChatStats,
  type SubChatPreviewInput,
  type SubChatPreviewStats,
} from "./chat-helpers"

export const chatStatsRouter = router({
  /**
   * Get file change stats for workspaces
   * Uses pre-computed statsJson when available for performance
   * Falls back to parsing messages for records without statsJson
   * Supports two modes:
   * - openSubChatIds: query specific sub-chats (used by main sidebar)
   * - chatIds: query all sub-chats for given chats (used by archive popover)
   */
  getFileStats: publicProcedure
    .input(z.object({
      openSubChatIds: z.array(z.string()).optional(),
      chatIds: z.array(z.string()).optional(),
    }))
    .query(({ input }) => {
    const db = getDatabase()

    // Early return if nothing to check
    if ((!input.openSubChatIds || input.openSubChatIds.length === 0) &&
        (!input.chatIds || input.chatIds.length === 0)) {
      return []
    }

    // OPTIMIZATION: Split query into two parts
    // 1. Records WITH statsJson - don't SELECT messages (saves ~80% I/O)
    // 2. Records WITHOUT statsJson - need messages for computation

    type ChatRow = {
      chatId: string | null
      subChatId: string
      statsJson: string | null
      mode: string | null
      messages?: string | null
      hasStats: boolean
    }

    let withStats: ChatRow[] = []
    let withoutStats: ChatRow[] = []

    if (input.chatIds && input.chatIds.length > 0) {
      // Archive mode: query by chat IDs
      withStats = db
        .select({
          chatId: subChats.chatId,
          subChatId: subChats.id,
          statsJson: subChats.statsJson,
          mode: subChats.mode,
          hasStats: sql<boolean>`1`.as('hasStats'),
        })
        .from(subChats)
        .where(and(
          inArray(subChats.chatId, input.chatIds),
          isNotNull(subChats.statsJson)
        ))
        .all()

      withoutStats = db
        .select({
          chatId: subChats.chatId,
          subChatId: subChats.id,
          messages: subChats.messages,
          mode: subChats.mode,
          statsJson: sql<string>`NULL`.as('statsJson'),
          hasStats: sql<boolean>`0`.as('hasStats'),
        })
        .from(subChats)
        .where(and(
          inArray(subChats.chatId, input.chatIds),
          isNull(subChats.statsJson)
        ))
        .all()
    } else {
      // Main sidebar mode: query specific sub-chats
      withStats = db
        .select({
          chatId: subChats.chatId,
          subChatId: subChats.id,
          statsJson: subChats.statsJson,
          mode: subChats.mode,
          hasStats: sql<boolean>`1`.as('hasStats'),
        })
        .from(subChats)
        .where(and(
          inArray(subChats.id, input.openSubChatIds!),
          isNotNull(subChats.statsJson)
        ))
        .all()

      withoutStats = db
        .select({
          chatId: subChats.chatId,
          subChatId: subChats.id,
          messages: subChats.messages,
          mode: subChats.mode,
          statsJson: sql<string>`NULL`.as('statsJson'),
          hasStats: sql<boolean>`0`.as('hasStats'),
        })
        .from(subChats)
        .where(and(
          inArray(subChats.id, input.openSubChatIds!),
          isNull(subChats.statsJson)
        ))
        .all()
    }

    // Merge results
    const allChats = [...withStats, ...withoutStats]

    // Get token usage from model_usage table
    // Group by chatId and sum total tokens
    const tokenUsageData = db
      .select({
        chatId: modelUsage.chatId,
        totalTokens: sql<number>`SUM(${modelUsage.totalTokens})`.as('totalTokens'),
      })
      .from(modelUsage)
      .where(
        input.chatIds && input.chatIds.length > 0
          ? inArray(modelUsage.chatId, input.chatIds)
          : inArray(modelUsage.subChatId, input.openSubChatIds!)
      )
      .groupBy(modelUsage.chatId)
      .all()

    // Create a map for quick token lookup
    const tokenUsageMap = new Map<string, number>()
    for (const row of tokenUsageData) {
      if (row.chatId) {
        tokenUsageMap.set(row.chatId, row.totalTokens || 0)
      }
    }

    // Aggregate stats per workspace (chatId)
    const statsMap = new Map<
      string,
      { additions: number; deletions: number; fileCount: number; totalTokens: number }
    >()

    // Track sub-chats that need statsJson update (lazy migration)
    const subChatsToUpdate: Array<{ id: string; statsJson: string }> = []

    for (const row of allChats) {
      if (!row.chatId) continue
      const chatId = row.chatId // TypeScript narrowing

      // Use shared helper to resolve stats
      const { fileCount, additions, deletions } = resolveSubChatStats(row)

      // Queue for lazy migration if we computed from messages
      if (!row.hasStats && row.messages) {
        try {
          const computed = computePreviewStatsFromMessages(row.messages, row.mode || "agent")
          subChatsToUpdate.push({
            id: row.subChatId,
            statsJson: JSON.stringify(computed),
          })
        } catch {
          // Ignore
        }
      }

      // Add to workspace total
      const existing = statsMap.get(chatId) || {
        additions: 0,
        deletions: 0,
        fileCount: 0,
        totalTokens: tokenUsageMap.get(chatId) || 0,
      }
      existing.additions += additions
      existing.deletions += deletions
      existing.fileCount += fileCount
      statsMap.set(chatId, existing)
    }

    // Lazy migration using shared helper
    lazyMigrateStats(db, subChatsToUpdate)

    // Convert to array for easier consumption
    return Array.from(statsMap.entries()).map(([chatId, stats]) => ({
      chatId,
      ...stats,
    }))
  }),

  /**
   * Get file change stats per sub-chat (not aggregated by workspace)
   * Uses pre-computed statsJson when available for performance
   * Returns stats keyed by subChatId for use in subchat sidebar
   */
  getSubChatStats: publicProcedure
    .input(z.object({
      subChatIds: z.array(z.string()),
    }))
    .query(({ input }) => {
      const db = getDatabase()

      if (input.subChatIds.length === 0) {
        return []
      }

      // OPTIMIZATION: Split query like getFileStats
      type SubChatRow = {
        subChatId: string
        statsJson: string | null
        mode: string | null
        messages?: string | null
        hasStats: boolean
      }

      const withStats = db
        .select({
          subChatId: subChats.id,
          statsJson: subChats.statsJson,
          mode: subChats.mode,
          hasStats: sql<boolean>`1`.as('hasStats'),
        })
        .from(subChats)
        .where(and(
          inArray(subChats.id, input.subChatIds),
          isNotNull(subChats.statsJson)
        ))
        .all() as SubChatRow[]

      const withoutStats = db
        .select({
          subChatId: subChats.id,
          messages: subChats.messages,
          mode: subChats.mode,
          statsJson: sql<string>`NULL`.as('statsJson'),
          hasStats: sql<boolean>`0`.as('hasStats'),
        })
        .from(subChats)
        .where(and(
          inArray(subChats.id, input.subChatIds),
          isNull(subChats.statsJson)
        ))
        .all() as SubChatRow[]

      const allSubChats = [...withStats, ...withoutStats]

      const results: Array<{
        subChatId: string
        fileCount: number
        additions: number
        deletions: number
      }> = []

      // Track sub-chats that need statsJson update (lazy migration)
      const subChatsToUpdate: Array<{ id: string; statsJson: string }> = []

      for (const row of allSubChats) {
        // Use shared helper
        const { fileCount, additions, deletions } = resolveSubChatStats(row)

        // Queue for lazy migration if computed from messages
        if (!row.hasStats && row.messages) {
          try {
            const computed = computePreviewStatsFromMessages(row.messages, row.mode || "agent")
            subChatsToUpdate.push({
              id: row.subChatId,
              statsJson: JSON.stringify(computed),
            })
          } catch {
            // Ignore
          }
        }

        results.push({
          subChatId: row.subChatId,
          fileCount,
          additions,
          deletions,
        })
      }

      // Lazy migration using shared helper
      lazyMigrateStats(db, subChatsToUpdate)

      return results
    }),

  /**
   * Get sub-chats with pending plan approvals
   * Uses pre-computed hasPendingPlan field for O(1) lookup (no message parsing)
   * Field is computed in updateSubChatMessages by checkHasPendingPlan helper
   * REQUIRES openSubChatIds to avoid loading all sub-chats (performance optimization)
   */
  getPendingPlanApprovals: publicProcedure
    .input(z.object({ openSubChatIds: z.array(z.string()) }))
    .query(({ input }) => {
      const db = getDatabase()

      // Early return if no sub-chats to check
      if (input.openSubChatIds.length === 0) {
        return []
      }

      // Query sub-chats with pending plan approval using pre-computed field
      // This eliminates the need to parse messages JSON (major performance win)
      const pendingApprovals = db
        .select({
          chatId: subChats.chatId,
          subChatId: subChats.id,
        })
        .from(subChats)
        .where(
          and(
            inArray(subChats.id, input.openSubChatIds),
            eq(subChats.hasPendingPlan, true)
          )
        )
        .all()

      return pendingApprovals
    }),

  /**
   * Get sub-chat preview data for hover popup
   * Uses pre-computed statsJson when available to avoid parsing large messages JSON
   * Falls back to computing stats on-the-fly for records without statsJson (migration)
   */
  getSubChatPreview: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()

      // Only select metadata fields, not the full messages JSON
      const subChat = db
        .select({
          id: subChats.id,
          name: subChats.name,
          mode: subChats.mode,
          statsJson: subChats.statsJson,
          messages: subChats.messages, // Still needed for fallback
        })
        .from(subChats)
        .where(eq(subChats.id, input.subChatId))
        .get()

      if (!subChat) return null

      // Try to use pre-computed stats first
      let inputs: SubChatPreviewInput[]
      let needsPersist = false

      if (subChat.statsJson) {
        // Use pre-computed stats (fast path)
        try {
          const stats = JSON.parse(subChat.statsJson) as SubChatPreviewStats
          inputs = stats.inputs || []
        } catch {
          // Fallback to computing on-the-fly if JSON is invalid
          const computed = computePreviewStatsFromMessages(
            subChat.messages || "[]",
            subChat.mode || "agent"
          )
          inputs = computed.inputs
          needsPersist = true
        }
      } else {
        // No pre-computed stats (old records) - compute on-the-fly
        // This will happen for existing records until they're updated
        const computed = computePreviewStatsFromMessages(
          subChat.messages || "[]",
          subChat.mode || "agent"
        )
        inputs = computed.inputs
        needsPersist = true
      }

      // Lazy migration: persist computed stats for old records
      if (needsPersist) {
        try {
          db.update(subChats)
            .set({ statsJson: JSON.stringify({ inputs }) })
            .where(eq(subChats.id, input.subChatId))
            .run()
        } catch {
          // Non-critical, ignore errors
        }
      }

      // Fetch token usage from model_usage table and merge into inputs
      // This is still needed because token usage is stored separately
      const usageRecords = db
        .select({
          totalTokens: modelUsage.totalTokens,
          mode: modelUsage.mode,
        })
        .from(modelUsage)
        .where(eq(modelUsage.subChatId, input.subChatId))
        .orderBy(modelUsage.createdAt)
        .all()

      // Distribute token usage to inputs (1:1 mapping by order)
      // If usage records show plan mode, update the input's mode accordingly
      for (let i = 0; i < inputs.length && i < usageRecords.length; i++) {
        const record = usageRecords[i]
        if (record) {
          inputs[i]!.totalTokens = record.totalTokens || 0
          if (record.mode === "plan" && inputs[i]) {
            inputs[i]!.mode = "plan"
          }
        }
      }

      // If there are more usage records than inputs (shouldn't happen normally),
      // sum the remaining into the last input
      if (usageRecords.length > inputs.length && inputs.length > 0) {
        let extraTokens = 0
        for (let i = inputs.length; i < usageRecords.length; i++) {
          extraTokens += usageRecords[i]?.totalTokens || 0
        }
        inputs[inputs.length - 1]!.totalTokens += extraTokens
      }

      return {
        subChatId: subChat.id,
        subChatName: subChat.name || "New Chat",
        mode: subChat.mode || "agent",
        inputs,
      }
    }),

  /**
   * Get basic stats for a chat (message count, tool usage, etc.)
   * Supports both full chat stats and individual sub-chat stats.
   * Useful for showing chat summary in sidebar or export dialogs.
   */
  getChatStats: publicProcedure
    .input(z.object({
      chatId: z.string(),
      subChatId: z.string().optional(), // If provided, return stats for only this sub-chat
    }))
    .query(({ input }) => {
      const db = getDatabase()

      let chatSubChats
      if (input.subChatId) {
        // Get stats for a single sub-chat
        const singleSubChat = db
          .select()
          .from(subChats)
          .where(and(
            eq(subChats.id, input.subChatId),
            eq(subChats.chatId, input.chatId)
          ))
          .get()

        chatSubChats = singleSubChat ? [singleSubChat] : []
      } else {
        // Get stats for all sub-chats
        chatSubChats = db
          .select()
          .from(subChats)
          .where(eq(subChats.chatId, input.chatId))
          .all()
      }

      let messageCount = 0
      let userMessageCount = 0
      let assistantMessageCount = 0
      let toolCalls = 0
      const toolUsage: Record<string, number> = {}
      let totalInputTokens = 0
      let totalOutputTokens = 0

      for (const subChat of chatSubChats) {
        try {
          const messages = JSON.parse(subChat.messages || "[]") as Array<{
            role: string
            parts?: Array<{ type: string; toolName?: string }>
            metadata?: { usage?: { inputTokens?: number; outputTokens?: number } }
          }>

          for (const msg of messages) {
            messageCount++
            if (msg.role === "user") {
              userMessageCount++
            } else if (msg.role === "assistant") {
              assistantMessageCount++

              // count tool calls
              for (const part of msg.parts || []) {
                if (part.type?.startsWith("tool-") && part.toolName) {
                  toolCalls++
                  toolUsage[part.toolName] = (toolUsage[part.toolName] || 0) + 1
                }
              }

              // aggregate token usage
              if (msg.metadata?.usage) {
                totalInputTokens += msg.metadata.usage.inputTokens || 0
                totalOutputTokens += msg.metadata.usage.outputTokens || 0
              }
            }
          }
        } catch {
          // skip invalid json
        }
      }

      return {
        messageCount,
        userMessageCount,
        assistantMessageCount,
        toolCalls,
        toolUsage,
        totalInputTokens,
        totalOutputTokens,
        subChatCount: chatSubChats.length,
      }
    }),
})
