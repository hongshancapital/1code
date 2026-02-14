import { useEffect } from "react"
import { useAtom, useSetAtom } from "jotai"
import {
  pendingPrMessageAtom,
  pendingReviewMessageAtom,
  pendingConflictResolutionMessageAtom,
  isCreatingPrAtom,
} from "../atoms"

export interface UsePendingMessageHandlingOptions {
  isStreaming: boolean
  isActive: boolean
  sendMessage: (message: { role: string; parts: { type: string; text: string }[] }) => void
}

/**
 * Hook to handle pending messages (PR, Review, Conflict Resolution).
 *
 * Watches for pending messages and automatically sends them when:
 * - Not currently streaming
 * - This tab is active
 *
 * Only the active tab consumes pending messages to prevent
 * inactive ChatViewInner instances from stealing messages.
 */
export function usePendingMessageHandling({
  isStreaming,
  isActive,
  sendMessage,
}: UsePendingMessageHandlingOptions): void {
  // Handle pending PR message
  const [pendingPrMessage, setPendingPrMessage] = useAtom(pendingPrMessageAtom)
  const setIsCreatingPr = useSetAtom(isCreatingPrAtom)

  useEffect(() => {
    if (pendingPrMessage && !isStreaming && isActive) {
      // Clear the pending message immediately to prevent double-sending
      setPendingPrMessage(null)

      // Send the message to Claude
      sendMessage({
        role: "user",
        parts: [{ type: "text", text: pendingPrMessage }],
      })

      // Reset creating PR state after message is sent
      setIsCreatingPr(false)
    }
  }, [pendingPrMessage, isStreaming, isActive, sendMessage, setPendingPrMessage, setIsCreatingPr])

  // Handle pending Review message
  const [pendingReviewMessage, setPendingReviewMessage] = useAtom(
    pendingReviewMessageAtom,
  )

  useEffect(() => {
    if (pendingReviewMessage && !isStreaming && isActive) {
      // Clear the pending message immediately to prevent double-sending
      setPendingReviewMessage(null)

      // Send the message to Claude
      sendMessage({
        role: "user",
        parts: [{ type: "text", text: pendingReviewMessage }],
      })
    }
  }, [pendingReviewMessage, isStreaming, isActive, sendMessage, setPendingReviewMessage])

  // Handle pending conflict resolution message
  const [pendingConflictMessage, setPendingConflictMessage] = useAtom(
    pendingConflictResolutionMessageAtom,
  )

  useEffect(() => {
    if (pendingConflictMessage && !isStreaming && isActive) {
      // Clear the pending message immediately to prevent double-sending
      setPendingConflictMessage(null)

      // Send the message to Claude
      sendMessage({
        role: "user",
        parts: [{ type: "text", text: pendingConflictMessage }],
      })
    }
  }, [pendingConflictMessage, isStreaming, isActive, sendMessage, setPendingConflictMessage])
}
