"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { X, Search } from "lucide-react"
import { ResizableSidebar } from "@/components/ui/resizable-sidebar"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import {
  expandedWidgetAtomFamily,
  expandedWidgetSidebarWidthAtom,
  WIDGET_REGISTRY,
  type WidgetId,
} from "./atoms"
import { diffSidebarOpenAtomFamily } from "../agents/atoms"
import { useChatInstance } from "../agents/context/chat-instance-context"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { InfoSection } from "./sections/info-section"
import { PlanSection } from "./sections/plan-section"
import { TerminalSection } from "./sections/terminal-section"
import { DiffSection } from "./sections/diff-section"

interface ExpandedWidgetSidebarProps {
  planPath: string | null
  planRefetchTrigger?: number
  diffStats?: { additions: number; deletions: number; fileCount: number } | null
}

// Widget ID to translation key mapping
const WIDGET_I18N_KEYS: Record<WidgetId, string> = {
  usage: "usage",
  info: "workspace",
  todo: "tasks",
  plan: "plan",
  terminal: "terminal",
  diff: "changes",
  artifacts: "artifacts",
  explorer: "explorer",
  "background-tasks": "backgroundTasks",
  mcp: "mcpServers",
  skills: "skills",
}

export function ExpandedWidgetSidebar({
  planPath,
  planRefetchTrigger,
  diffStats,
}: ExpandedWidgetSidebarProps) {
  const { t } = useTranslation("sidebar")

  // Self-sourced state from context/atoms/stores
  const { chatId, worktreePath } = useChatInstance()
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  const [isDiffSidebarOpen, setIsDiffSidebarOpen] = useAtom(diffSidebarOpenAtomFamily(chatId))

  // Search state for plan section
  const [isPlanSearchOpen, setIsPlanSearchOpen] = useState(false)

  // Per-workspace expanded widget state
  const expandedWidgetAtom = useMemo(
    () => expandedWidgetAtomFamily(chatId),
    [chatId],
  )
  const [expandedWidget, setExpandedWidget] = useAtom(expandedWidgetAtom)

  // Reset search state when widget changes
  useEffect(() => {
    setIsPlanSearchOpen(false)
  }, [expandedWidget])

  // Get widget config
  const widgetConfig = useMemo(
    () => WIDGET_REGISTRY.find((w) => w.id === expandedWidget),
    [expandedWidget],
  )

  // Close sidebar callback
  const closeSidebar = useCallback(() => {
    setExpandedWidget(null)
  }, [setExpandedWidget])

  // Keyboard shortcut: Escape to close expanded sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape" && expandedWidget) {
        e.preventDefault()
        e.stopPropagation()
        closeSidebar()
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [expandedWidget, closeSidebar])

  // Render the appropriate widget content based on expandedWidget
  const renderWidgetContent = () => {
    switch (expandedWidget) {
      case "info":
        return (
          <InfoSection
            chatId={chatId}
            worktreePath={worktreePath}
            isExpanded
          />
        )
      case "plan":
        return (
          <PlanSection
            chatId={activeSubChatId || chatId}
            planPath={planPath}
            refetchTrigger={planRefetchTrigger}
            isExpanded
            isSearchOpen={isPlanSearchOpen}
            onSearchClose={() => setIsPlanSearchOpen(false)}
          />
        )
      case "terminal":
        return worktreePath ? (
          <TerminalSection
            chatId={chatId}
            cwd={worktreePath}
            workspaceId={chatId}
            isExpanded
          />
        ) : null
      case "diff":
        return (
          <DiffSection
            chatId={chatId}
            isDiffSidebarOpen={isDiffSidebarOpen}
            setIsDiffSidebarOpen={setIsDiffSidebarOpen}
            diffStats={diffStats}
            isExpanded
          />
        )
      // Explorer is handled by ExplorerPanel component (supports three display modes)
      case "explorer":
        return null
      default:
        return null
    }
  }

  return (
    <ResizableSidebar
      isOpen={expandedWidget !== null}
      onClose={closeSidebar}
      widthAtom={expandedWidgetSidebarWidthAtom}
      side="right"
      minWidth={400}
      maxWidth={800}
      animationDuration={0}
      initialWidth={0}
      exitWidth={0}
      showResizeTooltip={true}
      className="bg-tl-background border-l"
      style={{ borderLeftWidth: "0.5px", overflow: "hidden" }}
    >
      <div className="flex flex-col h-full min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pl-3 pr-1.5 h-10 bg-tl-background shrink-0 border-b border-border/50">
          <div className="flex items-center gap-2">
            {widgetConfig && expandedWidget && (
              <>
                <widgetConfig.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{t(`details.widgets.${WIDGET_I18N_KEYS[expandedWidget]}`)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Search button for plan widget */}
            {expandedWidget === "plan" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsPlanSearchOpen(true)}
                    className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] text-muted-foreground hover:text-foreground shrink-0 rounded-md"
                    aria-label="Search"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {t("details.search")}
                  <Kbd>⌘F</Kbd>
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closeSidebar}
                  className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] text-muted-foreground hover:text-foreground shrink-0 rounded-md"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {t("details.close")}
                <Kbd>Esc</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {renderWidgetContent()}
        </div>
      </div>
    </ResizableSidebar>
  )
}
