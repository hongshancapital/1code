/**
 * PreviewSidebarPanel - Renders the preview sidebar with quick setup placeholder
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Handles:
 * - ResizableSidebar wrapper
 * - Quick setup placeholder (no preview available)
 * - AgentPreview component when preview is available
 */

import { memo } from "react"
import { ResizableSidebar } from "@/components/ui/resizable-sidebar"
import { Button } from "../../../components/ui/button"
import { IconCloseSidebarRight } from "../../../icons/icons"
import { AgentPreview } from "../ui/agent-preview"
import { agentsPreviewSidebarWidthAtom } from "../atoms"

export interface PreviewSidebarPanelProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  sandboxId?: string
  port: number
  repository?: string
  isQuickSetup: boolean
}

export const PreviewSidebarPanel = memo(function PreviewSidebarPanel({
  isOpen,
  onClose,
  chatId,
  sandboxId,
  port,
  repository,
  isQuickSetup,
}: PreviewSidebarPanelProps) {
  return (
    <ResizableSidebar
      isOpen={isOpen}
      onClose={onClose}
      widthAtom={agentsPreviewSidebarWidthAtom}
      minWidth={350}
      side="right"
      animationDuration={0}
      initialWidth={0}
      exitWidth={0}
      showResizeTooltip={true}
      className="bg-tl-background border-l"
      style={{ borderLeftWidth: "0.5px" }}
    >
      {isQuickSetup ? (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-end px-3 h-10 bg-tl-background shrink-0 border-b border-border/50">
            <Button
              variant="ghost"
              className="h-7 w-7 p-0 hover:bg-muted transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] rounded-md"
              onClick={onClose}
            >
              <IconCloseSidebarRight className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
          <div className="flex flex-col items-center justify-center flex-1 p-6 text-center">
            <div className="text-muted-foreground mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="opacity-50"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              Preview not available
            </p>
            <p className="text-xs text-muted-foreground/70 max-w-[200px]">
              Set up this repository to enable live preview
            </p>
          </div>
        </div>
      ) : (
        <AgentPreview
          chatId={chatId}
          sandboxId={sandboxId}
          port={port}
          repository={repository}
          hideHeader={false}
          onClose={onClose}
        />
      )}
    </ResizableSidebar>
  )
})
