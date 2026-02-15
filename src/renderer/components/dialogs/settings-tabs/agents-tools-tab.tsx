import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { settingsToolsSidebarWidthAtom } from "../../../lib/atoms"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"
import { ToolsIcon } from "../../../icons/icons"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import { ChatMarkdownRenderer } from "../../chat-markdown-renderer"
import {
  FileText,
  Terminal,
  Search,
  Globe,
  FileEdit,
  FolderSearch,
  Regex,
  Notebook,
  ListTodo,
  MessageSquare,
  Bot,
  HelpCircle,
  ClipboardList,
  RefreshCw,
  Camera,
  MousePointer,
  FormInput,
  Keyboard,
  Image,
  ArrowLeft,
  ArrowRight,
  Type,
  Link,
  Heading,
  Clock,
  ArrowUpDown,
  CheckSquare,
  CheckCircle,
  MousePointer2,
  Move,
  ImageDown,
  Download,
  Smartphone,
  Code,
  FileOutput,
  Files,
  Palette,
  Package,
  Layers,
  Minimize2,
  BoxSelect,
  Edit3,
  Wand2,
  type LucideIcon,
} from "lucide-react"

// Tool category type
type ToolCategory = "claude-sdk" | "custom" | "browser" | "image-process" | "image-gen" | "artifact"

// Tool definition
interface ToolDefinition {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  icon: LucideIcon
  details: string
}

// Icon mapping for dynamic tools
const ICON_MAPPING: Record<string, LucideIcon> = {
  // Browser
  browser_snapshot: Camera,
  browser_navigate: Globe,
  browser_click: MousePointer,
  browser_fill: FormInput,
  browser_type: Keyboard,
  browser_screenshot: Image,
  browser_back: ArrowLeft,
  browser_forward: ArrowRight,
  browser_reload: RefreshCw,
  browser_get_text: Type,
  browser_get_url: Link,
  browser_get_title: Heading,
  browser_wait: Clock,
  browser_scroll: ArrowUpDown,
  browser_press: Keyboard,
  browser_select: CheckSquare,
  browser_check: CheckCircle,
  browser_hover: MousePointer2,
  browser_drag: Move,
  browser_download_image: ImageDown,
  browser_download_file: Download,
  browser_emulate: Smartphone,
  browser_evaluate: Code,

  // Artifact
  mark_artifact: FileOutput,
  list_artifacts: Files,

  // Image Process
  image_info: FileText,
  image_resize: Move,
  image_crop: BoxSelect,
  image_compress: Minimize2,
  image_convert: RefreshCw,
  image_to_base64: Code,
  image_rotate: RefreshCw,
  image_concat: Layers,
  image_watermark: Type,
  image_annotate: Edit3,
  image_thumbnail: Image,
  image_composite: Layers,

  // Image Gen
  generate_image: Palette,
  edit_image: Wand2,
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  browser: Globe,
  "image-process": Image,
  "image-gen": Palette,
  artifact: Package,
}

