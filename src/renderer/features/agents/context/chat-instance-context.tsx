/**
 * ChatInstanceContext - Chat instance data and actions
 *
 * This context provides:
 * 1. Chat identification (chatId, worktreePath, sandboxId)
 * 2. Chat data from tRPC query
 * 3. Chat invalidation and refresh actions
 *
 * Usage:
 *   const { chatId, agentChat, worktreePath, invalidateChat } = useChatInstance()
 *
 * Note: This context should be mounted at the chat level, not globally.
 * Each ChatView instance should have its own provider.
 */

import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  type ReactNode,
} from "react"
import { useAtomValue } from "jotai"
import { trpc, trpcClient } from "../../../lib/trpc"
import { getQueryClient } from "../../../contexts/TRPCProvider"
import { useRemoteChat } from "../../../lib/hooks/use-remote-chats"
import { chatSourceModeAtom, selectedProjectAtom } from "../../../lib/atoms"
import type {
  AgentChat,
  LocalAgentChat,
  RemoteAgentChat,
  AgentSubChat,
  ChatProject,
} from "../types"
import { createLogger } from "../../../lib/logger"

const chatInstanceContextLog = createLogger("ChatInstanceContext")


// ============================================================================
// Types
// ============================================================================

export interface ChatInstanceContextValue {
  // Basic identifiers
  chatId: string
  worktreePath: string | null
  sandboxId: string | null
  projectPath: string | null

  // Chat data
  agentChat: AgentChat | null
  agentSubChats: AgentSubChat[]
  isLoading: boolean
  isRemoteChat: boolean
  isSandboxMode: boolean
  isPlayground: boolean

  // Project info
  project: ChatProject | undefined

  // Archive status
  isArchived: boolean

  // Actions
  invalidateChat: () => Promise<void>
  refreshBranch: () => Promise<void>
}

// ============================================================================
// Context
// ============================================================================

const ChatInstanceContext = createContext<ChatInstanceContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

export interface ChatInstanceProviderProps {
  chatId: string
  children: ReactNode
}

