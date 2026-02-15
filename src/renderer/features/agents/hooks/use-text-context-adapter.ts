/**
 * useTextContextAdapter - Unified text selection source handler
 *
 * Wraps addTextContext to handle different selection sources
 * (assistant-message, diff, tool-edit, plan, file-viewer).
 * Also listens for file-viewer custom events to add context.
 */

import { useCallback, useEffect } from "react"
import type { TextSelectionSource } from "../context/text-selection-context"

export interface UseTextContextAdapterOptions {
  addTextContextOriginal: (text: string, sourceMessageId: string) => void
  addDiffTextContext: (
    text: string,
    filePath: string,
    lineNumber?: number,
    lineType?: "old" | "new",
    comment?: string,
  ) => void
  editorRef: React.RefObject<{ focus: () => void } | null>
}

export interface UseTextContextAdapterResult {
  addTextContext: (text: string, source: TextSelectionSource) => void
  handleFocusInput: () => void
}

export function useTextContextAdapter({
  addTextContextOriginal,
  addDiffTextContext,
  editorRef,
}: UseTextContextAdapterOptions): UseTextContextAdapterResult {
  const addTextContext = useCallback(
    (text: string, source: TextSelectionSource) => {
      if (source.type === "assistant-message") {
        addTextContextOriginal(text, source.messageId)
      } else if (source.type === "diff") {
        addDiffTextContext(
          text,
          source.filePath,
          source.lineNumber,
          source.lineType,
        )
      } else if (source.type === "tool-edit") {
        addDiffTextContext(text, source.filePath)
      } else if (source.type === "plan") {
        addDiffTextContext(text, source.planPath)
      } else if (source.type === "file-viewer") {
        addDiffTextContext(text, source.filePath)
      }
    },
    [addTextContextOriginal, addDiffTextContext],
  )

  const handleFocusInput = useCallback(() => {
    editorRef.current?.focus()
  }, [])

  // Listen for file-viewer "Add to Context" from the custom context menu
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        text: string
        source: TextSelectionSource
      }
      if (detail.text && detail.source) {
        addTextContext(detail.text, detail.source)
        editorRef.current?.focus()
      }
    }
    window.addEventListener("file-viewer-add-to-context", handler)
    return () =>
      window.removeEventListener("file-viewer-add-to-context", handler)
  }, [addTextContext])

  return { addTextContext, handleFocusInput }
}
