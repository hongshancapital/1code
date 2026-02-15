/**
 * SubChatTabsRenderer - Keep-alive tab rendering for sub-chats
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Handles the rendering of multiple sub-chat tabs with:
 * - GPU-accelerated visibility switching
 * - Keep-alive behavior (tabs stay mounted when hidden)
 * - Workspace isolation validation
 */

import { memo } from "react"
import type { Chat } from "@ai-sdk/react"
import { useAtomValue } from "jotai"
import { IconSpinner } from "../../../icons/icons"
import { getFirstSubChatId } from "../main/chat-utils"
import { useChatInstance } from "../context/chat-instance-context"
import { isFullscreenAtom } from "../../../lib/atoms"
import { agentsSubChatsSidebarModeAtom } from "../atoms"

/**
 * Props for the ChatViewInner component (passed through)
 */
export interface ChatViewInnerProps {
  chat: Chat<any>
  subChatId: string
  parentChatId: string
  isFirstSubChat: boolean
  onAutoRename: (userMessage: string, subChatId: string) => void
  onCreateNewSubChat?: () => void
  refreshDiff?: () => void
  teamId?: string
  repository?: string
  streamId?: string | null
  isMobile?: boolean
  sandboxSetupStatus?: "cloning" | "ready" | "error"
  sandboxSetupError?: string
  onRetrySetup?: () => void
  isSubChatsSidebarOpen?: boolean
  sandboxId?: string
  projectPath?: string
  isArchived?: boolean
  onRestoreWorkspace?: () => void
  existingPrUrl?: string | null
  isActive?: boolean
}

/**
 * SubChat data structure
 */
export interface SubChatData {
  id: string
  name?: string | null
  mode?: "plan" | "agent" | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
  messages?: any
  stream_id?: string | null
}

export interface SubChatTabsRendererProps {
  /** IDs of tabs to render (keep-alive pool) */
  tabsToRender: string[]
  /** Currently active sub-chat ID */
  activeSubChatId: string | null
  /** SubChats from server data (authoritative) */
  agentSubChats: SubChatData[]
  /** SubChats from local store (for optimistic updates) */
  allSubChats: Array<{ id: string }>
  /** Whether local chat data is loading */
  isLocalChatLoading: boolean
  /** Function to get or create Chat instance for a subChatId */
  getOrCreateChat: (subChatId: string) => Chat<any> | null
  /** Handler for auto-rename */
  handleAutoRename: (userMessage: string, subChatId: string) => void
  /** Handler for creating new sub-chat */
  handleCreateNewSubChat: () => void
  /** Selected team ID */
  selectedTeamId: string | null
  /** Repository string for PR operations */
  repositoryString?: string
  /** Handler for restoring archived workspace */
  handleRestoreWorkspace: () => void
  /** Existing PR URL if any */
  existingPrUrl?: string | null
  /** ChatViewInner component to render */
  ChatViewInnerComponent: React.ComponentType<ChatViewInnerProps>
  /** Optional collapsed indicator element */
  collapsedIndicator?: React.ReactNode
}

/**
 * GPU-accelerated visibility styles for keep-alive tabs
 */
const getTabVisibilityStyles = (isActive: boolean): React.CSSProperties => ({
  // GPU-accelerated visibility switching (native feel)
  // transform + opacity is faster than visibility for GPU
  transform: isActive ? "translateZ(0)" : "translateZ(0) scale(0.98)",
  opacity: isActive ? 1 : 0,
  // Prevent pointer events on hidden tabs
  pointerEvents: isActive ? "auto" : "none",
  // GPU layer hints
  willChange: "transform, opacity",
  // Isolate layout - changes inside don't affect other tabs
  contain: "layout style paint",
})

/**
 * Loading spinner component
 */
const LoadingSpinner = memo(function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-full">
      <IconSpinner className="h-6 w-6 animate-spin" />
    </div>
  )
})

/**
 * Single tab wrapper with visibility handling
 */
interface TabWrapperProps {
  subChatId: string
  isActive: boolean
  children: React.ReactNode
}

