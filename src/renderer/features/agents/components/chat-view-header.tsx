/**
 * ChatViewHeader - Renders the header section of ChatView
 *
 * Self-contained component that sources most state from atoms/context.
 * Handles:
 * - Mobile vs Desktop header layouts
 * - SubChat selector and controls
 * - Various action buttons (Fork, Preview, Terminal, Details, Restore)
 */

import { memo, type ReactNode } from "react"
import { useAtom, useAtomValue } from "jotai"
import { GitFork, SquareTerminal } from "lucide-react"
import { cn } from "../../../lib/utils"
import { useChatInstance } from "../context/chat-instance-context"
import { useChatCapabilities } from "../context/chat-capabilities-context"
import { Button } from "../../../components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { IconSpinner, IconTextUndo, IconOpenSidebarRight } from "../../../icons/icons"
import { Kbd } from "../../../components/ui/kbd"
import { MobileChatHeader } from "../ui/mobile-chat-header"
import { AgentsHeaderControls } from "../ui/agents-header-controls"
import { SubChatSelector } from "../ui/sub-chat-selector"
import { PreviewSetupHoverCard } from "./preview-setup-hover-card"
import { CHAT_LAYOUT } from "../main/constants"
import type { DiffStats } from "../hooks/use-diff-data"
import { isFullscreenAtom, chatSourceModeAtom } from "../../../lib/atoms"
import { agentsPreviewSidebarOpenAtom, agentsSubChatsSidebarModeAtom, diffSidebarOpenAtomFamily } from "../atoms"
import { terminalSidebarOpenAtomFamily } from "../../terminal/atoms"
import { detailsSidebarOpenAtom, unifiedSidebarEnabledAtom } from "../../details-sidebar/atoms"
import { useResolvedHotkeyDisplay } from "../../../lib/hotkeys"

export interface ChatViewHeaderProps {
  // Sidebar state (parent-owned)
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  hasAnyUnseenChanges: boolean
  shouldHideChatHeader: boolean

  // Sub-chat actions
  handleCreateNewSubChat: () => void
  onBackToChats?: () => void

  // Preview callback (parent-owned)
  onOpenPreview?: () => void

  // Diff stats (computed by parent)
  diffStats: DiffStats

  // Archive
  handleRestoreWorkspace: () => void
  isRestorePending: boolean

  // Open locally (sandbox mode)
  showOpenLocally: boolean
  handleOpenLocally: () => void
  isImporting: boolean

  // Custom slot for right header content
  rightHeaderSlot?: ReactNode
}

/**
 * ChatViewHeader - Header component for ChatView
 */
