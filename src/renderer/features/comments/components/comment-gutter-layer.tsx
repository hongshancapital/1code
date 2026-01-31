import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type RefObject,
} from "react"
import { MessageSquare } from "lucide-react"
import { CommentEditPopup } from "./comment-edit-popup"
import { useCommentActions } from "../hooks/use-comment-actions"
import type { ReviewComment } from "../types"
import { cn } from "../../../lib/utils"

// Throttle function for performance
function throttle<T extends (...args: any[]) => void>(fn: T, delay: number): T {
  let lastCall = 0
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  return ((...args: Parameters<T>) => {
    const now = Date.now()
    const remaining = delay - (now - lastCall)

    if (remaining <= 0) {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      lastCall = now
      fn(...args)
    } else if (!timeoutId) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now()
        timeoutId = null
        fn(...args)
      }, remaining)
    }
  }) as T
}

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
  /** Callback when clicking a context comment bubble */
  onContextCommentClick?: (commentId: string) => void
  /** Callback to delete a context comment */
  onDeleteContextComment?: (commentId: string) => void
  /** Callback to delete a review comment (from ReviewPanel) */
  onDeleteReviewComment?: (commentId: string) => void
}

interface LineInfo {
  element: HTMLElement
  lineNumber: number
  side: "old" | "new"
  rect: DOMRect
}

/**
 * CommentGutterLayer - Overlay layer for displaying comments on diff view
 *
 * This component creates an overlay on top of the diff view that handles:
 * - Displaying comment indicators for existing comments
 * - Highlighting commented lines
 */
