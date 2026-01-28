/**
 * Background task types for Claude Agent SDK integration
 */

/**
 * Background task status
 */
export type BackgroundTaskStatus = "running" | "completed" | "failed" | "stopped"

/**
 * Background task data structure
 * Based on Claude Agent SDK's SDKTaskNotificationMessage
 */
export interface BackgroundTask {
  /** Task unique identifier */
  taskId: string
  /** Shell ID (used for kill operation) */
  shellId: string
  /** Task status */
  status: BackgroundTaskStatus
  /** Task summary/description */
  summary: string
  /** Output file path */
  outputFile?: string
  /** Task start time */
  startedAt: number
  /** Task completion time */
  completedAt?: number
  /** Associated subChatId */
  subChatId: string
  /** Associated command (if any) */
  command?: string
}

/**
 * Toolbar active mode
 */
export type ToolbarActiveMode = "none" | "background-tasks" | string
