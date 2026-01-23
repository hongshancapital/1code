import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
import { useAtom } from "jotai"
import { createPortal } from "react-dom"
import { activeCommentInputAtom, lineSelectionAtom } from "../atoms"
import { CommentIndicator, CommentAddButton } from "./comment-indicator"
import { CommentInputPopup } from "./comment-input-popup"
import { useCommentActions } from "../hooks/use-comment-actions"
import type { ReviewComment, LineRange } from "../types"
import { cn } from "../../../lib/utils"

interface CommentGutterLayerProps {
  /** Chat ID for comment storage */
  chatId: string
  /** File path being displayed */
  filePath: string
  /** Reference to the diff view container */
  diffViewContainerRef: RefObject<HTMLDivElement | null>
  /** Existing comments for this file */
  comments: ReviewComment[]
  /** Diff mode: unified or split */
  diffMode: "unified" | "split"
  /** Callback when a comment is added */
  onCommentAdded?: (comment: ReviewComment) => void
}

interface LineInfo {
  element: HTMLElement
  lineNumber: number
  side: "old" | "new"
  rect: DOMRect
}

/**
 * CommentGutterLayer - Adds comment controls to diff view line numbers
 *
 * Uses direct DOM manipulation to inject hover buttons into the diff view
 * without blocking user interaction with the diff content.
 */
