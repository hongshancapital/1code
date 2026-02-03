"use client"

import { useState, useCallback, useMemo } from "react"
import { X, MessageSquare, Trash2, FileCode } from "lucide-react"
import { createPortal } from "react-dom"
import { Button } from "../../../components/ui/button"
import { cn } from "../../../lib/utils"
import type { DiffTextContext } from "../lib/queue-utils"

interface ContextReviewPanelProps {
  isOpen: boolean
  onClose: () => void
  diffTextContexts: DiffTextContext[]
  onUpdateComment: (id: string, comment: string) => void
  onRemove: (id: string) => void
  onClearAll: () => void
}

export function ContextReviewPanel({
  isOpen,
  onClose,
  diffTextContexts,
  onUpdateComment,
  onRemove,
  onClearAll,
}: ContextReviewPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")

  // Only show contexts with comments
  const commentsOnly = useMemo(
    () => diffTextContexts.filter((ctx) => ctx.comment),
    [diffTextContexts]
  )

  // Group by file
  const groupedByFile = useMemo(() => {
    const groups: Record<string, DiffTextContext[]> = {}
    for (const ctx of commentsOnly) {
      const key = ctx.filePath
      if (!groups[key]) groups[key] = []
      groups[key].push(ctx)
    }
    return groups
  }, [commentsOnly])

  const handleStartEdit = useCallback((ctx: DiffTextContext) => {
    setEditingId(ctx.id)
    setEditValue(ctx.comment || "")
  }, [])

  const handleSaveEdit = useCallback(() => {
    if (editingId && editValue.trim()) {
      onUpdateComment(editingId, editValue.trim())
    }
    setEditingId(null)
    setEditValue("")
  }, [editingId, editValue, onUpdateComment])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setEditValue("")
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSaveEdit()
    }
    if (e.key === "Escape") {
      e.preventDefault()
      handleCancelEdit()
    }
  }, [handleSaveEdit, handleCancelEdit])

  if (!isOpen) return null

  const content = (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg max-h-[80vh] bg-popover border border-border rounded-lg shadow-xl flex flex-col animate-in fade-in-0 zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-yellow-500" />
            <span className="font-medium">Review Comments</span>
            <span className="text-xs text-muted-foreground">
              ({commentsOnly.length} comment{commentsOnly.length !== 1 ? "s" : ""})
            </span>
          </div>
          <div className="flex items-center gap-2">
            {commentsOnly.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearAll}
                className="text-xs text-destructive hover:text-destructive"
              >
                <Trash2 className="size-3 mr-1" />
                Clear all
              </Button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-muted transition-colors"
            >
              <X className="size-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {commentsOnly.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="size-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No comments yet</p>
              <p className="text-xs mt-1">
                Select code in the diff view and click "Comment" to add feedback
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {Object.entries(groupedByFile).map(([filePath, contexts]) => (
                <div key={filePath} className="flex flex-col gap-2">
                  {/* File header */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <FileCode className="size-3" />
                    <span className="font-mono truncate">{filePath}</span>
                  </div>

                  {/* Comments for this file */}
                  <div className="flex flex-col gap-2 pl-5">
                    {contexts.map((ctx) => (
                      <div
                        key={ctx.id}
                        className="rounded-md border border-border bg-muted/30 overflow-hidden"
                      >
                        {/* Code preview */}
                        <div className="px-3 py-2 bg-muted/50 border-b border-border">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
                            {ctx.lineNumber && <span>Line {ctx.lineNumber}</span>}
                            {ctx.lineType && (
                              <span className={ctx.lineType === "new" ? "text-green-500" : "text-red-500"}>
                                {ctx.lineType === "new" ? "Added" : "Removed"}
                              </span>
                            )}
                          </div>
                          <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-all line-clamp-3">
                            {ctx.preview}
                          </pre>
                        </div>

                        {/* Comment */}
                        <div className="px-3 py-2">
                          {editingId === ctx.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                autoFocus
                                className="flex-1 text-sm bg-background border border-input rounded px-2 py-1 outline-hidden focus:ring-1 focus:ring-ring"
                              />
                              <Button size="sm" onClick={handleSaveEdit}>
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={handleCancelEdit}>
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm text-yellow-600 dark:text-yellow-500">
                                {ctx.comment}
                              </p>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleStartEdit(ctx)}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <span className="text-xs">Edit</span>
                                </button>
                                <button
                                  onClick={() => onRemove(ctx.id)}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                                >
                                  <X className="size-3" />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-border bg-muted/20">
          <p className="text-xs text-muted-foreground">
            Comments will be included when you send your next message.
          </p>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
