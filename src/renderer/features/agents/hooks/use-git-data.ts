/**
 * useGitData - Git status and branch data management
 *
 * Consolidates git-related queries and derived state from ChatView:
 * - Branch data query
 * - Git status query (staged, unstaged, untracked)
 * - PR status query
 * - Sync counts (push/pull)
 * - Window focus refetch behavior
 *
 * This hook encapsulates the git data fetching logic to reduce
 * complexity in ChatView and make git operations more maintainable.
 */

import { useCallback, useEffect, useMemo } from "react"
import { useAtomValue } from "jotai"
import { trpc } from "../../../lib/trpc"
import { diffSidebarOpenAtomFamily } from "../atoms/index"

export interface GitDataOptions {
  chatId: string
  worktreePath: string | null
  /** Called when pending diff changes are detected */
  onPendingDiffChange?: (hasPending: boolean) => void
}

export interface GitStatusData {
  staged?: Array<{ path: string; status?: string }>
  unstaged?: Array<{ path: string; status?: string }>
  untracked?: Array<{ path: string }>
  pushCount?: number
  pullCount?: number
  hasUpstream?: boolean
  currentBranch?: string
}

export interface BranchData {
  current?: string
  baseBranch?: string
  branches?: string[]
}

export interface PrStatusData {
  pr?: {
    state?: "open" | "draft" | "merged" | "closed"
    mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN"
    number?: number
    url?: string
  }
}

export interface GitDataResult {
  // Branch data
  branchData: BranchData | undefined
  currentBranch: string | undefined

  // Git status
  gitStatus: GitStatusData | undefined
  isGitStatusLoading: boolean
  refetchGitStatus: () => void

  // PR status
  prStatusData: PrStatusData | undefined
  isPrStatusLoading: boolean
  prState: "open" | "draft" | "merged" | "closed" | undefined
  prMergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN" | undefined
  hasMergeConflicts: boolean
  isPrOpen: boolean

  // Derived state
  hasUncommittedChanges: boolean
  syncCounts: {
    pushCount: number
    pullCount: number
    hasUpstream: boolean
  }

  // Refresh handlers
  handleRefreshGitStatus: () => void
}

export function useGitData({
  chatId,
  worktreePath,
  onPendingDiffChange,
}: GitDataOptions): GitDataResult {
  // Check if diff sidebar is open (per-chat)
  const diffSidebarAtom = useMemo(
    () => diffSidebarOpenAtomFamily(chatId),
    [chatId]
  )
  const isDiffSidebarOpen = useAtomValue(diffSidebarAtom)

  // ==========================================================================
  // Queries
  // ==========================================================================

  // Fetch branch data for diff sidebar header
  const { data: branchData } = trpc.changes.getBranches.useQuery(
    { worktreePath: worktreePath || "" },
    { enabled: !!worktreePath }
  )

  // Fetch git status for sync counts (pushCount, pullCount, hasUpstream)
  const {
    data: gitStatus,
    refetch: refetchGitStatus,
    isLoading: isGitStatusLoading,
  } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath || "" },
    { enabled: !!worktreePath && isDiffSidebarOpen, staleTime: 30000 }
  )

  // Get PR status when PR exists - need agentChat to check prNumber
  // This query is enabled externally based on hasPrNumber prop
  const hasPrNumber = false // Will be passed as option in future refactor
  const {
    data: prStatusData,
    isLoading: isPrStatusLoading,
  } = trpc.chats.getPrStatus.useQuery(
    { chatId },
    {
      enabled: hasPrNumber,
      refetchInterval: 30000, // Poll every 30 seconds
    }
  )

  // ==========================================================================
  // Derived State
  // ==========================================================================

  const prState = prStatusData?.pr?.state as
    | "open"
    | "draft"
    | "merged"
    | "closed"
    | undefined
  const prMergeable = prStatusData?.pr?.mergeable
  const hasMergeConflicts = prMergeable === "CONFLICTING"
  // PR is open if state is explicitly "open" or "draft"
  // When PR status is still loading, assume open to avoid showing wrong button
  const isPrOpen =
    hasPrNumber && (isPrStatusLoading || prState === "open" || prState === "draft")

  const currentBranch = branchData?.current

  const hasUncommittedChanges = useMemo(() => {
    if (!gitStatus) return false
    return (
      (gitStatus.staged?.length ?? 0) > 0 ||
      (gitStatus.unstaged?.length ?? 0) > 0 ||
      (gitStatus.untracked?.length ?? 0) > 0
    )
  }, [gitStatus])

  const syncCounts = useMemo(
    () => ({
      pushCount: gitStatus?.pushCount ?? 0,
      pullCount: gitStatus?.pullCount ?? 0,
      hasUpstream: gitStatus?.hasUpstream ?? false,
    }),
    [gitStatus]
  )

  // ==========================================================================
  // Effects
  // ==========================================================================

  // Refetch git status when window gains focus (but not diff - let user manually refresh)
  useEffect(() => {
    if (!worktreePath || !isDiffSidebarOpen) return

    const handleWindowFocus = () => {
      // Refetch git status (sync counts, etc.)
      refetchGitStatus()
      // Don't auto-refresh diff - just mark as pending so user can choose when to refresh
      // This prevents disrupting the user's review when switching windows
      onPendingDiffChange?.(true)
    }

    window.addEventListener("focus", handleWindowFocus)
    return () => window.removeEventListener("focus", handleWindowFocus)
  }, [worktreePath, isDiffSidebarOpen, refetchGitStatus, onPendingDiffChange])

  // ==========================================================================
  // Handlers
  // ==========================================================================

  const handleRefreshGitStatus = useCallback(() => {
    refetchGitStatus()
  }, [refetchGitStatus])

  return {
    // Branch data
    branchData,
    currentBranch,

    // Git status
    gitStatus,
    isGitStatusLoading,
    refetchGitStatus,

    // PR status
    prStatusData,
    isPrStatusLoading,
    prState,
    prMergeable,
    hasMergeConflicts,
    isPrOpen,

    // Derived state
    hasUncommittedChanges,
    syncCounts,

    // Handlers
    handleRefreshGitStatus,
  }
}