// Claude Agent SDK built-in tools
const CLAUDE_SDK_TOOLS: ToolDefinition[] = [
  {
    name: "Read",
    displayName: "读取文件 (Read)",
    description: "读取本地文件系统中的文件内容",
    category: "claude-sdk",
    icon: FileText,
    details: `## Read Tool

读取本地文件系统中的文件，支持多种文件类型。

### 功能
- 读取带行号的文本文件
- 读取图片（PNG, JPG 等）- 可视化展示
- 读取 PDF 文件（支持页码范围选择）
- 读取 Jupyter Notebook (.ipynb) 及其输出
- 支持大文件的 offset（偏移）和 limit（行数限制）

### 参数
- \`file_path\` (必填): 文件的绝对路径
- \`offset\`: 开始读取的行号
- \`limit\`: 读取的行数
- \`pages\`: PDF 页码范围 (例如 "1-5")

### 注意
- 行号从 1 开始
- 单行超过 2000 字符会被截断
- 超过 10 页的 PDF 请使用 \`pages\` 参数`,
  },
  {
    name: "Write",
    displayName: "写入文件 (Write)",
    description: "在文件系统中创建或覆盖文件",
    category: "claude-sdk",
    icon: FileEdit,
    details: `## Write Tool

在本地文件系统中写入或覆盖文件。

### 功能
- 创建新文件
- 覆盖现有文件
- 支持任何基于文本的文件格式

### 参数
- \`file_path\` (必填): 文件的绝对路径
- \`content\` (必填): 要写入的内容

### 注意
- 会直接覆盖现有文件，无警告
- 如果文件已存在，必须先读取该文件
- 会自动创建不存在的父目录`,
  },
  {
    name: "Edit",
    displayName: "编辑文件 (Edit)",
    description: "对文件进行精确的字符串替换",
    category: "claude-sdk",
    icon: FileEdit,
    details: `## Edit Tool

对文件进行精确的字符串替换。

### 功能
- 替换文件中的特定文本
- 保持精确的缩进
- 支持使用 \`replace_all\` 替换所有出现的内容

### 参数
- \`file_path\` (必填): 文件的绝对路径
- \`old_string\` (必填): 要替换的文本
- \`new_string\` (必填): 替换后的文本
- \`replace_all\`: 是否替换所有出现的内容 (默认: false)

### 注意
- 如果 \`old_string\` 不唯一，编辑将失败（除非开启 replace_all）
- 编辑前必须先读取文件
- 保持文件编码和换行符`,
  },
  {
    name: "Bash",
    displayName: "终端命令 (Bash)",
    description: "执行 Shell 命令（支持超时控制）",
    category: "claude-sdk",
    icon: Terminal,
    details: `## Bash Tool

执行 Bash 命令，支持可选的超时设置。

### 功能
- 执行任何 Shell 命令
- 命令间保持工作目录状态
- 支持后台执行
- 可配置超时时间（最长 10 分钟）

### 参数
- \`command\` (必填): 要执行的命令
- \`timeout\`: 超时时间（毫秒，默认 120000）
- \`run_in_background\`: 在后台运行命令

### 注意
- Shell 状态（环境变量等）不会持久化
- 输出超过 30000 字符会被截断
- 用于 git, npm, docker 等 CLI 工具`,
  },
  {
    name: "Glob",
    displayName: "文件查找 (Glob)",
    description: "使用模式匹配快速查找文件",
    category: "claude-sdk",
    icon: FolderSearch,
    details: `## Glob Tool

使用 Glob 模式快速查找文件。

### 功能
- 使用 glob 模式匹配文件
- 适用于任何大小的代码库
- 返回按修改时间排序的文件列表

### 参数
- \`pattern\` (必填): Glob 模式 (例如 "**/*.ts")
- \`path\`: 搜索目录 (默认: 当前工作目录)

### 示例
- \`**/*.tsx\` - 所有 TypeScript React 文件
- \`src/**/*.ts\` - src 目录下的 TS 文件
- \`*.json\` - 当前目录下的 JSON 文件`,
  },
  {
    name: "Grep",
    displayName: "内容搜索 (Grep)",
    description: "使用正则表达式搜索文件内容",
    category: "claude-sdk",
    icon: Regex,
    details: `## Grep Tool

使用基于 ripgrep 的正则搜索文件内容。

### 功能
- 支持完整的正则语法
- 可按文件类型或 Glob 模式过滤
- 多种输出模式：内容、文件名、计数
- 支持显示匹配前后的上下文行

### 参数
- \`pattern\` (必填): 正则表达式
- \`path\`: 搜索目录 (默认: 当前工作目录)
- \`glob\`: 按 Glob 模式过滤文件
- \`type\`: 按文件类型过滤 (js, py 等)
- \`output_mode\`: "content" (默认), "files_with_matches", "count"

### 注意
- 使用 ripgrep 语法
- 支持多行匹配 (\`multiline: true\`)`,
  },
  {
    name: "WebFetch",
    displayName: "网页抓取 (WebFetch)",
    description: "抓取 URL 内容并进行智能分析",
    category: "claude-sdk",
    icon: Globe,
    details: `## WebFetch Tool

抓取 URL 内容并使用 AI 进行处理。

### 功能
- 抓取任何公开 URL
- 将 HTML 转换为 Markdown
- 根据自定义提示词处理内容
- 15分钟缓存机制

### 参数
- \`url\` (必填): 要抓取的 URL
- \`prompt\` (必填): 需要从内容中提取什么信息

### 限制
- 无法访问需要登录的 URL
- HTTP URL 会自动升级为 HTTPS
- 内容过大时可能会被摘要`,
  },
  {
    name: "WebSearch",
    displayName: "联网搜索 (WebSearch)",
    description: "搜索互联网以获取最新信息",
    category: "claude-sdk",
    icon: Search,
    details: `## WebSearch Tool

搜索互联网获取实时信息。

### 功能
- 实时网页搜索
- 域名过滤（包含/屏蔽）
- 获取知识截止日期后的最新信息

### 参数
- \`query\` (必填): 搜索关键词
- \`allowed_domains\`: 仅包含这些域名
- \`blocked_domains\`: 排除这些域名

### 注意
- 结果包含 Markdown 格式的链接
- 回答时必须包含来源引用`,
  },
  {
    name: "NotebookEdit",
    displayName: "笔记本编辑 (NotebookEdit)",
    description: "编辑 Jupyter Notebook 单元格",
    category: "claude-sdk",
    icon: Notebook,
    details: `## NotebookEdit Tool

编辑 Jupyter Notebook (.ipynb) 文件中的单元格。

### 功能
- 替换单元格内容
- 插入新单元格
- 删除单元格
- 支持代码和 Markdown 单元格

### 参数
- \`notebook_path\` (必填): 笔记本绝对路径
- \`new_source\` (必填): 新的单元格内容
- \`cell_id\`: 要编辑的单元格 ID
- \`cell_type\`: "code" 或 "markdown"
- \`edit_mode\`: "replace", "insert", 或 "delete"`,
  },
  {
    name: "Task",
    displayName: "子智能体 (Task)",
    description: "启动专门的子智能体处理复杂任务",
    category: "claude-sdk",
    icon: Bot,
    details: `## Task Tool

启动专门的子智能体来处理复杂任务。

### 智能体类型
- **Bash**: 命令行执行专家
- **Explore**: 快速代码库探索
- **Plan**: 架构与实现规划
- **general-purpose**: 通用多步骤任务

### 参数
- \`prompt\` (必填): 任务描述
- \`subagent_type\` (必填): 智能体类型
- \`description\` (必填): 简短描述 (3-5词)
- \`run_in_background\`: 后台运行
- \`resume\`: 恢复之前的智能体会话

### 注意
- 子智能体只能访问部分工具
- 支持并行运行多个智能体
- 后台智能体会将结果写入输出文件`,
  },
  {
    name: "AskUserQuestion",
    displayName: "询问用户 (AskUser)",
    description: "在执行过程中向用户提问",
    category: "claude-sdk",
    icon: HelpCircle,
    details: `## AskUserQuestion Tool

向用户提问以收集信息或澄清需求。

### 用途
- 收集用户偏好
- 澄清模糊的指令
- 确认实现方案的选择
- 提供后续方向的选项

### 参数
- \`questions\` (必填): 1-4 个问题的数组
  - \`question\` (必填): 问题文本
  - \`header\` (必填): 简短标签 (最多 12 字符)
  - \`options\` (必填): 2-4 个选项
  - \`multiSelect\`: 是否允许多选

### 注意
- 用户总是可以选择 "Other" 输入自定义内容
- 推荐选项请放在第一个并标记 "(Recommended)"`,
  },
]

