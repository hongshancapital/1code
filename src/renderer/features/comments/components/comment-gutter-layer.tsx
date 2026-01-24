import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react"
import { useAtom } from "jotai"
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
  /** Callback when clicking a context comment bubble */
  onContextCommentClick?: (commentId: string) => void
}

interface LineInfo {
  element: HTMLElement
  lineNumber: number
  side: "old" | "new"
  rect: DOMRect
}

/**
 * CommentGutterLayer - Overlay layer for adding comments to diff view
 *
 * This component creates an invisible overlay on top of the diff view
 * that handles:
 * - Detecting line hover and showing "+" buttons
 * - Drag selection for multi-line comments
 * - Displaying comment indicators for existing comments
 */
export const CommentGutterLayer = memo(function CommentGutterLayer({
  chatId,
  filePath,
  diffViewContainerRef,
  comments,
  diffMode,
  onCommentAdded,
  onContextCommentClick,
}: CommentGutterLayerProps) {
  const [activeInput, setActiveInput] = useAtom(activeCommentInputAtom)
  const [lineSelection, setLineSelection] = useAtom(lineSelectionAtom)
  const { addComment, closeCommentInput } = useCommentActions(chatId)

  const [hoveredLine, setHoveredLine] = useState<LineInfo | null>(null)
  const [lineElements, setLineElements] = useState<LineInfo[]>([])
  const isDragging = useRef(false)
  const dragStartLine = useRef<LineInfo | null>(null)

  // Scan for line elements when diff view updates
  useEffect(() => {
    const container = diffViewContainerRef.current
    if (!container) return

    const scanLines = () => {
      const lines: LineInfo[] = []
      // Track seen line+side combinations to avoid duplicates (which cause React key warnings)
      const seenKeys = new Set<string>()

      // Find all line number cells in the diff view
      // @git-diff-view uses .diff-line-num class for line numbers
      const lineNumCells = container.querySelectorAll(".diff-line-num")

      lineNumCells.forEach((cell) => {
        const lineNumText = cell.textContent?.trim()
        if (!lineNumText || lineNumText === "...") return

        const lineNumber = parseInt(lineNumText, 10)
        if (isNaN(lineNumber)) return

        // Determine side (old/new) based on cell position or class
        // In unified mode, we need to check the cell's position in the row
        // In split mode, left side is old, right side is new
        const row = cell.closest("tr")
        if (!row) return

        const cells = Array.from(row.querySelectorAll(".diff-line-num"))
        const cellIndex = cells.indexOf(cell as HTMLElement)

        let side: "old" | "new" = "new"
        if (diffMode === "split") {
          // In split mode: first cell is old, second is new
          side = cellIndex === 0 ? "old" : "new"
        } else {
          // In unified mode: check if row has deletion or addition class
          const rowClasses = row.className
          if (rowClasses.includes("diff-line-del")) {
            side = "old"
          } else if (rowClasses.includes("diff-line-add")) {
            side = "new"
          }
        }

        // Deduplicate: only keep the first occurrence of each lineNumber-side combination
        const key = `${lineNumber}-${side}`
        if (seenKeys.has(key)) return
        seenKeys.add(key)

        const rect = cell.getBoundingClientRect()
        lines.push({
          element: cell as HTMLElement,
          lineNumber,
          side,
          rect,
        })
      })

      setLineElements(lines)
    }

    // Initial scan
    scanLines()

    // Re-scan on scroll and resize
    const observer = new MutationObserver(scanLines)
    observer.observe(container, { childList: true, subtree: true })

    const handleScroll = () => {
      requestAnimationFrame(scanLines)
    }

    container.addEventListener("scroll", handleScroll)
    window.addEventListener("resize", handleScroll)

    return () => {
      observer.disconnect()
      container.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleScroll)
    }
  }, [diffViewContainerRef, diffMode])

  // Handle click on add button (single line)
  const handleAddClick = useCallback(
    (line: LineInfo, event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()

      // Get the code content for this line
      const row = line.element.closest("tr")
      const contentCell = row?.querySelector(".diff-line-content-item")
      const selectedCode = contentCell?.textContent || undefined

      setActiveInput({
        filePath,
        lineRange: {
          startLine: line.lineNumber,
          endLine: line.lineNumber,
          side: line.side,
        },
        selectedCode,
        anchorRect: line.rect,
        source: "diff-view",
      })
    },
    [filePath, setActiveInput]
  )

  // Handle mouse down for drag selection
  const handleMouseDown = useCallback(
    (line: LineInfo, event: React.MouseEvent) => {
      // Only start drag on left click
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

  // Handle mouse move during drag
  useEffect(() => {
    if (!lineSelection || !isDragging.current) return

    const handleGlobalMouseMove = (event: MouseEvent) => {
      const mouseY = event.clientY

      // Find the line at current mouse position
      for (const line of lineElements) {
        if (
          mouseY >= line.rect.top &&
          mouseY <= line.rect.bottom &&
          line.side === lineSelection.side
        ) {
          setLineSelection((prev) =>
            prev ? { ...prev, currentLine: line.lineNumber } : null
          )
          break
        }
      }
    }

    const handleGlobalMouseUp = () => {
      if (!isDragging.current || !dragStartLine.current) return

      isDragging.current = false
      const startLine = lineSelection.startLine
      const endLine = lineSelection.currentLine

      // Get selected code content
      const minLine = Math.min(startLine, endLine)
      const maxLine = Math.max(startLine, endLine)
      let selectedCode = ""

      for (const line of lineElements) {
        if (
          line.lineNumber >= minLine &&
          line.lineNumber <= maxLine &&
          line.side === lineSelection.side
        ) {
          const row = line.element.closest("tr")
          const contentCell = row?.querySelector(".diff-line-content-item")
          if (contentCell?.textContent) {
            selectedCode += contentCell.textContent + "\n"
          }
        }
      }

      // Open comment input
      const startLineInfo = lineElements.find(
        (l) => l.lineNumber === minLine && l.side === lineSelection.side
      )

      if (startLineInfo) {
        setActiveInput({
          filePath,
          lineRange: {
            startLine: minLine,
            endLine: maxLine,
            side: lineSelection.side,
          },
          selectedCode: selectedCode.trimEnd() || undefined,
          anchorRect: startLineInfo.rect,
          source: "diff-view",
        })
      }

      setLineSelection(null)
      dragStartLine.current = null
    }

    document.addEventListener("mousemove", handleGlobalMouseMove)
    document.addEventListener("mouseup", handleGlobalMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleGlobalMouseMove)
      document.removeEventListener("mouseup", handleGlobalMouseUp)
    }
  }, [lineSelection, lineElements, filePath, setActiveInput, setLineSelection])

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

  // Check if a line has comments and return the comments info
  const getCommentsForLine = useCallback(
    (lineNumber: number, side: "old" | "new") => {
      return comments.filter((c) => {
        const { startLine, endLine, side: cSide } = c.lineRange
        const inRange = lineNumber >= startLine && lineNumber <= endLine
        return inRange && (!cSide || cSide === side)
      })
    },
    [comments]
  )

  // Get comment count for display
  const getCommentCountForLine = useCallback(
    (lineNumber: number, side: "old" | "new") => {
      return getCommentsForLine(lineNumber, side).length
    },
    [getCommentsForLine]
  )

  // Handle click on comment indicator
  const handleCommentIndicatorClick = useCallback(
    (lineNumber: number, side: "old" | "new") => {
      const lineComments = getCommentsForLine(lineNumber, side)
      // Find context comment (has isContextComment flag)
      const contextComment = lineComments.find((c) => (c as any).isContextComment)
      if (contextComment && onContextCommentClick) {
        onContextCommentClick(contextComment.id)
      }
    },
    [getCommentsForLine, onContextCommentClick]
  )

  // Determine if a line is in the current selection
  const isLineInSelection = useCallback(
    (lineNumber: number, side: "old" | "new") => {
      if (!lineSelection || lineSelection.side !== side) return false
      const minLine = Math.min(lineSelection.startLine, lineSelection.currentLine)
      const maxLine = Math.max(lineSelection.startLine, lineSelection.currentLine)
      return lineNumber >= minLine && lineNumber <= maxLine
    },
    [lineSelection]
  )

  const container = diffViewContainerRef.current
  if (!container) return null

  return (
    <>
      {/* Overlay layer - pointer-events: none so it doesn't block diff view interaction */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        {/* Render indicators and buttons for each line */}
        {lineElements.map((line) => {
          const commentCount = getCommentCountForLine(line.lineNumber, line.side)
          const isHovered = hoveredLine?.lineNumber === line.lineNumber && hoveredLine?.side === line.side
          const isInSelection = isLineInSelection(line.lineNumber, line.side)
          const containerRect = container.getBoundingClientRect()

          // Calculate position relative to container
          const top = line.rect.top - containerRect.top
          const left = line.rect.left - containerRect.left - 24 // Position left of line number

          return (
            <div
              key={`${line.lineNumber}-${line.side}`}
              className={cn(
                "absolute flex items-center gap-0.5",
                isInSelection && "bg-blue-500/20"
              )}
              style={{
                top: `${top}px`,
                left: `${left}px`,
                height: `${line.rect.height}px`,
                width: "24px",
                // Enable pointer events only for this line's gutter area
                pointerEvents: "auto",
              }}
              onMouseEnter={() => setHoveredLine(line)}
              onMouseLeave={() => setHoveredLine(null)}
            >
              {/* Comment indicator for existing comments */}
              {commentCount > 0 && (
                <CommentIndicator
                  count={commentCount}
                  size="sm"
                  className="absolute left-0"
                  onClick={() => handleCommentIndicatorClick(line.lineNumber, line.side)}
                />
              )}

              {/* Add button (shown on hover when no existing comments) */}
              {isHovered && commentCount === 0 && (
                <CommentAddButton
                  onClick={(e) => handleAddClick(line, e)}
                  onMouseDown={(e) => handleMouseDown(line, e)}
                  className="absolute left-0"
                />
              )}
            </div>
          )
        })}
      </div>

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
