"use client"

import { useState, useMemo } from "react"
import { Pencil, Trash2, FileCode, FileText, ChevronDown, ChevronRight } from "lucide-react"
import { useDocumentComments } from "../hooks/use-document-comments"
import { cn } from "../../../lib/utils"
import type { DocumentComment } from "../atoms/review-atoms"

interface ReviewPanelProps {
  chatId: string
  subChatId: string
  onSubmit: (summary: string) => void
  onCancel: () => void
}

export function ReviewPanel({
  chatId,
  subChatId,
  onSubmit,
  onCancel,
}: ReviewPanelProps) {
  // Use subChatId to scope comments to specific subChat context
  const {
    comments,
    commentsByDocument,
    removeComment,
    updateComment,
  } = useDocumentComments(subChatId)
  const [summary, setSummary] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState("")
  const [isCommentsExpanded, setIsCommentsExpanded] = useState(false)

  // Group comments by document path for display
  const groupedComments = useMemo(() => {
    return Object.entries(commentsByDocument).map(([path, docComments]) => ({
      path,
      fileName: path.split("/").pop() || path,
      comments: docComments,
    }))
  }, [commentsByDocument])

  const handleStartEdit = (comment: DocumentComment) => {
    setEditingId(comment.id)
    setEditContent(comment.content)
  }

  const handleSaveEdit = (id: string) => {
    if (editContent.trim()) {
      updateComment(id, { content: editContent.trim() })
    }
    setEditingId(null)
    setEditContent("")
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditContent("")
  }

  const handleDelete = (id: string) => {
    removeComment(id)
    if (editingId === id) {
      setEditingId(null)
      setEditContent("")
    }
  }

  const handleSubmit = () => {
    onSubmit(summary)
    // Comments will be cleared by the parent after successful send
  }

  const getDocumentIcon = (comment: DocumentComment) => {
    if (comment.documentType === "plan") {
      return <FileText className="size-3 text-muted-foreground" />
    }
    return <FileCode className="size-3 text-muted-foreground" />
  }

  return (
    <div className="flex flex-col max-h-[480px]">
      {/* Submit comment section - at top */}
      <div className="p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground mb-1.5">
          Submit comment
        </div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Add an optional message, ↵ to submit comments"
          rows={2}
          className="w-full text-xs bg-background border border-border rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary resize-none placeholder:text-muted-foreground"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          autoFocus
        />
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={comments.length === 0}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded transition-colors",
              comments.length > 0
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            Submit
          </button>
        </div>
      </div>

      {/* Collapsible comments section - at bottom */}
      {comments.length > 0 && (
        <div className="border-t border-border">
          {/* Expand/Collapse header */}
          <button
            onClick={() => setIsCommentsExpanded(!isCommentsExpanded)}
            className="w-full px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            {isCommentsExpanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <span>Review {comments.length} comment{comments.length !== 1 ? "s" : ""}</span>
          </button>

          {/* Expandable comments list */}
          {isCommentsExpanded && (
            <div className="max-h-[280px] overflow-y-auto">
              <div className="p-2 space-y-3">
                {groupedComments.map(({ path, fileName, comments: docComments }) => (
                  <div key={path} className="space-y-2">
                    {/* Document header */}
                    <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                      {getDocumentIcon(docComments[0])}
                      <span className="truncate">{fileName}</span>
                    </div>

                    {/* Comments for this document */}
                    {docComments.map((comment) => (
                      <ReviewCommentItem
                        key={comment.id}
                        comment={comment}
                        isEditing={editingId === comment.id}
                        editContent={editContent}
                        onEditContentChange={setEditContent}
                        onStartEdit={() => handleStartEdit(comment)}
                        onSaveEdit={() => handleSaveEdit(comment.id)}
                        onCancelEdit={handleCancelEdit}
                        onDelete={() => handleDelete(comment.id)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Individual comment item
interface ReviewCommentItemProps {
  comment: DocumentComment
  isEditing: boolean
  editContent: string
  onEditContentChange: (content: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
}

function ReviewCommentItem({
  comment,
  isEditing,
  editContent,
  onEditContentChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: ReviewCommentItemProps) {
  // Format the quote preview
  const quotePreview = comment.anchor.selectedText.length > 60
    ? comment.anchor.selectedText.slice(0, 60) + "..."
    : comment.anchor.selectedText

  // Format line range (e.g., "L12" or "L12-34")
  const formatLineRange = () => {
    if (!comment.anchor.lineStart) return null
    const lineType = comment.anchor.lineType ? ` (${comment.anchor.lineType})` : ""
    if (comment.anchor.lineEnd && comment.anchor.lineEnd !== comment.anchor.lineStart) {
      return `L${comment.anchor.lineStart}-${comment.anchor.lineEnd}${lineType}`
    }
    return `L${comment.anchor.lineStart}${lineType}`
  }

  const lineRange = formatLineRange()

  return (
    <div className="bg-background rounded-md border border-border overflow-hidden">
      {/* Quote with line info */}
      <div className="px-2 py-1.5 bg-muted/50 border-b border-border">
        {lineRange && (
          <div className="text-[10px] text-muted-foreground font-mono mb-0.5">
            {lineRange}
          </div>
        )}
        <div className="text-xs text-muted-foreground font-mono line-clamp-2 italic">
          "{quotePreview}"
        </div>
      </div>

      {/* Comment content */}
      <div className="px-2 py-1.5">
        {isEditing ? (
          <div className="space-y-1.5">
            <textarea
              value={editContent}
              onChange={(e) => onEditContentChange(e.target.value)}
              rows={2}
              className="w-full text-xs bg-transparent outline-none resize-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  onSaveEdit()
                }
                if (e.key === "Escape") {
                  e.preventDefault()
                  onCancelEdit()
                }
              }}
            />
            <div className="flex items-center justify-end gap-1">
              <button
                onClick={onCancelEdit}
                className="px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onSaveEdit}
                disabled={!editContent.trim()}
                className={cn(
                  "px-1.5 py-0.5 text-[10px] rounded transition-colors",
                  editContent.trim()
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-foreground flex-1 whitespace-pre-wrap">
              {comment.content}
            </p>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                onClick={onStartEdit}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Edit comment"
              >
                <Pencil className="size-3" />
              </button>
              <button
                onClick={onDelete}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                title="Delete comment"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
