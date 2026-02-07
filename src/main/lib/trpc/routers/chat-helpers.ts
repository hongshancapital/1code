/**
 * Shared helper functions for chat routers
 * Extracted from chats.ts to reduce file size and improve maintainability
 */

// Type definitions for sub-chat preview stats
export interface SubChatPreviewInput {
  messageId: string
  index: number
  content: string
  mode: string
  fileCount: number
  additions: number
  deletions: number
  totalTokens: number
}

export interface SubChatPreviewStats {
  inputs: SubChatPreviewInput[]
}

/**
 * Fallback to truncated user message if AI generation fails
 */
export function getFallbackName(userMessage: string): string {
  const trimmed = userMessage.trim()
  if (trimmed.length <= 25) {
    return trimmed || "New Chat"
  }
  return trimmed.substring(0, 25) + "..."
}

/**
 * Compute preview stats from messages JSON without loading token usage from DB.
 * Token usage will be filled in separately when needed.
 * This is used by updateSubChatMessages to pre-compute stats on save.
 */
export function computePreviewStatsFromMessages(
  messagesJson: string,
  subChatMode: string
): SubChatPreviewStats {
  const messages = JSON.parse(messagesJson || "[]") as Array<{
    id: string
    role: string
    parts?: Array<{
      type: string
      text?: string
      input?: { file_path?: string; old_string?: string; new_string?: string; content?: string }
    }>
  }>

  const inputs: SubChatPreviewInput[] = []
  let currentMode = subChatMode || "agent"

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (!msg || msg.role !== "user") continue

    // Extract user input text
    const textPart = msg.parts?.find((p) => p.type === "text")
    const content = textPart?.text || ""

    // Detect mode switches via /plan or /agent commands
    const trimmedContent = content.trim().toLowerCase()
    if (trimmedContent === "/plan" || trimmedContent.startsWith("/plan ")) {
      currentMode = "plan"
    } else if (trimmedContent === "/agent" || trimmedContent.startsWith("/agent ")) {
      currentMode = "agent"
    }

    // Count file changes in subsequent assistant messages
    let additions = 0
    let deletions = 0
    const modifiedFiles = new Set<string>()
    let isPlanModeResponse = false

    // Find next user message index
    let nextUserIndex = messages.length
    for (let j = i + 1; j < messages.length; j++) {
      if (messages[j]?.role === "user") {
        nextUserIndex = j
        break
      }
    }

    for (let j = i + 1; j < nextUserIndex; j++) {
      const assistantMsg = messages[j]
      if (!assistantMsg || assistantMsg.role !== "assistant") continue

      for (const part of assistantMsg.parts || []) {
        if (part.type === "tool-Edit" || part.type === "tool-Write") {
          const filePath = part.input?.file_path
          if (filePath) modifiedFiles.add(filePath)

          if (part.type === "tool-Edit" && part.input) {
            const oldLines = (part.input.old_string || "").split("\n").length
            const newLines = (part.input.new_string || "").split("\n").length
            if (newLines > oldLines) {
              additions += newLines - oldLines
            } else {
              deletions += oldLines - newLines
            }
          } else if (part.type === "tool-Write" && part.input?.content) {
            additions += (part.input.content || "").split("\n").length
          }
        }

        if (part.type === "tool-ExitPlanMode" || part.type === "ExitPlanMode") {
          isPlanModeResponse = true
        }
      }
    }

    const messageMode = isPlanModeResponse ? "plan" : currentMode

    inputs.push({
      messageId: msg.id,
      index: inputs.length + 1,
      content: content.slice(0, 60),
      mode: messageMode,
      fileCount: modifiedFiles.size,
      additions,
      deletions,
      totalTokens: 0, // Will be filled from model_usage table when reading
    })
  }

  return { inputs }
}

/**
 * Helper: Aggregate file stats from inputs
 */
export function aggregateInputs(inputs: SubChatPreviewInput[]): {
  fileCount: number
  additions: number
  deletions: number
} {
  let fileCount = 0
  let additions = 0
  let deletions = 0

  for (const input of inputs) {
    fileCount += input.fileCount || 0
    additions += input.additions || 0
    deletions += input.deletions || 0
  }

  return { fileCount, additions, deletions }
}

/**
 * Helper: Resolve stats from either statsJson cache or by parsing messages
 * Used by getFileStats, getSubChatStats, and other stats queries
 */
export function resolveSubChatStats(row: {
  statsJson: string | null
  messages?: string | null
  mode: string | null
}): { fileCount: number; additions: number; deletions: number } {
  // Fast path: use cached statsJson
  if (row.statsJson) {
    try {
      const stats = JSON.parse(row.statsJson) as SubChatPreviewStats
      return aggregateInputs(stats.inputs)
    } catch {
      // Fall through to slow path if parse fails
    }
  }

  // Slow path: compute from messages
  if (row.messages) {
    try {
      const computed = computePreviewStatsFromMessages(row.messages, row.mode || "agent")
      return aggregateInputs(computed.inputs)
    } catch {
      // Ignore
    }
  }

  return { fileCount: 0, additions: 0, deletions: 0 }
}

/**
 * Helper: Lazy migration of statsJson in background (non-blocking)
 * Used by getFileStats and getSubChatStats to backfill statsJson cache
 */
export function lazyMigrateStats(
  db: any,
  subChatsToUpdate: Array<{ id: string; statsJson: string }>
) {
  if (subChatsToUpdate.length === 0) return

  // Schedule migration in next tick (non-blocking)
  setTimeout(() => {
    try {
      const { subChats } = require("../../db")
      const { eq } = require("drizzle-orm")
      for (const update of subChatsToUpdate) {
        db.update(subChats)
          .set({ statsJson: update.statsJson })
          .where(eq(subChats.id, update.id))
          .run()
      }
    } catch {
      // Non-critical - ignore errors
    }
  }, 0)
}

/**
 * Helper: Check if sub-chat has pending plan approval
 * Returns true when mode="plan" AND messages contain completed ExitPlanMode tool
 * Logic matches active-chat.tsx hasUnapprovedPlan computation
 */
export function checkHasPendingPlan(messagesJson: string, mode: string): boolean {
  // If mode is "agent", plan is already approved
  if (mode === "agent") return false

  try {
    const messages = JSON.parse(messagesJson || "[]") as Array<{
      role: string
      parts?: Array<{ type: string; output?: unknown }>
    }>

    // Look for completed ExitPlanMode in messages (from end to start)
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === "assistant" && msg.parts) {
        const exitPlanPart = msg.parts.find(
          (p) => p.type === "tool-ExitPlanMode" || p.type === "ExitPlanMode"
        )
        // Check if ExitPlanMode is completed (has output, even if empty)
        if (exitPlanPart && exitPlanPart.output !== undefined) {
          return true
        }
      }
    }
  } catch {
    // Invalid JSON - ignore
  }

  return false
}
