import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// MCP Server types
export type MCPServerStatus =
  | "connecting"
  | "connected"
  | "failed"
  | "timeout"
  | "retrying"
  | "needs-auth"
  | "pending"

export type MCPServerIcon = {
  src: string
  mimeType?: string
  sizes?: string[]
  theme?: "light" | "dark"
}

export type MCPServer = {
  name: string
  status: MCPServerStatus
  serverInfo?: {
    name: string
    version: string
    icons?: MCPServerIcon[]
  }
  error?: string
  retryCount?: number
  lastAttempt?: number
  lastSuccess?: number
  tools?: string[]
}

export type SessionInfo = {
  tools: string[]
  mcpServers: MCPServer[]
  plugins: { name: string; path: string }[]
  skills: string[]
}

// Session info from SDK init message
export const sessionInfoAtom = atomWithStorage<SessionInfo | null>(
  "hong-session-info",
  null,
  undefined,
  { getOnInit: true },
)

// Chat source toggle: "local" = worktree chats (SQLite), "sandbox" = remote sandbox chats
export type ChatSourceMode = "local" | "sandbox"

export const chatSourceModeAtom = atomWithStorage<ChatSourceMode>(
  "agents:chat-source-mode",
  "local",
  undefined,
  { getOnInit: true },
)

// DevTools unlock state
export const devToolsUnlockedAtom = atom<boolean>(false)

// Disabled MCP servers per project path
export const disabledMcpServersAtom = atomWithStorage<Record<string, string[]>>(
  "hong:disabled-mcp-servers",
  {},
)

// MCP Approval Dialog
export type PendingMcpApproval = {
  pluginSource: string
  serverName: string
  identifier: string
  config: Record<string, unknown>
}

export const mcpApprovalDialogOpenAtom = atom<boolean>(false)
export const pendingMcpApprovalsAtom = atom<PendingMcpApproval[]>([])