// Custom tools added by this app
const CUSTOM_TOOLS: ToolDefinition[] = [
  {
    name: "TaskCreate",
    displayName: "创建任务 (TaskCreate)",
    description: "创建结构化的任务列表以追踪进度",
    category: "custom",
    icon: ListTodo,
    details: `## TaskCreate Tool

为复杂的编码会话创建结构化的任务列表。

### 用途
- 复杂的多步骤任务（3步以上）
- 规划模式的任务追踪
- 多个用户请求
- 非琐碎的操作

### 参数
- \`subject\` (必填): 简短任务标题（祈使句）
- \`description\` (必填): 详细任务描述
- \`activeForm\`: 进行时形式（用于加载动画）

### 注意
- 创建的任务状态默认为 "pending"
- 使用 TaskUpdate 设置依赖关系
- 单个简单任务无需创建`,
  },
  {
    name: "TaskUpdate",
    displayName: "更新任务 (TaskUpdate)",
    description: "更新任务状态、详情和依赖",
    category: "custom",
    icon: RefreshCw,
    details: `## TaskUpdate Tool

更新任务列表中的现有任务。

### 用途
- 标记任务为已完成
- 更新任务状态
- 设置任务依赖
- 删除废弃任务

### 参数
- \`taskId\` (必填): 任务 ID
- \`status\`: "pending", "in_progress", "completed", "deleted"
- \`subject\`: 新标题
- \`description\`: 新描述
- \`addBlocks\`: 此任务阻塞的任务 ID
- \`addBlockedBy\`: 阻塞此任务的任务 ID

### 状态流转
pending → in_progress → completed`,
  },
  {
    name: "TaskList",
    displayName: "任务列表 (TaskList)",
    description: "查看所有任务及其当前状态",
    category: "custom",
    icon: ClipboardList,
    details: `## TaskList Tool

列出当前会话中的所有任务。

### 输出包含
- 任务 ID
- 标题 (Subject)
- 状态 (Status)
- 负责人 (Owner)
- 依赖 (BlockedBy)

### 用途
- 检查可用任务
- 查看整体进度
- 查找无阻塞的任务
- 完成任务后检查后续工作`,
  },
  {
    name: "EnterPlanMode",
    displayName: "规划模式 (Plan Mode)",
    description: "进入规划模式设计实现方案",
    category: "custom",
    icon: MessageSquare,
    details: `## EnterPlanMode Tool

切换到规划模式进行实现方案设计。

### 何时使用
- 新功能实现
- 存在多种有效方案
- 需要架构决策
- 涉及多个文件变更
- 需求不明确

### 规划模式流程
1. 使用只读工具探索代码库
2. 理解现有模式
3. 设计实现方案
4. 提交计划供用户审批
5. 准备好后使用 ExitPlanMode 退出

### 跳过情况
- 单行修复
- 明显的 Bug
- 清晰具体的指令`,
  },
]