export function ChatInstanceProvider({
  chatId,
  children,
}: ChatInstanceProviderProps) {
  // Determine chat source mode
  const chatSourceMode = useAtomValue(chatSourceModeAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)

  // Local chat query
  const {
    data: localAgentChat,
    isLoading: isLocalLoading,
  } = trpc.agents.getAgentChat.useQuery(
    { chatId },
    { enabled: chatSourceMode === "local" }
  )

  // Remote chat query (only for sandbox mode)
  const {
    data: remoteAgentChat,
    isLoading: isRemoteLoading,
  } = useRemoteChat(chatSourceMode === "sandbox" ? chatId : null)

  // Merge local and remote chat data
  const agentChat = useMemo<AgentChat | null>(() => {
    if (chatSourceMode === "sandbox") {
      if (!remoteAgentChat) return null
      return {
        ...remoteAgentChat,
        createdAt: new Date(remoteAgentChat.created_at),
        updatedAt: new Date(remoteAgentChat.updated_at),
        archivedAt: null,
        projectId: null,
        worktreePath: null,
        branch: null,
        baseBranch: null,
        prUrl: null,
        prNumber: null,
        sandbox_id: remoteAgentChat.sandbox_id,
        sandboxId: remoteAgentChat.sandbox_id,
        isRemote: true as const,
        remoteStats: remoteAgentChat.stats,
        subChats:
          remoteAgentChat.subChats?.map((sc: any) => ({
            ...sc,
            mode: sc.mode as "plan" | "agent" | null | undefined,
            created_at: new Date(sc.created_at),
            updated_at: new Date(sc.updated_at),
          })) ?? [],
      } as RemoteAgentChat
    }
    return localAgentChat
      ? ({ ...localAgentChat, isRemote: false as const } as LocalAgentChat)
      : null
  }, [chatSourceMode, remoteAgentChat, localAgentChat])

  // Extract sub-chats
  const agentSubChats = useMemo<AgentSubChat[]>(() => {
    return (agentChat?.subChats ?? []) as AgentSubChat[]
  }, [agentChat?.subChats])

  // Derived values
  const isLoading =
    chatSourceMode === "local"
      ? isLocalLoading && !localAgentChat
      : isRemoteLoading && !remoteAgentChat

  const isRemote = agentChat?.isRemote === true
  const isSandbox = chatSourceMode === "sandbox" || !!agentChat?.sandbox_id
  const isPlayground = selectedProject?.isPlayground === true
  const isArchived = !!agentChat?.archivedAt

  // Get worktreePath and sandboxId
  const worktreePath =
    (agentChat?.worktreePath as string | null) ?? selectedProject?.path ?? null
  const sandboxId = agentChat?.sandbox_id ?? null
  const projectPath = agentChat?.project?.path ?? selectedProject?.path ?? null
  const project = agentChat?.project as ChatProject | undefined

  // Actions
  const invalidateChat = useCallback(async () => {
    const queryClient = getQueryClient()
    await queryClient.invalidateQueries({
      queryKey: [["agents", "getAgentChat"], { input: { chatId } }],
    })
  }, [chatId])

  const refreshBranch = useCallback(async () => {
    if (!worktreePath) return
    try {
      await trpcClient.changes.fetchRemote.mutate({ worktreePath })
      await invalidateChat()
    } catch (error) {
      chatInstanceContextLog.error("Failed to refresh branch:", error)
    }
  }, [worktreePath, invalidateChat])

  const value = useMemo<ChatInstanceContextValue>(
    () => ({
      chatId,
      worktreePath,
      sandboxId,
      projectPath,
      agentChat,
      agentSubChats,
      isLoading,
      isRemoteChat: isRemote,
      isSandboxMode: isSandbox,
      isPlayground,
      project,
      isArchived,
      invalidateChat,
      refreshBranch,
    }),
    [
      chatId,
      worktreePath,
      sandboxId,
      projectPath,
      agentChat,
      agentSubChats,
      isLoading,
      isRemote,
      isSandbox,
      isPlayground,
      project,
      isArchived,
      invalidateChat,
      refreshBranch,
    ]
  )

  return (
    <ChatInstanceContext.Provider value={value}>
      {children}
    </ChatInstanceContext.Provider>
  )
}

// ============================================================================
// Value Provider (inject pre-computed values, no internal queries)
// ============================================================================

export interface ChatInstanceValueProviderProps {
  value: ChatInstanceContextValue
  children: ReactNode
}

/**
 * Lightweight provider that accepts pre-computed values.
 * Use this when the parent component already has the data (e.g., ChatView).
 * Avoids duplicate tRPC queries that ChatInstanceProvider would create.
 */
export function ChatInstanceValueProvider({
  value,
  children,
}: ChatInstanceValueProviderProps) {
  return (
    <ChatInstanceContext.Provider value={value}>
      {children}
    </ChatInstanceContext.Provider>
  )
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Access chat instance context
 * @throws Error if used outside ChatInstanceProvider
 */
export function useChatInstance(): ChatInstanceContextValue {
  const context = useContext(ChatInstanceContext)
  if (!context) {
    throw new Error(
      "useChatInstance must be used within a ChatInstanceProvider"
    )
  }
  return context
}

/**
 * Access chat instance context safely (returns null if outside provider)
 */
export function useChatInstanceSafe(): ChatInstanceContextValue | null {
  return useContext(ChatInstanceContext)
}

/**
 * Get chat ID from context
 */
export function useChatId(): string {
  const { chatId } = useChatInstance()
  return chatId
}

/**
 * Get worktree path from context
 */
export function useWorktreePath(): string | null {
  const { worktreePath } = useChatInstance()
  return worktreePath
}

/**
 * Get agent chat data from context
 */
export function useAgentChat(): AgentChat | null {
  const { agentChat } = useChatInstance()
  return agentChat
}

/**
 * Check if current chat is remote
 */
export function useIsRemoteChat(): boolean {
  const { isRemoteChat } = useChatInstance()
  return isRemoteChat
}