const TabWrapper = memo(function TabWrapper({
  subChatId,
  isActive,
  children,
}: TabWrapperProps) {
  return (
    <div
      className="absolute inset-0 flex flex-col"
      style={getTabVisibilityStyles(isActive)}
      aria-hidden={!isActive}
    >
      {children}
    </div>
  )
})

/**
 * SubChatTabsRenderer - renders all keep-alive tabs with proper visibility
 */
export const SubChatTabsRenderer = memo(function SubChatTabsRenderer({
  tabsToRender,
  activeSubChatId,
  agentSubChats,
  allSubChats,
  isLocalChatLoading,
  getOrCreateChat,
  handleAutoRename,
  handleCreateNewSubChat,
  selectedTeamId,
  repositoryString,
  handleRestoreWorkspace,
  existingPrUrl,
  ChatViewInnerComponent,
}: SubChatTabsRendererProps) {
  // Self-sourced state from context/atoms
  const { chatId, worktreePath, sandboxId, isArchived } = useChatInstance()
  const isMobileFullscreen = useAtomValue(isFullscreenAtom) ?? false
  const subChatsSidebarMode = useAtomValue(agentsSubChatsSidebarModeAtom)

  // Loading gate: 仅在 workspace 首次加载时显示 spinner
  // 切换 subchat tab 时不阻塞——keep-alive tabs 的 Chat 已在 chatRegistry 中
  // placeholderData: keepPreviousData 保证消息数据切 tab 时不变 undefined
  if (isLocalChatLoading) {
    return <LoadingSpinner />
  }

  return (
    <>
      {tabsToRender.map((subChatId) => {
        const chat = getOrCreateChat(subChatId)
        const isActive = subChatId === activeSubChatId
        const isFirstSubChat = getFirstSubChatId(agentSubChats) === subChatId

        // Defense in depth: double-check workspace ownership
        // Use agentSubChats (server data) as primary source, fall back to allSubChats for optimistic updates
        // This fixes the race condition where allSubChats is empty after setChatId but before setAllSubChats
        // When both sources are empty (data still loading), skip this check - tabsToRender already
        // handles this case by trusting localStorage when no data has loaded yet.
        const hasWorkspaceData = agentSubChats.length > 0 || allSubChats.length > 0
        const belongsToWorkspace =
          !hasWorkspaceData ||
          agentSubChats.some((sc) => sc.id === subChatId) ||
          allSubChats.some((sc) => sc.id === subChatId)

        if (!chat || !belongsToWorkspace) return null

        return (
          <TabWrapper key={subChatId} subChatId={subChatId} isActive={isActive}>
            <ChatViewInnerComponent
              chat={chat}
              subChatId={subChatId}
              parentChatId={chatId}
              isFirstSubChat={isFirstSubChat}
              onAutoRename={handleAutoRename}
              onCreateNewSubChat={handleCreateNewSubChat}
              teamId={selectedTeamId || undefined}
              repository={repositoryString}
              streamId={null}
              isMobile={isMobileFullscreen}
              isSubChatsSidebarOpen={subChatsSidebarMode === "sidebar"}
              sandboxId={sandboxId}
              projectPath={worktreePath || undefined}
              isArchived={isArchived}
              onRestoreWorkspace={handleRestoreWorkspace}
              existingPrUrl={existingPrUrl}
              isActive={isActive}
            />
          </TabWrapper>
        )
      })}
    </>
  )
})

/**
 * Container component that wraps SubChatTabsRenderer with proper layout
 */
export interface SubChatTabsContainerProps extends SubChatTabsRendererProps {
  /** Whether to show the container (tabsToRender.length > 0 && agentChat exists) */
  show: boolean
}

export const SubChatTabsContainer = memo(function SubChatTabsContainer({
  show,
  collapsedIndicator,
  ...rendererProps
}: SubChatTabsContainerProps) {
  if (!show) {
    return null
  }

  return (
    <div className="relative flex-1 min-h-0 flex">
      {/* Collapsed indicator column - occupies its own space in left */}
      {collapsedIndicator && (
        <div className="shrink-0 pl-2">{collapsedIndicator}</div>
      )}
      {/* Chat tabs container */}
      <div className="relative flex-1 min-h-0">
        <SubChatTabsRenderer {...rendererProps} collapsedIndicator={collapsedIndicator} />
      </div>
    </div>
  )
})
