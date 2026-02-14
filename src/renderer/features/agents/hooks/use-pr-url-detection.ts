import { useEffect, useRef } from "react"
import type { Message } from "@ai-sdk/react"
import { trpcClient } from "@/lib/trpc"
import { getQueryClient } from "@/contexts/TRPCProvider"

export interface UsePrUrlDetectionOptions {
  messages: Message[]
  isStreaming: boolean
  parentChatId: string
  existingPrUrl?: string | null
}

/**
 * Hook to detect GitHub PR URLs in assistant messages and store them.
 *
 * Automatically:
 * - Scans assistant messages for GitHub PR URLs
 * - Updates the database with PR URL and number
 * - Invalidates the agentChat query to refetch with new PR info
 * - Prevents duplicate detections using a ref
 */
export function usePrUrlDetection({
  messages,
  isStreaming,
  parentChatId,
  existingPrUrl = null,
}: UsePrUrlDetectionOptions): void {
  // Initialize with existing PR URL to prevent duplicate toast on re-mount
  const detectedPrUrlRef = useRef<string | null>(existingPrUrl)

  useEffect(() => {
    // Only check after streaming ends
    if (isStreaming) return

    const utils = getQueryClient()

    // Look through messages for PR URLs
    for (const msg of messages) {
      if (msg.role !== "assistant") continue

      // Extract text content from message
      const textContent =
        msg.parts
          ?.filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ") || ""

      // Match GitHub PR URL pattern
      const prUrlMatch = textContent.match(
        /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/,
      )

      if (prUrlMatch && prUrlMatch[0] !== detectedPrUrlRef.current) {
        const prUrl = prUrlMatch[0]
        const prNumber = parseInt(prUrlMatch[1], 10)

        // Store to prevent duplicate calls
        detectedPrUrlRef.current = prUrl

        // Update database
        trpcClient.chats.updatePrInfo
          .mutate({ chatId: parentChatId, prUrl, prNumber })
          .then(() => {
            // Invalidate the agentChat query to refetch with new PR info
            utils.agents.getAgentChat.invalidate({ chatId: parentChatId })
          })

        break // Only process first PR URL found
      }
    }
  }, [messages, isStreaming, parentChatId])
}
