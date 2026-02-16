/**
 * useQuestionHandlers - AskUserQuestion tool response handling
 *
 * Extracts question-related handlers from ChatViewInner:
 * - handleQuestionsAnswer: Handles answering questions (live or expired)
 * - handleQuestionsSkip: Handles skipping/dismissing questions
 * - handleSubmitWithQuestionAnswer: Handles answering with custom text from input
 * - clearPendingQuestionCallback: Clears pending and expired questions
 *
 * This hook manages the AskUserQuestion tool flow, handling both
 * live questions (where AI is waiting) and expired questions (timeout).
 */

import { useCallback, useMemo, useRef } from "react"
import type { MutableRefObject } from "react"
import { trpcClient } from "../../../lib/trpc"
import { chatRegistry } from "../stores/chat-registry"
import { QUESTIONS_SKIPPED_MESSAGE } from "../../../lib/atoms"

export interface QuestionData {
  toolUseId: string
  questions: Array<{
    question: string
    header?: string
    options?: Array<{ label: string; description?: string }>
    multiSelect?: boolean
  }>
}

export interface QuestionComponentRef {
  getAnswers: () => Record<string, string>
}

export interface EditorRef {
  getValue: () => string
  clear: () => void
}

export interface QuestionHandlersOptions {
  /** Current subChat ID */
  subChatId: string
  /** Parent chat ID (for draft management) */
  parentChatId: string | null
  /** Questions to display (pending or expired) */
  displayQuestions: QuestionData | null
  /** Whether the question has expired (timed out) */
  isQuestionExpired: boolean
  /** Setter for pending questions map */
  setPendingQuestionsMap: React.Dispatch<
    React.SetStateAction<Map<string, QuestionData>>
  >
  /** Setter for expired questions map */
  setExpiredQuestionsMap: React.Dispatch<
    React.SetStateAction<Map<string, QuestionData>>
  >
  /** Editor ref for getting/clearing input */
  editorRef: MutableRefObject<EditorRef | null>
  /** Question component ref for getting selected answers */
  questionRef: MutableRefObject<QuestionComponentRef | null>
  /** Ref for streaming state */
  isStreamingRef: MutableRefObject<boolean>
  /** Ref for stop function */
  stopRef: MutableRefObject<() => Promise<void>>
  /** Ref for send message function */
  sendMessageRef: MutableRefObject<(message: { role: string; parts: any[] }) => Promise<void>>
  /** Ref for auto-scroll state */
  shouldAutoScrollRef: MutableRefObject<boolean>
  /** Clear draft for subChat */
  clearSubChatDraft: (chatId: string, subChatId: string) => void
}

export interface QuestionHandlersResult {
  /** Handler for answering questions */
  handleQuestionsAnswer: (answers: Record<string, string>) => Promise<void>
  /** Handler for skipping questions */
  handleQuestionsSkip: () => Promise<void>
  /** Handler for answering with custom text from input */
  handleSubmitWithQuestionAnswer: () => Promise<void>
  /** Memoized callback (undefined when no questions) */
  submitWithQuestionAnswerCallback: (() => Promise<void>) | undefined
  /** Clear pending and expired questions for this subChat */
  clearPendingQuestionCallback: () => void
}

