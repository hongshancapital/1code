/**
 * SubChatContext - Sub-chat state and streaming
 *
 * This context provides:
 * 1. Current sub-chat data (id, name, mode)
 * 2. Streaming status
 * 3. Messages access
 *
 * Usage:
 *   const { subChatId, mode, isStreaming, messages } = useSubChat()
 *
 * Note: This is a lightweight context that provides sub-chat state.
 * The heavy lifting (getOrCreateChat, message sending) is handled by
 * MessageSendContext which depends on this context.
 */

import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  type ReactNode,
} from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useShallow } from "zustand/react/shallow"
import { useAgentSubChatStore, type SubChatMeta } from "../stores/sub-chat-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import { subChatModeAtomFamily, defaultAgentModeAtom, type AgentMode } from "../atoms"
import { useChatInstance } from "./chat-instance-context"

// ============================================================================
// Types
// ============================================================================

export interface SubChatContextValue {
  // Sub-chat identification
  subChatId: string
  subChat: SubChatMeta | null

  // Mode
  mode: AgentMode
  setMode: (mode: AgentMode) => void

  // Streaming status
  isStreaming: boolean
  streamingStatus: "idle" | "streaming" | "paused"

  // Sub-chat list (from store)
  allSubChats: SubChatMeta[]
  openSubChatIds: string[]
  pinnedSubChatIds: string[]

  // Actions
  setActiveSubChat: (subChatId: string) => void
  addToOpenSubChats: (subChatId: string) => void
  removeFromOpenSubChats: (subChatId: string) => void
  togglePinSubChat: (subChatId: string) => void
}

// ============================================================================
// Context
// ============================================================================

const SubChatContext = createContext<SubChatContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

export interface SubChatProviderProps {
  subChatId: string
  children: ReactNode
}

export function SubChatProvider({ subChatId, children }: SubChatProviderProps) {
  // Get agentSubChats from parent context
  const { agentSubChats } = useChatInstance()

  // Store state
  const {
    allSubChats,
    openSubChatIds,
    pinnedSubChatIds,
    setActiveSubChat,
    addToOpenSubChats,
    removeFromOpenSubChats,
    togglePinSubChat,
    updateSubChatMode,
  } = useAgentSubChatStore(
    useShallow((state) => ({
      allSubChats: state.allSubChats,
      openSubChatIds: state.openSubChatIds,
      pinnedSubChatIds: state.pinnedSubChatIds,
      setActiveSubChat: state.setActiveSubChat,
      addToOpenSubChats: state.addToOpenSubChats,
      removeFromOpenSubChats: state.removeFromOpenSubChats,
      togglePinSubChat: state.togglePinSubChat,
      updateSubChatMode: state.updateSubChatMode,
    }))
  )

  // Get streaming status
  const isStreaming = useStreamingStatusStore(
    (state) => state.isStreaming(subChatId)
  )

  // Determine streaming status
  const streamingStatus = useMemo<"idle" | "streaming" | "paused">(() => {
    if (isStreaming) return "streaming"
    return "idle"
  }, [isStreaming])

  // Get sub-chat data
  const subChat = useMemo(() => {
    // First try store (has latest name updates)
    const fromStore = allSubChats.find((sc) => sc.id === subChatId)
    if (fromStore) return fromStore

    // Fallback to agentSubChats from tRPC
    const fromQuery = agentSubChats.find((sc) => sc.id === subChatId)
    if (fromQuery) {
      return {
        id: fromQuery.id,
        name: fromQuery.name ?? "New Chat",
        mode: fromQuery.mode ?? undefined,
        created_at: fromQuery.created_at?.toString(),
        updated_at: fromQuery.updated_at?.toString(),
      } as SubChatMeta
    }

    return null
  }, [subChatId, allSubChats, agentSubChats])

  // Per-subChat mode atom
  const modeAtom = useMemo(() => subChatModeAtomFamily(subChatId), [subChatId])
  const [mode, setModeAtom] = useAtom(modeAtom)
  const defaultAgentMode = useAtomValue(defaultAgentModeAtom)

  // Effective mode (use atom mode, fallback to subChat mode, then default)
  const effectiveMode: AgentMode = mode || subChat?.mode || defaultAgentMode

  // Set mode handler (updates both atom and store)
  const setMode = useCallback(
    (newMode: AgentMode) => {
      setModeAtom(newMode)
      updateSubChatMode(subChatId, newMode)
    },
    [subChatId, setModeAtom, updateSubChatMode]
  )

  const value = useMemo<SubChatContextValue>(
    () => ({
      subChatId,
      subChat,
      mode: effectiveMode,
      setMode,
      isStreaming,
      streamingStatus,
      allSubChats,
      openSubChatIds,
      pinnedSubChatIds,
      setActiveSubChat,
      addToOpenSubChats,
      removeFromOpenSubChats,
      togglePinSubChat,
    }),
    [
      subChatId,
      subChat,
      effectiveMode,
      setMode,
      isStreaming,
      streamingStatus,
      allSubChats,
      openSubChatIds,
      pinnedSubChatIds,
      setActiveSubChat,
      addToOpenSubChats,
      removeFromOpenSubChats,
      togglePinSubChat,
    ]
  )

  return (
    <SubChatContext.Provider value={value}>{children}</SubChatContext.Provider>
  )
}

// ============================================================================
// Gate Component
// ============================================================================

/**
 * Gate component that only renders children when subChatId is valid
 */
export function SubChatGate({
  subChatId,
  children,
}: {
  subChatId: string | null
  children: ReactNode
}) {
  if (!subChatId) return null
  return <SubChatProvider subChatId={subChatId}>{children}</SubChatProvider>
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Access sub-chat context
 * @throws Error if used outside SubChatProvider
 */
export function useSubChat(): SubChatContextValue {
  const context = useContext(SubChatContext)
  if (!context) {
    throw new Error("useSubChat must be used within a SubChatProvider")
  }
  return context
}

/**
 * Access sub-chat context safely (returns null if outside provider)
 */
export function useSubChatSafe(): SubChatContextValue | null {
  return useContext(SubChatContext)
}

/**
 * Get sub-chat ID from context
 */
export function useSubChatId(): string {
  const { subChatId } = useSubChat()
  return subChatId
}

/**
 * Get sub-chat mode from context
 */
export function useSubChatMode(): AgentMode {
  const { mode } = useSubChat()
  return mode
}

/**
 * Check if current sub-chat is streaming
 */
export function useIsStreaming(): boolean {
  const { isStreaming } = useSubChat()
  return isStreaming
}