export const ChatViewHeader = memo(function ChatViewHeader({
  // Sidebar state
  isSidebarOpen,
  onToggleSidebar,
  hasAnyUnseenChanges,
  shouldHideChatHeader,

  // Sub-chat actions
  handleCreateNewSubChat,
  onBackToChats,

  // Preview callback
  onOpenPreview,

  // Diff stats
  diffStats,

  // Archive
  handleRestoreWorkspace,
  isRestorePending,

  // Open locally (sandbox mode)
  showOpenLocally,
  handleOpenLocally,
  isImporting,

  // Custom slot
  rightHeaderSlot,
}: ChatViewHeaderProps) {
  // Self-sourced state from context/atoms
  const { chatId, worktreePath, sandboxId, isArchived } = useChatInstance()
  const { hideGitFeatures, canOpenPreview, canShowDiffButton, canOpenDiff } = useChatCapabilities()

  const isMobileFullscreen = useAtomValue(isFullscreenAtom) ?? false
  const chatSourceMode = useAtomValue(chatSourceModeAtom)
  const subChatsSidebarMode = useAtomValue(agentsSubChatsSidebarModeAtom)
  const isUnifiedSidebarEnabled = useAtomValue(unifiedSidebarEnabledAtom)

  const [isPreviewSidebarOpen, setIsPreviewSidebarOpen] = useAtom(agentsPreviewSidebarOpenAtom)
  const [isDiffSidebarOpen, setIsDiffSidebarOpen] = useAtom(diffSidebarOpenAtomFamily(chatId))
  const [isTerminalSidebarOpen, setIsTerminalSidebarOpen] = useAtom(terminalSidebarOpenAtomFamily(chatId))
  const [isDetailsSidebarOpen, setIsDetailsSidebarOpen] = useAtom(detailsSidebarOpenAtom)

  const toggleTerminalHotkey = useResolvedHotkeyDisplay("toggle-terminal")
  const toggleDetailsHotkey = useResolvedHotkeyDisplay("toggle-details")

  if (shouldHideChatHeader) {
    return null
  }

  return (
    <div
      className={cn(
        "relative z-20 pointer-events-none",
        // Mobile: always flex; Desktop: absolute when sidebar open, flex when closed
        !isMobileFullscreen && subChatsSidebarMode === "sidebar"
          ? `absolute top-0 left-0 right-0 ${CHAT_LAYOUT.headerPaddingSidebarOpen}`
          : `shrink-0 ${CHAT_LAYOUT.headerPaddingSidebarClosed}`
      )}
    >
      {/* Gradient background - only when not absolute */}
      {(isMobileFullscreen || subChatsSidebarMode !== "sidebar") && (
        <div className="absolute inset-0 bg-linear-to-b from-background via-background to-transparent" />
      )}
      <div className="pointer-events-auto flex items-center justify-between relative">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {/* Mobile header - simplified with chat name as trigger */}
          {isMobileFullscreen ? (
            <MobileChatHeader
              onCreateNew={handleCreateNewSubChat}
              onBackToChats={onBackToChats}
              onOpenPreview={hideGitFeatures ? undefined : onOpenPreview}
              canOpenPreview={hideGitFeatures ? false : canOpenPreview}
              onOpenDiff={
                hideGitFeatures
                  ? undefined
                  : canOpenDiff
                    ? () => setIsDiffSidebarOpen(true)
                    : undefined
              }
              canOpenDiff={hideGitFeatures ? false : canShowDiffButton}
              diffStats={hideGitFeatures ? undefined : diffStats}
              onOpenTerminal={
                hideGitFeatures
                  ? undefined
                  : () => setIsTerminalSidebarOpen(true)
              }
              canOpenTerminal={hideGitFeatures ? false : !!worktreePath}
              isTerminalOpen={isTerminalSidebarOpen}
              isArchived={isArchived}
              onRestore={handleRestoreWorkspace}
              onOpenLocally={handleOpenLocally}
              showOpenLocally={showOpenLocally}
            />
          ) : (
            <>
              {/* Header controls - desktop only */}
              <AgentsHeaderControls
                isSidebarOpen={isSidebarOpen}
                onToggleSidebar={onToggleSidebar}
                hasUnseenChanges={hasAnyUnseenChanges}
                isSubChatsSidebarOpen={subChatsSidebarMode === "sidebar"}
              />
              <SubChatSelector
                onCreateNew={handleCreateNewSubChat}
                isMobile={false}
                onBackToChats={onBackToChats}
                onOpenPreview={hideGitFeatures ? undefined : onOpenPreview}
                canOpenPreview={hideGitFeatures ? false : canOpenPreview}
                onOpenDiff={
                  hideGitFeatures
                    ? undefined
                    : canOpenDiff
                      ? () => setIsDiffSidebarOpen(true)
                      : undefined
                }
                canOpenDiff={hideGitFeatures ? false : canShowDiffButton}
                isDiffSidebarOpen={hideGitFeatures ? false : isDiffSidebarOpen}
                diffStats={hideGitFeatures ? undefined : diffStats}
                onOpenTerminal={
                  hideGitFeatures
                    ? undefined
                    : () => setIsTerminalSidebarOpen(true)
                }
                canOpenTerminal={hideGitFeatures ? false : !!worktreePath}
                isTerminalOpen={isTerminalSidebarOpen}
                chatId={chatId}
              />
              {/* Open Locally button - desktop only, sandbox mode */}
              {showOpenLocally && (
                <Tooltip delayDuration={500}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleOpenLocally}
                      disabled={isImporting}
                      className="h-6 px-2 gap-1.5 text-xs font-medium ml-2"
                    >
                      {isImporting ? (
                        <IconSpinner className="h-3 w-3 animate-spin" />
                      ) : (
                        <GitFork className="h-3 w-3" />
                      )}
                      Fork Locally
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Continue this session on your local machine
                  </TooltipContent>
                </Tooltip>
              )}
            </>
          )}
        </div>
        {/* Open Preview Button - shows when preview is closed (desktop only, local mode only) */}
        {!hideGitFeatures &&
          !isMobileFullscreen &&
          !isPreviewSidebarOpen &&
          sandboxId &&
          chatSourceMode === "local" &&
          (canOpenPreview ? (
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsPreviewSidebarOpen(true)}
                  className="h-6 w-6 p-0 hover:bg-foreground/10 transition-colors text-foreground shrink-0 rounded-md ml-2"
                  aria-label="Open preview"
                >
                  <IconOpenSidebarRight className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open preview</TooltipContent>
            </Tooltip>
          ) : (
            <PreviewSetupHoverCard>
              <span className="inline-flex ml-2">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled
                  className="h-6 w-6 p-0 text-muted-foreground shrink-0 rounded-md cursor-not-allowed pointer-events-none"
                  aria-label="Preview not available"
                >
                  <IconOpenSidebarRight className="h-4 w-4" />
                </Button>
              </span>
            </PreviewSetupHoverCard>
          ))}
        {/* Overview/Terminal Button - shows when sidebar is closed and worktree/sandbox exists (desktop only) */}
        {!isMobileFullscreen &&
          (worktreePath || sandboxId) &&
          (isUnifiedSidebarEnabled ? (
            // Details button for unified sidebar
            !isDetailsSidebarOpen && (
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsDetailsSidebarOpen(true)}
                    className="h-6 w-6 p-0 hover:bg-foreground/10 transition-colors text-foreground shrink-0 rounded-md ml-2"
                    aria-label="View details"
                  >
                    <IconOpenSidebarRight className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  View details
                  {toggleDetailsHotkey && <Kbd>{toggleDetailsHotkey}</Kbd>}
                </TooltipContent>
              </Tooltip>
            )
          ) : (
            // Terminal button for legacy sidebars (hidden in cowork mode)
            !hideGitFeatures &&
            !isTerminalSidebarOpen && (
              <Tooltip delayDuration={500}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsTerminalSidebarOpen(true)}
                    className="h-6 w-6 p-0 hover:bg-foreground/10 transition-colors text-foreground shrink-0 rounded-md ml-2"
                    aria-label="Open terminal"
                  >
                    <SquareTerminal className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Open terminal
                  {toggleTerminalHotkey && <Kbd>{toggleTerminalHotkey}</Kbd>}
                </TooltipContent>
              </Tooltip>
            )
          ))}
        {/* Restore Button - shows when viewing archived workspace (desktop only) */}
        {!isMobileFullscreen && isArchived && (
          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                onClick={handleRestoreWorkspace}
                disabled={isRestorePending}
                className="h-6 px-2 gap-1.5 hover:bg-foreground/10 transition-colors text-foreground shrink-0 rounded-md ml-2 flex items-center"
                aria-label="Restore workspace"
              >
                <IconTextUndo className="h-4 w-4" />
                <span className="text-xs">Restore</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              Restore workspace
              <Kbd>⇧⌘E</Kbd>
            </TooltipContent>
          </Tooltip>
        )}
        {/* Custom right header slot - used by Cowork mode for panel toggle */}
        {rightHeaderSlot}
      </div>
    </div>
  )
})
