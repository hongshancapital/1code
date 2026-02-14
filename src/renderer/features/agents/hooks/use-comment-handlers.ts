/**
 * useCommentHandlers - Document comment handling logic
 *
 * Extracts comment-related handlers from ChatViewInner:
 * - handleAddComment: Creates new comment from text selection
 * - handleCommentSubmit: Submits new comment
 * - handleCommentCancel: Cancels comment input
 * - handleCommentUpdate: Updates existing comment
 * - handleCommentDelete: Deletes existing comment
 *
 * This hook works with useDocumentComments for state management.
 */

import { useCallback, useMemo } from "react"
import type { TextSelectionSource, DocumentType } from "../ui/text-selection-provider"
import type { CommentInputState } from "../../comments/atoms"

export interface CommentHandlersOptions {
  /** Current comment input state */
  commentInputState: CommentInputState | null
  /** Setter for comment input state */
  setCommentInputState: (state: CommentInputState | null) => void
  /** Add new comment to store */
  addComment: (comment: {
    documentType: DocumentType
    documentPath: string
    selectedText: string
    content: string
    lineStart?: number
    lineEnd?: number
    lineType?: "old" | "new"
    charStart?: number
    charLength?: number
  }) => void
  /** Update existing comment */
  updateComment: (id: string, updates: { content?: string }) => void
  /** Remove comment by ID */
  removeComment: (id: string) => void
  /** Get comment by ID */
  getComment: (id: string) => { content: string } | undefined
}

export interface CommentHandlersResult {
  /** Handler for adding a new comment from text selection */
  handleAddComment: (
    text: string,
    source: TextSelectionSource,
    rect: DOMRect,
    charStart?: number | null,
    charLength?: number | null,
    lineStart?: number | null,
    lineEnd?: number | null
  ) => void
  /** Handler for submitting a new comment */
  handleCommentSubmit: (content: string) => void
  /** Handler for canceling comment input */
  handleCommentCancel: () => void
  /** Handler for updating an existing comment */
  handleCommentUpdate: (content: string) => void
  /** Handler for deleting an existing comment */
  handleCommentDelete: () => void
  /** The existing comment being edited (if any) */
  existingComment: { content: string } | undefined
}

export function useCommentHandlers({
  commentInputState,
  setCommentInputState,
  addComment,
  updateComment,
  removeComment,
  getComment,
}: CommentHandlersOptions): CommentHandlersResult {
  // Handler for adding a new comment from text selection
  const handleAddComment = useCallback(
    (
      text: string,
      source: TextSelectionSource,
      rect: DOMRect,
      charStart?: number | null,
      charLength?: number | null,
      lineStart?: number | null,
      lineEnd?: number | null
    ) => {
      // Map TextSelectionSource to DocumentType
      let documentType: DocumentType
      let documentPath: string
      let lineType: "old" | "new" | undefined

      // Use passed lineStart/lineEnd, but for diff also check source.lineNumber
      let finalLineStart = lineStart ?? undefined
      let finalLineEnd = lineEnd ?? undefined

      if (source.type === "plan") {
        documentType = "plan"
        documentPath = source.planPath
      } else if (source.type === "diff") {
        documentType = "diff"
        documentPath = source.filePath
        // For diff, prefer source.lineNumber if available (more accurate from DOM)
        if (source.lineNumber) {
          finalLineStart = source.lineNumber
          // If we don't have lineEnd, use lineStart
          if (!finalLineEnd) finalLineEnd = finalLineStart
        }
        lineType = source.lineType
      } else if (source.type === "tool-edit") {
        documentType = "tool-edit"
        documentPath = source.filePath
      } else {
        return // Don't handle assistant-message type for comments
      }

      setCommentInputState({
        selectedText: text,
        documentType,
        documentPath,
        lineStart: finalLineStart,
        lineEnd: finalLineEnd,
        lineType,
        charStart: charStart ?? undefined,
        charLength: charLength ?? undefined,
        rect,
      })
    },
    [setCommentInputState]
  )

  // Handler for submitting a new comment
  const handleCommentSubmit = useCallback(
    (content: string) => {
      if (!commentInputState) return

      addComment({
        documentType: commentInputState.documentType,
        documentPath: commentInputState.documentPath,
        selectedText: commentInputState.selectedText,
        content,
        lineStart: commentInputState.lineStart,
        lineEnd: commentInputState.lineEnd,
        lineType: commentInputState.lineType,
        charStart: commentInputState.charStart,
        charLength: commentInputState.charLength,
      })

      setCommentInputState(null)
      window.getSelection()?.removeAllRanges()
    },
    [commentInputState, addComment, setCommentInputState]
  )

  // Handler for canceling comment input
  const handleCommentCancel = useCallback(() => {
    setCommentInputState(null)
  }, [setCommentInputState])

  // Handler for updating an existing comment
  const handleCommentUpdate = useCallback(
    (content: string) => {
      if (!commentInputState?.existingCommentId) return
      updateComment(commentInputState.existingCommentId, { content })
      setCommentInputState(null)
    },
    [commentInputState, updateComment, setCommentInputState]
  )

  // Handler for deleting an existing comment
  const handleCommentDelete = useCallback(() => {
    if (!commentInputState?.existingCommentId) return
    removeComment(commentInputState.existingCommentId)
    setCommentInputState(null)
  }, [commentInputState, removeComment, setCommentInputState])

  // Get existing comment for edit mode
  const existingComment = useMemo(() => {
    if (!commentInputState?.existingCommentId) return undefined
    return getComment(commentInputState.existingCommentId)
  }, [commentInputState?.existingCommentId, getComment])

  return {
    handleAddComment,
    handleCommentSubmit,
    handleCommentCancel,
    handleCommentUpdate,
    handleCommentDelete,
    existingComment,
  }
}
