/**
 * useChatMutations - Centralized chat mutation hooks
 *
 * Consolidates tRPC mutations used in ChatView:
 * - PR operations (create, merge, sync)
 * - Chat/SubChat renaming
 * - Workspace restoration
 *
 * This reduces the number of mutation declarations in ChatView
 * and provides a clean API for mutation operations.
 */

import { useCallback } from "react"
import { toast } from "sonner"
import { api } from "../../../lib/mock-api"
import { trpc } from "../../../lib/trpc"

export interface ChatMutationsOptions {
  chatId: string
  worktreePath: string | null
  onGitStatusRefetch?: () => void
}

export interface ChatMutationsResult {
  // Rename mutations
  renameSubChat: ReturnType<typeof api.agents.renameSubChat.useMutation>
  renameChat: ReturnType<typeof api.agents.renameChat.useMutation>
  generateSubChatName: ReturnType<typeof api.agents.generateSubChatName.useMutation>

  // PR mutations
  createPr: ReturnType<typeof trpc.changes.createPR.useMutation>
  mergePr: ReturnType<typeof trpc.chats.mergePr.useMutation>
  mergeFromDefault: ReturnType<typeof trpc.changes.mergeFromDefault.useMutation>

  // Workspace mutations
  restoreWorkspace: ReturnType<typeof trpc.chats.restore.useMutation>

  // Convenience handlers
  handleMergePr: () => void
  handleRestoreWorkspace: () => void
}

export function useChatMutations({
  chatId,
  worktreePath,
  onGitStatusRefetch,
}: ChatMutationsOptions): ChatMutationsResult {
  const trpcUtils = trpc.useUtils()
  const apiUtils = api.useUtils()

  // ==========================================================================
  // Rename Mutations
  // ==========================================================================

  const renameSubChat = api.agents.renameSubChat.useMutation()
  const renameChat = api.agents.renameChat.useMutation()
  const generateSubChatName = api.agents.generateSubChatName.useMutation()

  // ==========================================================================
  // PR Mutations
  // ==========================================================================

  // Direct PR creation mutation (push branch and open GitHub)
  const createPr = trpc.changes.createPR.useMutation({
    onSuccess: () => {
      toast.success("Opening GitHub to create PR...", { position: "top-center" })
      onGitStatusRefetch?.()
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create PR", {
        position: "top-center",
      })
    },
  })

  // Sync from main mutation (for resolving merge conflicts)
  const mergeFromDefault = trpc.changes.mergeFromDefault.useMutation({
    onSuccess: () => {
      toast.success("Branch synced with main. You can now merge the PR.", {
        position: "top-center",
      })
      // Invalidate PR status to refresh mergeability
      trpcUtils.chats.getPrStatus.invalidate({ chatId })
    },
    onError: (error) => {
      toast.error(error.message || "Failed to sync with main", {
        position: "top-center",
      })
    },
  })

  // Merge PR mutation
  const mergePr = trpc.chats.mergePr.useMutation({
    onSuccess: () => {
      toast.success("PR merged successfully!", { position: "top-center" })
      // Invalidate PR status to update button state
      trpcUtils.chats.getPrStatus.invalidate({ chatId })
    },
    onError: (error) => {
      const errorMsg = error.message || "Failed to merge PR"

      // Check if it's a merge conflict error
      if (errorMsg.includes("MERGE_CONFLICT")) {
        toast.error("PR has merge conflicts. Sync with main to resolve.", {
          position: "top-center",
          duration: 8000,
          action: worktreePath
            ? {
                label: "Sync with Main",
                onClick: () => {
                  mergeFromDefault.mutate({ worktreePath, useRebase: false })
                },
              }
            : undefined,
        })
      } else {
        toast.error(errorMsg, { position: "top-center" })
      }
    },
  })

  // ==========================================================================
  // Workspace Mutations
  // ==========================================================================

  // Restore archived workspace mutation (silent - no toast)
  const restoreWorkspace = trpc.chats.restore.useMutation({
    onSuccess: (restoredChat) => {
      if (restoredChat) {
        // Update the main chat list cache
        trpcUtils.chats.list.setData({}, (oldData) => {
          if (!oldData) return [restoredChat]
          if (oldData.some((c) => c.id === restoredChat.id)) return oldData
          return [restoredChat, ...oldData]
        })
      }
      // Invalidate both lists to refresh
      trpcUtils.chats.list.invalidate()
      trpcUtils.chats.listArchived.invalidate()
      // Invalidate this chat's data to update isArchived state
      apiUtils.agents.getAgentChat.invalidate({ chatId })
    },
  })

  // ==========================================================================
  // Convenience Handlers
  // ==========================================================================

  const handleMergePr = useCallback(() => {
    mergePr.mutate({ chatId, method: "squash" })
  }, [chatId, mergePr])

  const handleRestoreWorkspace = useCallback(() => {
    restoreWorkspace.mutate({ id: chatId })
  }, [chatId, restoreWorkspace])

  return {
    // Rename
    renameSubChat,
    renameChat,
    generateSubChatName,

    // PR
    createPr,
    mergePr,
    mergeFromDefault,

    // Workspace
    restoreWorkspace,

    // Handlers
    handleMergePr,
    handleRestoreWorkspace,
  }
}
