"use client"

import { memo, useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useAtomValue } from "jotai"
import { Check, X, Copy } from "lucide-react"
import { useFileOpen } from "../mentions"
import { selectedProjectAtom } from "../atoms"
import { AgentToolRegistry, getToolStatus } from "./agent-tool-registry"
import { AgentToolCall } from "./agent-tool-call"
import { AgentToolInterrupted } from "./agent-tool-interrupted"
import { areTaskToolPropsEqual } from "./agent-tool-utils"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import {
  IconSpinner,
  ExpandIcon,
  CollapseIcon,
  CustomAgentIcon,
} from "../../../icons/icons"
import { CompactMarkdownRenderer } from "../../../components/chat-markdown-renderer"
import { cn } from "../../../lib/utils"

interface AgentTaskToolProps {
  part: any
  nestedTools: any[]
  chatStatus?: string
}

// Constants for rendering
const MAX_VISIBLE_TOOLS = 5
const TOOL_HEIGHT_PX = 24
const MAX_COLLAPSED_LINES = 5

// Format elapsed time in a human-readable format
function formatElapsedTime(ms: number): string {
  if (ms < 1000) return ""
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (remainingSeconds === 0) return `${minutes}m`
  return `${minutes}m ${remainingSeconds}s`
}

// Map subagent_type to display label
function getSubagentTypeLabel(type?: string): string {
  if (!type) return "Agent"
  switch (type) {
    case "Bash": return "Bash"
    case "Explore": return "Explore"
    case "general-purpose": return "Agent"
    case "Plan": return "Plan"
    case "statusline-setup": return "Setup"
    default: return type
  }
}

// Extract text content from subagent output
function getSubagentResultText(output: any): string {
  if (!output?.content || !Array.isArray(output.content)) return ""
  return output.content
    .filter((c: any) => c.type === "text" && c.text)
    .map((c: any) => c.text)
    .join("\n\n")
}

// Format token count (e.g. 1234 -> "1.2k")
function formatTokens(n: number): string {
  if (!n || n === 0) return "0"
  if (n < 1000) return String(n)
  return (n / 1000).toFixed(1) + "k"
}

// Limit text to N lines
function limitLines(text: string, maxLines: number): { text: string; truncated: boolean } {
  if (!text) return { text: "", truncated: false }
  const lines = text.split("\n")
  if (lines.length <= maxLines) return { text, truncated: false }
  return { text: lines.slice(0, maxLines).join("\n"), truncated: true }
}

