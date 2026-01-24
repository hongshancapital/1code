import { memo, useState } from "react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../../../components/ui/hover-card"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"

interface UserInputSummary {
  messageId: string
  index: number
  content: string
  mode: string
  fileCount: number
  totalTokens: number
  additions: number
  deletions: number
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`
  }
  return String(tokens)
}

interface InputItemProps {
  input: UserInputSummary
  onClick?: () => void
}

const InputItem = memo(function InputItem({ input, onClick }: InputItemProps) {
  const isPlan = input.mode === "plan"

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full px-3 py-2 text-left transition-colors",
        "hover:bg-muted/50 border-b border-border/30 last:border-b-0",
        // plan 模式用淡黄色底色
        isPlan && "bg-amber-500/5"
      )}
    >
      {/* 上行：内容 */}
      <div className="text-sm truncate">
        {input.content || "Empty input"}
      </div>
      {/* 下行：文件变更 + token */}
      <div className="flex items-center justify-between mt-1 text-[11px] text-muted-foreground">
        {/* 左侧：文件变更 Xfiles +XX -XX */}
        <div className="flex items-center gap-1.5">
          {input.fileCount > 0 ? (
            <>
              <span>{input.fileCount} file{input.fileCount > 1 ? "s" : ""}</span>
              {(input.additions > 0 || input.deletions > 0) && (
                <>
                  <span className="text-green-600 dark:text-green-400">+{input.additions}</span>
                  <span className="text-red-600 dark:text-red-400">-{input.deletions}</span>
                </>
              )}
            </>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </div>
        {/* 右侧：token 数 */}
        <div>
          {input.totalTokens > 0 ? (
            <span>{formatTokens(input.totalTokens)} tokens</span>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
        </div>
      </div>
    </button>
  )
})

interface SubChatHoverPreviewProps {
  subChatId: string
  children: React.ReactNode
  onInputClick?: (messageId: string) => void
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
}

export function SubChatHoverPreview({
  subChatId,
  children,
  onInputClick,
  side = "right",
  align = "start",
}: SubChatHoverPreviewProps) {
  const [open, setOpen] = useState(false)

  const { data, isLoading } = trpc.chats.getSubChatPreview.useQuery(
    { subChatId },
    {
      enabled: open,
      staleTime: 30000, // 缓存 30 秒
      refetchOnWindowFocus: false,
    }
  )

  const handleInputClick = (messageId: string) => {
    onInputClick?.(messageId)
    setOpen(false)
  }

  return (
    <HoverCard openDelay={300} closeDelay={100} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side={side}
        align={align}
        sideOffset={8}
        className="w-[280px] max-h-[240px] p-0 overflow-hidden"
      >
        {isLoading ? (
          <div className="p-4 flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
          </div>
        ) : !data || data.inputs.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            No inputs yet
          </div>
        ) : (
          <div className="overflow-y-auto max-h-[240px]">
            {data.inputs.map((input) => (
              <InputItem
                key={input.messageId}
                input={input}
                onClick={() => handleInputClick(input.messageId)}
              />
            ))}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

export type { UserInputSummary }