export const CommentGutterLayer = memo(function CommentGutterLayer({
  chatId,
  filePath,
  diffViewContainerRef,
  comments,
  diffMode,
  onContextCommentClick,
  onDeleteContextComment,
  onDeleteReviewComment,
}: CommentGutterLayerProps) {
  const { updateComment, deleteComment } = useCommentActions(chatId)

  // Callback to delete a comment - handles all three comment types
  const handleDeleteComment = useCallback((comment: ReviewComment) => {
    // Check for isReviewComment flag (from ReviewPanel / useDocumentComments)
    if (comment.isReviewComment && onDeleteReviewComment) {
      onDeleteReviewComment(comment.id)
      return
    }
    // Check for isContextComment flag (from chat input context comments)
    if (comment.isContextComment && onDeleteContextComment) {
      onDeleteContextComment(comment.id)
      return
    }
    // Fallback: try all delete methods
    onDeleteContextComment?.(comment.id)
    onDeleteReviewComment?.(comment.id)
    deleteComment(comment.id)
  }, [deleteComment, onDeleteContextComment, onDeleteReviewComment])

  const [editingComment, setEditingComment] = useState<ReviewComment | null>(null)
  const [lineElements, setLineElements] = useState<LineInfo[]>([])
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null)
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Scan for line elements when diff view updates
  useEffect(() => {
    const container = diffViewContainerRef.current
    if (!container) return

    const scanLines = () => {
      const lines: LineInfo[] = []
      // Track seen line+side combinations to avoid duplicates (which cause React key warnings)
      const seenKeys = new Set<string>()

      // Cache container rect for position calculations
      const rect = container.getBoundingClientRect()
      setContainerRect(rect)

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

        const cellRect = cell.getBoundingClientRect()
        lines.push({
          element: cell as HTMLElement,
          lineNumber,
          side,
          rect: cellRect,
        })
      })

      setLineElements(lines)
    }

    // Initial scan (debounced to let DOM settle)
    scanTimeoutRef.current = setTimeout(scanLines, 50)

    // Throttled scan for scroll/resize events (100ms throttle)
    const throttledScan = throttle(scanLines, 100)

    // Re-scan on mutations with debounce
    let mutationTimeoutId: ReturnType<typeof setTimeout> | null = null
    const observer = new MutationObserver(() => {
      if (mutationTimeoutId) clearTimeout(mutationTimeoutId)
      mutationTimeoutId = setTimeout(scanLines, 100)
    })
    observer.observe(container, { childList: true, subtree: true })

    const handleScroll = () => {
      throttledScan()
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("resize", handleScroll, { passive: true })

    return () => {
      observer.disconnect()
      container.removeEventListener("scroll", handleScroll)
      window.removeEventListener("resize", handleScroll)
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current)
      if (mutationTimeoutId) clearTimeout(mutationTimeoutId)
    }
  }, [diffViewContainerRef, diffMode])

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

  // Handle click on comment indicator - opens edit popup for comments
  const handleCommentIndicatorClick = useCallback(
    (lineNumber: number, side: "old" | "new") => {
      const lineComments = getCommentsForLine(lineNumber, side)
      if (lineComments.length === 0) return

      // Open edit mode for the first comment on this line
      const comment = lineComments[0]
      if (comment) {
        setEditingComment(comment)
      }
    },
    [getCommentsForLine]
  )

  // Calculate comment highlights for code lines (must be before conditional return)
  const commentHighlights = useMemo(() => {
    const highlights: Array<{
      comment: ReviewComment
      lineNumber: number
      side: "old" | "new"
      lineInfo: LineInfo | undefined
      isFirstLine: boolean
      isLastLine: boolean
    }> = []

    for (const comment of comments) {
      const { startLine, endLine, side } = comment.lineRange
      const commentSide = side || "new"

      for (let line = startLine; line <= endLine; line++) {
        const lineInfo = lineElements.find(
          (l) => l.lineNumber === line && l.side === commentSide
        )
        highlights.push({
          comment,
          lineNumber: line,
          side: commentSide,
          lineInfo,
          isFirstLine: line === startLine,
          isLastLine: line === endLine,
        })
      }
    }

    return highlights
  }, [comments, lineElements])

  // Calculate which lines have comments starting on them (for showing edit icon)
  const linesWithCommentIcons = useMemo(() => {
    const result: Array<{
      comment: ReviewComment
      lineInfo: LineInfo
    }> = []

    for (const comment of comments) {
      const startLine = comment.lineRange.startLine
      const commentSide = comment.lineRange.side || "new"
      const lineInfo = lineElements.find(
        (l) => l.lineNumber === startLine && l.side === commentSide
      )
      if (lineInfo) {
        result.push({ comment, lineInfo })
      }
    }

    return result
  }, [comments, lineElements])

  const container = diffViewContainerRef.current
  if (!container || !containerRect) return null

  return (
    <>
      {/* Code highlight layer - show background highlight for commented lines */}
      <div className="absolute inset-0 z-5 pointer-events-none">
        {commentHighlights.map(({ comment, lineNumber, side, lineInfo }) => {
          if (!lineInfo) return null

          // Find the content cell for this line to highlight
          const row = lineInfo.element.closest("tr")
          const contentCell = row?.querySelector(".diff-line-content-item") as HTMLElement | null
          if (!contentCell) return null

          const contentRect = contentCell.getBoundingClientRect()
          const top = contentRect.top - containerRect.top
          const left = contentRect.left - containerRect.left
          const width = contentRect.width
          const height = contentRect.height

          return (
            <div
              key={`highlight-${comment.id}-${lineNumber}-${side}`}
              className="absolute bg-yellow-400/15 dark:bg-yellow-500/15"
              style={{
                top: `${top}px`,
                left: `${left}px`,
                width: `${width}px`,
                height: `${height}px`,
              }}
            />
          )
        })}
      </div>

      {/* Comment edit icons - positioned inside line number cells */}
      {linesWithCommentIcons.map(({ comment, lineInfo }) => {
        // Position icon inside the line number cell (left side of line number)
        const lineRect = lineInfo.rect
        const top = lineRect.top - containerRect.top
        const left = lineRect.left - containerRect.left
        const height = lineRect.height

        return (
          <button
            key={`comment-icon-${comment.id}`}
            className={cn(
              "absolute flex items-center justify-center z-20",
              "w-4 h-4 rounded-full",
              "bg-yellow-500 dark:bg-yellow-400",
              "text-white dark:text-gray-900",
              "hover:scale-110 transition-transform",
              "cursor-pointer"
            )}
            style={{
              // Position at the left edge of the line number cell with more margin
              left: `${left + 8}px`,
              top: `${top + (height - 16) / 2}px`,
            }}
            onClick={() => handleCommentIndicatorClick(lineInfo.lineNumber, lineInfo.side)}
            title={comment.body.slice(0, 50) + (comment.body.length > 50 ? "..." : "")}
          >
            <MessageSquare className="w-2.5 h-2.5" />
          </button>
        )
      })}

      {/* Comment edit popup */}
      {editingComment && editingComment.filePath === filePath && (
        <CommentEditPopup
          comment={editingComment}
          containerRef={diffViewContainerRef}
          onUpdate={(newBody) => {
            updateComment(editingComment.id, { body: newBody })
            setEditingComment(null)
          }}
          onDelete={() => {
            handleDeleteComment(editingComment)
            setEditingComment(null)
          }}
          onCancel={() => setEditingComment(null)}
        />
      )}
    </>
  )
})
