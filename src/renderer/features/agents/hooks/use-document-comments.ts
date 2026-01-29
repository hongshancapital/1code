import { useAtom } from "jotai"
import { useCallback, useMemo } from "react"
import {
  reviewCommentsAtomFamily,
  generateCommentId,
  hashText,
  type DocumentComment,
  type DocumentType,
  type CommentAnchor,
} from "../atoms/review-atoms"

interface AddCommentParams {
  documentType: DocumentType
  documentPath: string
  selectedText: string
  content: string
  // Line information
  lineStart?: number
  lineEnd?: number
  lineType?: "old" | "new"
  // Character position for highlight rendering
  charStart?: number
  charLength?: number
}

interface UpdateCommentParams {
  content?: string
}

/**
 * Hook for managing document comments
 * Provides CRUD operations and computed values for the review system
 */
export function useDocumentComments(chatId: string) {
  const [comments, setComments] = useAtom(reviewCommentsAtomFamily(chatId))

  /**
   * Add a new comment
   */
  const addComment = useCallback((params: AddCommentParams): DocumentComment => {
    const now = new Date().toISOString()
    const anchor: CommentAnchor = {
      selectedText: params.selectedText,
      textHash: hashText(params.selectedText),
      lineStart: params.lineStart,
      lineEnd: params.lineEnd,
      lineType: params.lineType,
      charStart: params.charStart,
      charLength: params.charLength ?? params.selectedText.length,
    }

    const newComment: DocumentComment = {
      id: generateCommentId(),
      documentType: params.documentType,
      documentPath: params.documentPath,
      anchor,
      content: params.content,
      createdAt: now,
      updatedAt: now,
    }

    setComments([...comments, newComment])
    return newComment
  }, [comments, setComments])

  /**
   * Update an existing comment
   */
  const updateComment = useCallback((id: string, updates: UpdateCommentParams) => {
    setComments(
      comments.map((c) =>
        c.id === id
          ? {
              ...c,
              ...updates,
              updatedAt: new Date().toISOString(),
            }
          : c
      )
    )
  }, [comments, setComments])

  /**
   * Remove a comment by ID
   */
  const removeComment = useCallback((id: string) => {
    setComments(comments.filter((c) => c.id !== id))
  }, [comments, setComments])

  /**
   * Clear all comments (after submit)
   */
  const clearComments = useCallback(() => {
    setComments([])
  }, [setComments])

  /**
   * Get a comment by ID
   */
  const getComment = useCallback((id: string): DocumentComment | undefined => {
    return comments.find((c) => c.id === id)
  }, [comments])

  /**
   * Comments grouped by document path
   */
  const commentsByDocument = useMemo(() => {
    return comments.reduce((acc, comment) => {
      const key = comment.documentPath
      if (!acc[key]) acc[key] = []
      acc[key].push(comment)
      return acc
    }, {} as Record<string, DocumentComment[]>)
  }, [comments])

  /**
   * Get comments for a specific document
   */
  const getCommentsForDocument = useCallback((documentPath: string): DocumentComment[] => {
    return comments.filter((c) => c.documentPath === documentPath)
  }, [comments])

  /**
   * Check if a specific text range has a comment
   * Used for highlighting in the document
   */
  const findCommentForText = useCallback((
    documentPath: string,
    selectedText: string
  ): DocumentComment | undefined => {
    const textHash = hashText(selectedText)
    return comments.find(
      (c) => c.documentPath === documentPath && c.anchor.textHash === textHash
    )
  }, [comments])

  return {
    // Data
    comments,
    commentsByDocument,
    hasComments: comments.length > 0,
    commentCount: comments.length,

    // Actions
    addComment,
    updateComment,
    removeComment,
    clearComments,

    // Queries
    getComment,
    getCommentsForDocument,
    findCommentForText,
  }
}
