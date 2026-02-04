/**
 * Type definitions for agent chat data structures
 * Provides type safety for local and remote chat data
 */

import type { Chat } from "../../../main/lib/db/schema"

/**
 * Transformed sub-chat with parsed messages
 */
export interface AgentSubChat {
  id: string
  name?: string | null
  mode?: "plan" | "agent" | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
  messages?: unknown[] | string
  stream_id?: string | null
  chatId?: string
  sessionId?: string | null
}

/**
 * Project data attached to a chat
 */
export interface ChatProject {
  id: string
  path: string
  name: string
  mode?: "cowork" | "coding"
  featureConfig?: string | null
}

/**
 * Remote chat stats for diff display
 */
export interface RemoteStats {
  // Original format
  files_added?: number
  files_modified?: number
  files_removed?: number
  lines_added?: number
  lines_removed?: number
  // Alternative format from some remotes
  fileCount?: number
  additions?: number
  deletions?: number
}

/**
 * Base chat structure from database
 * Note: We use Omit to override projectId to allow null for remote/sandbox chats
 */
export interface BaseAgentChat extends Omit<Chat, 'projectId'> {
  projectId: string | null
  subChats?: AgentSubChat[]
  project?: ChatProject
  sandbox_id?: string | null
  meta?: unknown
}

/**
 * Local chat data from tRPC
 */
export interface LocalAgentChat extends BaseAgentChat {
  isRemote?: false
}

/**
 * Remote/sandbox chat data
 */
export interface RemoteAgentChat extends BaseAgentChat {
  isRemote: true
  sandboxId?: string | null
  remoteStats?: RemoteStats | null
}

/**
 * Union type for both local and remote chat data
 */
export type AgentChat = LocalAgentChat | RemoteAgentChat

/**
 * Type guard to check if chat is remote
 */
export function isRemoteChat(chat: AgentChat | null | undefined): chat is RemoteAgentChat {
  return !!chat && (chat as RemoteAgentChat).isRemote === true
}

/**
 * Type guard to check if chat has sandbox
 */
export function hasSandbox(chat: AgentChat | null | undefined): boolean {
  if (!chat) return false
  return !!chat.sandbox_id || !!(chat as RemoteAgentChat).sandboxId
}

/**
 * Get sandbox ID from chat (handles both naming conventions)
 */
export function getSandboxId(chat: AgentChat | null | undefined): string | null {
  if (!chat) return null
  return chat.sandbox_id ?? (chat as RemoteAgentChat).sandboxId ?? null
}

/**
 * Get project path from chat
 */
export function getProjectPath(chat: AgentChat | null | undefined): string | undefined {
  return chat?.project?.path
}

/**
 * Get remote stats from chat (if available)
 * Handles both stat formats and returns normalized stats
 */
export function getRemoteStats(chat: AgentChat | null | undefined): {
  fileCount: number
  additions: number
  deletions: number
} | null {
  if (!chat || !isRemoteChat(chat) || !chat.remoteStats) return null

  const s = chat.remoteStats
  // Handle both old format (files_added/lines_added) and new format (fileCount/additions)
  const fileCount = s.fileCount ?? ((s.files_added || 0) + (s.files_modified || 0) + (s.files_removed || 0))
  const additions = s.additions ?? (s.lines_added || 0)
  const deletions = s.deletions ?? (s.lines_removed || 0)

  return { fileCount, additions, deletions }
}
