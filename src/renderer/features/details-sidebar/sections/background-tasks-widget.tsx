"use client"

import { memo, useMemo, useState, useCallback } from "react"
import { useAtom, useAtomValue } from "jotai"
import { Cpu, Loader2, CheckCircle, XCircle, StopCircle, X, Trash2 } from "lucide-react"
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

interface BackgroundTasksWidgetProps {
  /** Active sub-chat ID to get tasks from */
  subChatId: string | null
  /** Callback to kill a background task */
  onKillTask?: (taskId: string, shellId: string) => void
}

const statusIcons: Record<BackgroundTaskStatus, React.ReactNode> = {
  running: <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />,
  completed: <CheckCircle className="h-3.5 w-3.5 text-green-500" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-500" />,
  stopped: <StopCircle className="h-3.5 w-3.5 text-muted-foreground" />,
}

const TaskListItem = memo(function TaskListItem({
  task,
  isLast,
  onKill,
}: {
  task: BackgroundTask
  isLast: boolean
  onKill?: (taskId: string, shellId: string) => void
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 group",
        !isLast && "border-b border-border/30"
      )}
    >
      <div className="flex-shrink-0">{statusIcons[task.status]}</div>
      <span
        className={cn(
          "text-xs truncate flex-1",
          task.status === "completed" || task.status === "stopped"
            ? "text-muted-foreground"
            : "text-foreground"
        )}
      >
        {task.summary}
      </span>
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
  )
})

/**
 * Background Tasks Widget for Details Sidebar
 * Shows background tasks from the active sub-chat
 * Memoized to prevent re-renders when parent updates
 */
export const BackgroundTasksWidget = memo(function BackgroundTasksWidget({
  subChatId,
  onKillTask,
}: BackgroundTasksWidgetProps) {
  // Get tasks from the active sub-chat
  const tasksAtom = useMemo(
    () => backgroundTasksAtomFamily(subChatId || "default"),
    [subChatId]
  )
  const [tasks, setTasks] = useAtom(tasksAtom)

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
              />
            ))}
            {/* Completed tasks */}
            {completedTasks.map((task, idx) => (
              <TaskListItem
                key={task.taskId}
                task={task}
                isLast={idx === completedTasks.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
