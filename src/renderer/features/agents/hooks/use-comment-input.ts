/**
 * useCommentInput - Opens the comment input from a text selection source
 *
 * Unifies the TextSelectionSource → CommentInputState mapping logic
 * that was previously duplicated in ChatViewInner and ChatView.
 */

import { useCallback } from "react"
import { useSetAtom } from "jotai"
import { commentInputStateAtom, type DocumentType } from "../atoms/review-atoms"
import type { TextSelectionSource } from "../ui/text-selection-provider"

/**
 * Returns a callback that opens the comment input popover for a given text selection.
 * Used by TextSelectionPopover's onAddComment prop.
 */
export function useCommentInput() {
  const setCommentInputState = useSetAtom(commentInputStateAtom)

  const openCommentInput = useCallback((
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
        if (!finalLineEnd) finalLineEnd = finalLineStart
      }
      lineType = source.lineType
    } else if (source.type === "tool-edit") {
      documentType = "tool-edit"
      documentPath = source.filePath
    } else {
      return // Don't handle assistant-message or file-viewer types
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
  }, [setCommentInputState])

  return openCommentInput
}