export function useQuestionHandlers({
  subChatId,
  parentChatId,
  displayQuestions,
  isQuestionExpired,
  setPendingQuestionsMap,
  setExpiredQuestionsMap,
  editorRef,
  questionRef,
  isStreamingRef,
  stopRef,
  sendMessageRef,
  shouldAutoScrollRef,
  clearSubChatDraft,
}: QuestionHandlersOptions): QuestionHandlersResult {
  // Ref to prevent double submit of question answer
  const isSubmittingQuestionAnswerRef = useRef(false)

  // ==========================================================================
  // Helper Functions
  // ==========================================================================

  // Clear pending and expired questions for this subChat
  const clearPendingQuestionCallback = useCallback(() => {
    setPendingQuestionsMap((current) => {
      if (current.has(subChatId)) {
        const newMap = new Map(current)
        newMap.delete(subChatId)
        return newMap
      }
      return current
    })
    setExpiredQuestionsMap((current) => {
      if (current.has(subChatId)) {
        const newMap = new Map(current)
        newMap.delete(subChatId)
        return newMap
      }
      return current
    })
  }, [subChatId, setPendingQuestionsMap, setExpiredQuestionsMap])

  // Format answers as readable text
  const formatAnswersAsText = useCallback(
    (answers: Record<string, string>): string =>
      Object.entries(answers)
        .map(([question, answer]) => `${question}: ${answer}`)
        .join("\n"),
    [],
  )

  // Clear input editor and draft
  const clearInputAndDraft = useCallback(() => {
    editorRef.current?.clear()
    if (parentChatId) {
      clearSubChatDraft(parentChatId, subChatId)
    }
  }, [editorRef, parentChatId, subChatId, clearSubChatDraft])

  // Send a user message
  const sendUserMessage = useCallback(
    async (text: string) => {
      shouldAutoScrollRef.current = true
      await sendMessageRef.current({
        role: "user",
        parts: [{ type: "text", text }],
      })
    },
    [shouldAutoScrollRef, sendMessageRef],
  )

  // ==========================================================================
  // Main Handlers
  // ==========================================================================

  // Handle answering questions
  const handleQuestionsAnswer = useCallback(
    async (answers: Record<string, string>) => {
      if (!displayQuestions) return

      if (isQuestionExpired) {
        // Question timed out - send answers as a normal user message
        clearPendingQuestionCallback()
        await sendUserMessage(formatAnswersAsText(answers))
      } else {
        // Question is still live - use tool approval path
        await trpcClient.claude.respondToolApproval.mutate({
          toolUseId: displayQuestions.toolUseId,
          approved: true,
          updatedInput: { questions: displayQuestions.questions, answers },
        })
        clearPendingQuestionCallback()
      }
    },
    [
      displayQuestions,
      isQuestionExpired,
      clearPendingQuestionCallback,
      sendUserMessage,
      formatAnswersAsText,
    ],
  )

  // Handle skipping questions
  const handleQuestionsSkip = useCallback(async () => {
    if (!displayQuestions) return

    if (isQuestionExpired) {
      // Expired question - just clear the UI, no backend call needed
      clearPendingQuestionCallback()
      return
    }

    const toolUseId = displayQuestions.toolUseId

    // Clear UI immediately - don't wait for backend
    // This ensures dialog closes even if stream was already aborted
    clearPendingQuestionCallback()

    // Try to notify backend (may fail if already aborted - that's ok)
    try {
      await trpcClient.claude.respondToolApproval.mutate({
        toolUseId,
        approved: false,
        message: QUESTIONS_SKIPPED_MESSAGE,
      })
    } catch {
      // Stream likely already aborted - ignore
    }
  }, [displayQuestions, isQuestionExpired, clearPendingQuestionCallback])

  // Handle answering questions with custom text from input (called on Enter in input)
  const handleSubmitWithQuestionAnswer = useCallback(async () => {
    if (!displayQuestions) return
    if (isSubmittingQuestionAnswerRef.current) return
    isSubmittingQuestionAnswerRef.current = true

    try {
      // 1. Get custom text from input
      const customText = editorRef.current?.getValue()?.trim() || ""
      if (!customText) {
        isSubmittingQuestionAnswerRef.current = false
        return
      }

      // 2. Get already selected answers from question component
      const selectedAnswers = questionRef.current?.getAnswers() || {}
      const formattedAnswers: Record<string, string> = { ...selectedAnswers }

      // 3. Add custom text to the last question as "Other"
      const lastQuestion =
        displayQuestions.questions[displayQuestions.questions.length - 1]
      if (lastQuestion) {
        const existingAnswer = formattedAnswers[lastQuestion.question]
        if (existingAnswer) {
          // Append to existing answer
          formattedAnswers[lastQuestion.question] =
            `${existingAnswer}, Other: ${customText}`
        } else {
          formattedAnswers[lastQuestion.question] = `Other: ${customText}`
        }
      }

      if (isQuestionExpired) {
        // Expired: send user's custom text as-is (don't format)
        clearPendingQuestionCallback()
        clearInputAndDraft()
        await sendUserMessage(customText)
      } else {
        // Live: use existing tool approval flow
        await trpcClient.claude.respondToolApproval.mutate({
          toolUseId: displayQuestions.toolUseId,
          approved: true,
          updatedInput: {
            questions: displayQuestions.questions,
            answers: formattedAnswers,
          },
        })
        clearPendingQuestionCallback()

        // Stop stream if currently streaming
        if (isStreamingRef.current) {
          chatRegistry.setManuallyAborted(subChatId, true)
          await stopRef.current()
          await new Promise((resolve) => setTimeout(resolve, 100))
        }

        clearInputAndDraft()
        await sendUserMessage(customText)
      }
    } finally {
      isSubmittingQuestionAnswerRef.current = false
    }
  }, [
    displayQuestions,
    isQuestionExpired,
    editorRef,
    questionRef,
    clearPendingQuestionCallback,
    clearInputAndDraft,
    sendUserMessage,
    isStreamingRef,
    stopRef,
    subChatId,
  ])

  // Memoize the callback to prevent ChatInputArea re-renders
  // Only provide callback when there's a pending or expired question for this subChat
  const submitWithQuestionAnswerCallback = useMemo(
    () => (displayQuestions ? handleSubmitWithQuestionAnswer : undefined),
    [displayQuestions, handleSubmitWithQuestionAnswer],
  )

  return {
    handleQuestionsAnswer,
    handleQuestionsSkip,
    handleSubmitWithQuestionAnswer,
    submitWithQuestionAnswerCallback,
    clearPendingQuestionCallback,
  }
}
