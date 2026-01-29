"use client"

import { useAtom, useAtomValue } from "jotai"
import { MessageSquare, ChevronDown } from "lucide-react"
import { Button } from "../../../components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover"
import { cn } from "../../../lib/utils"
import { reviewCommentsAtomFamily, reviewPanelOpenAtomFamily } from "../atoms/review-atoms"
import { ReviewPanel } from "./review-panel"

interface ReviewButtonProps {
  chatId: string
  subChatId: string
  onSubmitReview: (summary: string) => void
  className?: string
}

export function ReviewButton({
  chatId,
  subChatId,
  onSubmitReview,
  className,
}: ReviewButtonProps) {
  const comments = useAtomValue(reviewCommentsAtomFamily(chatId))
  const [isOpen, setIsOpen] = useAtom(reviewPanelOpenAtomFamily(chatId))
  const commentCount = comments.length

  if (commentCount === 0) {
    return null
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className={cn(
            "h-6 px-2 gap-1 text-xs",
            className
          )}
        >
          <span>Review</span>
          <span className="text-[10px] opacity-80">•</span>
          <span>{commentCount}</span>
          <MessageSquare className="size-3 ml-0.5" />
          <ChevronDown className="size-3 ml-0.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={4}
        className="w-[360px] max-h-[480px] p-0 overflow-hidden"
      >
        <ReviewPanel
          chatId={chatId}
          subChatId={subChatId}
          onSubmit={(summary) => {
            onSubmitReview(summary)
            setIsOpen(false)
          }}
          onCancel={() => setIsOpen(false)}
        />
      </PopoverContent>
    </Popover>
  )
}
