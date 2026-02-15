/**
 * useAuthRetryMessage - Retry message after successful OAuth flow
 *
 * Watches for pending auth retry messages. When OAuth completes successfully
 * and readyToRetry is set, automatically re-sends the original message.
 */

import { useEffect } from "react"
import { useAtom } from "jotai"
import { pendingAuthRetryMessageAtom } from "../atoms"

export interface UseAuthRetryMessageOptions {
  subChatId: string
  isStreaming: boolean
  sendMessage: (message: {
    role: "user"
    parts: Array<
      { type: "text"; text: string } | { type: "data-image"; data: any }
    >
  }) => void
}

export function useAuthRetryMessage({
  subChatId,
  isStreaming,
  sendMessage,
}: UseAuthRetryMessageOptions): void {
  const [pendingAuthRetry, setPendingAuthRetry] = useAtom(
    pendingAuthRetryMessageAtom,
  )

  useEffect(() => {
    if (
      pendingAuthRetry &&
      pendingAuthRetry.readyToRetry &&
      pendingAuthRetry.subChatId === subChatId &&
      !isStreaming
    ) {
      setPendingAuthRetry(null)

      const parts: Array<
        { type: "text"; text: string } | { type: "data-image"; data: any }
      > = [{ type: "text", text: pendingAuthRetry.prompt }]

      if (pendingAuthRetry.images && pendingAuthRetry.images.length > 0) {
        for (const img of pendingAuthRetry.images) {
          parts.push({
            type: "data-image",
            data: {
              base64Data: img.base64Data,
              mediaType: img.mediaType,
              filename: img.filename,
            },
          })
        }
      }

      sendMessage({ role: "user", parts })
    }
  }, [pendingAuthRetry, isStreaming, sendMessage, setPendingAuthRetry, subChatId])
}
