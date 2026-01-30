import { useState, useCallback, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { X, Trash2 } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { cn } from "../../../lib/utils"
import type { ReviewComment } from "../types"

interface CommentEditPopupProps {
  /** The comment to edit */
  comment: ReviewComment
  /** Container element for positioning reference */
  containerRef: React.RefObject<HTMLElement | null>
  /** Callback when comment is updated */
  onUpdate: (body: string) => void
  /** Callback when comment is deleted */
  onDelete: () => void
  /** Callback when popup is cancelled */
  onCancel: () => void
}

/**
 * Floating popup for editing an existing comment
 */
export function CommentEditPopup({
  comment,
  containerRef,
  onUpdate,
  onDelete,
  onCancel,
}: CommentEditPopupProps) {
  const [body, setBody] = useState(comment.body)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus()
    // Select all text for easy replacement
    textareaRef.current?.select()
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
      // Cmd/Ctrl + Enter to save
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault()
        handleSave()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [body, onCancel])

  const handleSave = useCallback(() => {
    const trimmedBody = body.trim()
    if (trimmedBody && trimmedBody !== comment.body) {
      onUpdate(trimmedBody)
    } else {
      onCancel()
    }
  }, [body, comment.body, onUpdate, onCancel])

  const handleDelete = useCallback(() => {
    onDelete()
  }, [onDelete])

  // Calculate popup position - center in viewport or near container
  const getPopupStyle = useCallback((): React.CSSProperties => {
    const popupWidth = 400
    const popupHeight = 280
    const padding = 16

    // Default to center of viewport
    let left = (window.innerWidth - popupWidth) / 2
    let top = (window.innerHeight - popupHeight) / 2

    // If container is available, position near it
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect()
      // Position to the right of the container if there's space
      if (containerRect.right + popupWidth + padding < window.innerWidth) {
        left = containerRect.right + padding
        top = Math.max(padding, Math.min(containerRect.top, window.innerHeight - popupHeight - padding))
      }
    }

    return {
      position: "fixed",
      left: `${left}px`,
      top: `${top}px`,
      width: `${popupWidth}px`,
      zIndex: 9999,
    }
  }, [containerRef])

  // Format line range display
  const lineRangeText =
    comment.lineRange.startLine === comment.lineRange.endLine
      ? `Line ${comment.lineRange.startLine}`
      : `Lines ${comment.lineRange.startLine}-${comment.lineRange.endLine}`

  // Get file name from path
  const fileName = comment.filePath.split("/").pop() || comment.filePath

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
          {comment.lineRange.side && (
            <span className="text-xs text-muted-foreground">
              ({comment.lineRange.side})
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
      {comment.selectedCode && (
        <div className="px-3 py-2 border-b border-border bg-muted/30 max-h-24 overflow-auto">
          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all">
            {comment.selectedCode}
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
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Delete
        </Button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            ⌘+Enter to save
          </span>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!body.trim() || body.trim() === comment.body}
          >
            Save
          </Button>
        </div>
      </div>
    </div>,
    document.body
  )
}
