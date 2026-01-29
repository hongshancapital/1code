"use client"

import { memo, useMemo, useState, useCallback } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Cpu, Loader2, CheckCircle, XCircle, StopCircle, X, Trash2, ChevronRight, RefreshCw, Terminal as TerminalIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { ExpandIcon, CollapseIcon } from "@/components/ui/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  backgroundTasksAtomFamily,
  runningTasksCountAtomFamily,
} from "@/features/agents/atoms/background-tasks"
import type { BackgroundTask, BackgroundTaskStatus } from "@/features/agents/types/background-task"
import { trpc } from "@/lib/trpc"
import {
  terminalsAtom,
  activeTerminalIdAtom,
  terminalSidebarOpenAtom,
} from "@/features/terminal/atoms"
import type { TerminalInstance } from "@/features/terminal/types"

interface BackgroundTasksWidgetProps {
  /** Active sub-chat ID to get tasks from */
  subChatId: string | null
  /** Chat ID for terminal scoping */
  chatId?: string
  /** Current working directory */
  cwd?: string
  /** Workspace ID for terminal */
  workspaceId?: string
  /** Callback to kill a background task */
  onKillTask?: (taskId: string, shellId: string) => void
}

const statusIcons: Record<BackgroundTaskStatus, React.ReactNode> = {
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
  completed: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  stopped: <StopCircle className="h-3.5 w-3.5 text-muted-foreground" />,
}

function generateTerminalId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function generatePaneId(chatId: string, terminalId: string): string {
  return `${chatId}:term:${terminalId}`
}

const TaskListItem = memo(function TaskListItem({
  task,
  isLast,
  onKill,
  onOpenInTerminal,
}: {
  task: BackgroundTask
  isLast: boolean
  onKill?: (taskId: string, shellId: string) => void
  onOpenInTerminal?: (outputFile: string) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [output, setOutput] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  // Use trpc client directly for reading files
  const trpcUtils = trpc.useUtils()

  const handleToggleOutput = useCallback(async () => {
    if (!task.outputFile) return

    if (isExpanded) {
      setIsExpanded(false)
      return
    }

    setIsLoading(true)
    try {
      const content = await trpcUtils.files.readFile.fetch({
        path: task.outputFile,
      })
      setOutput(content || "(empty)")
      setIsExpanded(true)
    } catch (err: any) {
      console.error("[BackgroundTask] Failed to read output:", err)
      // SDK cleans up output files after session ends
      // Show appropriate message based on task status
      let errorMsg: string
      if (err?.message?.includes("ENOENT")) {
        if (task.status === "running") {
          errorMsg = "Output file not available yet (task starting...)"
        } else {
          errorMsg = "Output file cleaned up (SDK removes files after session)"
        }
      } else {
        errorMsg = "Failed to read output file"
      }
      setOutput(errorMsg)
      setIsExpanded(true)
    } finally {
      setIsLoading(false)
    }
  }, [task.outputFile, isExpanded, trpcUtils])

  const handleRefreshOutput = useCallback(async () => {
    if (!task.outputFile) return

    setIsLoading(true)
    try {
      const content = await trpcUtils.files.readFile.fetch({
        path: task.outputFile,
      })
      setOutput(content || "(empty)")
    } catch (err: any) {
      console.error("[BackgroundTask] Failed to refresh output:", err)
      let errorMsg: string
      if (err?.message?.includes("ENOENT")) {
        if (task.status === "running") {
          errorMsg = "Output file not available yet (task starting...)"
        } else {
          errorMsg = "Output file cleaned up (SDK removes files after session)"
        }
      } else {
        errorMsg = "Failed to read output file"
      }
      setOutput(errorMsg)
    } finally {
      setIsLoading(false)
    }
  }, [task.outputFile, trpcUtils])

  const hasOutput = !!task.outputFile

  return (
    <div
      className={cn(
        "group",
        !isLast && !isExpanded && "border-b border-border/30"
      )}
    >
      {/* Task row */}
      <div
        className={cn(
          "flex items-center gap-2 px-2 py-1.5",
          hasOutput && "cursor-pointer hover:bg-muted/30"
        )}
        onClick={hasOutput ? handleToggleOutput : undefined}
      >
        {/* Expand indicator for tasks with output */}
        {hasOutput && (
          <ChevronRight
            className={cn(
              "h-3 w-3 text-muted-foreground transition-transform flex-shrink-0",
              isExpanded && "rotate-90"
            )}
          />
        )}
        <div className="flex-shrink-0">{statusIcons[task.status]}</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "text-xs truncate flex-1 cursor-default",
                task.status === "completed" || task.status === "stopped"
                  ? "text-muted-foreground"
                  : "text-foreground"
              )}
            >
              {task.summary}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[400px] break-all">
            <p className="font-mono text-xs">{task.command || task.summary}</p>
            {task.outputFile && (
              <p className="text-muted-foreground text-[10px] mt-1">
                Output: {task.outputFile}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
        {task.status === "running" && onKill && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onKill(task.taskId, task.shellId)
                }}
                className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Kill task</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Output panel */}
      {isExpanded && (
        <div className="border-t border-border/30 bg-muted/20">
          {/* Output header with refresh and terminal buttons */}
          <div className="flex items-center justify-between px-2 py-1 border-b border-border/20">
            <span className="text-[10px] text-muted-foreground font-medium">OUTPUT</span>
            <div className="flex items-center gap-1">
              {/* Open in terminal button */}
              {task.outputFile && onOpenInTerminal && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onOpenInTerminal(task.outputFile!)
                      }}
                      className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <TerminalIcon className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Open in terminal (tail -f)</TooltipContent>
                </Tooltip>
              )}
              {/* Refresh button */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleRefreshOutput()
                }}
                disabled={isLoading}
                className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
              </button>
            </div>
          </div>
          {/* Output content */}
          <pre className="px-2 py-1.5 text-[10px] text-muted-foreground max-h-[150px] overflow-auto whitespace-pre-wrap break-all font-mono">
            {isLoading && !output ? "Loading..." : output || "No output"}
          </pre>
        </div>
      )}
    </div>
  )
})

