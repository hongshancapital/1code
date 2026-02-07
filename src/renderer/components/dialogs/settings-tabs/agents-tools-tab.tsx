import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { settingsToolsSidebarWidthAtom } from "../../../features/agents/atoms"
import { cn } from "../../../lib/utils"
import { ToolsIcon } from "../../ui/icons"
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
  type LucideIcon,
} from "lucide-react"

// Tool category type
type ToolCategory = "claude-sdk" | "custom" | "local-mcp"

// Tool definition
interface ToolDefinition {
  name: string
  displayName: string
  descriptionKey: string
  category: ToolCategory
  icon: LucideIcon
  detailsKey: string
}

// Claude Agent SDK built-in tools
const CLAUDE_SDK_TOOLS: ToolDefinition[] = [
  {
    name: "Read",
    displayName: "Read",
    descriptionKey: "tools.read.description",
    category: "claude-sdk",
    icon: FileText,
    detailsKey: "tools.read.details",
  },
  {
    name: "Write",
    displayName: "Write",
    descriptionKey: "tools.write.description",
    category: "claude-sdk",
    icon: FileEdit,
    detailsKey: "tools.write.details",
  },
  {
    name: "Edit",
    displayName: "Edit",
    descriptionKey: "tools.edit.description",
    category: "claude-sdk",
    icon: FileEdit,
    detailsKey: "tools.edit.details",
  },
  {
    name: "Bash",
    displayName: "Bash",
    descriptionKey: "tools.bash.description",
    category: "claude-sdk",
    icon: Terminal,
    detailsKey: "tools.bash.details",
  },
  {
    name: "Glob",
    displayName: "Glob",
    descriptionKey: "tools.glob.description",
    category: "claude-sdk",
    icon: FolderSearch,
    detailsKey: "tools.glob.details",
  },
  {
    name: "Grep",
    displayName: "Grep",
    descriptionKey: "tools.grep.description",
    category: "claude-sdk",
    icon: Regex,
    detailsKey: "tools.grep.details",
  },
  {
    name: "WebFetch",
    displayName: "Web Fetch",
    descriptionKey: "tools.webFetch.description",
    category: "claude-sdk",
    icon: Globe,
    detailsKey: "tools.webFetch.details",
  },
  {
    name: "WebSearch",
    displayName: "Web Search",
    descriptionKey: "tools.webSearch.description",
    category: "claude-sdk",
    icon: Search,
    detailsKey: "tools.webSearch.details",
  },
  {
    name: "NotebookEdit",
    displayName: "Notebook Edit",
    descriptionKey: "tools.notebookEdit.description",
    category: "claude-sdk",
    icon: Notebook,
    detailsKey: "tools.notebookEdit.details",
  },
  {
    name: "Task",
    displayName: "Task (Subagent)",
    descriptionKey: "tools.task.description",
    category: "claude-sdk",
    icon: Bot,
    detailsKey: "tools.task.details",
  },
  {
    name: "AskUserQuestion",
    displayName: "Ask User",
    descriptionKey: "tools.askUser.description",
    category: "claude-sdk",
    icon: HelpCircle,
    detailsKey: "tools.askUser.details",
  },
]

// Custom tools added by this app
const CUSTOM_TOOLS: ToolDefinition[] = [
  {
    name: "TaskCreate",
    displayName: "Task Create",
    descriptionKey: "tools.taskCreate.description",
    category: "custom",
    icon: ListTodo,
    detailsKey: "tools.taskCreate.details",
  },
  {
    name: "TaskUpdate",
    displayName: "Task Update",
    descriptionKey: "tools.taskUpdate.description",
    category: "custom",
    icon: RefreshCw,
    detailsKey: "tools.taskUpdate.details",
  },
  {
    name: "TaskList",
    displayName: "Task List",
    descriptionKey: "tools.taskList.description",
    category: "custom",
    icon: ClipboardList,
    detailsKey: "tools.taskList.details",
  },
  {
    name: "EnterPlanMode",
    displayName: "Plan Mode",
    descriptionKey: "tools.planMode.description",
    category: "custom",
    icon: MessageSquare,
    detailsKey: "tools.planMode.details",
  },
]

