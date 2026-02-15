"use client"

import { memo, useCallback } from "react"
import { useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { FolderTree, ArrowUpRight } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { FileTreePanel } from "@/features/cowork/file-tree-panel"
import { FilePreviewDialog } from "@/features/cowork/file-preview/file-preview-dialog"
import { filePreviewPathAtom } from "@/lib/atoms"
import { ResizableWidgetCard } from "../components/resizable-widget-card"

// ============================================================================
// Types
// ============================================================================

interface ExplorerWidgetProps {
  worktreePath?: string | null
  subChatId: string | null
  onExpand?: () => void
  /** Called when a file is selected for preview */
  onFileSelect?: (filePath: string, line?: number) => void
}

// ============================================================================
// Explorer Widget Component
// ============================================================================

/**
 * Explorer Widget for Details Sidebar
 * Wraps the full FileTreePanel component in a compact widget container
 */
export const ExplorerWidget = memo(function ExplorerWidget({
  worktreePath,
  subChatId,
  onExpand,
  onFileSelect,
}: ExplorerWidgetProps) {
  const { t } = useTranslation("sidebar")
  const setFilePreviewPath = useSetAtom(filePreviewPathAtom)

  // Handle file selection - open preview dialog
  const handleFileSelect = useCallback(
    (path: string, line?: number) => {
      if (worktreePath) {
        const normalizedPath = worktreePath.replace(/[\\/]+$/, "")
        const fullPath = `${normalizedPath}/${path}`
        setFilePreviewPath(fullPath)
      }
      // Also call external callback if provided
      onFileSelect?.(path, line)
    },
    [worktreePath, setFilePreviewPath, onFileSelect]
  )

  if (!worktreePath) {
    return (
      <div className="mx-2 mb-2">
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <div className="flex items-center gap-2 px-2 h-8 select-none bg-muted/30">
            <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">{t("details.widgets.explorer")}</span>
          </div>
          <div className="text-xs text-muted-foreground px-2 py-2">
            {t("details.explorerWidget.noWorkspace")}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mx-2 mb-2">
        {/* Resizable container for proper flex layout and scrolling */}
        <div className="rounded-lg border border-border/50 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 px-2 h-8 select-none group bg-muted/30 shrink-0">
            <FolderTree className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs font-medium text-foreground">{t("details.widgets.explorer")}</span>
            <div className="flex-1" />

            {/* Expand button */}
            {onExpand && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onExpand}
                    className="h-5 w-5 p-0 hover:bg-foreground/10 text-muted-foreground hover:text-foreground rounded-md opacity-0 group-hover:opacity-100 transition-[background-color,opacity] duration-150 shrink-0"
                    aria-label={t("details.widgets.explorer")}
                  >
                    <ArrowUpRight className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">{t("details.explorerWidget.openInSidebar")}</TooltipContent>
              </Tooltip>
            )}
          </div>

          {/* FileTreePanel - wrapped in ResizableWidgetCard for height adjustment */}
          <ResizableWidgetCard
            widgetId="explorer"
            subChatId={subChatId || "default"}
          >
            <div className="h-full min-h-0">
              <FileTreePanel
                projectPath={worktreePath}
                onFileSelect={handleFileSelect}
                showHeader={false}
              />
            </div>
          </ResizableWidgetCard>
        </div>
      </div>

      {/* File preview dialog - triggered by file selection */}
      <FilePreviewDialog />
    </>
  )
})