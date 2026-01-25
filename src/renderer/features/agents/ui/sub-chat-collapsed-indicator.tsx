import { memo, useState } from "react"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../../../components/ui/hover-card"

interface SubChatCollapsedIndicatorProps {
  subChatId: string
  onInputClick?: (messageId: string) => void
}

// 单条横线组件，带独立的 hover 预览
const IndicatorLine = memo(function IndicatorLine({
  input,
  onInputClick,
}: {
  input: {
    messageId: string
    content: string
    mode: string
    fileCount: number
    additions: number
    deletions: number
    totalTokens: number
  }
  onInputClick?: (messageId: string) => void
}) {
  const [isHovered, setIsHovered] = useState(false)
  const isPlan = input.mode === "plan"

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          className={cn(
            "w-3 h-[3px] rounded-full transition-all duration-150 cursor-pointer",
            isPlan ? "bg-amber-400/50" : "bg-gray-400/40",
            isHovered && (isPlan ? "w-5 h-[4px] bg-amber-400/70" : "w-5 h-[4px] bg-gray-400/60")
          )}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={() => onInputClick?.(input.messageId)}
        />
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        sideOffset={8}
        className={cn(
          "w-64 p-2 z-[100]",
          isPlan && "bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800"
        )}
      >
        <div className="space-y-1.5">
          <p className="text-sm line-clamp-2">{input.content || "..."}</p>
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-2">
              {input.fileCount > 0 && (
                <span>
                  {input.fileCount} files
                  {(input.additions > 0 || input.deletions > 0) && (
                    <>
                      {" "}
                      <span className="text-green-600">+{input.additions}</span>
                      {" "}
                      <span className="text-red-600">-{input.deletions}</span>
                    </>
                  )}
                </span>
              )}
            </div>
            {input.totalTokens > 0 && (
              <span>{input.totalTokens.toLocaleString()} tokens</span>
            )}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
})

export function SubChatCollapsedIndicator({
  subChatId,
  onInputClick,
}: SubChatCollapsedIndicatorProps) {
  const { data, isLoading, error } = trpc.chats.getSubChatPreview.useQuery(
    { subChatId },
    {
      staleTime: 0, // 每次获取最新数据
      refetchOnWindowFocus: false,
    }
  )

  // Don't render anything if loading, error, or no data
  if (isLoading || error || !data || data.inputs.length === 0) {
    return null
  }

  return (
    <div className="flex py-2 w-5">
      <div className="flex flex-col gap-1 absolute top-12 left-2">
        {data.inputs.map((input) => (
            <IndicatorLine
                key={input.messageId}
                input={input}
                onInputClick={onInputClick}
            />
        ))}
      </div>
    </div>
  )
}
