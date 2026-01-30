"use client"

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react"

// Discriminated union for selection source
export type TextSelectionSource =
  | { type: "assistant-message"; messageId: string }
  | { type: "diff"; filePath: string; lineNumber?: number; lineType?: "old" | "new" }
  | { type: "tool-edit"; filePath: string; isWrite: boolean }
  | { type: "plan"; planPath: string }

export interface TextSelectionState {
  selectedText: string | null
  source: TextSelectionSource | null
  selectionRect: DOMRect | null
  // Character position info for precise highlighting
  charStart: number | null
  charLength: number | null
  // Line information calculated from selection
  lineStart: number | null
  lineEnd: number | null
}

interface TextSelectionContextValue extends TextSelectionState {
  clearSelection: () => void
  /** Lock the selection state to prevent it from being cleared when input is focused */
  lockSelection: () => void
  /** Unlock the selection state */
  unlockSelection: () => void
  /** Whether selection is currently locked */
  isLocked: boolean
  // Legacy getters for backwards compatibility
  selectedMessageId: string | null
}

const TextSelectionContext = createContext<TextSelectionContextValue | null>(
  null
)

export function useTextSelection(): TextSelectionContextValue {
  const ctx = useContext(TextSelectionContext)
  if (!ctx) {
    throw new Error(
      "useTextSelection must be used within TextSelectionProvider"
    )
  }
  return ctx
}

interface TextSelectionProviderProps {
  children: ReactNode
}

// Helper to calculate character offset and line numbers within a container
function calculateSelectionPosition(
  container: HTMLElement,
  range: Range
): { charStart: number; charLength: number; lineStart: number; lineEnd: number } {
  // Create a range from the start of container to the start of selection
  const preSelectionRange = document.createRange()
  preSelectionRange.selectNodeContents(container)
  preSelectionRange.setEnd(range.startContainer, range.startOffset)

  // Get the text content before the selection to calculate charStart
  const preSelectionText = preSelectionRange.toString()
  const charStart = preSelectionText.length

  // charLength is the length of the selected text
  const selectedText = range.toString()
  const charLength = selectedText.length

  // Calculate line numbers (1-indexed)
  // Count newlines in the text before selection to get lineStart
  const newlinesBefore = (preSelectionText.match(/\n/g) || []).length
  const lineStart = newlinesBefore + 1

  // Count newlines in the selected text to get lineEnd
  const newlinesInSelection = (selectedText.match(/\n/g) || []).length
  const lineEnd = lineStart + newlinesInSelection

  return { charStart, charLength, lineStart, lineEnd }
}

// Helper to extract line number from diff selection
function extractDiffLineInfo(element: Element): { lineNumber?: number; lineType?: "old" | "new" } {
  // Find the closest table row (tr) which contains line number info
  const row = element.closest("tr")
  if (!row) return {}

  let lineNumber: number | undefined
  let lineType: "old" | "new" | undefined

  // Get data-side from row for type determination
  const dataSide = row.getAttribute("data-side")

  // First try: data-line-num attribute on spans (most accurate for actual line number)
  // This is used in split view mode
  const lineNumSpan = row.querySelector("[data-line-num]")
  if (lineNumSpan) {
    const numAttr = lineNumSpan.getAttribute("data-line-num")
    if (numAttr) {
      const parsed = parseInt(numAttr, 10)
      if (!isNaN(parsed) && parsed > 0) {
        lineNumber = parsed
        // Determine type from data-side
        if (dataSide === "old") {
          lineType = "old"
        } else {
          lineType = "new"
        }
      }
    }
  }

  // Second try: data-line-new-num and data-line-old-num attributes (unified view)
  if (!lineNumber) {
    const newLineNumSpan = row.querySelector("[data-line-new-num]")
    const oldLineNumSpan = row.querySelector("[data-line-old-num]")

    // Prefer new line number if available (for added/modified lines)
    if (newLineNumSpan) {
      const numAttr = newLineNumSpan.getAttribute("data-line-new-num")
      if (numAttr) {
        const parsed = parseInt(numAttr, 10)
        if (!isNaN(parsed) && parsed > 0) {
          lineNumber = parsed
          lineType = "new"
        }
      }
    }

    // Fall back to old line number (for deleted lines)
    if (!lineNumber && oldLineNumSpan) {
      const numAttr = oldLineNumSpan.getAttribute("data-line-old-num")
      if (numAttr) {
        const parsed = parseInt(numAttr, 10)
        if (!isNaN(parsed) && parsed > 0) {
          lineNumber = parsed
          lineType = "old"
        }
      }
    }
  }

  // Third try: text content of cells containing numbers (for any view mode)
  if (!lineNumber) {
    // Look for td cells that contain line numbers
    const tds = Array.from(row.querySelectorAll("td"))
    for (const td of tds) {
      // Skip cells with content class (these have the actual code)
      if (td.className.includes("content")) continue

      // Look for spans with numbers inside
      const spans = Array.from(td.querySelectorAll("span"))
      for (const span of spans) {
        const text = span.textContent?.trim()
        if (text && /^\d+$/.test(text)) {
          const parsed = parseInt(text, 10)
          if (!isNaN(parsed) && parsed > 0) {
            lineNumber = parsed
            // Determine type based on data-side or class
            if (dataSide === "old" || td.className.includes("old")) {
              lineType = "old"
            } else {
              lineType = "new"
            }
            break
          }
        }
      }
      if (lineNumber) break
    }
  }

  return { lineNumber, lineType }
}

