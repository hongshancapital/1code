import { memo } from "react"
import { MessageSquare } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { cn } from "../../../lib/utils"

interface CommentIndicatorProps {
  /** Number of comments on this line */
  count: number
  /** Callback when indicator is clicked */
  onClick?: () => void
  /** Additional class names */
  className?: string
  /** Size variant */
  size?: "sm" | "md"
}

/**
 * Visual indicator showing that a line has comments
 * Displayed in the gutter area next to line numbers
 */
export const CommentIndicator = memo(function CommentIndicator({
  count,
  onClick,
  className,
  size = "sm",
}: CommentIndicatorProps) {
  const sizeClasses = {
    sm: "w-4 h-4 text-[10px]",
    md: "w-5 h-5 text-xs",
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex items-center justify-center rounded-full",
            "bg-yellow-500 text-white font-medium",
            "hover:bg-yellow-600 transition-colors",
            "cursor-pointer",
            sizeClasses[size],
            className
          )}
        >
          {count > 1 ? count : <MessageSquare className="w-2.5 h-2.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {count === 1 ? "1 comment" : `${count} comments`}
      </TooltipContent>
    </Tooltip>
  )
})

interface CommentAddButtonProps {
  /** Callback when button is clicked */
  onClick: (event: React.MouseEvent) => void
  /** Callback for mouse down (for drag selection) */
  onMouseDown?: (event: React.MouseEvent) => void
  /** Additional class names */
  className?: string
  /** Whether the button is visible */
  visible?: boolean
}

/**
 * "+" button that appears on hover to add a comment
 */
export const CommentAddButton = memo(function CommentAddButton({
  onClick,
  onMouseDown,
  className,
  visible = true,
}: CommentAddButtonProps) {
  if (!visible) return null

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={cn(
        "flex items-center justify-center",
        "w-5 h-5 rounded",
        "bg-blue-500 text-white text-sm font-medium",
        "hover:bg-blue-600 transition-all",
        "cursor-pointer select-none",
        className
      )}
    >
      +
    </button>
  )
})
