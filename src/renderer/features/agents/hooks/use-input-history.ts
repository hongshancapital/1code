"use client"

import { useCallback, useRef, useMemo } from "react"
import { useAtomValue } from "jotai"
import { appStore } from "../../../lib/jotai-store"
import {
  userMessageIdsAtom,
  messageAtomFamily,
  currentSubChatIdAtom,
  type MessagePart,
} from "../stores/message-store"

/**
 * Hook for managing input history navigation (like terminal command history)
 *
 * Features:
 * - Navigate through previously sent messages with ArrowUp/ArrowDown
 * - Temporarily saves current draft when navigating up
 * - Restores draft when navigating back to the latest position
 * - Resets state when a new message is sent or subChat changes
 */
export function useInputHistory() {
  // -1 means we're at the draft position (most recent)
  // 0 means the most recent history item
  // 1 means the second most recent, etc.
  const historyIndexRef = useRef<number>(-1)

  // Temporary storage for the current draft when navigating history
  const draftRef = useRef<string>("")

  // Get current subChatId to detect chat switches
  const currentSubChatId = useAtomValue(currentSubChatIdAtom)
  const lastSubChatIdRef = useRef<string>(currentSubChatId)

  // Reset history when subChat changes
  if (currentSubChatId !== lastSubChatIdRef.current) {
    lastSubChatIdRef.current = currentSubChatId
    historyIndexRef.current = -1
    draftRef.current = ""
  }

  // Get user message IDs (ordered oldest to newest)
  const userMessageIds = useAtomValue(userMessageIdsAtom)

  // Extract text content from user messages (oldest to newest)
  const historyTexts = useMemo(() => {
    const texts: string[] = []
    for (const id of userMessageIds) {
      const msg = appStore.get(messageAtomFamily(id))
      if (!msg?.parts) continue

      // Find text part in message
      const textPart = msg.parts.find((p: MessagePart) => p.type === "text")
      if (textPart?.text) {
        texts.push(textPart.text)
      }
    }
    return texts
  }, [userMessageIds])

  /**
   * Navigate to the previous (older) history item
   * @param currentValue - Current input value (saved as draft if at position -1)
   * @returns The history text to display, or null if already at the oldest
   */
  const getHistoryUp = useCallback(
    (currentValue: string): string | null => {
      if (historyTexts.length === 0) return null

      // If at draft position, save the current input as draft
      if (historyIndexRef.current === -1) {
        draftRef.current = currentValue
      }

      const nextIndex = historyIndexRef.current + 1

      // Check if we've reached the oldest message
      if (nextIndex >= historyTexts.length) {
        return null
      }

      historyIndexRef.current = nextIndex

      // Return history item (index from the end, since historyTexts is oldest-first)
      return historyTexts[historyTexts.length - 1 - nextIndex] ?? null
    },
    [historyTexts]
  )

  /**
   * Navigate to the next (newer) history item or draft
   * @returns The history text or draft to display, or null if already at draft
   */
  const getHistoryDown = useCallback((): string | null => {
    // Already at draft position
    if (historyIndexRef.current <= -1) {
      return null
    }

    const nextIndex = historyIndexRef.current - 1
    historyIndexRef.current = nextIndex

    // Back to draft position
    if (nextIndex === -1) {
      return draftRef.current
    }

    // Return history item
    return historyTexts[historyTexts.length - 1 - nextIndex] ?? null
  }, [historyTexts])

  /**
   * Reset history navigation state
   * Call this after sending a message or when switching chats
   */
  const resetHistory = useCallback(() => {
    historyIndexRef.current = -1
    draftRef.current = ""
  }, [])

  /**
   * Check if currently browsing history (not at draft position)
   */
  const isInHistory = useCallback(() => {
    return historyIndexRef.current > -1
  }, [])

  return {
    getHistoryUp,
    getHistoryDown,
    resetHistory,
    isInHistory,
    historyLength: historyTexts.length,
  }
}
