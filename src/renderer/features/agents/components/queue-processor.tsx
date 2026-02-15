"use client"

import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useMessageQueueStore } from "../stores/message-queue-store"
import type { AgentQueueItem } from "../lib/queue-utils"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { chatRegistry } from "../stores/chat-registry"
import { buildImagePart, buildFilePart } from "../lib/message-utils"
import { appStore } from "../../../lib/jotai-store"
import { loadingSubChatsAtom, setLoading, clearLoading } from "../atoms"
import { trackSendMessage } from "../../../lib/sensors-analytics"
import { createLogger } from "../../../lib/logger"

const queueProcessorLog = createLogger("QueueProcessor")


// 智能队列处理延迟配置
const QUEUE_SMART_DELAY_MS = 100  // 快速检查间隔 (从 1000ms 优化为 100ms)
const QUEUE_MAX_WAIT_MS = 3000    // 最大等待时间 (安全网,避免无限等待)

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

      // Merge consecutive text-only queue items into a single message.
      // Items with attachments (images/files/textContexts/diffTextContexts) are
      // sent individually to preserve their semantic context.
      const isTextOnly = (item: AgentQueueItem) =>
        !item.images?.length &&
        !item.files?.length &&
        !item.textContexts?.length &&
        !item.diffTextContexts?.length

      const store = useMessageQueueStore.getState()
      const currentQueue = store.queues[subChatId] || []

      let poppedItems: AgentQueueItem[] = []

      if (isTextOnly(currentQueue[0]) && currentQueue.length > 1) {
        // Greedily collect consecutive text-only items from queue head
        const mergeableIds: string[] = []
        for (const item of currentQueue) {
          if (!isTextOnly(item)) break
          mergeableIds.push(item.id)
        }
        for (const id of mergeableIds) {
          const popped = useMessageQueueStore.getState().popItem(subChatId, id)
          if (popped) poppedItems.push(popped)
        }
      } else {
        // Single item (has attachments, or only 1 item in queue)
        const popped = store.popItem(subChatId, currentQueue[0].id)
        if (popped) poppedItems.push(popped)
      }

      if (poppedItems.length === 0) {
        processingRef.current.delete(subChatId)
        return
      }

      try {
        // Build message parts — merge text from all popped items
        const parts: any[] = []

        if (poppedItems.length === 1) {
          // Single item: preserve original behavior (attachments + text)
          const item = poppedItems[0]
          parts.push(
            ...(item.images || []).map(buildImagePart),
            ...(item.files || []).map(buildFilePart),
          )
          if (item.message) {
            parts.push({ type: "text", text: item.message })
          }
        } else {
          // Multiple text-only items: merge messages with \n\n
          const mergedText = poppedItems
            .map((item) => item.message)
            .filter(Boolean)
            .join("\n\n")
          if (mergedText) {
            parts.push({ type: "text", text: mergedText })
          }
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

        // Track message sent
        const hasAt = parts.some((p: any) => p.type === "text" && p.text?.includes("@"))
        trackSendMessage(mode, hasAt)

        // Send message using Chat's sendMessage method
        await chat.sendMessage({ role: "user", parts })

      } catch (error) {
        queueProcessorLog.error(`Error processing queue:`, error)

        // Requeue all popped items at the front in original order so they can be retried
        for (let i = poppedItems.length - 1; i >= 0; i--) {
          useMessageQueueStore.getState().prependItem(subChatId, poppedItems[i])
        }

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

    // 智能调度策略: 基于流状态的动态等待,而非固定 1 秒延迟
    const scheduleProcessing = (subChatId: string) => {
      // 如果已调度,不重复设置,避免无限延迟
      const existingTimer = timersRef.current.get(subChatId)
      if (existingTimer) {
        return
      }

      const startTime = Date.now()

      const checkAndProcess = async () => {
        const status = useStreamingStatusStore.getState().getStatus(subChatId)
        const elapsed = Date.now() - startTime

        // 条件 1: 流已就绪或出错,立即处理
        if (status === "ready" || status === "error") {
          timersRef.current.delete(subChatId)
          await processQueue(subChatId)
          return
        }

        // 条件 2: 超过最大等待时间,放弃等待并警告
        if (elapsed >= QUEUE_MAX_WAIT_MS) {
          queueProcessorLog.warn(`Max wait time reached for ${subChatId}, status: ${status}`)
          timersRef.current.delete(subChatId)
          return
        }

        // 条件 3: 继续等待,100ms 后重试
        const timer = setTimeout(checkAndProcess, QUEUE_SMART_DELAY_MS)
        timersRef.current.set(subChatId, timer)
      }

      // 首次检查 (100ms 后)
      const timer = setTimeout(checkAndProcess, QUEUE_SMART_DELAY_MS)
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
