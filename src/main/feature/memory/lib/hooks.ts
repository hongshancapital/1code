/**
 * Memory Hooks
 * Hook handlers for capturing memory during Claude sessions
 * Borrowed from claude-mem architecture
 */

import { getDatabase, memorySessions, observations, userPrompts, modelUsage } from "../../../lib/db"
import { eq } from "drizzle-orm"
import {
  parseToolToObservation,
  parseAssistantMessage,
  isMetaObservation,
  buildObservationText,
} from "./observation-parser"
import {
  enhanceObservation,
  isSummaryModelConfigured,
  generateSessionSummary,
} from "./summarizer"
import type { MemoryLLMUsage } from "./summarizer"
import type {
  SessionStartData,
  UserPromptData,
  ToolOutputData,
  SessionEndData,
} from "./types"
import { queueForEmbedding } from "./vector-store"
import { createLogger } from "../../../lib/logger"

const memoryLog = createLogger("Memory")


/**
 * Record memory system LLM usage to model_usage table.
 * Uses the session's associated subChatId/chatId/projectId for tracking.
 */
function recordMemoryUsage(
  usage: MemoryLLMUsage,
  sessionId: string,
  subChatId: string,
  chatId: string,
  projectId: string,
): void {
  try {
    const db = getDatabase()
    const totalTokens = usage.inputTokens + usage.outputTokens

    db.insert(modelUsage)
      .values({
        subChatId,
        chatId,
        projectId,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens,
        sessionId,
        mode: "agent",
        source: "memory",
      })
      .run()

    memoryLog.info(
      `[Memory] Usage recorded: ${usage.purpose} — ${totalTokens} tokens (${usage.model})`,
    )
  } catch (error) {
    // Non-critical, don't block memory pipeline
    memoryLog.warn("Failed to record usage:", (error as Error).message)
  }
}

/**
 * Look up session context (subChatId, chatId, projectId) from memorySessions table.
 */
function getSessionContext(sessionId: string): {
  subChatId: string
  chatId: string
  projectId: string
} | null {
  try {
    const db = getDatabase()
    const session = db
      .select({
        subChatId: memorySessions.subChatId,
        chatId: memorySessions.chatId,
        projectId: memorySessions.projectId,
      })
      .from(memorySessions)
      .where(eq(memorySessions.id, sessionId))
      .get()

    if (!session?.subChatId || !session?.chatId || !session?.projectId) return null
    return session as { subChatId: string; chatId: string; projectId: string }
  } catch {
    return null
  }
}

