"use client"

import {
  Database,
  Eye,
  FileCode2,
  FolderSearch,
  GitBranch,
  List,
  ListTodo,
  LogOut,
  Minimize2,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  XCircle,
} from "lucide-react"
import {
  CustomTerminalIcon,
  EyeIcon,
  GlobeIcon,
  IconEditFile,
  PlanningIcon,
  SearchIcon,
  SparklesIcon,
  WriteFileIcon,
} from "../../../icons/icons"
import i18n from "../../../lib/i18n"

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, { ns: "chat", ...options })

export type ToolVariant = "simple" | "collapsible"

export interface ToolMeta {
  icon: React.ComponentType<{ className?: string }>
  title: (part: any) => string
  subtitle?: (part: any) => string
  tooltipContent?: (part: any, projectPath?: string) => string
  variant: ToolVariant
}

export function getToolStatus(part: any, chatStatus?: string) {
  const basePending =
    part.state !== "output-available" && part.state !== "output-error" && part.state !== "result"
  const isError =
    part.state === "output-error" ||
    (part.state === "output-available" && part.output?.success === false)
  const isSuccess = part.state === "output-available" && !isError
  // Critical: if chat stopped streaming, pending tools should show as complete
  // Include "submitted" status - this is when request was sent but streaming hasn't started yet
  const isActivelyStreaming = chatStatus === "streaming" || chatStatus === "submitted"
  const isPending = basePending && isActivelyStreaming
  // Tool was in progress but chat stopped streaming (user interrupted)
  const isInterrupted = basePending && !isActivelyStreaming && chatStatus !== undefined

  return { isPending, isError, isSuccess, isInterrupted }
}

// Utility to get clean display path (remove sandbox/worktree/absolute prefixes)
// projectPath: optional absolute path to the project root, used to compute relative paths
export function getDisplayPath(filePath: string, projectPath?: string): string {
  if (!filePath) return ""

  // If projectPath is provided, strip it to get a project-relative path
  if (projectPath && filePath.startsWith(projectPath)) {
    const relative = filePath.slice(projectPath.length).replace(/^\//, "")
    return relative || filePath.split("/").pop() || filePath
  }

  const prefixes = [
    "/project/sandbox/repo/",
    "/project/sandbox/",
    "/project/",
    "/workspace/",
  ]
  for (const prefix of prefixes) {
    if (filePath.startsWith(prefix)) {
      return filePath.slice(prefix.length)
    }
  }
  // Handle worktree paths: /.hong/worktrees/{chatId}/{subChatId}/relativePath
  const worktreeMatch = filePath.match(/\.hong\/worktrees\/[^/]+\/[^/]+\/(.+)$/)
  if (worktreeMatch) {
    return worktreeMatch[1]
  }
  // Handle claude-sessions paths: .../claude-sessions/{sessionId}/{folder}/{file}
  const sessionMatch = filePath.match(/claude-sessions\/[^/]+\/(.+)$/)
  if (sessionMatch) {
    return sessionMatch[1]
  }
  if (filePath.startsWith("/")) {
    const parts = filePath.split("/")
    const rootIndicators = ["apps", "packages", "src", "lib", "components"]
    const rootIndex = parts.findIndex((p: string) =>
      rootIndicators.includes(p),
    )
    if (rootIndex > 0) {
      return parts.slice(rootIndex).join("/")
    }
    // For other absolute paths, show last 3 segments to keep it short
    if (parts.length > 3) {
      return parts.slice(-3).join("/")
    }
  }
  return filePath
}

// Utility to calculate diff stats
function calculateDiffStats(oldString: string, newString: string) {
  const oldLines = oldString.split("\n")
  const newLines = newString.split("\n")
  const maxLines = Math.max(oldLines.length, newLines.length)
  let addedLines = 0
  let removedLines = 0

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]
    if (oldLine !== undefined && newLine !== undefined) {
      if (oldLine !== newLine) {
        removedLines++
        addedLines++
      }
    } else if (oldLine !== undefined) {
      removedLines++
    } else if (newLine !== undefined) {
      addedLines++
    }
  }
  return { addedLines, removedLines }
}


