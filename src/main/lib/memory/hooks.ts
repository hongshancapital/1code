/**
 * Memory Hooks
 * Hook handlers for capturing memory during Claude sessions
 * Borrowed from claude-mem architecture
 */

import { getDatabase, memorySessions, observations, userPrompts } from "../db"
import { eq } from "drizzle-orm"
import {
  parseToolToObservation,
  parseAssistantMessage,
  isMetaObservation,
  buildObservationText,
} from "./observation-parser"
import type {
  SessionStartData,
  UserPromptData,
  ToolOutputData,
  SessionEndData,
} from "./types"
import { queueForEmbedding } from "./vector-store"

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
        console.error("[Memory] Failed to create session: no result")
        return null
      }

      console.log(`[Memory] Session started: ${session.id}`)
      return session.id
    } catch (error) {
      console.error("[Memory] Failed to create session:", error)
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

      console.log(
        `[Memory] User prompt recorded: #${data.promptNumber} (${data.prompt.slice(0, 50)}...)`,
      )
    } catch (error) {
      console.error("[Memory] Failed to record user prompt:", error)
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
      const parsed = parseToolToObservation(
        data.toolName,
        data.toolInput,
        data.toolOutput,
        data.toolCallId,
      )

      if (!parsed) {
        // Unknown tool or should be skipped
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
        console.error("[Memory] Failed to create observation: no result")
        return
      }

      console.log(
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
      console.error("[Memory] Failed to create observation:", error)
    }
  },

  /**
   * Called when a session ends
   * Updates the session status to completed
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

      console.log(`[Memory] Session completed: ${data.sessionId}`)

      // Phase 3: Generate session summary
      // await generateSessionSummary(data.sessionId)
    } catch (error) {
      console.error("[Memory] Failed to complete session:", error)
    }
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

      console.log(`[Memory] Session failed: ${sessionId}`)
    } catch (error) {
      console.error("[Memory] Failed to mark session as failed:", error)
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
        console.error("[Memory] Failed to record AI response: no result")
        return
      }

      console.log(
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
      console.error("[Memory] Failed to record AI response:", error)
    }
  },
}
