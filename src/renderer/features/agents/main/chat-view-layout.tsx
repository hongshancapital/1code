/**
 * ChatViewLayout - 聊天视图的布局组件
 *
 * 负责管理 sidebar 和 panel 的布局逻辑，从 active-chat.tsx 拆分出来。
 * 使用 PanelRegistry 和新的 Context 系统。
 *
 * 布局结构:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ Header                                                       │
 * ├──────────┬──────────────────────────────────┬───────────────┤
 * │ Explorer │ Main Chat Area                   │ Right Sidebar │
 * │ (left)   │ (center)                         │ (right)       │
 * ├──────────┴──────────────────────────────────┴───────────────┤
 * │ Terminal/Bottom Panel (optional)                             │
 * └─────────────────────────────────────────────────────────────┘
 */

import { memo, useMemo, useCallback, type ReactNode } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { cn } from "../../../lib/utils"
import { ResizableSidebar } from "../../../components/ui/resizable-sidebar"
import { ResizableBottomPanel } from "../../../components/ui/resizable-bottom-panel"
import {
  PanelGate,
  usePanelContext,
  PANEL_IDS,
} from "../ui/panel-system"
import {
  agentsDiffSidebarWidthAtom,
  agentsPlanSidebarWidthAtom,
  agentsBrowserSidebarWidthAtom,
  agentsPreviewSidebarWidthAtom,
  fileViewerSidebarWidthAtom,
  diffSidebarOpenAtomFamily,
  planSidebarOpenAtomFamily,
  terminalDisplayModeAtom,
  terminalBottomHeightAtom,
} from "../atoms"
import { terminalSidebarOpenAtomFamily } from "../../terminal/atoms"
import { browserVisibleAtomFamily } from "../../browser-sidebar"
import { detailsSidebarOpenAtom } from "../../details-sidebar/atoms"

// ============================================================================
// Types
// ============================================================================

export interface ChatViewLayoutProps {
  /** Chat ID for per-chat state atoms */
  chatId: string

  /** Sub-chat ID for per-subchat state atoms */
  subChatId?: string | null

  /** Whether the layout is in fullscreen mode */
  isFullscreen?: boolean

  /** Whether the chat is full width */
  isChatFullWidth?: boolean

  /** Header content */
  header?: ReactNode

  /** Main chat area content */
  children: ReactNode

  /** Left sidebar content (Explorer) */
  leftSidebar?: ReactNode

  /** Diff sidebar content */
  diffSidebar?: ReactNode

  /** Plan sidebar content */
  planSidebar?: ReactNode

  /** Preview sidebar content */
  previewSidebar?: ReactNode

  /** Browser sidebar content */
  browserSidebar?: ReactNode

  /** File viewer sidebar content */
  fileViewerSidebar?: ReactNode

  /** Details sidebar content */
  detailsSidebar?: ReactNode

  /** Terminal content */
  terminalContent?: ReactNode

  /** Whether terminal is open */
  isTerminalOpen?: boolean

  /** Callback when terminal open state changes */
  onTerminalOpenChange?: (open: boolean) => void

  /** Custom class name */
  className?: string
}

// ============================================================================
// Layout Component
// ============================================================================

