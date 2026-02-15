/**
 * useMessagesSync - Sync messages and streaming status to global stores
 *
 * Syncs the active tab's messages to Jotai atoms for isolated rendering,
 * and syncs streaming status to the global streaming status store for queue processing.
 * Only the active tab syncs to prevent overwriting shared global atoms.
 */

import { useEffect, useLayoutEffect } from "react"
import { useSetAtom } from "jotai"
import { syncMessagesWithStatusAtom } from "../stores/message-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"

export interface UseMessagesSyncOptions {
  messages: any[]
  status: string
  subChatId: string
  isActive: boolean
}

export function useMessagesSync({
  messages,
  status,
  subChatId,
  isActive,
}: UseMessagesSyncOptions): void {
  // Sync messages to Jotai store for isolated rendering
  const syncMessages = useSetAtom(syncMessagesWithStatusAtom)
  useLayoutEffect(() => {
    if (!isActive) return
    syncMessages({ messages, status, subChatId })
  }, [messages, status, subChatId, syncMessages, isActive])

  // Sync status to global streaming status store for queue processing
  const setStreamingStatus = useStreamingStatusStore((s) => s.setStatus)
  useEffect(() => {
    setStreamingStatus(
      subChatId,
      status as "ready" | "streaming" | "submitted" | "error",
    )
  }, [subChatId, status, setStreamingStatus])
}
