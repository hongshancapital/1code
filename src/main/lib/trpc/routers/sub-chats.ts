/**
 * SubChat CRUD Router
 * Handles sub-chat operations (create, read, update, delete, rename, rollback)
 */

import { eq } from "drizzle-orm"
import { z } from "zod"
import { BrowserWindow } from "electron"
import { chats, getDatabase, memorySessions, modelUsage, projects, subChats } from "../../db"
import { applyRollbackStash } from "../../git/stash"
import { publicProcedure, router } from "../index"
import {
  checkHasPendingPlan,
  computePreviewStatsFromMessages,
  getFallbackName,
} from "./chat-helpers"

export const subChatsRouter = router({
  /**
   * Get a single sub-chat
   */
  getSubChat: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()

      // Optimized: 1 JOIN query instead of 3 separate queries
      const result = db
        .select({
          subChat: subChats,
          chat: chats,
          project: projects,
        })
        .from(subChats)
        .innerJoin(chats, eq(subChats.chatId, chats.id))
        .innerJoin(projects, eq(chats.projectId, projects.id))
        .where(eq(subChats.id, input.id))
        .get()

      if (!result) return null

      return {
        ...result.subChat,
        chat: {
          ...result.chat,
          project: result.project,
        },
      }
    }),

  /**
   * Get messages for a single sub-chat (lazy loading)
   */
  getSubChatMessages: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      const subChat = db
        .select({ messages: subChats.messages })
        .from(subChats)
        .where(eq(subChats.id, input.id))
        .get()

      if (!subChat) return null
      return { messages: subChat.messages || "[]" }
    }),

  /**
   * Create a new sub-chat
   */
  createSubChat: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        name: z.string().optional(),
        mode: z.enum(["plan", "agent"]).default("agent"),
        initialMessageParts: z
          .array(
            z.union([
              z.object({ type: z.literal("text"), text: z.string() }),
              z.object({
                type: z.literal("data-image"),
                data: z.object({
                  url: z.string(),
                  mediaType: z.string().optional(),
                  filename: z.string().optional(),
                  base64Data: z.string().optional(),
                }),
              }),
              z.object({
                type: z.literal("file-content"),
                filePath: z.string(),
                content: z.string(),
              }),
            ]),
          )
          .optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      // Build initial messages if provided
      let initialMessages = "[]"
      if (input.initialMessageParts && input.initialMessageParts.length > 0) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: input.initialMessageParts,
          },
        ])
      }

      return db
        .insert(subChats)
        .values({
          chatId: input.chatId,
          name: input.name,
          mode: input.mode,
          messages: initialMessages,
        })
        .returning()
        .get()
    }),

  /**
   * Update sub-chat messages
   * Also pre-computes preview stats and hasPendingPlan to avoid parsing large JSON on read
   */
  updateSubChatMessages: publicProcedure
    .input(z.object({ id: z.string(), messages: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()

      // Get current subChat mode for stats computation
      const existingSubChat = db
        .select({ mode: subChats.mode })
        .from(subChats)
        .where(eq(subChats.id, input.id))
        .get()

      const mode = existingSubChat?.mode || "agent"

      // Compute preview stats from messages
      const stats = computePreviewStatsFromMessages(input.messages, mode)

      // Compute hasPendingPlan flag
      const hasPendingPlan = checkHasPendingPlan(input.messages, mode)

      return db
        .update(subChats)
        .set({
          messages: input.messages,
          statsJson: JSON.stringify(stats),
          hasPendingPlan,
          updatedAt: new Date(),
        })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Rollback to a specific message by sdkMessageUuid
   * Handles both git state rollback and message truncation
   * Git rollback is done first - if it fails, the whole operation aborts
   */
  rollbackToMessage: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        sdkMessageUuid: z.string(),
        // Optional: message index as fallback when UUID lookup fails
        messageIndex: z.number().optional(),
      }),
    )
    .mutation(async ({ input }): Promise<
      | { success: false; error: string }
      | { success: true; messages: any[] }
    > => {
      const db = getDatabase()

      // 1. Get the sub-chat and its messages
      const subChat = db
        .select()
        .from(subChats)
        .where(eq(subChats.id, input.subChatId))
        .get()
      if (!subChat) {
        return { success: false, error: "Sub-chat not found" }
      }

      // 2. Parse messages and find the target message
      const messages = JSON.parse(subChat.messages || "[]")

      // Log all messages for debugging
      console.log("[rollback] Looking for message:", {
        sdkMessageUuid: input.sdkMessageUuid,
        messageIndex: input.messageIndex,
        dbMessageCount: messages.length,
        dbMessages: messages.map((m: any, idx: number) => ({
          idx,
          id: m.id,
          role: m.role,
          sdkMessageUuid: m.metadata?.sdkMessageUuid,
        })),
      })

      // Primary lookup: by sdkMessageUuid
      let targetIndex = messages.findIndex(
        (m: any) => m.metadata?.sdkMessageUuid === input.sdkMessageUuid,
      )

      // Fallback 1: use messageIndex if provided and UUID lookup failed
      if (targetIndex === -1 && input.messageIndex !== undefined) {
        // Validate the index is within bounds and points to an assistant message
        if (
          input.messageIndex >= 0 &&
          input.messageIndex < messages.length &&
          messages[input.messageIndex].role === "assistant"
        ) {
          console.log("[rollback] UUID lookup failed, using messageIndex fallback:", input.messageIndex)
          targetIndex = input.messageIndex
        }
      }

      // Fallback 2: find last assistant message with matching sdkMessageUuid pattern
      // This handles case where frontend and backend message arrays might be out of sync
      if (targetIndex === -1) {
        // Find all assistant messages and their sdkMessageUuids
        const assistantMsgs = messages
          .map((m: any, idx: number) => ({ msg: m, idx }))
          .filter(({ msg }: { msg: any }) => msg.role === "assistant")

        console.log("[rollback] Fallback 2 - checking assistant messages:",
          assistantMsgs.map(({ msg, idx }: { msg: any; idx: number }) => ({
            idx,
            sdkUuid: msg.metadata?.sdkMessageUuid,
          }))
        )

        // Try to find by the last assistant message (most common rollback case)
        if (assistantMsgs.length > 0) {
          const lastAssistant = assistantMsgs[assistantMsgs.length - 1]
          // Only use this fallback if the last assistant message has a sdkMessageUuid
          // (indicates historyEnabled was true when message was created)
          if (lastAssistant.msg.metadata?.sdkMessageUuid) {
            console.log("[rollback] Fallback 2: using last assistant message at index:", lastAssistant.idx)
            targetIndex = lastAssistant.idx
          }
        }
      }

      if (targetIndex === -1) {
        console.error("[rollback] Message not found after all fallbacks. DB has", messages.length, "messages")
        return { success: false, error: "Message not found" }
      }

      // Get the actual sdkMessageUuid from the found message (may differ from input if fallback was used)
      const targetMessage = messages[targetIndex]
      const targetSdkUuid = targetMessage?.metadata?.sdkMessageUuid || input.sdkMessageUuid

      console.log("[rollback] Found target message at index:", targetIndex, {
        inputSdkUuid: input.sdkMessageUuid,
        targetSdkUuid,
        usedFallback: targetSdkUuid !== input.sdkMessageUuid,
      })

      // 3. Get the parent chat for worktreePath
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, subChat.chatId))
        .get()

      // 4. Rollback git state first - if this fails, abort the whole operation
      // Use targetSdkUuid (from the found message) instead of input.sdkMessageUuid
      // This ensures we look up the checkpoint that matches the actual message being rolled back to
      if (chat?.worktreePath) {
        const res = await applyRollbackStash(chat.worktreePath, targetSdkUuid)
        if (!res.success) {
          return { success: false, error: `Git rollback failed: ${res.error}` }
        }
        // If checkpoint wasn't found, we still fail because we can't safely rollback
        // without reverting the git state to match the message history
        if (!res.checkpointFound) {
          return { success: false, error: "Checkpoint not found - cannot rollback git state" }
        }
      }

      // 5. Truncate messages to include up to and including the target message
      let truncatedMessages = messages.slice(0, targetIndex + 1)

      // 5.5. Clear any old shouldResume flags, then set on the target message
      truncatedMessages = truncatedMessages.map((m: any, i: number) => {
        const { shouldResume: _shouldResume, ...restMeta } = m.metadata || {}
        return {
          ...m,
          metadata: {
            ...restMeta,
            ...(i === truncatedMessages.length - 1 && { shouldResume: true }),
          },
        }
      })

      // 6. Update the sub-chat with truncated messages and recompute stats
      const truncatedMessagesJson = JSON.stringify(truncatedMessages)
      const stats = computePreviewStatsFromMessages(truncatedMessagesJson, subChat.mode || "agent")
      db.update(subChats)
        .set({
          messages: truncatedMessagesJson,
          statsJson: JSON.stringify(stats),
          updatedAt: new Date(),
        })
        .where(eq(subChats.id, input.subChatId))
        .returning()
        .get()

      return {
        success: true,
        messages: truncatedMessages,
      }
    }),

  /**
   * Update sub-chat session ID (for Claude resume)
   */
  updateSubChatSession: publicProcedure
    .input(z.object({ id: z.string(), sessionId: z.string().nullable() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ sessionId: input.sessionId })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Get sub-chat by session ID (for memory search navigation)
   */
  getSubChatBySessionId: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      const subChat = db
        .select({
          id: subChats.id,
          name: subChats.name,
          chatId: subChats.chatId,
          sessionId: subChats.sessionId,
          mode: subChats.mode,
          createdAt: subChats.createdAt,
        })
        .from(subChats)
        .where(eq(subChats.sessionId, input.sessionId))
        .get()

      if (!subChat) return null

      // Also get the parent chat info
      const chat = db
        .select({
          id: chats.id,
          name: chats.name,
          projectId: chats.projectId,
        })
        .from(chats)
        .where(eq(chats.id, subChat.chatId))
        .get()

      return {
        subChat,
        chat,
      }
    }),

  /**
   * Get sub-chat by memory session ID (for global search navigation)
   * Uses memory_sessions.sub_chat_id to find the associated SubChat
   */
  getSubChatByMemorySessionId: publicProcedure
    .input(z.object({ memorySessionId: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()

      // 1. Get sub_chat_id from memory_sessions
      const memSession = db
        .select({ subChatId: memorySessions.subChatId })
        .from(memorySessions)
        .where(eq(memorySessions.id, input.memorySessionId))
        .get()

      if (!memSession?.subChatId) return null

      // 2. Get the sub_chat
      const subChat = db
        .select({
          id: subChats.id,
          name: subChats.name,
          chatId: subChats.chatId,
          sessionId: subChats.sessionId,
          mode: subChats.mode,
          createdAt: subChats.createdAt,
        })
        .from(subChats)
        .where(eq(subChats.id, memSession.subChatId))
        .get()

      if (!subChat) return null

      // 3. Get the parent chat
      const chat = db
        .select({
          id: chats.id,
          name: chats.name,
          projectId: chats.projectId,
          archivedAt: chats.archivedAt,
        })
        .from(chats)
        .where(eq(chats.id, subChat.chatId))
        .get()

      return {
        subChat,
        chat,
      }
    }),

  /**
   * Update sub-chat mode
   */
  updateSubChatMode: publicProcedure
    .input(z.object({ id: z.string(), mode: z.enum(["plan", "agent"]) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ mode: input.mode })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Rename a sub-chat
   * Set manuallyRenamed to true when user manually renames
   */
  renameSubChat: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1),
      skipManuallyRenamed: z.boolean().optional(), // For internal/auto-rename usage
    }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({
          name: input.name,
          // Only set manuallyRenamed if not explicitly skipped (for auto-rename)
          ...(!input.skipManuallyRenamed && { manuallyRenamed: true }),
        })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Delete a sub-chat
   */
  deleteSubChat: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .delete(subChats)
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Archive a sub-chat (soft delete)
   */
  archiveSubChat: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Unarchive a sub-chat
   */
  unarchiveSubChat: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(subChats)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(subChats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Generate a name for a sub-chat using AI
   *
   * New flow for better UX:
   * 1. Immediately return fallback name (truncated user message)
   * 2. Kick off async AI generation in background
   * 3. If AI succeeds, update DB directly (frontend will see update via query invalidation)
   */
  generateSubChatName: publicProcedure
    .input(z.object({
      userMessage: z.string(),
      summaryProviderId: z.string().optional(),
      summaryModelId: z.string().optional(),
      subChatId: z.string().optional(),
      chatId: z.string().optional(),
      projectId: z.string().optional(),
      isFirstSubChat: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const fallbackName = getFallbackName(input.userMessage)

      console.log("[generateSubChatName] Returning fallback immediately:", fallbackName)

      // Kick off async AI generation (fire-and-forget)
      generateNameWithAI(input, fallbackName).catch((err) => {
        console.warn("[generateSubChatName] Background AI generation failed:", err)
      })

      return { name: fallbackName }
    }),
})

