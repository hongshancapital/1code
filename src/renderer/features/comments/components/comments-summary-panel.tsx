import { memo, useCallback, useMemo } from "react"
import { useAtom, useAtomValue } from "jotai"
import { FileCode2, FileText, MessageSquare, Send, Trash2, X } from "lucide-react"
import { Button } from "../../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog"
import { cn } from "../../../lib/utils"
import {
  commentsPanelOpenAtom,
  pendingCommentsAtomFamily,
} from "../atoms"
import { useCommentActions } from "../hooks/use-comment-actions"
import {
  formatCommentsForAI,
  formatCommentSummary,
  isCommentsTooLong,
} from "../utils/format-for-ai"
import type { ReviewComment } from "../types"

interface CommentsSummaryPanelProps {
  /** Chat ID for comment storage */
  chatId: string
  /** Callback when user submits comments to AI */
  onSubmitToAI: (message: string) => void
  /** Callback when user clicks on a comment to navigate to it */
  onNavigateToComment?: (comment: ReviewComment) => void
}

/**
 * Group comments by file path
 */
function groupByFile(comments: ReviewComment[]): Record<string, ReviewComment[]> {
  const groups: Record<string, ReviewComment[]> = {}
  for (const comment of comments) {
    if (!groups[comment.filePath]) {
      groups[comment.filePath] = []
    }
    groups[comment.filePath].push(comment)
  }
  return groups
}

/**
 * CommentsSummaryPanel - Shows all pending comments and allows submission to AI
 */
export const CommentsSummaryPanel = memo(function CommentsSummaryPanel({
  chatId,
  onSubmitToAI,
  onNavigateToComment,
}: CommentsSummaryPanelProps) {
  const [isOpen, setIsOpen] = useAtom(commentsPanelOpenAtom)
  const comments = useAtomValue(pendingCommentsAtomFamily(chatId))
  const { deleteComment, clearAllComments } = useCommentActions(chatId)

  // Group comments by file
  const groupedComments = useMemo(() => groupByFile(comments), [comments])
  const fileCount = Object.keys(groupedComments).length
  const isTooLong = useMemo(() => isCommentsTooLong(comments), [comments])

  // Handle submit to AI
  const handleSubmit = useCallback(() => {
    if (comments.length === 0) return

    const formattedMessage = formatCommentsForAI(comments)
    onSubmitToAI(formattedMessage)

    // Clear comments after submission
    clearAllComments()
    setIsOpen(false)
  }, [comments, onSubmitToAI, clearAllComments, setIsOpen])

  // Handle delete single comment
  const handleDeleteComment = useCallback(
    (commentId: string, event: React.MouseEvent) => {
      event.stopPropagation()
      deleteComment(commentId)
    },
    [deleteComment]
  )

  // Handle click on comment to navigate
  const handleCommentClick = useCallback(
    (comment: ReviewComment) => {
      onNavigateToComment?.(comment)
    },
    [onNavigateToComment]
  )

  // Get source icon
  const getSourceIcon = (source: string) => {
    switch (source) {
      case "diff-view":
        return <FileCode2 className="h-3 w-3" />
      case "file-preview":
        return <FileText className="h-3 w-3" />
      default:
        return <MessageSquare className="h-3 w-3" />
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        className="w-[450px] max-w-[90vw] max-h-[80vh] p-0 flex flex-col"
        showCloseButton={false}
      >
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" />
              Review Comments
              {comments.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({comments.length} comment{comments.length !== 1 ? "s" : ""}{" "}
                  on {fileCount} file{fileCount !== 1 ? "s" : ""})
                </span>
              )}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsOpen(false)}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No pending comments</p>
              <p className="text-xs mt-1">
                Add comments in the Diff View or File Preview
              </p>
            </div>
          ) : (
            <div className="p-4 flex flex-col gap-4">
              {Object.entries(groupedComments).map(([filePath, fileComments]) => {
                const fileName = filePath.split("/").pop() || filePath

                return (
                  <div key={filePath} className="flex flex-col gap-2">
                    {/* File header */}
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="truncate" title={filePath}>
                        {fileName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({fileComments.length})
                      </span>
                    </div>

                    {/* Comments for this file */}
                    <div className="flex flex-col gap-2 ml-6">
                      {fileComments
                        .sort((a, b) => a.lineRange.startLine - b.lineRange.startLine)
                        .map((comment) => {
                          const { startLine, endLine, side } = comment.lineRange
                          const lineDesc =
                            startLine === endLine
                              ? `Line ${startLine}`
                              : `Lines ${startLine}-${endLine}`

                          return (
                            <div
                              key={comment.id}
                              className={cn(
                                "group relative p-2 rounded-md border bg-card",
                                "hover:border-primary/50 cursor-pointer transition-colors"
                              )}
                              onClick={() => handleCommentClick(comment)}
                            >
                              {/* Line info and source */}
                              <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground">
                                {getSourceIcon(comment.source)}
                                <span>{lineDesc}</span>
                                {side && (
                                  <span className="text-[10px]">
                                    ({side === "old" ? "before" : "after"})
                                  </span>
                                )}
                              </div>

                              {/* Selected code preview */}
                              {comment.selectedCode && (
                                <pre className="text-[11px] font-mono bg-muted/50 rounded px-2 py-1 mb-1.5 max-h-16 overflow-hidden text-muted-foreground">
                                  {comment.selectedCode.slice(0, 100)}
                                  {comment.selectedCode.length > 100 && "..."}
                                </pre>
                              )}

                              {/* Comment body */}
                              <p className="text-sm whitespace-pre-wrap wrap-break-word">
                                {comment.body}
                              </p>

                              {/* Delete button */}
                              <button
                                onClick={(e) => handleDeleteComment(comment.id, e)}
                                className={cn(
                                  "absolute top-2 right-2 p-1 rounded",
                                  "opacity-0 group-hover:opacity-100",
                                  "hover:bg-destructive/10 text-muted-foreground hover:text-destructive",
                                  "transition-opacity"
                                )}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )
                        })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {comments.length > 0 && (
          <div className="shrink-0 px-4 py-3 border-t bg-muted/30">
            {/* Warning if comments are too long */}
            {isTooLong && (
              <p className="text-xs text-yellow-600 dark:text-yellow-500 mb-2">
                Warning: Comments may exceed AI context length. Consider reducing.
              </p>
            )}

            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllComments}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Clear All
              </Button>

              <Button
                size="sm"
                onClick={handleSubmit}
                className="gap-1"
              >
                <Send className="h-4 w-4" />
                Submit to AI
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
})
