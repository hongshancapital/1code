/**
 * FileViewerPanel - Renders file viewer in the appropriate display mode
 *
 * Extracted from active-chat.tsx to reduce JSX duplication.
 * Consolidates three repeated FileViewerSidebar instances into one component
 * that switches on displayMode: "side-peek" | "center-peek" | "full-page"
 */

import { memo } from "react"
import { ResizableSidebar } from "@/components/ui/resizable-sidebar"
import { CenterPeekDialog } from "@/components/ui/panel-container/center-peek-dialog"
import { FullPageView } from "@/components/ui/panel-container/full-page-view"
import { FileViewerSidebar } from "../../file-viewer"
import { fileViewerSidebarWidthAtom } from "../atoms"

export interface FileViewerPanelProps {
  filePath: string | null
  projectPath: string | null
  displayMode: "side-peek" | "center-peek" | "full-page"
  isMobileFullscreen: boolean
  onClose: () => void
}

export const FileViewerPanel = memo(function FileViewerPanel({
  filePath,
  projectPath,
  displayMode,
  isMobileFullscreen,
  onClose,
}: FileViewerPanelProps) {
  if (!filePath || !projectPath) return null

  const fileViewer = (
    <FileViewerSidebar
      filePath={filePath}
      projectPath={projectPath}
      onClose={onClose}
    />
  )

  switch (displayMode) {
    case "side-peek":
      if (isMobileFullscreen) return null
      return (
        <ResizableSidebar
          isOpen={!!filePath}
          onClose={onClose}
          widthAtom={fileViewerSidebarWidthAtom}
          minWidth={350}
          maxWidth={900}
          side="right"
          animationDuration={0}
          initialWidth={0}
          exitWidth={0}
          showResizeTooltip={true}
          className="bg-tl-background border-l"
          style={{ borderLeftWidth: "0.5px" }}
        >
          {fileViewer}
        </ResizableSidebar>
      )

    case "center-peek":
      return (
        <CenterPeekDialog
          isOpen={!!filePath}
          onClose={onClose}
        >
          {fileViewer}
        </CenterPeekDialog>
      )

    case "full-page":
      return (
        <FullPageView
          isOpen={!!filePath}
          onClose={onClose}
        >
          {fileViewer}
        </FullPageView>
      )

    default:
      return null
  }
})