export const ChatViewLayout = memo(function ChatViewLayout({
  chatId,
  subChatId,
  isFullscreen = false,
  isChatFullWidth = false,
  header,
  children,
  leftSidebar,
  diffSidebar,
  planSidebar,
  previewSidebar,
  browserSidebar,
  fileViewerSidebar,
  detailsSidebar,
  terminalContent,
  isTerminalOpen,
  onTerminalOpenChange,
  className,
}: ChatViewLayoutProps) {
  // Panel context for availability checks
  const panelContext = usePanelContext()

  // Sidebar width atoms
  const [diffSidebarWidth, setDiffSidebarWidth] = useAtom(agentsDiffSidebarWidthAtom)
  const [planSidebarWidth, setPlanSidebarWidth] = useAtom(agentsPlanSidebarWidthAtom)
  const [browserSidebarWidth, setBrowserSidebarWidth] = useAtom(agentsBrowserSidebarWidthAtom)
  const [previewSidebarWidth, setPreviewSidebarWidth] = useAtom(agentsPreviewSidebarWidthAtom)
  const [fileViewerWidth, setFileViewerWidth] = useAtom(fileViewerSidebarWidthAtom)

  // Per-chat sidebar state
  const diffSidebarOpenAtom = useMemo(
    () => diffSidebarOpenAtomFamily(chatId),
    [chatId]
  )
  const [isDiffSidebarOpen, setIsDiffSidebarOpen] = useAtom(diffSidebarOpenAtom)

  const planSidebarOpenAtom = useMemo(
    () => planSidebarOpenAtomFamily(subChatId || ""),
    [subChatId]
  )
  const [isPlanSidebarOpen, setIsPlanSidebarOpen] = useAtom(planSidebarOpenAtom)

  const browserVisibleAtom = useMemo(
    () => browserVisibleAtomFamily(chatId),
    [chatId]
  )
  const [isBrowserSidebarOpen, setIsBrowserSidebarOpen] = useAtom(browserVisibleAtom)

  const terminalSidebarAtom = useMemo(
    () => terminalSidebarOpenAtomFamily(chatId),
    [chatId]
  )
  const [isTerminalSidebarOpen, setIsTerminalSidebarOpen] = useAtom(terminalSidebarAtom)

  const terminalDisplayMode = useAtomValue(terminalDisplayModeAtom)
  const [terminalBottomHeight, setTerminalBottomHeight] = useAtom(terminalBottomHeightAtom)

  const [isDetailsSidebarOpen, setIsDetailsSidebarOpen] = useAtom(detailsSidebarOpenAtom)

  // Determine which right sidebar is active (priority-based)
  const hasRightSidebar = useMemo(() => {
    // Browser takes highest priority (exclusive)
    if (isBrowserSidebarOpen && browserSidebar) return true
    // Then diff
    if (isDiffSidebarOpen && diffSidebar) return true
    // Then plan
    if (isPlanSidebarOpen && planSidebar) return true
    // Then preview
    // Then file viewer
    // Then details
    if (isDetailsSidebarOpen && detailsSidebar) return true
    return false
  }, [
    isBrowserSidebarOpen,
    browserSidebar,
    isDiffSidebarOpen,
    diffSidebar,
    isPlanSidebarOpen,
    planSidebar,
    isDetailsSidebarOpen,
    detailsSidebar,
  ])

  // Render right sidebars
  const renderRightSidebars = useCallback(() => {
    const sidebars: ReactNode[] = []

    // Browser sidebar (exclusive - renders alone when open)
    if (isBrowserSidebarOpen && browserSidebar) {
      sidebars.push(
        <PanelGate key="browser" panelId={PANEL_IDS.BROWSER}>
          <ResizableSidebar
            side="right"
            width={browserSidebarWidth}
            onWidthChange={setBrowserSidebarWidth}
            minWidth={400}
            maxWidth={1000}
          >
            {browserSidebar}
          </ResizableSidebar>
        </PanelGate>
      )
      return sidebars
    }

    // Diff sidebar
    if (isDiffSidebarOpen && diffSidebar) {
      sidebars.push(
        <PanelGate key="diff" panelId={PANEL_IDS.DIFF}>
          <ResizableSidebar
            side="right"
            width={diffSidebarWidth}
            onWidthChange={setDiffSidebarWidth}
            minWidth={300}
            maxWidth={800}
          >
            {diffSidebar}
          </ResizableSidebar>
        </PanelGate>
      )
    }

    // Plan sidebar
    if (isPlanSidebarOpen && planSidebar) {
      sidebars.push(
        <PanelGate key="plan" panelId={PANEL_IDS.PLAN}>
          <ResizableSidebar
            side="right"
            width={planSidebarWidth}
            onWidthChange={setPlanSidebarWidth}
            minWidth={300}
            maxWidth={600}
          >
            {planSidebar}
          </ResizableSidebar>
        </PanelGate>
      )
    }

    // Details sidebar (unified)
    if (isDetailsSidebarOpen && detailsSidebar) {
      sidebars.push(
        <PanelGate key="details" panelId={PANEL_IDS.DETAILS}>
          {detailsSidebar}
        </PanelGate>
      )
    }

    return sidebars
  }, [
    isBrowserSidebarOpen,
    browserSidebar,
    browserSidebarWidth,
    setBrowserSidebarWidth,
    isDiffSidebarOpen,
    diffSidebar,
    diffSidebarWidth,
    setDiffSidebarWidth,
    isPlanSidebarOpen,
    planSidebar,
    planSidebarWidth,
    setPlanSidebarWidth,
    isDetailsSidebarOpen,
    detailsSidebar,
  ])

  // Render terminal/bottom panel
  const renderBottomPanel = useCallback(() => {
    if (!terminalContent || !isTerminalOpen) return null

    if (terminalDisplayMode === "bottom") {
      return (
        <PanelGate panelId={PANEL_IDS.TERMINAL}>
          <ResizableBottomPanel
            height={terminalBottomHeight}
            onHeightChange={setTerminalBottomHeight}
            minHeight={150}
            maxHeight={500}
            onClose={() => onTerminalOpenChange?.(false)}
          >
            {terminalContent}
          </ResizableBottomPanel>
        </PanelGate>
      )
    }

    return null
  }, [
    terminalContent,
    isTerminalOpen,
    terminalDisplayMode,
    terminalBottomHeight,
    setTerminalBottomHeight,
    onTerminalOpenChange,
  ])

  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden",
        isFullscreen && "fixed inset-0 z-50",
        className
      )}
    >
      {/* Header */}
      {header && (
        <div className="flex-shrink-0">
          {header}
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar (Explorer) */}
        {leftSidebar && (
          <PanelGate panelId={PANEL_IDS.EXPLORER}>
            {leftSidebar}
          </PanelGate>
        )}

        {/* Center: Chat area */}
        <div
          className={cn(
            "flex-1 flex flex-col overflow-hidden",
            isChatFullWidth && "max-w-none"
          )}
        >
          {/* Main chat content */}
          <div className="flex-1 overflow-hidden">
            {children}
          </div>

          {/* Bottom panel (Terminal in bottom mode) */}
          {renderBottomPanel()}
        </div>

        {/* Right sidebars */}
        {renderRightSidebars()}
      </div>
    </div>
  )
})

// ============================================================================
// Sub-components
// ============================================================================

/**
 * Sidebar container with consistent styling
 */
export const SidebarContainer = memo(function SidebarContainer({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col overflow-hidden border-l border-border bg-background",
        className
      )}
    >
      {children}
    </div>
  )
})

/**
 * Sidebar header with title and close button
 */
export const SidebarHeader = memo(function SidebarHeader({
  title,
  onClose,
  children,
  className,
}: {
  title: string
  onClose?: () => void
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex h-10 items-center justify-between border-b border-border px-3",
        className
      )}
    >
      <span className="text-sm font-medium">{title}</span>
      <div className="flex items-center gap-1">
        {children}
        {onClose && (
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-muted"
            aria-label="Close sidebar"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
})
