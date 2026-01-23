import { useCallback } from "react"
import { useAtom, useSetAtom } from "jotai"
import { nanoid } from "nanoid"
import {
  pendingCommentsAtomFamily,
  activeCommentInputAtom,
  lineSelectionAtom,
} from "../atoms"
import type {
  ReviewComment,
  LineRange,
  CommentSource,
  ActiveCommentInput,
} from "../types"

/**
 * Hook for managing review comments CRUD operations
 */
export function useCommentActions(chatId: string) {
  const [comments, setComments] = useAtom(pendingCommentsAtomFamily(chatId))
  const setActiveInput = useSetAtom(activeCommentInputAtom)
  const setLineSelection = useSetAtom(lineSelectionAtom)

  /**
   * Add a new comment
   */
  const addComment = useCallback(
    (params: {
      filePath: string
      lineRange: LineRange
      body: string
      selectedCode?: string
      source: CommentSource
    }) => {
      const newComment: ReviewComment = {
        id: nanoid(),
        filePath: params.filePath,
        lineRange: params.lineRange,
        body: params.body,
        selectedCode: params.selectedCode,
        source: params.source,
        status: "pending",
        createdAt: Date.now(),
      }

      setComments((prev) => [...prev, newComment])
      return newComment
    },
    [setComments]
  )

  /**
   * Update an existing comment
   */
  const updateComment = useCallback(
    (commentId: string, updates: Partial<Pick<ReviewComment, "body">>) => {
      setComments((prev) =>
        prev.map((comment) =>
          comment.id === commentId ? { ...comment, ...updates } : comment
        )
      )
    },
    [setComments]
  )

  /**
   * Delete a comment by ID
   */
  const deleteComment = useCallback(
    (commentId: string) => {
      setComments((prev) => prev.filter((comment) => comment.id !== commentId))
    },
    [setComments]
  )

  /**
   * Delete all comments for a specific file
   */
  const deleteFileComments = useCallback(
    (filePath: string) => {
      setComments((prev) =>
        prev.filter((comment) => comment.filePath !== filePath)
      )
    },
    [setComments]
  )

  /**
   * Clear all pending comments
   */
  const clearAllComments = useCallback(() => {
    setComments([])
  }, [setComments])

  /**
   * Mark all comments as submitted
   */
  const markAllAsSubmitted = useCallback(() => {
    setComments((prev) =>
      prev.map((comment) => ({ ...comment, status: "submitted" as const }))
    )
  }, [setComments])

  /**
   * Open comment input popup for a specific line/range
   */
  const openCommentInput = useCallback(
    (input: ActiveCommentInput) => {
      setActiveInput(input)
    },
    [setActiveInput]
  )

  /**
   * Close comment input popup
   */
  const closeCommentInput = useCallback(() => {
    setActiveInput(null)
    setLineSelection(null)
  }, [setActiveInput, setLineSelection])

  /**
   * Get comments for a specific file
   */
  const getFileComments = useCallback(
    (filePath: string) => {
      return comments.filter((comment) => comment.filePath === filePath)
    },
    [comments]
  )

  /**
   * Get comments that overlap with a specific line range
   */
  const getCommentsInRange = useCallback(
    (filePath: string, startLine: number, endLine: number, side?: "old" | "new") => {
      return comments.filter((comment) => {
        if (comment.filePath !== filePath) return false
        const { startLine: cStart, endLine: cEnd, side: cSide } = comment.lineRange
        const hasOverlap = cStart <= endLine && cEnd >= startLine
        if (side && cSide) {
          return hasOverlap && cSide === side
        }
        return hasOverlap
      })
    },
    [comments]
  )

  return {
    comments,
    addComment,
    updateComment,
    deleteComment,
    deleteFileComments,
    clearAllComments,
    markAllAsSubmitted,
    openCommentInput,
    closeCommentInput,
    getFileComments,
    getCommentsInRange,
  }
}
