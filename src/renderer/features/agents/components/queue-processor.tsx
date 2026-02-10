"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useMessageQueueStore } from "../stores/message-queue-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { chatRegistry } from "../stores/chat-registry"
import { appStore } from "../../../lib/jotai-store"
import { loadingSubChatsAtom, setLoading, clearLoading } from "../atoms"

// Delay between processing queue items (ms)
const QUEUE_PROCESS_DELAY = 1000

/**
 * Global queue processor component.
 *
 * This component runs at the app level (AgentsLayout) and processes
 * message queues for ALL sub-chats, regardless of which one is currently active.
 *
 * Key insight: Unlike the previous local useEffect in ChatViewInner which only
 * processed the currently active sub-chat's queue, this component listens to
 * ALL queues and streaming statuses globally.
 */
export function QueueProcessor() {
  // Track which sub-chats are currently being processed to avoid double-sends
  const processingRef = useRef<Set<string>>(new Set())
  // Track timers for cleanup
  const timersRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  useEffect(() => {
    // Function to process queue for a specific sub-chat
    const processQueue = async (subChatId: string) => {
      // Check if already processing this sub-chat
      if (processingRef.current.has(subChatId)) {
        return
      }

      // Check streaming status
      const status = useStreamingStatusStore.getState().getStatus(subChatId)
      if (status !== "ready") {
        return
      }

      // Get queue for this sub-chat
      const queue = useMessageQueueStore.getState().queues[subChatId] || []
      if (queue.length === 0) {
        return
      }

      // Get the Chat object from chatRegistry
      const chat = chatRegistry.get(subChatId)
      if (!chat) {
        return
      }

      // Mark as processing
      processingRef.current.add(subChatId)

      // Pop the first item from queue (atomic operation)
      const item = useMessageQueueStore.getState().popItem(subChatId, queue[0].id)
      if (!item) {
        processingRef.current.delete(subChatId)
        return
      }

      try {
        // Build message parts from queued item
        const parts: any[] = [
          ...(item.images || []).map((img) => ({
            type: "data-image" as const,
            data: {
              url: img.url,
              mediaType: img.mediaType,
              filename: img.filename,
              base64Data: img.base64Data,
            },
          })),
          ...(item.files || []).map((f) => ({
            type: "data-file" as const,
            data: {
              url: f.url,
              mediaType: f.mediaType,
              filename: f.filename,
              size: f.size,
            },
          })),
        ]

        if (item.message) {
          parts.push({ type: "text", text: item.message })
        }

        // Get mode from sub-chat store for analytics
        const subChatMeta = useAgentSubChatStore
          .getState()
          .allSubChats.find((sc) => sc.id === subChatId)
        const mode = subChatMeta?.mode || "agent"

        // Update timestamps
        useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)

        // Set loading state for sidebar indicator
        const parentChatId = chatRegistry.getEntry(subChatId)?.parentChatId
        if (parentChatId) {
          setLoading(
            (fn) => appStore.set(loadingSubChatsAtom, fn(appStore.get(loadingSubChatsAtom))),
            subChatId,
            parentChatId
          )
        }

        // Send message using Chat's sendMessage method
        await chat.sendMessage({ role: "user", parts })

      } catch (error) {
        console.error(`[QueueProcessor] Error processing queue:`, error)

        // Requeue the item at the front so it can be retried
        useMessageQueueStore.getState().prependItem(subChatId, item)

        // Set error status (will be cleared on next successful send or manual retry)
        useStreamingStatusStore.getState().setStatus(subChatId, "error")

        // Clear loading state since send failed
        clearLoading(
          (fn) => appStore.set(loadingSubChatsAtom, fn(appStore.get(loadingSubChatsAtom))),
          subChatId
        )

        // Notify user
        toast.error("Failed to send queued message. It will be retried.")
      } finally {
        processingRef.current.delete(subChatId)

        // Re-check queues after clearing the processing lock.
        // This is critical because onFinish may have fired during
        // `await chat.sendMessage()` while processingRef was still set,
        // causing checkAllQueues to skip this subChatId. Without this
        // re-check, remaining queue items would never be processed.
        checkAllQueues()
      }
    }

    // Schedule processing for a sub-chat with delay
    const scheduleProcessing = (subChatId: string) => {
      // If already scheduled, don't reset the timer - let it fire
      // This prevents infinite deferral when checkAllQueues is called frequently
      const existingTimer = timersRef.current.get(subChatId)
      if (existingTimer) {
        return
      }

      // Schedule new processing
      const timer = setTimeout(() => {
        timersRef.current.delete(subChatId)
        processQueue(subChatId)
      }, QUEUE_PROCESS_DELAY)

      timersRef.current.set(subChatId, timer)
    }

    // Check all queues and schedule processing for ready sub-chats
    const checkAllQueues = () => {
      const queues = useMessageQueueStore.getState().queues

      for (const subChatId of Object.keys(queues)) {
        const queue = queues[subChatId]
        if (!queue || queue.length === 0) continue

        const status = useStreamingStatusStore.getState().getStatus(subChatId)

        // Process when ready, or retry on error status
        if ((status === "ready" || status === "error") && !processingRef.current.has(subChatId)) {
          // If error status, clear it before retrying
          if (status === "error") {
            useStreamingStatusStore.getState().setStatus(subChatId, "ready")
          }
          scheduleProcessing(subChatId)
        }
      }
    }

    // Subscribe to queue changes with selector (requires subscribeWithSelector middleware)
    const unsubscribeQueue = useMessageQueueStore.subscribe(
      (state) => state.queues,
      () => checkAllQueues()
    )

    // Subscribe to streaming status changes with selector
    const unsubscribeStatus = useStreamingStatusStore.subscribe(
      (state) => state.statuses,
      () => checkAllQueues()
    )

    // Initial check
    checkAllQueues()

    // Cleanup
    return () => {
      unsubscribeQueue()
      unsubscribeStatus()

      // Clear all timers
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer)
      }
      timersRef.current.clear()
    }
  }, [])

  // This component doesn't render anything
  return null
}