// --- Tool Detail Panel ---
function ToolDetail({ tool }: { tool: ToolDefinition }) {
  const Icon = tool.icon

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-foreground/5 flex items-center justify-center">
            <Icon className="h-5 w-5 text-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{tool.displayName}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{tool.description}</p>
          </div>
          <span
            className={cn(
              "text-[10px] font-medium px-2 py-0.5 rounded-full",
              tool.category === "claude-sdk"
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                : tool.category === "custom"
                  ? "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                  : "bg-green-500/10 text-green-600 dark:text-green-400"
            )}
          >
            {tool.category === "claude-sdk"
              ? "Claude SDK"
              : tool.category === "custom"
                ? "Custom"
                : tool.category.charAt(0).toUpperCase() + tool.category.slice(1)}
          </span>
        </div>

        {/* Details */}
        <div className="rounded-lg border border-border bg-background overflow-hidden px-4 py-3">
          <ChatMarkdownRenderer content={tool.details} size="sm" />
        </div>
      </div>
    </div>
  )
}

// --- Main Component ---
export function AgentsToolsTab() {
  const { t } = useTranslation("settings")
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sidebarWidthAtom = settingsToolsSidebarWidthAtom

  // Fetch dynamic tools from backend
  const { data: internalTools, isLoading, error } = trpc.internalTools.list.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false
  })


  // Focus search on "/" hotkey
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  const allTools = useMemo(() => {
    const tools: ToolDefinition[] = [...CLAUDE_SDK_TOOLS, ...CUSTOM_TOOLS]

    if (internalTools) {
      const mapTools = (list: any[], category: ToolCategory) =>
        list.map(t => ({
          name: t.name,
          displayName: t.name,
          description: t.description,
          category,
          icon: ICON_MAPPING[t.name] || CATEGORY_ICONS[category] || Bot,
          details: `## ${t.name}\n\n${t.description}\n\n### Input Schema\n\`\`\`json\n${JSON.stringify(t.inputSchema, null, 2)}\n\`\`\``
        }))

      if (internalTools.browser) tools.push(...mapTools(internalTools.browser, "browser"))
      if (internalTools.imageProcess) tools.push(...mapTools(internalTools.imageProcess, "image-process"))
      if (internalTools.imageGen) tools.push(...mapTools(internalTools.imageGen, "image-gen"))
      if (internalTools.artifact) tools.push(...mapTools(internalTools.artifact, "artifact"))
    }

    return tools
  }, [internalTools])

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return allTools
    const q = searchQuery.toLowerCase()
    return allTools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        tool.displayName.toLowerCase().includes(q)
    )
  }, [searchQuery, allTools])

  const sdkTools = filteredTools.filter((t) => t.category === "claude-sdk")
  const customTools = filteredTools.filter((t) => t.category === "custom")
  const browserTools = filteredTools.filter((t) => t.category === "browser")
  const imageProcessTools = filteredTools.filter((t) => t.category === "image-process")
  const imageGenTools = filteredTools.filter((t) => t.category === "image-gen")
  const artifactTools = filteredTools.filter((t) => t.category === "artifact")

  const selectedTool = allTools.find((t) => t.name === selectedToolName) || null

  // Auto-select first tool
  useEffect(() => {
    if (selectedToolName || allTools.length === 0) return
    setSelectedToolName(allTools[0]!.name)
  }, [selectedToolName, allTools])

  const renderToolGroup = (title: string, tools: ToolDefinition[]) => {
    if (tools.length === 0) return null
    return (
      <div>
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
          {title}
        </p>
        <div className="space-y-0.5">
          {tools.map((tool) => {
            const isSelected = selectedToolName === tool.name
            const Icon = tool.icon
            return (
              <button
                key={tool.name}
                onClick={() => setSelectedToolName(tool.name)}
                className={cn(
                  "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer flex items-center gap-2",
                  isSelected
                    ? "bg-foreground/5 text-foreground"
                    : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                )}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-50")} />
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm truncate", isSelected && "font-medium")}>
                    {tool.displayName}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar - tool list */}
      <ResizableSidebar
        isOpen={true}
        onClose={() => {}}
        widthAtom={sidebarWidthAtom}
        minWidth={200}
        maxWidth={400}
        side="left"
        animationDuration={0}
        initialWidth={240}
        exitWidth={240}
        disableClickToClose={true}
      >
        <div
          className="flex flex-col h-full bg-background border-r overflow-hidden"
          style={{ borderRightWidth: "0.5px" }}
        >
          {/* Search */}
          <div className="px-2 pt-2 flex-shrink-0">
            <input
              ref={searchInputRef}
              placeholder={t("tools.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 w-full rounded-lg text-sm bg-muted border border-input px-3 placeholder:text-muted-foreground/40 outline-none"
            />
          </div>

          {/* Tool list */}
          <div className="flex-1 overflow-y-auto px-2 pt-2 pb-2">

            {filteredTools.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">{t("tools.noToolsFound")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {renderToolGroup("Claude SDK", sdkTools)}
                {renderToolGroup("Custom", customTools)}
                {renderToolGroup("Browser", browserTools)}
                {renderToolGroup("Image Process", imageProcessTools)}
                {renderToolGroup("Image Gen", imageGenTools)}
                {renderToolGroup("Artifact", artifactTools)}
              </div>
            )}
          </div>
        </div>
      </ResizableSidebar>

      {/* Right content - detail panel */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {selectedTool ? (
          <ToolDetail tool={selectedTool} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <ToolsIcon className="h-12 w-12 text-border mb-4" />
            <p className="text-sm text-muted-foreground">{t("tools.selectTool")}</p>
          </div>
        )}
      </div>
    </div>
  )
}
