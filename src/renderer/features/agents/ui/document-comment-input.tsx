"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { cn } from "../../../lib/utils"
import { Trash2 } from "lucide-react"
import type { DocumentType, DocumentComment } from "../atoms/review-atoms"

interface DocumentCommentInputProps {
  selectedText: string
  documentType: DocumentType
  documentPath: string
  lineStart?: number
  lineEnd?: number
  lineType?: "old" | "new"
  rect: DOMRect
  onSubmit: (content: string) => void
  onCancel: () => void
  // Edit mode
  existingComment?: DocumentComment
  onUpdate?: (content: string) => void
  onDelete?: () => void
}

export function DocumentCommentInput({
  selectedText,
  documentType,
  documentPath,
  lineStart,
  lineEnd,
  lineType,
  rect,
  onSubmit,
  onCancel,
  existingComment,
  onUpdate,
  onDelete,
}: DocumentCommentInputProps) {
  const [content, setContent] = useState(existingComment?.content ?? "")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isEditMode = !!existingComment

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      textareaRef.current?.focus()
      // Move cursor to end in edit mode
      if (isEditMode && textareaRef.current) {
        textareaRef.current.selectionStart = textareaRef.current.value.length
      }
    }, 10)
    return () => clearTimeout(timer)
  }, [isEditMode])

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel()
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [onCancel])

  const handleSubmit = useCallback(() => {
    const trimmed = content.trim()
    if (!trimmed) return

    if (isEditMode && onUpdate) {
      onUpdate(trimmed)
    } else {
      onSubmit(trimmed)
    }
  }, [content, isEditMode, onSubmit, onUpdate])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
    }
  }, [handleSubmit, onCancel])

  // Calculate position - below the selection by default, above if not enough space
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const inputWidth = 320
  const inputHeight = 140

  // Center horizontally on the selection
  let left = rect.left + rect.width / 2
  left = Math.max(inputWidth / 2 + 16, Math.min(left, viewportWidth - inputWidth / 2 - 16))
  const centeredLeft = left - inputWidth / 2

  // Position below by default, above if not enough space below
  const spaceBelow = viewportHeight - rect.bottom
  const showBelow = spaceBelow > inputHeight + 8

  const top = showBelow
    ? rect.bottom + 4
    : rect.top - inputHeight - 4

  const style: React.CSSProperties = {
    position: "fixed",
    top,
    left: centeredLeft,
    width: inputWidth,
    zIndex: 100001,
  }

  // Create preview text
  const preview = selectedText.length > 80
    ? selectedText.slice(0, 80) + "..."
    : selectedText

  // Get source label with line range
  const getSourceLabel = () => {
    const fileName = documentPath.split("/").pop() || documentPath
    if (documentType === "plan") {
      return lineStart ? `Plan:L${lineStart}` : "Plan"
    }
    if (lineStart) {
      const lineRange = lineEnd && lineEnd !== lineStart
        ? `L${lineStart}-${lineEnd}`
        : `L${lineStart}`
      const lineTypeStr = lineType ? ` (${lineType})` : ""
      return `${fileName}:${lineRange}${lineTypeStr}`
    }
    return fileName
  }

  // Animation
  const animationClass = showBelow
    ? "animate-in fade-in-0 zoom-in-95 origin-top duration-100"
    : "animate-in fade-in-0 zoom-in-95 origin-bottom duration-100"

  const portalContent = (
    <div
      ref={containerRef}
      style={style}
      className={animationClass}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="rounded-md bg-popover border border-border shadow-lg overflow-hidden">
        {/* Preview of selected text */}
        <div className="px-2.5 py-1.5 border-b border-border bg-muted/30">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
            <span>{isEditMode ? "Editing comment on" : "Comment on"}</span>
            <span className="font-medium text-foreground/70">{getSourceLabel()}</span>
          </div>
          <div className="text-xs text-muted-foreground font-mono line-clamp-2">
            {preview}
          </div>
        </div>

        {/* Input area */}
        <div className="p-2">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add your comment..."
            rows={3}
            className="w-full text-xs bg-transparent outline-hidden text-foreground placeholder:text-muted-foreground resize-none"
          />
        </div>

        {/* Actions */}
        <div className="px-2 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            {isEditMode && onDelete && (
              <button
                onClick={onDelete}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete comment"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onCancel}
              className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!content.trim()}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded transition-colors",
                content.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed"
              )}
            >
              {isEditMode ? "Update" : "Add Comment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(portalContent, document.body)
}
