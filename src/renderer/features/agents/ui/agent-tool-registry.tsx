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
} from "../../../components/ui/icons"

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

const PLANNING_MESSAGES = [
  "构思中...",
  "酝酿中...",
  "脑洞大开中...",
  "灵感涌现中...",
  "奋笔疾书中...",
  "运筹帷幄中...",
  "文思泉涌中...",
  "创意发酵中...",
  "思路梳理中...",
  "灵光乍现中...",
  "神经元放电中...",
  "逻辑推演中...",
  "创意烹饪中...",
  "思维编织中...",
  "代码酿造中...",
  "想法孵化中...",
  "蓝图绘制中...",
  "点子碰撞中...",
  "答案浮现中...",
  "方案打磨中...",
  "灵感捕捉中...",
  "思维加速中...",
  "智慧结晶中...",
  "好点子冒泡中...",
  "思考回路全开中...",
  "知识融合中...",
  "草稿起笔中...",
  "拼图拼接中...",
  "脑内风暴中...",
  "解法推导中..."
]

export const AgentToolRegistry: Record<string, ToolMeta> = {
  "tool-Task": {
    icon: SparklesIcon,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return "准备子代理"
      return isPending ? "运行子代理" : "子代理已完成"
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
      if (isInputStreaming) return "准备搜索"
      if (isPending) return "搜索中"

      const mode = part.output?.mode
      const numFiles = part.output?.numFiles || 0
      const numLines = part.output?.numLines || 0

      if (mode === "content") {
        return numLines > 0 ? `找到 ${numLines} 处匹配` : "无匹配"
      }

      return numFiles > 0 ? `搜索了 ${numFiles} 个文件` : "无匹配"
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
      if (isInputStreaming) return "准备搜索"
      if (isPending) return "浏览文件中"

      const numFiles = part.output?.numFiles || 0
      return numFiles > 0 ? `找到 ${numFiles} 个文件` : "未找到文件"
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
      if (isInputStreaming) return "准备阅读"
      return isPending ? "阅读中" : "已阅读"
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
      if (isInputStreaming) return "准备编辑"
      const filePath = part.input?.file_path || ""
      if (!filePath) return "编辑"
      return filePath.split("/").pop() || "编辑"
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
    title: () => "克隆仓库中",
    variant: "simple",
  },

  // Planning indicator - shown when streaming starts but no content yet
  "tool-planning": {
    icon: PlanningIcon,
    title: () => {
      return PLANNING_MESSAGES[Math.floor(Math.random() * PLANNING_MESSAGES.length)]
    },
    variant: "simple",
  },

  "tool-Write": {
    icon: WriteFileIcon,
    title: (part) => {
      const isInputStreaming = part.state === "input-streaming"
      if (isInputStreaming) return "准备创建"
      return "创建"
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
      if (isInputStreaming) return "生成命令中"
      return isPending ? "执行命令中" : "已执行命令"
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
      if (isInputStreaming) return "准备抓取"
      return isPending ? "抓取中" : "已抓取"
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
      if (isInputStreaming) return "准备搜索"
      return isPending ? "搜索网页中" : "已搜索网页"
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
        return action === "add" ? "添加待办中" : "更新待办中"
      }
      return action === "add" ? "已添加待办" : "已更新待办"
    },
    subtitle: (part) => {
      const todos = part.input?.todos || []
      if (todos.length === 0) return ""
      return `${todos.length} 项`
    },
    variant: "simple",
  },

  // Task management tools
  "tool-TaskCreate": {
    icon: Plus,
    title: (part) => {
      const isPending =
        part.state !== "output-available" && part.state !== "output-error"
      return isPending ? "创建任务中" : "已创建任务"
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
        if (status === "in_progress") return "启动任务中"
        if (status === "completed") return "完成任务中"
        if (status === "deleted") return "删除任务中"
        return "更新任务中"
      }
      if (status === "in_progress") return "已启动任务"
      if (status === "completed") return "已完成任务"
      if (status === "deleted") return "已删除任务"
      return "已更新任务"
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
      return isPending ? "获取任务中" : "已获取任务"
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
      if (isPending) return "列出任务中"
      return count !== undefined ? `已列出 ${count} 个任务` : "已列出任务"
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
        if (action === "create") return "创建计划中"
        if (action === "approve") return "审批计划中"
        if (action === "complete") return "完成计划中"
        return "更新计划中"
      }
      if (status === "awaiting_approval") return "计划待审阅"
      if (status === "approved") return "计划已批准"
      if (status === "completed") return "计划已完成"
      return action === "create" ? "已创建计划" : "已更新计划"
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
      return isPending ? "结束计划中" : "计划完成"
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
      return isPending ? "编辑笔记本中" : "已编辑笔记本"
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
      return isPending ? "获取输出中" : "已获取输出"
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
      return isPending ? "停止 Shell 中" : "已停止 Shell"
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
      return isPending ? "列出资源中" : "已列出资源"
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
      return isPending ? "读取资源中" : "已读取资源"
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
      return isPending ? "压缩中..." : "已压缩"
    },
    variant: "simple",
  },

}
