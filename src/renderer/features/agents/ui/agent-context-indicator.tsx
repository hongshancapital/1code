"use client"

import { memo } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { cn } from "../../../lib/utils"

// Claude model context windows
const CONTEXT_WINDOWS = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
} as const

type ModelId = keyof typeof CONTEXT_WINDOWS

// Pre-computed token data to avoid re-computing on every render
export interface MessageTokenData {
  // Per-API-call values from streaming events (accurate context window size)
  lastCallInputTokens: number
  lastCallOutputTokens: number
  // Cumulative values from SDK (for fallback and cost display)
  totalInputTokens: number   // Cumulative inputTokens across all API calls in the turn
  totalOutputTokens: number  // Cumulative outputTokens across all API calls in the turn
  totalCostUsd: number
  messageCount: number
}

interface AgentContextIndicatorProps {
  tokenData: MessageTokenData
  modelId?: ModelId
  className?: string
  onCompact?: () => void
  isCompacting?: boolean
  disabled?: boolean
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`
  }
  return tokens.toString()
}

// Circular progress component
function CircularProgress({
  percent,
  size = 18,
  strokeWidth = 2,
  className,
}: {
  percent: number
  size?: number
  strokeWidth?: number
  className?: string
}) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (percent / 100) * circumference

  return (
    <svg
      width={size}
      height={size}
      className={cn("transform -rotate-90", className)}
    >
      {/* Background circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/20"
      />
      {/* Progress circle */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className="transition-all duration-300 text-muted-foreground/60"
      />
    </svg>
  )
}

export const AgentContextIndicator = memo(function AgentContextIndicator({
  tokenData,
  modelId = "sonnet",
  className,
  onCompact,
  isCompacting,
  disabled,
}: AgentContextIndicatorProps) {
  // Context usage estimate:
  // We now have per-API-call token counts from streaming events.
  // lastCallInputTokens = the LAST API call's input tokens = actual context window size
  // lastCallOutputTokens = the LAST API call's output tokens
  // Together they approximate the context for the next request.
  //
  // Fallback to cumulative values if per-call data isn't available
  // (e.g. non-streaming, Ollama, or older messages without per-call data).
  const hasPerCallData = tokenData.lastCallInputTokens > 0
  const contextUsed = hasPerCallData
    ? tokenData.lastCallInputTokens + tokenData.lastCallOutputTokens
    : tokenData.totalInputTokens + tokenData.totalOutputTokens
  const contextWindow = CONTEXT_WINDOWS[modelId]
  const percentUsed = Math.min(100, (contextUsed / contextWindow) * 100)
  const isEmpty = contextUsed === 0

  const canCompact = onCompact && !disabled && !isCompacting && !isEmpty

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "h-4 w-4 flex items-center justify-center cursor-default",
            disabled && "opacity-50",
            className,
          )}
        >
          <CircularProgress
            percent={percentUsed}
            size={14}
            strokeWidth={2.5}
            className={isCompacting ? "animate-pulse" : undefined}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8}>
        <div className="text-xs">
          {isEmpty ? (
            <span className="text-muted-foreground">
              Context: 0 / {formatTokens(contextWindow)}
            </span>
          ) : (
            <>
              <p>
                <span className="font-mono font-medium text-foreground">
                  {percentUsed.toFixed(1)}%
                </span>
                <span className="text-muted-foreground mx-1">·</span>
                <span className="text-muted-foreground">
                  {formatTokens(contextUsed)} / {formatTokens(contextWindow)} context
                </span>
              </p>
              {canCompact && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCompact()
                  }}
                  className="mt-2 w-full px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                >
                  Compact
                </button>
              )}
            </>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
})