export const AgentTaskTool = memo(function AgentTaskTool({
  part,
  nestedTools,
  chatStatus,
}: AgentTaskToolProps) {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const projectPath = selectedProject?.path
  const { isPending, isInterrupted } = getToolStatus(part, chatStatus)
  const onOpenFile = useFileOpen()

  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  const description = part.input?.description || ""
  const subagentType = part.input?.subagent_type
  const typeLabel = getSubagentTypeLabel(subagentType)
  const startedAt = part.startedAt as number | undefined

  // Check if chat is actively streaming
  const isActivelyStreaming = chatStatus === "streaming" || chatStatus === "submitted"
  const isInputStreaming = part.state === "input-streaming" && isActivelyStreaming

  // Extract result text from output
  const resultText = useMemo(() => getSubagentResultText(part.output), [part.output])

  // Detect error state from content
  const isTaskError = useMemo(() => {
    if (part.state === "output-error") return true
    if (!part.output) return false
    if (part.output.status === "error") return true
    const text = getSubagentResultText(part.output)
    if (text.includes("Failed to authenticate") || text.includes("API Error")) return true
    return false
  }, [part.output, part.state])

  const isTaskSuccess = !isPending && !isTaskError && part.output

  // Stats from output
  const totalDurationMs = part.output?.totalDurationMs || part.output?.duration || part.output?.duration_ms || 0
  const totalTokens = part.output?.totalTokens || 0
  const totalToolUseCount = part.output?.totalToolUseCount || 0
  const hasStats = totalDurationMs > 0 || totalTokens > 0 || totalToolUseCount > 0

  // Collapsed result text preview
  const resultLimited = useMemo(() => limitLines(resultText, MAX_COLLAPSED_LINES), [resultText])
  const hasResultContent = resultText.trim().length > 0
  const hasMoreContent = resultLimited.truncated

  // Whether there's expandable content
  const hasExpandableContent = hasResultContent || nestedTools.length > 0 || hasStats

  // Track elapsed time while task is running
  useEffect(() => {
    if (isPending && startedAt) {
      setElapsedMs(Date.now() - startedAt)
      const interval = setInterval(() => {
        setElapsedMs(Date.now() - startedAt)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isPending, startedAt])

  const displayMs = !isPending && totalDurationMs ? totalDurationMs : elapsedMs
  const elapsedTimeDisplay = formatElapsedTime(displayMs)

  // Auto-scroll nested tools
  useEffect(() => {
    if (isPending && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [nestedTools.length, isPending, isExpanded])

  const hasNestedTools = nestedTools.length > 0

  const handleCopy = useCallback(() => {
    if (!resultText) return
    navigator.clipboard.writeText(resultText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [resultText])

  // If input is still streaming, show loading state
  if (isInputStreaming) {
    return (
      <div className="flex items-start gap-1.5 rounded-md py-0.5 px-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
            <CustomAgentIcon className="w-3.5 h-3.5 shrink-0" />
            <span className="font-medium whitespace-nowrap shrink-0">
              <TextShimmer
                as="span"
                duration={1.2}
                className="inline-flex items-center text-xs leading-none h-4 m-0"
              >
                Preparing subagent
              </TextShimmer>
            </span>
          </div>
        </div>
      </div>
    )
  }

  // Show interrupted state
  if (isInterrupted && !part.output) {
    return <AgentToolInterrupted toolName="Subagent" subtitle={description} />
  }

  // If still pending (no output yet), show the lightweight running state
  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 overflow-hidden mx-2">
        {/* Header */}
        <div
          onClick={() => hasNestedTools && setIsExpanded(!isExpanded)}
          className={cn(
            "flex items-center justify-between pl-2.5 pr-0.5 h-7",
            hasNestedTools && "cursor-pointer hover:bg-muted/50 transition-colors duration-150",
          )}
        >
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <CustomAgentIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted-foreground/10 font-medium text-muted-foreground shrink-0">
              {typeLabel}
            </span>
            <TextShimmer
              as="span"
              duration={1.2}
              className="text-xs truncate min-w-0"
            >
              {description || "Running subagent..."}
            </TextShimmer>
            {elapsedTimeDisplay && (
              <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
                {elapsedTimeDisplay}
              </span>
            )}
          </div>
          <div className="w-6 h-6 flex items-center justify-center shrink-0">
            <IconSpinner className="w-3 h-3" />
          </div>
        </div>

        {/* Nested tools while streaming */}
        {hasNestedTools && isExpanded && (
          <div className="border-t border-border">
            <div className="relative">
              <div
                className={cn(
                  "absolute inset-x-0 top-0 h-8 bg-linear-to-b from-background to-transparent z-10 pointer-events-none transition-opacity duration-200",
                  nestedTools.length > MAX_VISIBLE_TOOLS ? "opacity-100" : "opacity-0",
                )}
              />
              <div
                ref={scrollRef}
                className={cn(
                  "space-y-0.5 py-1.5",
                  nestedTools.length > MAX_VISIBLE_TOOLS && "overflow-y-auto scrollbar-hide",
                )}
                style={
                  nestedTools.length > MAX_VISIBLE_TOOLS
                    ? { maxHeight: `${MAX_VISIBLE_TOOLS * TOOL_HEIGHT_PX}px` }
                    : undefined
                }
              >
                {nestedTools.map((nestedPart, idx) => {
                  const nestedMeta = AgentToolRegistry[nestedPart.type]
                  if (!nestedMeta) {
                    return (
                      <div key={idx} className="text-xs text-muted-foreground py-0.5 px-2.5">
                        {nestedPart.type?.replace("tool-", "")}
                      </div>
                    )
                  }
                  const { isPending: nestedIsPending, isError: nestedIsError } =
                    getToolStatus(nestedPart, chatStatus)
                  return (
                    <AgentToolCall
                      key={idx}
                      icon={nestedMeta.icon}
                      title={nestedMeta.title(nestedPart)}
                      subtitle={nestedMeta.subtitle?.(nestedPart)}
                      tooltipContent={nestedMeta.tooltipContent?.(nestedPart, projectPath)}
                      isPending={nestedIsPending}
                      isError={nestedIsError}
                      isNested
                    />
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Completed state: full card ──

  return (
    <div
      className={cn(
        "rounded-lg border overflow-hidden mx-2",
        isTaskError
          ? "border-rose-500/30 bg-rose-500/5"
          : "border-border bg-muted/30",
      )}
    >
      {/* Header */}
      <div
        onClick={() => hasExpandableContent && setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center justify-between pl-2.5 pr-0.5 h-7",
          hasExpandableContent && "cursor-pointer hover:bg-muted/50 transition-colors duration-150",
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <CustomAgentIcon className={cn(
            "w-3.5 h-3.5 shrink-0",
            isTaskError ? "text-rose-500 dark:text-rose-400" : "text-muted-foreground",
          )} />
          <span className={cn(
            "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
            isTaskError
              ? "bg-rose-500/15 text-rose-600 dark:text-rose-400"
              : "bg-muted-foreground/10 text-muted-foreground",
          )}>
            {typeLabel}
          </span>
          <span className="text-xs text-muted-foreground truncate min-w-0">
            {description || "Subagent"}
          </span>
          {elapsedTimeDisplay && (
            <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
              {elapsedTimeDisplay}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {/* Status */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {isTaskSuccess ? (
              <>
                <Check className="w-3 h-3" />
                <span>Done</span>
              </>
            ) : isTaskError ? (
              <>
                <X className="w-3 h-3 text-rose-500" />
                <span className="text-rose-500 dark:text-rose-400">Failed</span>
              </>
            ) : null}
          </div>

          {/* Expand/Collapse button */}
          <div className="w-6 h-6 flex items-center justify-center">
            {hasExpandableContent ? (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsExpanded(!isExpanded)
                }}
                className="p-1 rounded-md hover:bg-accent transition-[background-color,transform] duration-150 ease-out active:scale-95"
              >
                {isExpanded ? (
                  <CollapseIcon className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ExpandIcon className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Content area */}
      {hasExpandableContent && (
        <div
          onClick={() => !isExpanded && hasMoreContent && setIsExpanded(true)}
          className={cn(
            "border-t border-border transition-colors duration-150",
            !isExpanded && hasMoreContent && "cursor-pointer hover:bg-muted/50",
          )}
        >
          {/* Result text */}
          {hasResultContent && (
            <div className="px-2.5 py-2">
              {isExpanded ? (
                <div className="relative group/result">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCopy()
                    }}
                    className="absolute top-0 right-0 p-1 rounded-md bg-muted opacity-0 group-hover/result:opacity-100 hover:bg-accent transition-all duration-150 ease-out active:scale-95 z-10"
                  >
                    {copied ? (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                    )}
                  </button>
                  <div className="text-xs">
                    <CompactMarkdownRenderer content={resultText} />
                  </div>
                </div>
              ) : (
                <div className="font-mono text-xs text-muted-foreground whitespace-pre-wrap break-all">
                  {resultLimited.text}
                  {resultLimited.truncated && (
                    <span className="text-muted-foreground/40"> ...</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Stats row */}
          {hasStats && !isPending && (
            <div className={cn(
              "flex items-center gap-3 px-2.5 py-1.5 text-[10px] text-muted-foreground/60",
              hasResultContent && "border-t border-border/50",
            )}>
              {totalDurationMs > 0 && (
                <span className="tabular-nums">{formatElapsedTime(totalDurationMs) || "<1s"}</span>
              )}
              {totalToolUseCount > 0 && (
                <span>{totalToolUseCount} tool{totalToolUseCount !== 1 ? "s" : ""}</span>
              )}
              {totalTokens > 0 && (
                <span>{formatTokens(totalTokens)} tokens</span>
              )}
            </div>
          )}

          {/* Nested tools */}
          {hasNestedTools && isExpanded && (
            <div className="border-t border-border/50">
              <div className="relative">
                <div
                  ref={scrollRef}
                  className="space-y-0.5 py-1.5"
                >
                  {nestedTools.map((nestedPart, idx) => {
                    const nestedMeta = AgentToolRegistry[nestedPart.type]
                    if (!nestedMeta) {
                      return (
                        <div key={idx} className="text-xs text-muted-foreground py-0.5 px-2.5">
                          {nestedPart.type?.replace("tool-", "")}
                        </div>
                      )
                    }
                    const { isPending: nestedIsPending, isError: nestedIsError } =
                      getToolStatus(nestedPart, chatStatus)
                    const handleClick = nestedPart.type === "tool-Read" && onOpenFile && nestedPart.input?.file_path
                      ? () => onOpenFile(nestedPart.input.file_path)
                      : undefined
                    return (
                      <AgentToolCall
                        key={idx}
                        icon={nestedMeta.icon}
                        title={nestedMeta.title(nestedPart)}
                        subtitle={nestedMeta.subtitle?.(nestedPart)}
                        tooltipContent={nestedMeta.tooltipContent?.(nestedPart, projectPath)}
                        isPending={nestedIsPending}
                        isError={nestedIsError}
                        onClick={handleClick}
                        isNested
                      />
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}, areTaskToolPropsEqual)
