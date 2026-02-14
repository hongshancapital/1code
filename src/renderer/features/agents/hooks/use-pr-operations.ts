/**
 * usePrOperations - PR creation, commit, merge, and review operations
 *
 * This hook encapsulates all PR-related operations that were previously
 * scattered in active-chat.tsx. It uses the Context providers for data access.
 *
 * Usage:
 *   const {
 *     handleCreatePr,
 *     handleCreatePrDirect,
 *     handleCommitToPr,
 *     handleMergePr,
 *     handleReview,
 *     isCreatingPr,
 *     isMergingPr,
 *     isReviewing,
 *   } = usePrOperations()
 */

import { useCallback, useState } from "react"
import { useSetAtom } from "jotai"
import { toast } from "sonner"
import { trpc, trpcClient } from "../../../lib/trpc"
import {
  pendingPrMessageAtom,
  pendingReviewMessageAtom,
  isCreatingPrAtom,
  filteredSubChatIdAtom,
} from "../atoms"
import { useChatInstance } from "../context/chat-instance-context"
import { useChatCapabilities } from "../context/chat-capabilities-context"
import { useSubChatSafe } from "../context/sub-chat-context"
import {
  generatePrMessage,
  generateCommitToPrMessage,
  generateReviewMessage,
} from "../utils/pr-message"

export interface PrOperationsResult {
  // PR creation
  handleCreatePr: () => Promise<void>
  handleCreatePrDirect: () => Promise<void>
  handleCommitToPr: (selectedPaths?: string[]) => Promise<void>
  isCreatingPr: boolean
  isCommittingToPr: boolean

  // PR merge
  handleMergePr: () => void
  isMergingPr: boolean
  canMergePr: boolean

  // Review
  handleReview: () => Promise<void>
  isReviewing: boolean

  // PR status
  prState: "open" | "draft" | "merged" | "closed" | undefined
  prMergeable: boolean | undefined
  isPrStatusLoading: boolean
}

export function usePrOperations(): PrOperationsResult {
  // Get data from contexts
  const { chatId, worktreePath } = useChatInstance()
  const { canCreatePr, canMergePr: canMergePrCapability, hasPrNumber } = useChatCapabilities()
  const subChatContext = useSubChatSafe()
  const activeSubChatId = subChatContext?.subChatId

  // Atoms for pending messages
  const setPendingPrMessage = useSetAtom(pendingPrMessageAtom)
  const setPendingReviewMessage = useSetAtom(pendingReviewMessageAtom)
  const setIsCreatingPr = useSetAtom(isCreatingPrAtom)
  const setFilteredSubChatId = useSetAtom(filteredSubChatIdAtom)

  // Local state
  const [isCommittingToPr, setIsCommittingToPr] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)

  // Mutations
  const utils = trpc.useUtils()

  const createPrMutation = trpc.changes.createPr.useMutation({
    onSuccess: (data) => {
      if (data.prUrl) {
        utils.agents.getAgentChat.invalidate({ chatId })
      }
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create PR", {
        position: "top-center",
      })
    },
  })

  const mergePrMutation = trpc.chats.mergePr.useMutation({
    onSuccess: () => {
      toast.success("PR merged successfully")
      utils.chats.getPrStatus.invalidate({ chatId })
    },
    onError: (error) => {
      toast.error(error.message || "Failed to merge PR")
      utils.chats.getPrStatus.invalidate({ chatId })
    },
  })

  // PR status query
  const { data: prStatusData, isLoading: isPrStatusLoading } = trpc.chats.getPrStatus.useQuery(
    { chatId },
    {
      enabled: !!chatId && hasPrNumber,
      staleTime: 30_000,
      refetchInterval: 60_000,
    }
  )

  const prState = prStatusData?.pr?.state as "open" | "draft" | "merged" | "closed" | undefined
  const prMergeable = prStatusData?.pr?.mergeable

  // Create PR directly (without AI)
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

  // Create PR with AI assistance
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
      // Don't reset isCreatingPr here - it will be reset after message is sent
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to prepare PR request",
        { position: "top-center" }
      )
      setIsCreatingPr(false)
    }
  }, [chatId, setPendingPrMessage, setIsCreatingPr])

  // Commit to existing PR
  const handleCommitToPr = useCallback(
    async (_selectedPaths?: string[]) => {
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
          { position: "top-center" }
        )
      } finally {
        setIsCommittingToPr(false)
      }
    },
    [chatId, setPendingPrMessage]
  )

  // Merge PR
  const handleMergePr = useCallback(() => {
    mergePrMutation.mutate({ chatId, method: "squash" })
  }, [chatId, mergePrMutation])

  // Start review
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

      // Set filter to show only files from the active subchat
      if (activeSubChatId) {
        setFilteredSubChatId(activeSubChatId)
      }

      const message = generateReviewMessage(context)
      setPendingReviewMessage(message)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to start review",
        { position: "top-center" }
      )
    } finally {
      setIsReviewing(false)
    }
  }, [chatId, activeSubChatId, setPendingReviewMessage, setFilteredSubChatId])

  return {
    // PR creation
    handleCreatePr,
    handleCreatePrDirect,
    handleCommitToPr,
    isCreatingPr: createPrMutation.isPending,
    isCommittingToPr,

    // PR merge
    handleMergePr,
    isMergingPr: mergePrMutation.isPending,
    canMergePr: canMergePrCapability && prState === "open" && prMergeable !== false,

    // Review
    handleReview,
    isReviewing,

    // PR status
    prState,
    prMergeable,
    isPrStatusLoading,
  }
}
