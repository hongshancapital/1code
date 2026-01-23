import { useState, useCallback, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { X } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { cn } from "../../../lib/utils"
import type { LineRange, CommentSource } from "../types"

interface CommentInputPopupProps {
  /** File path being commented on */
  filePath: string
  /** Line range of the comment */
  lineRange: LineRange
  /** Anchor rectangle for positioning */
  anchorRect: DOMRect
  /** Selected code content */
  selectedCode?: string
  /** Comment source */
  source: CommentSource
  /** Callback when comment is submitted */
  onSubmit: (body: string) => void
  /** Callback when popup is cancelled */
  onCancel: () => void
}

/**
 * Floating comment input popup - appears next to the selected line(s)
 */
export function CommentInputPopup({
  filePath,
  lineRange,
  anchorRect,
  selectedCode,
  source,
  onSubmit,
  onCancel,
}: CommentInputPopupProps) {
  const [body, setBody] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Handle click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node)
      ) {
        onCancel()
      }
    }

    // Delay adding listener to avoid immediate close
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [onCancel])

  // Handle keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Escape to cancel
      if (event.key === "Escape") {
        event.preventDefault()
        onCancel()
      }
      // Cmd/Ctrl + Enter to submit
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        handleSubmit()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [body, onCancel])

  const handleSubmit = useCallback(() => {
    const trimmedBody = body.trim()
    if (trimmedBody) {
      onSubmit(trimmedBody)
    }
  }, [body, onSubmit])

  // Calculate popup position
  const getPopupStyle = useCallback((): React.CSSProperties => {
    const popupWidth = 400
    const popupHeight = 200 // Approximate
    const padding = 8
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    let left = anchorRect.right + padding
    let top = anchorRect.top

    // If popup would go off right edge, position to the left of anchor
    if (left + popupWidth > viewportWidth - padding) {
      left = anchorRect.left - popupWidth - padding
    }

    // If still off screen, align with left edge
    if (left < padding) {
      left = padding
    }

    // If popup would go off bottom, adjust top
    if (top + popupHeight > viewportHeight - padding) {
      top = viewportHeight - popupHeight - padding
    }

    // If off top, adjust
    if (top < padding) {
      top = padding
    }

    return {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      width: `${popupWidth}px`,
      zIndex: 9999,
    }
  }, [anchorRect])

  // Format line range display
  const lineRangeText =
    lineRange.startLine === lineRange.endLine
      ? `Line ${lineRange.startLine}`
      : `Lines ${lineRange.startLine}-${lineRange.endLine}`

  // Get file name from path
  const fileName = filePath.split("/").pop() || filePath

  return createPortal(
    <div
      ref={popupRef}
      style={getPopupStyle()}
      className={cn(
        "bg-popover border border-border rounded-lg shadow-xl",
        "animate-in fade-in-0 zoom-in-95 duration-150"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground truncate max-w-[200px]">
            {fileName}
          </span>
          <span className="text-muted-foreground">{lineRangeText}</span>
          {lineRange.side && (
            <span className="text-xs text-muted-foreground">
              ({lineRange.side})
            </span>
          )}
        </div>
        <button
          onClick={onCancel}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Selected code preview */}
      {selectedCode && (
        <div className="px-3 py-2 border-b border-border bg-muted/30 max-h-24 overflow-auto">
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
            {selectedCode}
          </pre>
        </div>
      )}

      {/* Textarea */}
      <div className="p-3">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a comment..."
          className={cn(
            "w-full h-24 px-3 py-2 text-sm",
            "bg-background border border-input rounded-md",
            "placeholder:text-muted-foreground",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
            "resize-none"
          )}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/20">
        <span className="text-xs text-muted-foreground">
          ⌘+Enter to submit
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!body.trim()}
          >
            Add Comment
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