/**
 * Background task to generate name with AI and update DB if successful
 */
async function generateNameWithAI(
  input: {
    userMessage: string
    summaryProviderId?: string
    summaryModelId?: string
    subChatId?: string
    chatId?: string
    projectId?: string
    isFirstSubChat?: boolean
  },
  fallbackName: string,
) {
  let aiName: string | null = null

  // 1. Try configured summary AI provider
  if (input.summaryProviderId && input.summaryModelId) {
    console.log("[generateSubChatName:bg] Trying Summary AI provider...")
    try {
      const { callSummaryAIWithUsage } = await import("./summary-ai")
      const startTime = Date.now()
      const result = await callSummaryAIWithUsage(
        input.summaryProviderId,
        input.summaryModelId,
        "Generate a concise title for a chat conversation based on the user's first message. " +
        "The title should clearly describe what the conversation is about, so someone can tell the topic at a glance. " +
        "Max 35 characters. Use the same language as the message. " +
        "Return ONLY the title, nothing else. No quotes, no punctuation at the end.",
        input.userMessage,
      )
      if (result?.text) {
        aiName = result.text
        console.log("[generateSubChatName:bg] Summary AI generated:", aiName, `(${Date.now() - startTime}ms)`)

        // Record usage
        if (result.usage && input.subChatId && input.chatId && input.projectId) {
          try {
            const db = getDatabase()
            const totalTokens = result.usage.inputTokens + result.usage.outputTokens
            db.insert(modelUsage).values({
              subChatId: input.subChatId,
              chatId: input.chatId,
              projectId: input.projectId,
              model: result.usage.model,
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens,
              source: "auto-name",
              durationMs: Date.now() - startTime,
            }).run()
          } catch (usageErr) {
            console.warn("[generateSubChatName:bg] Failed to record usage:", (usageErr as Error).message)
          }
        }
      } else {
        console.warn("[generateSubChatName:bg] Summary AI returned empty result")
      }
    } catch (error) {
      console.warn("[generateSubChatName:bg] Summary AI failed:", (error as Error).message)
    }
  }

  // 2. Try hongshan.com API if no AI name yet
  if (!aiName) {
    console.log("[generateSubChatName:bg] Trying hongshan.com API...")
    try {
      const { getDeviceInfo } = await import("../../device-id")
      const deviceInfo = getDeviceInfo()
      const apiUrl = "https://cowork.hongshan.com"

      const response = await fetch(
        `${apiUrl}/api/agents/sub-chat/generate-name`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-device-id": deviceInfo.deviceId,
            "x-device-platform": deviceInfo.platform,
            "x-app-version": deviceInfo.appVersion,
          },
          body: JSON.stringify({ userMessage: input.userMessage }),
        },
      )

      if (response.ok) {
        const data = await response.json()
        if (data.name && data.name !== fallbackName) {
          aiName = data.name
          console.log("[generateSubChatName:bg] hongshan.com API returned:", aiName)
        }
      } else {
        console.warn("[generateSubChatName:bg] hongshan.com API returned:", response.status)
      }
    } catch (error) {
      console.warn("[generateSubChatName:bg] hongshan.com API failed:", (error as Error).message)
    }
  }

  // 3. Determine final name (AI or fallback)
  const finalName = aiName || fallbackName

  // 4. Update DB if we got a better name from AI
  if (aiName && aiName !== fallbackName && input.subChatId) {
    console.log("[generateSubChatName:bg] Updating sub-chat name in DB:", aiName)
    const db = getDatabase()

    // Update sub-chat name
    db.update(subChats)
      .set({ name: aiName, updatedAt: new Date() })
      .where(eq(subChats.id, input.subChatId))
      .run()

    // Also update parent chat if this is the first sub-chat
    if (input.isFirstSubChat && input.chatId) {
      console.log("[generateSubChatName:bg] Also updating parent chat name:", aiName)
      db.update(chats)
        .set({ name: aiName, updatedAt: new Date() })
        .where(eq(chats.id, input.chatId))
        .run()
    }
  }

  // 5. Always notify frontend via IPC (both success and failure)
  // This allows frontend to stop shimmer and confirm the name
  if (input.subChatId) {
    console.log("[generateSubChatName:bg] Sending IPC event to frontend, name:", finalName, aiName ? "(AI)" : "(fallback)")
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("sub-chat:ai-name-ready", {
        subChatId: input.subChatId,
        chatId: input.chatId,
        name: finalName,
        isFirstSubChat: input.isFirstSubChat,
      })
    })
  }
}