/**
 * Background Tasks Widget for Details Sidebar
 * Shows background tasks from the active sub-chat
 * Memoized to prevent re-renders when parent updates
 */
export const BackgroundTasksWidget = memo(function BackgroundTasksWidget({
  subChatId,
  chatId,
  cwd,
  workspaceId,
  onKillTask,
}: BackgroundTasksWidgetProps) {
  // Get tasks from the active sub-chat
  const tasksAtom = useMemo(
    () => backgroundTasksAtomFamily(subChatId || "default"),
    [subChatId]
  )
  const [tasks, setTasks] = useAtom(tasksAtom)

  // Terminal state for opening output in terminal
  const [allTerminals, setAllTerminals] = useAtom(terminalsAtom)
  const setAllActiveIds = useSetAtom(activeTerminalIdAtom)
  const setTerminalSidebarOpen = useSetAtom(terminalSidebarOpenAtom)

  // Expanded/collapsed state
  const [isExpanded, setIsExpanded] = useState(true)

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setIsExpanded((prev) => !prev)
    }
  }, [])

  const handleKill = useCallback(
    (taskId: string, shellId: string) => {
      // Update local state to stopped
      setTasks((prev) =>
        prev.map((t) =>
          t.taskId === taskId
            ? { ...t, status: "stopped" as const, completedAt: Date.now() }
            : t
        )
      )
      // Call parent handler to actually kill the task
      onKillTask?.(taskId, shellId)
    },
    [setTasks, onKillTask]
  )

  // Open output file in terminal with tail -f
  const handleOpenInTerminal = useCallback(
    (outputFile: string) => {
      if (!chatId || !cwd) return

      const id = generateTerminalId()
      // Use "run" prefix for task output terminals
      const paneId = `${chatId}:run:${id}`

      // Get existing terminals for this chat to generate name
      const existingTerminals = allTerminals[chatId] || []
      const existingNumbers = existingTerminals
        .map((t) => {
          const match = t.name.match(/^Task Output (\d+)$/)
          return match ? parseInt(match[1], 10) : 0
        })
        .filter((n) => n > 0)
      const maxNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0
      const name = `Task Output ${maxNumber + 1}`

      // Create as "run" type terminal with tail -f command
      const newTerminal: TerminalInstance = {
        id,
        paneId,
        name,
        createdAt: Date.now(),
        type: "run",
        runConfig: {
          scriptName: "tail",
          command: `tail -f "${outputFile}"`,
          projectPath: cwd,
          packageManager: "shell",
          isDebugMode: false,
        },
        status: "running",
      }

      setAllTerminals((prev) => ({
        ...prev,
        [chatId]: [...(prev[chatId] || []), newTerminal],
      }))

      setAllActiveIds((prev) => ({
        ...prev,
        [chatId]: id,
      }))

      // Open terminal sidebar
      setTerminalSidebarOpen(true)
    },
    [chatId, cwd, allTerminals, setAllTerminals, setAllActiveIds, setTerminalSidebarOpen]
  )

  // Clear completed/stopped/failed tasks
  const handleClearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === "running"))
  }, [setTasks])

  // Calculate stats
  const runningTasks = tasks.filter((t) => t.status === "running")
  const completedTasks = tasks.filter((t) => t.status !== "running")
  const runningCount = runningTasks.length
  const totalTasks = tasks.length

  // Get display task (first running, or last completed)
  const displayTask = runningTasks[0] || completedTasks[completedTasks.length - 1]

  // Empty state - show simple indicator
  if (tasks.length === 0) {
    return (
      <div className="mx-2 mb-2">
        <div className="rounded-lg border border-border/50 bg-muted/30 px-2 h-8 flex items-center">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-xs text-muted-foreground">
              0 Background Processes Running
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-2 mb-2">
      {/* TOP BLOCK - Header with expand/collapse button - fixed height h-8 for consistency */}
      <div
        className="rounded-t-lg border border-b-0 border-border/50 bg-muted/30 px-2 h-8 cursor-pointer hover:bg-muted/50 transition-colors duration-150 flex items-center group"
        onClick={handleToggleExpand}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`Background tasks with ${totalTasks} items. Click to ${isExpanded ? "collapse" : "expand"}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Icon with activity indicator */}
          <div className="relative flex-shrink-0">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
            {runningCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
            )}
          </div>
          <span className="text-xs font-medium text-foreground">Background Tasks</span>
          {runningCount > 0 && (
            <span className="text-xs text-blue-500">
              {runningCount} running
            </span>
          )}
          {/* Spacer */}
          <div className="flex-1" />
          {/* Clear completed button - only show when there are completed tasks */}
          {completedTasks.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleClearCompleted()
                  }}
                  className="p-0.5 rounded hover:bg-foreground/10 text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0 mr-1"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">Clear completed</TooltipContent>
            </Tooltip>
          )}
          {/* Expand/Collapse icon */}
          <div className="relative w-3.5 h-3.5 flex-shrink-0">
            <ExpandIcon
              className={cn(
                "absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                isExpanded ? "opacity-0 scale-75" : "opacity-100 scale-100"
              )}
            />
            <CollapseIcon
              className={cn(
                "absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                isExpanded ? "opacity-100 scale-100" : "opacity-0 scale-75"
              )}
            />
          </div>
        </div>
      </div>

      {/* BOTTOM BLOCK - Task list (expandable) */}
      <div className="rounded-b-lg border border-border/50 border-t-0">
        {/* Collapsed view - current/last task + count */}
        {!isExpanded && displayTask && (
          <div
            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors duration-150"
            onClick={() => setIsExpanded(true)}
          >
            <div className="flex-shrink-0">{statusIcons[displayTask.status]}</div>
            <span className="text-xs text-muted-foreground truncate flex-1">
              {displayTask.summary}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
              {runningCount}/{totalTasks}
            </span>
          </div>
        )}

        {/* Expanded content - full task list */}
        {isExpanded && (
          <div className="max-h-[300px] overflow-y-auto">
            {/* Running tasks */}
            {runningTasks.map((task, idx) => (
              <TaskListItem
                key={task.taskId}
                task={task}
                isLast={idx === runningTasks.length - 1 && completedTasks.length === 0}
                onKill={handleKill}
                onOpenInTerminal={chatId && cwd ? handleOpenInTerminal : undefined}
              />
            ))}
            {/* Completed tasks */}
            {completedTasks.map((task, idx) => (
              <TaskListItem
                key={task.taskId}
                task={task}
                isLast={idx === completedTasks.length - 1}
                onOpenInTerminal={chatId && cwd ? handleOpenInTerminal : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