// Local MCP - Browser tools
const BROWSER_MCP_TOOLS: ToolDefinition[] = [
  {
    name: "browser_snapshot",
    displayName: "Browser Snapshot",
    descriptionKey: "tools.browserSnapshot.description",
    category: "local-mcp",
    icon: Camera,
    detailsKey: "tools.browserSnapshot.details",
  },
  {
    name: "browser_navigate",
    displayName: "Browser Navigate",
    descriptionKey: "tools.browserNavigate.description",
    category: "local-mcp",
    icon: Globe,
    detailsKey: "tools.browserNavigate.details",
  },
  {
    name: "browser_click",
    displayName: "Browser Click",
    descriptionKey: "tools.browserClick.description",
    category: "local-mcp",
    icon: MousePointer,
    detailsKey: "tools.browserClick.details",
  },
  {
    name: "browser_fill",
    displayName: "Browser Fill",
    descriptionKey: "tools.browserFill.description",
    category: "local-mcp",
    icon: FormInput,
    detailsKey: "tools.browserFill.details",
  },
  {
    name: "browser_type",
    displayName: "Browser Type",
    descriptionKey: "tools.browserType.description",
    category: "local-mcp",
    icon: Keyboard,
    detailsKey: "tools.browserType.details",
  },
  {
    name: "browser_screenshot",
    displayName: "Browser Screenshot",
    descriptionKey: "tools.browserScreenshot.description",
    category: "local-mcp",
    icon: Image,
    detailsKey: "tools.browserScreenshot.details",
  },
  {
    name: "browser_back",
    displayName: "Browser Back",
    descriptionKey: "tools.browserBack.description",
    category: "local-mcp",
    icon: ArrowLeft,
    detailsKey: "tools.browserBack.details",
  },
  {
    name: "browser_forward",
    displayName: "Browser Forward",
    descriptionKey: "tools.browserForward.description",
    category: "local-mcp",
    icon: ArrowRight,
    detailsKey: "tools.browserForward.details",
  },
  {
    name: "browser_reload",
    displayName: "Browser Reload",
    descriptionKey: "tools.browserReload.description",
    category: "local-mcp",
    icon: RefreshCw,
    detailsKey: "tools.browserReload.details",
  },
  {
    name: "browser_get_text",
    displayName: "Browser Get Text",
    descriptionKey: "tools.browserGetText.description",
    category: "local-mcp",
    icon: Type,
    detailsKey: "tools.browserGetText.details",
  },
  {
    name: "browser_get_url",
    displayName: "Browser Get URL",
    descriptionKey: "tools.browserGetUrl.description",
    category: "local-mcp",
    icon: Link,
    detailsKey: "tools.browserGetUrl.details",
  },
  {
    name: "browser_get_title",
    displayName: "Browser Get Title",
    descriptionKey: "tools.browserGetTitle.description",
    category: "local-mcp",
    icon: Heading,
    detailsKey: "tools.browserGetTitle.details",
  },
  {
    name: "browser_wait",
    displayName: "Browser Wait",
    descriptionKey: "tools.browserWait.description",
    category: "local-mcp",
    icon: Clock,
    detailsKey: "tools.browserWait.details",
  },
  {
    name: "browser_scroll",
    displayName: "Browser Scroll",
    descriptionKey: "tools.browserScroll.description",
    category: "local-mcp",
    icon: ArrowUpDown,
    detailsKey: "tools.browserScroll.details",
  },
  {
    name: "browser_press",
    displayName: "Browser Press",
    descriptionKey: "tools.browserPress.description",
    category: "local-mcp",
    icon: Keyboard,
    detailsKey: "tools.browserPress.details",
  },
  {
    name: "browser_select",
    displayName: "Browser Select",
    descriptionKey: "tools.browserSelect.description",
    category: "local-mcp",
    icon: CheckSquare,
    detailsKey: "tools.browserSelect.details",
  },
  {
    name: "browser_check",
    displayName: "Browser Check",
    descriptionKey: "tools.browserCheck.description",
    category: "local-mcp",
    icon: CheckCircle,
    detailsKey: "tools.browserCheck.details",
  },
  {
    name: "browser_hover",
    displayName: "Browser Hover",
    descriptionKey: "tools.browserHover.description",
    category: "local-mcp",
    icon: MousePointer2,
    detailsKey: "tools.browserHover.details",
  },
  {
    name: "browser_drag",
    displayName: "Browser Drag",
    descriptionKey: "tools.browserDrag.description",
    category: "local-mcp",
    icon: Move,
    detailsKey: "tools.browserDrag.details",
  },
  {
    name: "browser_download_image",
    displayName: "Browser Download Image",
    descriptionKey: "tools.browserDownloadImage.description",
    category: "local-mcp",
    icon: ImageDown,
    detailsKey: "tools.browserDownloadImage.details",
  },
  {
    name: "browser_download_file",
    displayName: "Browser Download File",
    descriptionKey: "tools.browserDownloadFile.description",
    category: "local-mcp",
    icon: Download,
    detailsKey: "tools.browserDownloadFile.details",
  },
  {
    name: "browser_emulate",
    displayName: "Browser Emulate",
    descriptionKey: "tools.browserEmulate.description",
    category: "local-mcp",
    icon: Smartphone,
    detailsKey: "tools.browserEmulate.details",
  },
  {
    name: "browser_evaluate",
    displayName: "Browser Evaluate",
    descriptionKey: "tools.browserEvaluate.description",
    category: "local-mcp",
    icon: Code,
    detailsKey: "tools.browserEvaluate.details",
  },
]