export const CommentGutterLayer = memo(function CommentGutterLayer({
  chatId,
  filePath,
  diffViewContainerRef,
  comments,
  diffMode,
  onCommentAdded,
}: CommentGutterLayerProps) {
  const [activeInput, setActiveInput] = useAtom(activeCommentInputAtom)
  const [lineSelection, setLineSelection] = useAtom(lineSelectionAtom)
  const { addComment, closeCommentInput } = useCommentActions(chatId)

  const [hoveredLine, setHoveredLine] = useState<LineInfo | null>(null)
  const [lineInfoCache, setLineInfoCache] = useState<Map<HTMLElement, LineInfo>>(new Map())
  const isDragging = useRef(false)
  const dragStartLine = useRef<LineInfo | null>(null)

  // Scan for line elements and set up event listeners
  useEffect(() => {
    const container = diffViewContainerRef.current
    if (!container) return

    const lineInfoMap = new Map<HTMLElement, LineInfo>()

    const getLineInfo = (cell: HTMLElement): LineInfo | null => {
      if (lineInfoMap.has(cell)) {
        return lineInfoMap.get(cell)!
      }

      const lineNumText = cell.textContent?.trim()
      if (!lineNumText || lineNumText === "...") return null

      const lineNumber = parseInt(lineNumText, 10)
      if (isNaN(lineNumber)) return null

      const row = cell.closest("tr")
      if (!row) return null

      // Determine side based on class or position
      let side: "old" | "new" = "new"
      if (cell.classList.contains("diff-line-old-num")) {
        side = "old"
      } else if (cell.classList.contains("diff-line-new-num")) {
        side = "new"
      } else if (diffMode === "split") {
        const cells = Array.from(row.querySelectorAll(".diff-line-num, .diff-line-old-num, .diff-line-new-num"))
        const cellIndex = cells.indexOf(cell)
        side = cellIndex === 0 ? "old" : "new"
      }

      const rect = cell.getBoundingClientRect()
      const info: LineInfo = { element: cell, lineNumber, side, rect }
      lineInfoMap.set(cell, info)
      return info
    }

    // Mouse enter handler for line number cells
    const handleMouseEnter = (event: MouseEvent) => {
      if (isDragging.current) return
      const cell = event.currentTarget as HTMLElement
      const info = getLineInfo(cell)
      if (info) {
        // Update rect on hover (in case of scroll)
        info.rect = cell.getBoundingClientRect()
        setHoveredLine(info)
      }
    }

    const handleMouseLeave = () => {
      if (!isDragging.current) {
        setHoveredLine(null)
      }
    }

    // Find all line number cells and add listeners
    const lineNumCells = container.querySelectorAll(
      ".diff-line-num, .diff-line-old-num, .diff-line-new-num"
    )

    lineNumCells.forEach((cell) => {
      const el = cell as HTMLElement
      // Add hover cursor style
      el.style.cursor = "pointer"
      el.addEventListener("mouseenter", handleMouseEnter)
      el.addEventListener("mouseleave", handleMouseLeave)
    })

    setLineInfoCache(lineInfoMap)

    // Cleanup
    return () => {
      lineNumCells.forEach((cell) => {
        const el = cell as HTMLElement
        el.style.cursor = ""
        el.removeEventListener("mouseenter", handleMouseEnter)
        el.removeEventListener("mouseleave", handleMouseLeave)
      })
    }
  }, [diffViewContainerRef, diffMode])

  // Get code content for a line
  const getLineCode = useCallback((line: LineInfo): string => {
    const row = line.element.closest("tr")
    // Try different selectors for content
    const contentCell = row?.querySelector(
      ".diff-line-content-item, .diff-line-new-content, .diff-line-old-content, .diff-line-content"
    )
    return contentCell?.textContent || ""
  }, [])

  // Handle click to add comment (single line)
  const handleAddClick = useCallback(
    (line: LineInfo, event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()

      const selectedCode = getLineCode(line)

      setActiveInput({
        filePath,
        lineRange: {
          startLine: line.lineNumber,
          endLine: line.lineNumber,
          side: line.side,
        },
        selectedCode: selectedCode || undefined,
        anchorRect: line.rect,
        source: "diff-view",
      })
    },
    [filePath, setActiveInput, getLineCode]
  )

  // Handle mouse down for drag selection
  const handleMouseDown = useCallback(
    (line: LineInfo, event: React.MouseEvent) => {
      if (event.button !== 0) return

      event.preventDefault()
      isDragging.current = true
      dragStartLine.current = line

      setLineSelection({
        filePath,
        startLine: line.lineNumber,
        currentLine: line.lineNumber,
        side: line.side,
      })
    },
    [filePath, setLineSelection]
  )

  // Handle drag selection
  useEffect(() => {
    if (!lineSelection || !isDragging.current) return

    const handleGlobalMouseMove = (event: MouseEvent) => {
      const container = diffViewContainerRef.current
      if (!container) return

      // Find line at mouse position
      const cells = container.querySelectorAll(
        ".diff-line-num, .diff-line-old-num, .diff-line-new-num"
      )

      for (const cell of Array.from(cells)) {
        const rect = cell.getBoundingClientRect()
        if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
          const lineNumText = cell.textContent?.trim()
          if (!lineNumText || lineNumText === "...") continue

          const lineNumber = parseInt(lineNumText, 10)
          if (isNaN(lineNumber)) continue

          // Check if same side
          let side: "old" | "new" = "new"
          if (cell.classList.contains("diff-line-old-num")) {
            side = "old"
          } else if (cell.classList.contains("diff-line-new-num")) {
            side = "new"
          }

          if (side === lineSelection.side) {
            setLineSelection((prev) =>
              prev ? { ...prev, currentLine: lineNumber } : null
            )
          }
          break
        }
      }
    }

    const handleGlobalMouseUp = () => {
      if (!isDragging.current || !dragStartLine.current || !lineSelection) {
        isDragging.current = false
        return
      }

      isDragging.current = false
      const startLine = lineSelection.startLine
      const endLine = lineSelection.currentLine
      const minLine = Math.min(startLine, endLine)
      const maxLine = Math.max(startLine, endLine)

      // Get selected code
      const container = diffViewContainerRef.current
      let selectedCode = ""

      if (container) {
        const cells = container.querySelectorAll(
          ".diff-line-num, .diff-line-old-num, .diff-line-new-num"
        )

        for (const cell of Array.from(cells)) {
          const lineNumText = cell.textContent?.trim()
          if (!lineNumText) continue
          const lineNum = parseInt(lineNumText, 10)
          if (isNaN(lineNum) || lineNum < minLine || lineNum > maxLine) continue

          // Check side
          let side: "old" | "new" = "new"
          if (cell.classList.contains("diff-line-old-num")) {
            side = "old"
          }
          if (side !== lineSelection.side) continue

          const row = cell.closest("tr")
          const contentCell = row?.querySelector(
            ".diff-line-content-item, .diff-line-new-content, .diff-line-old-content"
          )
          if (contentCell?.textContent) {
            selectedCode += contentCell.textContent + "\n"
          }
        }
      }

      // Open comment input
      const startRect = dragStartLine.current.element.getBoundingClientRect()

      setActiveInput({
        filePath,
        lineRange: {
          startLine: minLine,
          endLine: maxLine,
          side: lineSelection.side,
        },
        selectedCode: selectedCode.trimEnd() || undefined,
        anchorRect: startRect,
        source: "diff-view",
      })

      setLineSelection(null)
      dragStartLine.current = null
    }

    document.addEventListener("mousemove", handleGlobalMouseMove)
    document.addEventListener("mouseup", handleGlobalMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove)
      document.removeEventListener("mouseup", handleGlobalMouseUp)
    }
  }, [lineSelection, diffViewContainerRef, filePath, setActiveInput, setLineSelection])

  // Handle comment submission
  const handleSubmitComment = useCallback(
    (body: string) => {
      if (!activeInput) return

      const newComment = addComment({
        filePath: activeInput.filePath,
        lineRange: activeInput.lineRange,
        body,
        selectedCode: activeInput.selectedCode,
        source: activeInput.source,
      })

      onCommentAdded?.(newComment)
      closeCommentInput()
    },
    [activeInput, addComment, closeCommentInput, onCommentAdded]
  )

  // Get comment count for a line
  const getCommentCountForLine = useCallback(
    (lineNumber: number, side: "old" | "new") => {
      return comments.filter((c) => {
        const { startLine, endLine, side: cSide } = c.lineRange
        const inRange = lineNumber >= startLine && lineNumber <= endLine
        return inRange && (!cSide || cSide === side)
      }).length
    },
    [comments]
  )

  // Render floating UI elements using portal
  const container = diffViewContainerRef.current
  if (!container) return null

  const commentCount = hoveredLine
    ? getCommentCountForLine(hoveredLine.lineNumber, hoveredLine.side)
    : 0

  return (
    <>
      {/* Floating add button - rendered via portal to avoid z-index issues */}
      {hoveredLine && createPortal(
        <div
          className="fixed z-50 flex items-center"
          style={{
            top: hoveredLine.rect.top + hoveredLine.rect.height / 2,
            left: hoveredLine.rect.left - 20,
            transform: "translateY(-50%)",
          }}
        >
          {commentCount > 0 ? (
            <CommentIndicator count={commentCount} size="sm" />
          ) : (
            <CommentAddButton
              onClick={(e) => handleAddClick(hoveredLine, e)}
              onMouseDown={(e) => handleMouseDown(hoveredLine, e)}
            />
          )}
        </div>,
        document.body
      )}

      {/* Comment input popup */}
      {activeInput && activeInput.filePath === filePath && (
        <CommentInputPopup
          filePath={activeInput.filePath}
          lineRange={activeInput.lineRange}
          anchorRect={activeInput.anchorRect}
          selectedCode={activeInput.selectedCode}
          source={activeInput.source}
          onSubmit={handleSubmitComment}
          onCancel={closeCommentInput}
        />
      )}
    </>
  )
})
