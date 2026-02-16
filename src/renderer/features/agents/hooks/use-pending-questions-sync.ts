/**
 * usePendingQuestionsSync - 同步待处理问题与流状态
 *
 * 处理两个场景：
 * - 流停止后延迟清除待处理问题
 * - 同步待处理问题与消息状态（恢复 / 清除已回答的问题）
 */

import { useEffect, useRef } from "react"
import type { SetStateAction } from "react"
import type { MessagePart } from "../stores/message-store"
import type { PendingUserQuestion } from "../atoms"

interface LastAssistantMessage {
  parts?: MessagePart[]
  [key: string]: unknown
}

export function usePendingQuestionsSync(options: {
  subChatId: string
  isStreaming: boolean
  pendingQuestions: PendingUserQuestion | null
  setPendingQuestionsMap: (
    update: SetStateAction<Map<string, PendingUserQuestion>>,
  ) => void
  lastAssistantMessage: LastAssistantMessage | null
}) {
  const {
    subChatId,
    isStreaming,
    pendingQuestions,
    setPendingQuestionsMap,
    lastAssistantMessage,
  } = options

  // Track previous streaming state to detect stream stop
  const prevIsStreamingRef = useRef(isStreaming)
  // Track if we recently stopped streaming (to prevent sync effect from restoring)
  const recentlyStoppedStreamRef = useRef(false)

  // Clear pending questions when streaming is aborted
  // This effect runs when isStreaming transitions from true to false
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current
    prevIsStreamingRef.current = isStreaming

    // Detect streaming stop transition
    if (wasStreaming && !isStreaming) {
      // Mark that we recently stopped streaming
      recentlyStoppedStreamRef.current = true
      // Clear the flag after a delay
      const flagTimeout = setTimeout(() => {
        recentlyStoppedStreamRef.current = false
      }, 500)

      // Streaming just stopped - if there's a pending question for this chat,
      // clear it after a brief delay (backend already handled the abort)
      if (pendingQuestions) {
        const timeout = setTimeout(() => {
          // Re-check if still showing the same question (might have been cleared by other means)
          setPendingQuestionsMap((current) => {
            if (current.has(subChatId)) {
              const newMap = new Map(current)
              newMap.delete(subChatId)
              return newMap
            }
            return current
          })
        }, 150) // Small delay to allow for race conditions with transport chunks
        return () => {
          clearTimeout(timeout)
          clearTimeout(flagTimeout)
        }
      }
      return () => clearTimeout(flagTimeout)
    }
  }, [isStreaming, subChatId, pendingQuestions, setPendingQuestionsMap])

  // Sync pending questions with messages state
  // This handles: 1) restoring on chat switch, 2) clearing when question is answered/timed out
  useEffect(() => {
    // Check if there's a pending AskUserQuestion in the last assistant message
    const pendingQuestionPart = lastAssistantMessage?.parts?.find(
      (part: MessagePart) =>
        part.type === "tool-AskUserQuestion" &&
        part.state !== "output-available" &&
        part.state !== "output-error" &&
        part.state !== "result" &&
        part.input?.questions,
    ) as MessagePart | undefined

    // Helper to clear pending question for this subChat
    const clearPendingQuestion = () => {
      setPendingQuestionsMap((current) => {
        if (current.has(subChatId)) {
          const newMap = new Map(current)
          newMap.delete(subChatId)
          return newMap
        }
        return current
      })
    }

    // If streaming and we already have a pending question for this chat, keep it
    // (transport will manage it via chunks)
    if (isStreaming && pendingQuestions) {
      // But if the question in messages is already answered, clear the atom
      if (!pendingQuestionPart) {
        // Check if the specific toolUseId is now answered
        const answeredPart = lastAssistantMessage?.parts?.find(
          (part: MessagePart) =>
            part.type === "tool-AskUserQuestion" &&
            (part as unknown as { toolCallId?: string }).toolCallId ===
              pendingQuestions.toolUseId &&
            (part.state === "output-available" ||
              part.state === "output-error" ||
              part.state === "result"),
        )
        if (answeredPart) {
          clearPendingQuestion()
        }
      }
      return
    }

    // Not streaming - DON'T restore pending questions from messages
    if (pendingQuestions) {
      clearPendingQuestion()
    }
  }, [
    subChatId,
    lastAssistantMessage,
    isStreaming,
    pendingQuestions,
    setPendingQuestionsMap,
  ])

  return { recentlyStoppedStreamRef }
}