// Local MCP - Artifact tools
const ARTIFACT_MCP_TOOLS: ToolDefinition[] = [
  {
    name: "mark_artifact",
    displayName: "Mark Artifact",
    descriptionKey: "tools.markArtifact.description",
    category: "local-mcp",
    icon: FileOutput,
    detailsKey: "tools.markArtifact.details",
  },
  {
    name: "list_artifacts",
    displayName: "List Artifacts",
    descriptionKey: "tools.listArtifacts.description",
    category: "local-mcp",
    icon: Files,
    detailsKey: "tools.listArtifacts.details",
  },
]

// All tools combined
const ALL_TOOLS = [...CLAUDE_SDK_TOOLS, ...CUSTOM_TOOLS, ...BROWSER_MCP_TOOLS, ...ARTIFACT_MCP_TOOLS]

// --- Tool Detail Panel ---
function ToolDetail({ tool }: { tool: ToolDefinition }) {
  const { t } = useTranslation("settings")
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
            <p className="text-xs text-muted-foreground mt-0.5">{t(tool.descriptionKey)}</p>
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
                ? t("tools.category.custom")
                : BROWSER_MCP_TOOLS.some((b) => b.name === tool.name)
                  ? t("tools.category.browserMcp")
                  : t("tools.category.artifactMcp")}
          </span>
        </div>

        {/* Details */}
        <div className="rounded-lg border border-border bg-background overflow-hidden px-4 py-3">
          <ChatMarkdownRenderer content={t(tool.detailsKey)} size="sm" />
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

  const filteredTools = useMemo(() => {
    if (!searchQuery.trim()) return ALL_TOOLS
    const q = searchQuery.toLowerCase()
    return ALL_TOOLS.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) ||
        tool.displayName.toLowerCase().includes(q)
    )
  }, [searchQuery])

  const sdkTools = filteredTools.filter((t) => t.category === "claude-sdk")
  const customTools = filteredTools.filter((t) => t.category === "custom")
  const browserMcpTools = filteredTools.filter((t) => BROWSER_MCP_TOOLS.some((b) => b.name === t.name))
  const artifactMcpTools = filteredTools.filter((t) => ARTIFACT_MCP_TOOLS.some((a) => a.name === t.name))

  const selectedTool = ALL_TOOLS.find((t) => t.name === selectedToolName) || null

  // Auto-select first tool
  useEffect(() => {
    if (selectedToolName || ALL_TOOLS.length === 0) return
    setSelectedToolName(ALL_TOOLS[0]!.name)
  }, [selectedToolName])

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
                {/* Claude SDK Tools */}
                {sdkTools.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      Claude SDK
                    </p>
                    <div className="space-y-0.5">
                      {sdkTools.map((tool) => {
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
                )}

                {/* Custom Tools */}
                {customTools.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t("tools.category.custom")}
                    </p>
                    <div className="space-y-0.5">
                      {customTools.map((tool) => {
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
                )}

                {/* Browser MCP Tools */}
                {browserMcpTools.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t("tools.category.browserMcp")}
                    </p>
                    <div className="space-y-0.5">
                      {browserMcpTools.map((tool) => {
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
                )}

                {/* Artifact MCP Tools */}
                {artifactMcpTools.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t("tools.category.artifactMcp")}
                    </p>
                    <div className="space-y-0.5">
                      {artifactMcpTools.map((tool) => {
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
                )}
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