const emptyState: TextSelectionState = {
  selectedText: null,
  source: null,
  selectionRect: null,
  charStart: null,
  charLength: null,
  lineStart: null,
  lineEnd: null,
}

export function TextSelectionProvider({
  children,
}: TextSelectionProviderProps) {
  const [state, setState] = useState<TextSelectionState>(emptyState)
  const [isLocked, setIsLocked] = useState(false)
  const isLockedRef = useRef(false)

  // Keep ref in sync with state for use in event handlers
  useEffect(() => {
    isLockedRef.current = isLocked
  }, [isLocked])

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges()
    setState(emptyState)
    setIsLocked(false)
  }, [])

  const lockSelection = useCallback(() => {
    setIsLocked(true)
  }, [])

  const unlockSelection = useCallback(() => {
    setIsLocked(false)
  }, [])

  useEffect(() => {
    let rafId: number | null = null

    const handleSelectionChange = () => {
      // Cancel any pending frame to debounce rapid selection changes
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }

      rafId = requestAnimationFrame(() => {
        rafId = null

        // Skip updates when selection is locked (e.g., when QuickCommentInput is open)
        if (isLockedRef.current) {
          return
        }

        const selection = window.getSelection()

        // No selection or collapsed (just cursor)
        if (!selection || selection.isCollapsed) {
          setState(emptyState)
          return
        }

        const text = selection.toString().trim()
        if (!text) {
          setState(emptyState)
          return
        }

        // Get the selection range
        const range = selection.getRangeAt(0)
        const container = range.commonAncestorContainer

        // Find the element containing the selection
        const element =
          container.nodeType === Node.TEXT_NODE
            ? container.parentElement
            : (container as Element)

        // Check for assistant message first
        // Must be inside [data-assistant-message-id] element
        const messageElement = element?.closest?.(
          "[data-assistant-message-id]"
        ) as HTMLElement | null

        // Check for tool-edit (Edit/Write tool in chat)
        // Use specific selector for Edit/Write tools only
        const toolEditElement = element?.closest?.(
          '[data-part-type="tool-Edit"], [data-part-type="tool-Write"]'
        ) as HTMLElement | null

        // Check for diff file - must be inside .agent-diff-wrapper (the actual code area)
        // This prevents selection in diff headers, buttons, etc.
        const diffWrapperElement = element?.closest?.(".agent-diff-wrapper") as HTMLElement | null
        const diffElement = diffWrapperElement?.closest?.(
          "[data-diff-file-path]"
        ) as HTMLElement | null

        // Check for plan sidebar content
        const planElement = element?.closest?.(
          "[data-plan-path]"
        ) as HTMLElement | null

        // Build the source based on what we found
        // Priority: plan > tool-edit > diff > assistant-message
        let source: TextSelectionSource | null = null

        if (planElement) {
          // Plan selection - extract plan path from data attribute
          const planPath = planElement.getAttribute("data-plan-path") || "unknown"
          source = {
            type: "plan",
            planPath,
          }
        }

        if (!source && toolEditElement) {
          // Tool edit selection - extract file path from data attribute
          const partType = toolEditElement.getAttribute("data-part-type")
          const isWrite = partType === "tool-Write"
          const filePath = toolEditElement.getAttribute("data-tool-file-path") || "unknown"
          source = {
            type: "tool-edit",
            filePath,
            isWrite,
          }
        }

        if (!source && diffElement && diffWrapperElement) {
          // Only allow diff selection if inside the actual diff content wrapper
          const filePath = diffElement.getAttribute("data-diff-file-path")
          if (filePath) {
            const lineInfo = element ? extractDiffLineInfo(element) : {}
            source = {
              type: "diff",
              filePath,
              lineNumber: lineInfo.lineNumber,
              lineType: lineInfo.lineType,
            }
          }
        }

        // Fallback to assistant message (check last because tool-edit is nested inside)
        if (!source && messageElement) {
          const messageId = messageElement.getAttribute("data-assistant-message-id")
          if (messageId) {
            source = { type: "assistant-message", messageId }
          }
        }

        // Selection is not within a supported element
        if (!source) {
          setState(emptyState)
          return
        }

        // Get the bounding rect of the selection
        const rect = range.getBoundingClientRect()

        // Calculate character position and line numbers within the source container
        // Find the container element for the source
        let sourceContainer: HTMLElement | null = null
        if (source.type === "plan") {
          sourceContainer = planElement
        } else if (source.type === "tool-edit") {
          sourceContainer = toolEditElement
        } else if (source.type === "diff") {
          sourceContainer = diffWrapperElement
        }

        let charStart: number | null = null
        let charLength: number | null = null
        let lineStart: number | null = null
        let lineEnd: number | null = null

        if (sourceContainer) {
          // Calculate character offset and line numbers from the start of the container
          const posInfo = calculateSelectionPosition(sourceContainer, range)
          charStart = posInfo.charStart
          charLength = posInfo.charLength

          // For diff, use actual line numbers from DOM instead of calculating from newlines
          if (source.type === "diff") {
            // Get line info from start and end of selection
            const startElement = range.startContainer.nodeType === Node.TEXT_NODE
              ? range.startContainer.parentElement
              : (range.startContainer as Element)
            const endElement = range.endContainer.nodeType === Node.TEXT_NODE
              ? range.endContainer.parentElement
              : (range.endContainer as Element)

            const startLineInfo = startElement ? extractDiffLineInfo(startElement) : {}
            const endLineInfo = endElement ? extractDiffLineInfo(endElement) : {}

            // Use the extracted line numbers if available
            if (startLineInfo.lineNumber) {
              lineStart = startLineInfo.lineNumber
            }
            if (endLineInfo.lineNumber) {
              lineEnd = endLineInfo.lineNumber
            }

            // If only one line number found, use it for both (single line selection)
            if (lineStart && !lineEnd) lineEnd = lineStart
            if (lineEnd && !lineStart) lineStart = lineEnd

            // Ensure lineStart <= lineEnd (in case selection was made bottom-to-top)
            if (lineStart && lineEnd && lineStart > lineEnd) {
              const temp = lineStart
              lineStart = lineEnd
              lineEnd = temp
            }
          } else {
            // For non-diff sources, use the calculated line numbers
            lineStart = posInfo.lineStart
            lineEnd = posInfo.lineEnd
          }
        }

        setState({
          selectedText: text,
          source,
          selectionRect: rect,
          charStart,
          charLength,
          lineStart,
          lineEnd,
        })
      })
    }

    document.addEventListener("selectionchange", handleSelectionChange)

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange)
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
      }
    }
  }, [])

  // Compute legacy selectedMessageId for backwards compatibility
  const selectedMessageId = state.source?.type === "assistant-message"
    ? state.source.messageId
    : null

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo<TextSelectionContextValue>(() => ({
    ...state,
    clearSelection,
    lockSelection,
    unlockSelection,
    isLocked,
    selectedMessageId,
  }), [state, clearSelection, lockSelection, unlockSelection, isLocked, selectedMessageId])

  return (
    <TextSelectionContext.Provider value={contextValue}>
      {children}
    </TextSelectionContext.Provider>
  )
}
