import { useAtom } from "jotai"
import { X, ExternalLink, Maximize2, Minimize2 } from "lucide-react"
import { cn } from "../../../lib/utils"
import { isMacOS } from "../../../lib/utils/platform"
import { Button } from "../../../components/ui/button"
import { Dialog, DialogContent } from "../../../components/ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"
import { getFileIconByExtension } from "../../agents/mentions/agents-file-mention"
import { FilePreview } from "./file-preview"
import { trpc } from "../../../lib/trpc"
import {
  filePreviewPathAtom,
  filePreviewOpenAtom,
  filePreviewDisplayModeAtom,
} from "../atoms"

interface FilePreviewDialogProps {
  className?: string
}

export function FilePreviewDialog({ className }: FilePreviewDialogProps) {
  const [open, setOpen] = useAtom(filePreviewOpenAtom)
  const [filePath, setFilePath] = useAtom(filePreviewPathAtom)
  const [displayMode, setDisplayMode] = useAtom(filePreviewDisplayModeAtom)

  const fileName = filePath?.split("/").pop() || ""
  const dirPath = filePath?.split("/").slice(0, -1).join("/") || ""
  const FileIcon = fileName ? (getFileIconByExtension(fileName) ?? null) : null

  const handleClose = () => {
    setFilePath(null)
  }

  const openInFinderMutation = trpc.external.openInFinder.useMutation()

  const handleOpenExternal = () => {
    if (filePath) {
      openInFinderMutation.mutate(filePath)
    }
  }

  const handleToggleFullscreen = () => {
    setDisplayMode(displayMode === "full-page" ? "dialog" : "full-page")
  }

  if (!filePath) return null

  const isMac = isMacOS()

  // Full page mode
  if (displayMode === "full-page") {
    return (
      <div className={cn("fixed inset-0 z-50 bg-background flex flex-col", className)}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
          {/* macOS: Left side has close + fullscreen buttons */}
          {isMac && (
            <div className="flex items-center gap-1">
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>关闭</TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleToggleFullscreen}>
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>退出全屏</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* File info - center on macOS, left on Windows */}
          <div className={cn(
            "flex items-center gap-2 min-w-0",
            isMac && "flex-1 justify-center"
          )}>
            {FileIcon && <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
            <span className="text-sm font-medium truncate">{fileName}</span>
            {dirPath && (
              <span className="text-xs text-muted-foreground truncate hidden sm:block">
                {dirPath}
              </span>
            )}
          </div>

          {/* macOS: Right side has "Show in Finder" only */}
          {isMac ? (
            <div className="flex items-center gap-1">
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenExternal}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>在 Finder 中显示</TooltipContent>
              </Tooltip>
            </div>
          ) : (
            /* Windows: Right side has all buttons - external, fullscreen, close */
            <div className="flex items-center gap-1">
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenExternal}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>在资源管理器中显示</TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleToggleFullscreen}>
                    <Minimize2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>退出全屏</TooltipContent>
              </Tooltip>

              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>关闭</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <FilePreview filePath={filePath} />
        </div>
      </div>
    )
  }

  // Dialog mode (default)
  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent
        className={cn(
          "max-w-4xl w-[90vw] h-[80vh] p-0 gap-0 flex flex-col overflow-hidden",
          className
        )}
        showCloseButton={false}
      >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 flex-shrink-0">
            {/* macOS: Left side has close + fullscreen buttons */}
            {isMac && (
              <div className="flex items-center gap-1">
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
                      <X className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>关闭</TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleToggleFullscreen}>
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>全屏</TooltipContent>
                </Tooltip>
              </div>
            )}

            {/* File info - center on macOS, left on Windows */}
            <div className={cn(
              "flex items-center gap-2 min-w-0",
              isMac && "flex-1 justify-center"
            )}>
              {FileIcon && <FileIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
              <span className="text-sm font-medium truncate">{fileName}</span>
              {dirPath && (
                <span className="text-xs text-muted-foreground truncate hidden sm:block">
                  {dirPath}
                </span>
              )}
            </div>

            {/* macOS: Right side has "Show in Finder" only */}
            {isMac ? (
              <div className="flex items-center gap-1">
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenExternal}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>在 Finder 中显示</TooltipContent>
                </Tooltip>
              </div>
            ) : (
              /* Windows: Right side has all buttons - external, fullscreen, close */
              <div className="flex items-center gap-1">
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleOpenExternal}>
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>在资源管理器中显示</TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleToggleFullscreen}>
                      <Maximize2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>全屏</TooltipContent>
                </Tooltip>

                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
                      <X className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>关闭</TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden">
            <FilePreview filePath={filePath} />
          </div>
        </DialogContent>
    </Dialog>
  )
}

// Hook to open file preview
export function useFilePreview() {
  const [, setFilePath] = useAtom(filePreviewPathAtom)

  return {
    openPreview: (path: string) => setFilePath(path),
    closePreview: () => setFilePath(null),
  }
}
