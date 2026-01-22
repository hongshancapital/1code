import { useMemo } from "react"
import { useAtom } from "jotai"
import { useAgentSubChatStore } from "../../lib/stores/sub-chat-store"
import { currentTodosAtomFamily } from "../agents/atoms"
import {
  CheckCircle2,
  Loader2,
  ListTodo,
  PanelRightClose,
  CheckIcon,
} from "lucide-react"
import { Button } from "../../components/ui/button"
import { cn } from "../../lib/utils"
import { IconArrowRight } from "../../components/ui/icons"

// ============================================================================
// Types
// ============================================================================

interface TodoItem {
  content: string
  status: "pending" | "in_progress" | "completed"
  activeForm?: string
}

interface TaskPanelProps {
  onClose?: () => void
  showHeader?: boolean
}

// ============================================================================
// Components
// ============================================================================

/**
 * Status icon for individual todo items
 */
function TodoStatusIcon({ status }: { status: TodoItem["status"] }) {
  switch (status) {
    case "completed":
      return (
        <div className="w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <CheckIcon className="w-2.5 h-2.5 text-primary" />
        </div>
      )
    case "in_progress":
      return (
        <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
          <IconArrowRight className="w-2.5 h-2.5 text-primary-foreground" />
        </div>
      )
    default:
      return (
        <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 border border-muted-foreground/30" />
      )
  }
}

/**
 * Individual task item in the list
 */
function TaskItem({ todo }: { todo: TodoItem }) {
  const isCompleted = todo.status === "completed"
  const isInProgress = todo.status === "in_progress"

  return (
    <div
      className={cn(
        "flex items-start gap-2.5 p-2.5 rounded-lg transition-colors",
        isInProgress && "bg-accent/50"
      )}
    >
      <TodoStatusIcon status={todo.status} />
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-xs leading-relaxed",
            isCompleted && "line-through text-muted-foreground",
            isInProgress && "text-foreground font-medium"
          )}
        >
          {isInProgress && todo.activeForm ? todo.activeForm : todo.content}
        </p>
      </div>
    </div>
  )
}

/**
 * Empty state when no tasks
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
      <ListTodo className="h-8 w-8 mb-2 opacity-40" />
      <p className="text-xs">暂无任务</p>
    </div>
  )
}

// ============================================================================
// Task Panel Content (without header, for use in collapsible section)
// ============================================================================

export function TaskPanelContent() {
  // Get active sub-chat ID
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)

  // Get todos for active sub-chat
  const todosAtom = useMemo(
    () => currentTodosAtomFamily(activeSubChatId || "default"),
    [activeSubChatId]
  )
  const [todoState] = useAtom(todosAtom)
  const todos = todoState.todos

  // Calculate progress
  const completedCount = todos.filter((t) => t.status === "completed").length
  const totalCount = todos.length
  const progressPercent =
    totalCount > 0 ? (completedCount / totalCount) * 100 : 0

  // Find current task
  const currentTask = todos.find((t) => t.status === "in_progress")

  if (todos.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="flex flex-col">
      {/* Progress Section */}
      {totalCount > 0 && (
        <div className="p-3 border-b">
          {/* Progress bar */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums w-10 text-right">
              {Math.round(progressPercent)}%
            </span>
          </div>

          {/* Current task indicator */}
          {currentTask && (
            <div className="flex items-center gap-2 text-xs">
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span className="text-muted-foreground truncate">
                {currentTask.activeForm || currentTask.content}
              </span>
            </div>
          )}

          {/* All completed indicator */}
          {completedCount === totalCount && totalCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-3 w-3 text-green-500" />
              <span className="text-muted-foreground">所有任务已完成</span>
            </div>
          )}
        </div>
      )}

      {/* Task List */}
      <div className="p-2 space-y-0.5">
        {todos.map((todo, index) => (
          <TaskItem key={`${todo.content}-${index}`} todo={todo} />
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component (with header, for standalone use)
// ============================================================================

export function TaskPanel({ onClose, showHeader = true }: TaskPanelProps) {
  // Get active sub-chat ID
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)

  // Get todos for active sub-chat
  const todosAtom = useMemo(
    () => currentTodosAtomFamily(activeSubChatId || "default"),
    [activeSubChatId]
  )
  const [todoState] = useAtom(todosAtom)
  const todos = todoState.todos

  // Calculate progress
  const completedCount = todos.filter((t) => t.status === "completed").length
  const totalCount = todos.length

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-2 border-b flex-shrink-0">
          <div className="flex items-center gap-2">
            <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">任务</span>
          </div>
          <div className="flex items-center gap-2">
            {totalCount > 0 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {completedCount}/{totalCount}
              </span>
            )}
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onClose}
              >
                <PanelRightClose className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <TaskPanelContent />
      </div>
    </div>
  )
}
