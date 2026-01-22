import { cn } from "../../../lib/utils"
import { ChatMarkdownRenderer } from "../../../components/chat-markdown-renderer"

interface MarkdownPreviewProps {
  content: string
  className?: string
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <div className={cn("h-full overflow-auto p-4", className)}>
      <ChatMarkdownRenderer content={content} size="md" />
    </div>
  )
}
