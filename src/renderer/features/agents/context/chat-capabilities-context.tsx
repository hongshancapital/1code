/**
 * ChatCapabilitiesContext - Chat feature capabilities
 *
 * This context provides:
 * 1. Chat type detection (remote, sandbox, playground)
 * 2. Feature capability flags (canOpenDiff, canOpenTerminal, etc.)
 * 3. Git-related feature visibility
 *
 * Usage:
 *   const { canOpenDiff, hideGitFeatures, isRemoteChat } = useChatCapabilities()
 *
 * Note: This context depends on ChatInstanceContext and ProjectModeContext.
 * It consolidates capability checks that were previously scattered across components.
 */

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { isDesktopApp } from "../../../lib/utils/platform"
import { useChatInstance } from "./chat-instance-context"
import { useProjectMode } from "./project-mode-context"

// ============================================================================
// Types
// ============================================================================

export interface ChatCapabilitiesContextValue {
  // Chat type
  isRemoteChat: boolean
  isSandboxMode: boolean
  isPlayground: boolean

  // Git capabilities
  hideGitFeatures: boolean // Master switch for all git features
  canOpenDiff: boolean // Can open diff sidebar/view
  canShowDiffButton: boolean // Can show changes button (may show stats even if can't open)
  canOpenTerminal: boolean // Can open terminal
  canOpenPreview: boolean // Can open preview sidebar (sandbox with port)

  // PR capabilities
  canCreatePr: boolean // Can create a PR
  canMergePr: boolean // Can merge a PR
  hasPrNumber: boolean // Has an associated PR

  // Repository info
  repository: { owner: string; name: string } | null
  branchName: string | null
  baseBranch: string | null
  isPrOpen: boolean

  // Preview info
  previewPort: number | null
  isQuickSetup: boolean
}

// ============================================================================
// Context
// ============================================================================

const ChatCapabilitiesContext =
  createContext<ChatCapabilitiesContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

export interface ChatCapabilitiesProviderProps {
  /** Override hideGitFeatures from props (used by parent components) */
  hideGitFeaturesOverride?: boolean
  children: ReactNode
}

export function ChatCapabilitiesProvider({
  hideGitFeaturesOverride,
  children,
}: ChatCapabilitiesProviderProps) {
  // Get data from parent contexts
  const {
    agentChat,
    worktreePath,
    sandboxId,
    isRemoteChat,
    isSandboxMode,
    isPlayground,
  } = useChatInstance()

  const { projectMode, hideGitWidgets } = useProjectMode()

  // Extract metadata
  const meta = agentChat?.meta as {
    repository?: string
    branch?: string
    sandboxConfig?: { port?: number; quickSetup?: boolean }
  } | undefined

  // Parse repository info
  const repository = useMemo(() => {
    const repoString = meta?.repository
    if (!repoString) return null
    const parts = repoString.split("/")
    if (parts.length !== 2) return null
    return { owner: parts[0]!, name: parts[1]! }
  }, [meta?.repository])

  // Git/PR info
  const branchName = (agentChat?.branch as string | null) ?? meta?.branch ?? null
  const baseBranch = (agentChat?.baseBranch as string | null) ?? null
  const prUrl = agentChat?.prUrl as string | null
  const prNumber = agentChat?.prNumber as number | null
  const hasPrNumber = !!prNumber
  const isPrOpen = !!prUrl

  // Preview info
  const previewPort = meta?.sandboxConfig?.port ?? null
  const isQuickSetup = meta?.sandboxConfig?.quickSetup ?? false

  // Capability calculations
  const hideGitFeatures = hideGitFeaturesOverride ?? hideGitWidgets

  // Can show changes button in header (may just show stats without opening)
  const canShowDiffButton = !!worktreePath || !!sandboxId

  // Can actually open diff sidebar/view
  // Desktop remote chats (sandboxId without worktree) cannot open diff sidebar
  const canOpenDiff = !!worktreePath || (!!sandboxId && !isDesktopApp())

  // Can open terminal (requires local worktree)
  const canOpenTerminal = !!worktreePath

  // Can open preview (sandbox with port, not quick setup)
  const canOpenPreview = !!(sandboxId && !isQuickSetup && previewPort)

  // PR capabilities
  const canCreatePr = !!worktreePath && !!branchName && !hasPrNumber
  const canMergePr = !!worktreePath && hasPrNumber && isPrOpen

  const value = useMemo<ChatCapabilitiesContextValue>(
    () => ({
      // Chat type
      isRemoteChat,
      isSandboxMode,
      isPlayground,

      // Git capabilities
      hideGitFeatures,
      canOpenDiff: hideGitFeatures ? false : canOpenDiff,
      canShowDiffButton: hideGitFeatures ? false : canShowDiffButton,
      canOpenTerminal: hideGitFeatures ? false : canOpenTerminal,
      canOpenPreview: hideGitFeatures ? false : canOpenPreview,

      // PR capabilities
      canCreatePr,
      canMergePr,
      hasPrNumber,

      // Repository info
      repository,
      branchName,
      baseBranch,
      isPrOpen,

      // Preview info
      previewPort,
      isQuickSetup,
    }),
    [
      isRemoteChat,
      isSandboxMode,
      isPlayground,
      hideGitFeatures,
      canOpenDiff,
      canShowDiffButton,
      canOpenTerminal,
      canOpenPreview,
      canCreatePr,
      canMergePr,
      hasPrNumber,
      repository,
      branchName,
      baseBranch,
      isPrOpen,
      previewPort,
      isQuickSetup,
    ]
  )

  return (
    <ChatCapabilitiesContext.Provider value={value}>
      {children}
    </ChatCapabilitiesContext.Provider>
  )
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Access chat capabilities context
 * @throws Error if used outside ChatCapabilitiesProvider
 */
export function useChatCapabilities(): ChatCapabilitiesContextValue {
  const context = useContext(ChatCapabilitiesContext)
  if (!context) {
    throw new Error(
      "useChatCapabilities must be used within a ChatCapabilitiesProvider"
    )
  }
  return context
}

/**
 * Access chat capabilities context safely (returns null if outside provider)
 */
export function useChatCapabilitiesSafe(): ChatCapabilitiesContextValue | null {
  return useContext(ChatCapabilitiesContext)
}

/**
 * Check if git features should be hidden
 */
export function useHideGitFeatures(): boolean {
  const { hideGitFeatures } = useChatCapabilities()
  return hideGitFeatures
}

/**
 * Check if diff can be opened
 */
export function useCanOpenDiff(): boolean {
  const { canOpenDiff } = useChatCapabilities()
  return canOpenDiff
}

/**
 * Check if terminal can be opened
 */
export function useCanOpenTerminal(): boolean {
  const { canOpenTerminal } = useChatCapabilities()
  return canOpenTerminal
}

/**
 * Check if preview can be opened
 */
export function useCanOpenPreview(): boolean {
  const { canOpenPreview } = useChatCapabilities()
  return canOpenPreview
}