export const AgentToolRegistry: Record<string, ToolMeta> = {
  "tool-Task": {
    icon: SparklesIcon,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.task.preparing")
      return isPending ? t("tools.task.running") : t("tools.task.completed")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const description = part.input?.description || ""
      return description.length > 50
        ? description.slice(0, 47) + "..."
        : description
    },
    variant: "simple",
  },

  "tool-Grep": {
    icon: SearchIcon,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.grep.preparing")
      if (isPending) return t("tools.grep.pending")

      const mode = part.output?.mode
      const numFiles = part.output?.numFiles || 0
      const numLines = part.output?.numLines || 0

      if (mode === "content") {
        return numLines > 0 ? t("tools.grep.foundMatches", { count: numLines }) : t("tools.grep.noMatches")
      }

      return numFiles > 0 ? t("tools.grep.greppedFiles", { count: numFiles }) : t("tools.grep.noMatches")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const pattern = part.input?.pattern || ""
      const path = part.input?.path || ""

      if (path) {
        // Show "pattern in path" with shortened path
        const displayPath = getDisplayPath(path)
        const combined = `${pattern} in ${displayPath}`
        return combined.length > 40 ? combined.slice(0, 37) + "..." : combined
      }

      return pattern.length > 40 ? pattern.slice(0, 37) + "..." : pattern
    },
    variant: "simple",
  },

  "tool-Glob": {
    icon: FolderSearch,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.glob.preparing")
      if (isPending) return t("tools.glob.pending")

      const numFiles = part.output?.numFiles || 0
      return numFiles > 0 ? t("tools.glob.foundFiles", { count: numFiles }) : t("tools.glob.noFiles")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const pattern = part.input?.pattern || ""
      const targetDir = part.input?.target_directory || ""

      if (targetDir) {
        // Show "pattern in targetDir" with shortened path
        const displayTargetDir = getDisplayPath(targetDir)
        const combined = `${pattern} in ${displayTargetDir}`
        return combined.length > 40 ? combined.slice(0, 37) + "..." : combined
      }

      return pattern.length > 40 ? pattern.slice(0, 37) + "..." : pattern
    },
    variant: "simple",
  },

  "tool-Read": {
    icon: EyeIcon,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.read.preparing")
      return isPending ? t("tools.read.pending") : t("tools.read.completed")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const filePath = part.input?.file_path || ""
      if (!filePath) return "" // Don't show "file" placeholder during streaming
      return filePath.split("/").pop() || ""
    },
    tooltipContent: (part, projectPath) => {
      if (part.state === "input-streaming") return ""
      const filePath = part.input?.file_path || ""
      return getDisplayPath(filePath, projectPath)
    },
    variant: "simple",
  },

  "tool-Edit": {
    icon: IconEditFile,
    title: (part) => {
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.edit.preparing")
      const filePath = part.input?.file_path || ""
      if (!filePath) return t("tools.edit.default")
      return filePath.split("/").pop() || t("tools.edit.default")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      if (isPending) return ""

      const oldString = part.input?.old_string || ""
      const newString = part.input?.new_string || ""

      if (!oldString && !newString) {
        return ""
      }

      // Always show actual line counts if there are any changes (copied from canvas)
      if (oldString !== newString) {
        const { addedLines, removedLines } = calculateDiffStats(
          oldString,
          newString,
        )
        return `<span style="font-size: 11px; color: light-dark(#587C0B, #A3BE8C)">+${addedLines}</span> <span style="font-size: 11px; color: light-dark(#AD0807, #AE5A62)">-${removedLines}</span>`
      }

      return ""
    },
    variant: "simple",
  },

  // Cloning indicator - shown while sandbox is being created
  "tool-cloning": {
    icon: GitBranch,
    title: () => t("tools.cloning"),
    variant: "simple",
  },

  // Planning indicator - shown when streaming starts but no content yet
  "tool-planning": {
    icon: PlanningIcon,
    title: () => {
      const messages = t("planning.messages", { returnObjects: true }) as string[]
      return messages[Math.floor(Math.random() * messages.length)]
    },
    variant: "simple",
  },

  "tool-Write": {
    icon: WriteFileIcon,
    title: (part) => {
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.write.preparing")
      return t("tools.write.completed")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const filePath = part.input?.file_path || ""
      if (!filePath) return "" // Don't show "file" placeholder during streaming
      return filePath.split("/").pop() || ""
    },
    variant: "simple",
  },

  "tool-Bash": {
    icon: CustomTerminalIcon,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.bash.preparing")
      return isPending ? t("tools.bash.pending") : t("tools.bash.completed")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const command = part.input?.command || ""
      if (!command) return ""
      // Normalize line continuations, shorten absolute paths, and truncate
      let normalized = command.replace(/\\\s*\n\s*/g, " ").trim()
      // Replace absolute paths that look like project paths with relative versions
      normalized = normalized.replace(/\/(?:Users|home|root)\/[^\s"']+/g, (match: string) => {
        return getDisplayPath(match)
      })
      return normalized.length > 50 ? normalized.slice(0, 47) + "..." : normalized
    },
    variant: "simple",
  },

  "tool-WebFetch": {
    icon: GlobeIcon,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.webFetch.preparing")
      return isPending ? t("tools.webFetch.pending") : t("tools.webFetch.completed")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const url = part.input?.url || ""
      try {
        return new URL(url).hostname.replace("www.", "")
      } catch {
        return url.slice(0, 30)
      }
    },
    variant: "simple",
  },

  "tool-WebSearch": {
    icon: SearchIcon,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return t("tools.webSearch.preparing")
      return isPending ? t("tools.webSearch.pending") : t("tools.webSearch.completed")
    },
    subtitle: (part) => {
      // Don't show subtitle while input is still streaming
      if (part.state === "input-streaming") return ""
      const query = part.input?.query || ""
      return query.length > 40 ? query.slice(0, 37) + "..." : query
    },
    variant: "collapsible",
  },

  // Planning tools
  "tool-TodoWrite": {
    icon: ListTodo,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const action = part.input?.action || "update"
      if (isPending) {
        return action === "add" ? t("tools.todoWrite.adding") : t("tools.todoWrite.updating")
      }
      return action === "add" ? t("tools.todoWrite.added") : t("tools.todoWrite.updated")
    },
    subtitle: (part) => {
      const todos = part.input?.todos || []
      if (todos.length === 0) return ""
      return t("tools.todoWrite.itemCount", { count: todos.length })
    },
    variant: "simple",
  },

  // Task management tools
  "tool-TaskCreate": {
    icon: Plus,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? t("tools.taskCreate.pending") : t("tools.taskCreate.completed")
    },
    subtitle: (part) => {
      const subject = part.input?.subject || ""
      return subject.length > 40 ? subject.slice(0, 37) + "..." : subject
    },
    variant: "simple",
  },

  "tool-TaskUpdate": {
    icon: RefreshCw,
    title: (part) => {
      const status = part.input?.status
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      if (isPending) {
        if (status === "in_progress") return t("tools.taskUpdate.starting")
        if (status === "completed") return t("tools.taskUpdate.completing")
        if (status === "deleted") return t("tools.taskUpdate.deleting")
        return t("tools.taskUpdate.updating")
      }
      if (status === "in_progress") return t("tools.taskUpdate.started")
      if (status === "completed") return t("tools.taskUpdate.completedTask")
      if (status === "deleted") return t("tools.taskUpdate.deleted")
      return t("tools.taskUpdate.updated")
    },
    subtitle: (part) => {
      const subject = part.input?.subject
      const taskId = part.input?.taskId
      if (subject) {
        return subject.length > 40 ? subject.slice(0, 37) + "..." : subject
      }
      return taskId ? `#${taskId}` : ""
    },
    variant: "simple",
  },

  "tool-TaskGet": {
    icon: Eye,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? t("tools.taskGet.pending") : t("tools.taskGet.completed")
    },
    subtitle: (part) => {
      const subject = part.output?.task?.subject
      const taskId = part.input?.taskId
      if (subject) {
        return subject.length > 40 ? subject.slice(0, 37) + "..." : subject
      }
      return taskId ? `#${taskId}` : ""
    },
    variant: "simple",
  },

  "tool-TaskList": {
    icon: List,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const count = part.output?.tasks?.length
      if (isPending) return t("tools.taskList.pending")
      return count !== undefined ? t("tools.taskList.completed", { count }) : t("tools.taskList.completedDefault")
    },
    subtitle: () => "",
    variant: "simple",
  },

  "tool-PlanWrite": {
    icon: PlanningIcon,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const action = part.input?.action || "create"
      const status = part.input?.plan?.status
      if (isPending) {
        if (action === "create") return t("tools.planWrite.creating")
        if (action === "approve") return t("tools.planWrite.approving")
        if (action === "complete") return t("tools.planWrite.completingPlan")
        return t("tools.planWrite.updating")
      }
      if (status === "awaiting_approval") return t("tools.planWrite.readyForReview")
      if (status === "approved") return t("tools.planWrite.approved")
      if (status === "completed") return t("tools.planWrite.completedPlan")
      return action === "create" ? t("tools.planWrite.created") : t("tools.planWrite.updated")
    },
    subtitle: (part) => {
      const plan = part.input?.plan
      if (!plan) return ""
      const steps = plan.steps || []
      const completed = steps.filter((s: any) => s.status === "completed").length
      if (plan.title) {
        return steps.length > 0
          ? `${plan.title} (${completed}/${steps.length})`
          : plan.title
      }
      return steps.length > 0
        ? `${completed}/${steps.length} steps`
        : ""
    },
    variant: "simple",
  },

  "tool-ExitPlanMode": {
    icon: LogOut,
    title: (part) => {
      const {isPending} = getToolStatus(part)
      return isPending ? t("tools.exitPlanMode.pending") : t("tools.exitPlanMode.completed")
    },
    subtitle: () => "",
    variant: "simple",
  },

  // Notebook tools
  "tool-NotebookEdit": {
    icon: FileCode2,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? t("tools.notebookEdit.pending") : t("tools.notebookEdit.completed")
    },
    subtitle: (part) => {
      const filePath = part.input?.file_path || ""
      if (!filePath) return ""
      return filePath.split("/").pop() || ""
    },
    variant: "simple",
  },

  // Shell management tools
  "tool-BashOutput": {
    icon: Terminal,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? t("tools.bashOutput.pending") : t("tools.bashOutput.completed")
    },
    subtitle: (part) => {
      const pid = part.input?.pid
      return pid ? `PID: ${pid}` : ""
    },
    variant: "simple",
  },

  "tool-KillShell": {
    icon: XCircle,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? t("tools.killShell.pending") : t("tools.killShell.completed")
    },
    subtitle: (part) => {
      const pid = part.input?.pid
      return pid ? `PID: ${pid}` : ""
    },
    variant: "simple",
  },

  // MCP tools
  "tool-ListMcpResources": {
    icon: Server,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? t("tools.mcpListResources.pending") : t("tools.mcpListResources.completed")
    },
    subtitle: (part) => {
      const server = part.input?.server || ""
      return server
    },
    variant: "simple",
  },

  "tool-ReadMcpResource": {
    icon: Database,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? t("tools.mcpReadResource.pending") : t("tools.mcpReadResource.completed")
    },
    subtitle: (part) => {
      const uri = part.input?.uri || ""
      return uri.length > 30 ? "..." + uri.slice(-27) : uri
    },
    variant: "simple",
  },

  // System tools
  "system-Compact": {
    icon: Minimize2,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? t("tools.compact.pending") : t("tools.compact.completed")
    },
    variant: "simple",
  },

}