export const memoryHooks = {
  /**
   * Called when a new session starts
   * Creates a memory_sessions record and returns the session ID
   */
  async onSessionStart(data: SessionStartData): Promise<string | null> {
    try {
      const db = getDatabase()
      const session = db
        .insert(memorySessions)
        .values({
          subChatId: data.subChatId,
          projectId: data.projectId,
          chatId: data.chatId,
          status: "active",
          startedAt: new Date(),
          startedAtEpoch: Date.now(),
        })
        .returning()
        .get()

      if (!session) {
        memoryLog.error("Failed to create session: no result")
        return null
      }

      memoryLog.info(`Session started: ${session.id}`)
      return session.id
    } catch (error) {
      memoryLog.error("Failed to create session:", error)
      return null
    }
  },

  /**
   * Called when user submits a prompt
   * Records the user's input
   */
  async onUserPrompt(data: UserPromptData): Promise<void> {
    if (!data.sessionId) return

    try {
      const db = getDatabase()
      db.insert(userPrompts).values({
        sessionId: data.sessionId,
        promptText: data.prompt,
        promptNumber: data.promptNumber,
        createdAt: new Date(),
        createdAtEpoch: Date.now(),
      }).run()

      memoryLog.info(
        `[Memory] User prompt recorded: #${data.promptNumber} (${data.prompt.slice(0, 50)}...)`,
      )
    } catch (error) {
      memoryLog.error("Failed to record user prompt:", error)
    }
  },

  /**
   * Called when a tool returns output
   * Parses the tool call and creates an observation
   */
  async onToolOutput(data: ToolOutputData): Promise<void> {
    if (!data.sessionId) return

    try {
      // Skip meta-observations (session-memory files, etc.)
      if (isMetaObservation(data.toolName, data.toolInput)) {
        return
      }

      // Parse tool to observation using rules
      let parsed = parseToolToObservation(
        data.toolName,
        data.toolInput,
        data.toolOutput,
        data.toolCallId,
      )

      if (!parsed) {
        // Unknown tool or should be skipped
        return
      }

      // Enhance with LLM if summary model is configured (async, best-effort)
      if (isSummaryModelConfigured()) {
        try {
          const result = await enhanceObservation(parsed, data.toolInput, data.toolOutput)
          parsed = result.observation

          // Record LLM usage if any
          if (result.usage) {
            const ctx = getSessionContext(data.sessionId)
            if (ctx) {
              recordMemoryUsage(result.usage, data.sessionId, ctx.subChatId, ctx.chatId, ctx.projectId)
            }
          }
        } catch (error) {
          // Silently fall back to rule-based
          memoryLog.warn("LLM enhancement failed, using rule-based:", (error as Error).message)
        }
      }

      // Store to database
      const db = getDatabase()
      const obs = db
        .insert(observations)
        .values({
          sessionId: data.sessionId,
          projectId: data.projectId,
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
          promptNumber: data.promptNumber,
          createdAt: new Date(),
          createdAtEpoch: Date.now(),
        })
        .returning()
        .get()

      if (!obs) {
        memoryLog.error("Failed to create observation: no result")
        return
      }

      memoryLog.info(
        `[Memory] Observation created: ${obs.id} (${parsed.type}: ${parsed.title})`,
      )

      // Queue for vector embedding (fire-and-forget)
      const text = buildObservationText(parsed)
      queueForEmbedding(
        obs.id,
        text,
        data.projectId,
        parsed.type,
        obs.createdAtEpoch || Date.now(),
      )
    } catch (error) {
      memoryLog.error("Failed to create observation:", error)
    }
  },

  /**
   * Called when a session ends
   * Updates the session status to completed and generates session summary
   */
  async onSessionEnd(data: SessionEndData): Promise<void> {
    if (!data.sessionId) return

    try {
      const db = getDatabase()
      db.update(memorySessions)
        .set({
          status: "completed",
          completedAt: new Date(),
          completedAtEpoch: Date.now(),
        })
        .where(eq(memorySessions.id, data.sessionId))
        .run()

      memoryLog.info(`Session completed: ${data.sessionId}`)

      // Generate session summary with LLM (async, best-effort)
      if (isSummaryModelConfigured()) {
        this._generateAndStoreSummary(data.sessionId).catch((error) => {
          memoryLog.warn("Session summary generation failed:", (error as Error).message)
        })
      }
    } catch (error) {
      memoryLog.error("Failed to complete session:", error)
    }
  },

  /**
   * Internal: generate and store session summary
   */
  async _generateAndStoreSummary(sessionId: string): Promise<void> {
    const db = getDatabase()

    // Gather user prompts for this session
    const prompts = db
      .select()
      .from(userPrompts)
      .where(eq(userPrompts.sessionId, sessionId))
      .orderBy(userPrompts.promptNumber)
      .all()

    // Gather observations for this session
    const obs = db
      .select()
      .from(observations)
      .where(eq(observations.sessionId, sessionId))
      .orderBy(observations.createdAtEpoch)
      .all()

    if (prompts.length === 0 && obs.length === 0) return

    const promptTexts = prompts.map((p) => p.promptText)
    const obsTitles = obs.map((o) => o.title || "")
    const obsNarratives = obs.map((o) => o.narrative || "")

    const result = await generateSessionSummary(promptTexts, obsTitles, obsNarratives)
    if (!result) return

    // Record LLM usage for session summary
    if (result.usage) {
      const ctx = getSessionContext(sessionId)
      if (ctx) {
        recordMemoryUsage(result.usage, sessionId, ctx.subChatId, ctx.chatId, ctx.projectId)
      }
    }

    // Store summary on the session
    db.update(memorySessions)
      .set({
        summaryRequest: result.summary.request,
        summaryInvestigated: result.summary.investigated,
        summaryLearned: result.summary.learned,
        summaryCompleted: result.summary.completed,
        summaryNextSteps: result.summary.nextSteps,
      })
      .where(eq(memorySessions.id, sessionId))
      .run()

    memoryLog.info(`Session summary generated for: ${sessionId}`)
  },

  /**
   * Mark a session as failed
   */
  async onSessionFailed(sessionId: string): Promise<void> {
    if (!sessionId) return

    try {
      const db = getDatabase()
      db.update(memorySessions)
        .set({
          status: "failed",
          completedAt: new Date(),
          completedAtEpoch: Date.now(),
        })
        .where(eq(memorySessions.id, sessionId))
        .run()

      memoryLog.info(`Session failed: ${sessionId}`)
    } catch (error) {
      memoryLog.error("Failed to mark session as failed:", error)
    }
  },

  /**
   * Called when assistant returns a text message
   * Records the AI response as an observation
   */
  async onAssistantMessage(data: {
    sessionId: string
    projectId: string
    text: string
    messageId?: string
    promptNumber?: number
  }): Promise<void> {
    if (!data.sessionId || !data.text) return

    try {
      // Parse assistant message to observation
      const parsed = parseAssistantMessage(data.text, data.messageId)

      if (!parsed) {
        // Skip short or tool-related messages
        return
      }

      // Store to database
      const db = getDatabase()
      const obs = db
        .insert(observations)
        .values({
          sessionId: data.sessionId,
          projectId: data.projectId,
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
          promptNumber: data.promptNumber,
          createdAt: new Date(),
          createdAtEpoch: Date.now(),
        })
        .returning()
        .get()

      if (!obs) {
        memoryLog.error("Failed to record AI response: no result")
        return
      }

      memoryLog.info(
        `[Memory] AI response recorded: ${obs.id} (${parsed.title?.slice(0, 50)}...)`,
      )

      // Queue for vector embedding (fire-and-forget)
      const text = buildObservationText(parsed)
      queueForEmbedding(
        obs.id,
        text,
        data.projectId,
        parsed.type,
        obs.createdAtEpoch || Date.now(),
      )
    } catch (error) {
      memoryLog.error("Failed to record AI response:", error)
    }
  },
}
