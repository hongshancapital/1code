/**
 * Remote API - wrapper around tRPC client for web backend
 * Provides clean interface for fetching remote sandbox data
 */
import { remoteTrpc } from "./remote-trpc"

// API base URL - dynamically fetched from main process
let API_BASE: string | null = null

async function getApiBase(): Promise<string> {
  if (!API_BASE) {
    if (!window.desktopApi?.getApiBaseUrl) {
      throw new Error("Desktop API not available")
    }
    API_BASE = await window.desktopApi.getApiBaseUrl()
  }
  return API_BASE
}

// Re-export types for convenience
export type Team = {
  id: string
  name: string
  slug?: string
}

export type RemoteChat = {
  id: string
  name: string
  sandbox_id: string | null
  meta: {
    repository?: string
    branch?: string | null
    originalSandboxId?: string | null
    isQuickSetup?: boolean
    isPublicImport?: boolean
  } | null
  created_at: string
  updated_at: string
  archived_at?: string | null
  stats: { fileCount: number; additions: number; deletions: number } | null
}

export type RemoteSubChat = {
  id: string
  name: string
  mode: string
  messages: unknown[]
  stream_id: string | null
  created_at: string
  updated_at: string
}

export type RemoteChatWithSubChats = RemoteChat & {
  subChats: RemoteSubChat[]
}

export const remoteApi = {
  /**
   * Fetch user's teams (same as web)
   * [CLOUD DISABLED] Returns empty array as cloud backend is not available
   */
  async getTeams(): Promise<Team[]> {
    // [CLOUD DISABLED] remoteTrpc is stubbed
    // const teams = await remoteTrpc.teams.getUserTeams.query()
    // return teams.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }))
    return []
  },

  /**
   * [CLOUD DISABLED] Fetch all agent chats for a team
   */
  async getAgentChats(_teamId: string): Promise<RemoteChat[]> {
    return []
  },

  /**
   * [CLOUD DISABLED] Fetch a single agent chat with all sub-chats
   */
  async getAgentChat(_chatId: string): Promise<RemoteChatWithSubChats> {
    throw new Error("Cloud backend is not available")
  },

  /**
   * [CLOUD DISABLED] Fetch archived chats for a team
   */
  async getArchivedChats(_teamId: string): Promise<RemoteChat[]> {
    return []
  },

  /**
   * [CLOUD DISABLED] Archive a chat
   */
  async archiveChat(_chatId: string): Promise<void> {},

  /**
   * [CLOUD DISABLED] Archive multiple chats at once
   */
  async archiveChatsBatch(_chatIds: string[]): Promise<{ archivedCount: number }> {
    return { archivedCount: 0 }
  },

  /**
   * [CLOUD DISABLED] Restore a chat from archive
   */
  async restoreChat(_chatId: string): Promise<void> {},

  /**
   * [CLOUD DISABLED] Rename a sub-chat
   */
  async renameSubChat(_subChatId: string, _name: string): Promise<void> {},

  /**
   * [CLOUD DISABLED] Rename a chat (workspace)
   */
  async renameChat(_chatId: string, _name: string): Promise<void> {},

  /**
   * Get diff from a sandbox (via REST endpoint with signedFetch)
   */
  async getSandboxDiff(sandboxId: string): Promise<{ diff: string }> {
    if (!window.desktopApi?.signedFetch) {
      throw new Error("Desktop API not available")
    }
    const apiBase = await getApiBase()
    const result = await window.desktopApi.signedFetch(
      `${apiBase}/api/agents/sandbox/${sandboxId}/diff`
    )
    if (!result.ok) {
      throw new Error(result.error || `Failed to fetch diff: ${result.status}`)
    }
    return result.data as { diff: string }
  },

  /**
   * Get file content from a sandbox (via REST endpoint with signedFetch)
   */
  async getSandboxFile(sandboxId: string, path: string): Promise<{ content: string }> {
    if (!window.desktopApi?.signedFetch) {
      throw new Error("Desktop API not available")
    }
    const apiBase = await getApiBase()
    const result = await window.desktopApi.signedFetch(
      `${apiBase}/api/agents/sandbox/${sandboxId}/files?path=${encodeURIComponent(path)}`
    )
    if (!result.ok) {
      throw new Error(result.error || `Failed to fetch file: ${result.status}`)
    }
    return result.data as { content: string }
  },
}
