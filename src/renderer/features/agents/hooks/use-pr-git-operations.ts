/**
 * usePrGitOperations - Manages PR/Git operation mutations and handlers
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Handles:
 * - PR status polling
 * - Create PR (direct and AI-assisted)
 * - Merge PR
 * - Commit to PR
 * - Review (AI-assisted)
 * - Fix merge conflicts
 * - Git status and branch data
 * - Restore archived workspace
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { toast } from "sonner"
import { api } from "../../../lib/mock-api"
import { trpc, trpcClient } from "../../../lib/trpc"
import {
  isCreatingPrAtom,
  pendingPrMessageAtom,
  pendingReviewMessageAtom,
  pendingConflictResolutionMessageAtom,
  filteredSubChatIdAtom,
} from "../atoms"
import { generateCommitToPrMessage, generatePrMessage, generateReviewMessage } from "../utils/pr-message"
import { useDocumentComments } from "./use-document-comments"
import type { AgentDiffViewRef } from "../ui/agent-diff-view"
import type { CachedParsedDiffFile } from "../atoms"
import { createLogger } from "../../../lib/logger"

const activeChatLog = createLogger("active-chat")


export interface UsePrGitOperationsOptions {
  chatId: string
  worktreePath: string | null
  isDiffSidebarOpen: boolean
  activeSubChatId: string | null
  activeSubChatIdForPlan: string | null
  agentChat: { prNumber?: number | null; [key: string]: any } | null
  setHasPendingDiffChanges: (v: boolean) => void
  parsedFileDiffs: CachedParsedDiffFile[] | null
  setParsedFileDiffs: (v: CachedParsedDiffFile[]) => void
  setPrefetchedFileContents: (v: Record<string, string>) => void
  setDiffContent: (v: string | null) => void
  setDiffStats: (v: any) => void
  fetchDiffStats: () => void
  diffViewRef: React.RefObject<AgentDiffViewRef | null>
  setIsPlanSidebarOpen: (v: boolean) => void
  setIsDiffSidebarOpen: (v: boolean) => void
}

export function usePrGitOperations({
  chatId,
  worktreePath,
  isDiffSidebarOpen,
  activeSubChatId,
  activeSubChatIdForPlan,
  agentChat,
  setHasPendingDiffChanges,
  parsedFileDiffs,
  setParsedFileDiffs,
  setPrefetchedFileContents,
  setDiffContent,
  setDiffStats,
  fetchDiffStats,
  diffViewRef,
  setIsPlanSidebarOpen,
  setIsDiffSidebarOpen,
}: UsePrGitOperationsOptions) {
  const utils = api.useUtils()
  const trpcUtils = trpc.useUtils()

  // PR creation loading state
  const [isCreatingPr, setIsCreatingPr] = useAtom(isCreatingPrAtom)
  // Review loading state
  const [isReviewing, setIsReviewing] = useState(false)
  // Commit to PR loading state
  const [isCommittingToPr, setIsCommittingToPr] = useState(false)
  // Subchat filter setter
  const setFilteredSubChatId = useSetAtom(filteredSubChatIdAtom)

  // Pending message atoms
  const setPendingPrMessage = useSetAtom(pendingPrMessageAtom)
  const setPendingReviewMessage = useSetAtom(pendingReviewMessageAtom)
  const setPendingConflictResolutionMessage = useSetAtom(pendingConflictResolutionMessageAtom)

  // --- PR Status ---
  const hasPrNumber = !!agentChat?.prNumber
  const { data: prStatusData, isLoading: isPrStatusLoading } = trpc.chats.getPrStatus.useQuery(
    { chatId },
    {
      enabled: hasPrNumber,
      refetchInterval: 30000,
    }
  )
  const prState = prStatusData?.pr?.state as "open" | "draft" | "merged" | "closed" | undefined
  const prMergeable = prStatusData?.pr?.mergeable
  const hasMergeConflicts = prMergeable === "CONFLICTING"
  const isPrOpen = hasPrNumber && (isPrStatusLoading || prState === "open" || prState === "draft")

  // --- Mutations ---

  // Direct PR creation (push branch and open GitHub)
  const { data: gitStatus, refetch: refetchGitStatus, isLoading: isGitStatusLoading } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath || "" },
    { enabled: !!worktreePath && isDiffSidebarOpen, staleTime: 30000 }
  )

  const createPrMutation = trpc.changes.createPR.useMutation({
    onSuccess: () => {
      toast.success("Opening GitHub to create PR...", { position: "top-center" })
      refetchGitStatus()
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create PR", { position: "top-center" })
    },
  })

  // Sync from main mutation (for resolving merge conflicts)
  const mergeFromDefaultMutation = trpc.changes.mergeFromDefault.useMutation({
    onSuccess: () => {
      toast.success("Branch synced with main. You can now merge the PR.", { position: "top-center" })
      trpcUtils.chats.getPrStatus.invalidate({ chatId })
    },
    onError: (error) => {
      toast.error(error.message || "Failed to sync with main", { position: "top-center" })
    },
  })

  const mergePrMutation = trpc.chats.mergePr.useMutation({
    onSuccess: () => {
      toast.success("PR merged successfully!", { position: "top-center" })
      trpcUtils.chats.getPrStatus.invalidate({ chatId })
    },
    onError: (error) => {
      const errorMsg = error.message || "Failed to merge PR"
      if (errorMsg.includes("MERGE_CONFLICT")) {
        toast.error(
          "PR has merge conflicts. Sync with main to resolve.",
          {
            position: "top-center",
            duration: 8000,
            action: worktreePath ? {
              label: "Sync with Main",
              onClick: () => {
                mergeFromDefaultMutation.mutate({ worktreePath, useRebase: false })
              },
            } : undefined,
          }
        )
      } else {
        toast.error(errorMsg, { position: "top-center" })
      }
    },
  })

  // Restore archived workspace
  const restoreWorkspaceMutation = trpc.chats.restore.useMutation({
    onSuccess: (restoredChat) => {
      if (restoredChat) {
        trpcUtils.chats.list.setData({}, (oldData) => {
          if (!oldData) return [restoredChat]
          if (oldData.some((c) => c.id === restoredChat.id)) return oldData
          return [restoredChat, ...oldData]
        })
      }
      trpcUtils.chats.list.invalidate()
      trpcUtils.chats.listArchived.invalidate()
      utils.agents.getAgentChat.invalidate({ chatId })
    },
  })

  // Branch data for diff sidebar header
  const { data: branchData } = trpc.changes.getBranches.useQuery(
    { worktreePath: worktreePath || "" },
    { enabled: !!worktreePath }
  )

  // --- Handlers ---

  const handleCreatePrDirect = useCallback(async () => {
    if (!worktreePath) {
      toast.error("No workspace path available", { position: "top-center" })
      return
    }
    setIsCreatingPr(true)
    try {
      await createPrMutation.mutateAsync({ worktreePath })
    } finally {
      setIsCreatingPr(false)
    }
  }, [worktreePath, createPrMutation, setIsCreatingPr])

  const handleCreatePr = useCallback(async () => {
    if (!chatId) {
      toast.error("Chat ID is required", { position: "top-center" })
      return
    }
    setIsCreatingPr(true)
    try {
      const context = await trpcClient.chats.getPrContext.query({ chatId })
      if (!context) {
        toast.error("Could not get git context", { position: "top-center" })
        setIsCreatingPr(false)
        return
      }
      const message = generatePrMessage(context)
      setPendingPrMessage(message)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to prepare PR request",
        { position: "top-center" },
      )
      setIsCreatingPr(false)
    }
  }, [chatId, setPendingPrMessage, setIsCreatingPr])

  const handleMergePr = useCallback(() => {
    mergePrMutation.mutate({ chatId, method: "squash" })
  }, [chatId, mergePrMutation])

  const handleCommitToPr = useCallback(async (_selectedPaths?: string[]) => {
    if (!chatId) {
      toast.error("Chat ID is required", { position: "top-center" })
      return
    }
    try {
      setIsCommittingToPr(true)
      const context = await trpcClient.chats.getPrContext.query({ chatId })
      if (!context) {
        toast.error("Could not get git context", { position: "top-center" })
        return
      }
      const message = generateCommitToPrMessage(context)
      setPendingPrMessage(message)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to prepare commit request",
        { position: "top-center" },
      )
    } finally {
      setIsCommittingToPr(false)
    }
  }, [chatId, setPendingPrMessage])

  const handleReview = useCallback(async () => {
    if (!chatId) {
      toast.error("Chat ID is required", { position: "top-center" })
      return
    }
    setIsReviewing(true)
    try {
      const context = await trpcClient.chats.getPrContext.query({ chatId })
      if (!context) {
        toast.error("Could not get git context", { position: "top-center" })
        return
      }
      if (activeSubChatId) {
        setFilteredSubChatId(activeSubChatId)
      }
      const message = generateReviewMessage(context)
      setPendingReviewMessage(message)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start review",
        { position: "top-center" },
      )
    } finally {
      setIsReviewing(false)
    }
  }, [chatId, activeSubChatId, setPendingReviewMessage, setFilteredSubChatId])

  // Review system - document comments for plan sidebar
  const { comments: reviewComments, commentsByDocument, clearComments } = useDocumentComments(activeSubChatIdForPlan || "")

  const handleSubmitReview = useCallback((summary: string) => {
    if (reviewComments.length === 0) {
      toast.error("No comments to submit")
      return
    }
    const messageParts: string[] = []
    messageParts.push("## Review\n")
    if (summary.trim()) {
      messageParts.push(`### Summary\n${summary.trim()}\n`)
      messageParts.push("\n### Comments\n")
    }
    for (const [path, docComments] of Object.entries(commentsByDocument)) {
      for (const comment of docComments) {
        const fileName = path.split("/").pop() || path
        const lineRange = comment.anchor.lineStart
          ? comment.anchor.lineEnd && comment.anchor.lineEnd !== comment.anchor.lineStart
            ? `:L${comment.anchor.lineStart}-${comment.anchor.lineEnd}`
            : `:L${comment.anchor.lineStart}`
          : ""
        messageParts.push(`\n**${fileName}${lineRange}**\n`)
        const quoteText = comment.anchor.selectedText.slice(0, 100)
        const truncated = comment.anchor.selectedText.length > 100 ? "..." : ""
        messageParts.push(`\n> ${quoteText}${truncated}\n`)
        messageParts.push(`\n${comment.content}\n`)
      }
    }
    const message = messageParts.join("")
    setPendingReviewMessage(message)
    clearComments()
    setIsPlanSidebarOpen(false)
    setIsDiffSidebarOpen(false)
  }, [reviewComments, commentsByDocument, clearComments, setPendingReviewMessage, setIsPlanSidebarOpen, setIsDiffSidebarOpen])

  const handleFixConflicts = useCallback(() => {
    const message = `This PR has merge conflicts with the main branch. Please:

1. First, fetch and merge the latest changes from main branch using git commands
2. If there are any merge conflicts, resolve them carefully by keeping the correct code from both branches
3. After resolving conflicts, commit the merge
4. Push the changes to update the PR

Make sure to preserve all functionality from both branches when resolving conflicts.`
    setPendingConflictResolutionMessage(message)
  }, [setPendingConflictResolutionMessage])

  const handleRestoreWorkspace = useCallback(() => {
    restoreWorkspaceMutation.mutate({ id: chatId })
  }, [chatId, restoreWorkspaceMutation])

  // Refetch git status when window gains focus
  useEffect(() => {
    if (!worktreePath || !isDiffSidebarOpen) return
    const handleWindowFocus = () => {
      refetchGitStatus()
      setHasPendingDiffChanges(true)
    }
    window.addEventListener('focus', handleWindowFocus)
    return () => window.removeEventListener('focus', handleWindowFocus)
  }, [worktreePath, isDiffSidebarOpen, refetchGitStatus, setHasPendingDiffChanges])

  // Sync parsedFileDiffs with git status - clear diff data when all files are committed
  useEffect(() => {
    if (!gitStatus || isGitStatusLoading) return
    const hasUncommittedChanges =
      (gitStatus.staged?.length ?? 0) > 0 ||
      (gitStatus.unstaged?.length ?? 0) > 0 ||
      (gitStatus.untracked?.length ?? 0) > 0
    if (!hasUncommittedChanges && parsedFileDiffs && parsedFileDiffs.length > 0) {
      activeChatLog.info('Git status empty but parsedFileDiffs has files, refreshing diff data')
      setParsedFileDiffs([])
      setPrefetchedFileContents({})
      setDiffContent(null)
      setDiffStats({
        fileCount: 0,
        additions: 0,
        deletions: 0,
        isLoading: false,
        hasChanges: false,
      })
    }
  }, [gitStatus, isGitStatusLoading, parsedFileDiffs])

  // Stable callbacks for DiffSidebarHeader
  const handleRefreshGitStatus = useCallback(() => {
    refetchGitStatus()
  }, [refetchGitStatus])

  const handleRefreshDiff = useCallback(() => {
    setHasPendingDiffChanges(false)
    fetchDiffStats()
  }, [setHasPendingDiffChanges, fetchDiffStats])

  const handleExpandAll = useCallback(() => {
    diffViewRef.current?.expandAll()
  }, [])

  const handleCollapseAll = useCallback(() => {
    diffViewRef.current?.collapseAll()
  }, [])

  const handleMarkAllViewed = useCallback(() => {
    diffViewRef.current?.markAllViewed()
  }, [])

  const handleMarkAllUnviewed = useCallback(() => {
    diffViewRef.current?.markAllUnviewed()
  }, [])

  return {
    // PR status
    hasPrNumber,
    isPrOpen,
    hasMergeConflicts,

    // Git data
    branchData,
    gitStatus,
    isGitStatusLoading,

    // Loading states
    isCreatingPr,
    isReviewing,
    isCommittingToPr,

    // Mutations
    mergePrMutation,
    restoreWorkspaceMutation,

    // Handlers
    handleCreatePrDirect,
    handleCreatePr,
    handleMergePr,
    handleCommitToPr,
    handleReview,
    handleSubmitReview,
    handleFixConflicts,
    handleRestoreWorkspace,
    handleRefreshGitStatus,
    handleRefreshDiff,
    handleExpandAll,
    handleCollapseAll,
    handleMarkAllViewed,
    handleMarkAllUnviewed,
  }
}
