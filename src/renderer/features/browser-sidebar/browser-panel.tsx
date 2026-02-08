/**
 * Browser Panel Component
 * Sidebar panel for browser (like Plan Sidebar)
 * Shows browser with collapse and close buttons
 */

import { X, Globe } from "lucide-react"
import { useAtomValue, useSetAtom } from "jotai"
import { Button } from "@/components/ui/button"
import { IconDoubleChevronRight } from "@/components/ui/icons"
import { BrowserSidebar } from "./browser-sidebar"
import {
  browserTitleAtomFamily,
  browserFaviconAtomFamily,
  browserActiveAtomFamily,
  browserVisibleAtomFamily,
} from "./atoms"

interface BrowserPanelProps {
  chatId: string
  projectId: string
  /** Called when user clicks collapse button (<<) - hides panel but keeps webview alive */
  onCollapse: () => void
  /** Called when user clicks close button (X) - destroys webview, clears active state */
  onClose: () => void
  /** Called when screenshot is taken - receives base64 image data */
  onScreenshot?: (imageData: string) => void
}

export function BrowserPanel({ chatId, projectId, onCollapse, onClose, onScreenshot }: BrowserPanelProps) {
  const title = useAtomValue(browserTitleAtomFamily(chatId))
  const favicon = useAtomValue(browserFaviconAtomFamily(chatId))
  const setBrowserActive = useSetAtom(browserActiveAtomFamily(chatId))
  const setBrowserVisible = useSetAtom(browserVisibleAtomFamily(chatId))

  // Handle close - mark as inactive and hide
  const handleClose = () => {
    setBrowserActive(false)
    setBrowserVisible(false)
    onClose()
  }

  return (
    <div className="h-full flex flex-col bg-tl-background">
      {/* Header - similar to AgentPlanSidebar, draggable for window move */}
      <div
        className="flex items-center justify-between px-2 h-10 bg-tl-background shrink-0 border-b border-border/50"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Collapse button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={onCollapse}
            className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] text-foreground shrink-0 rounded-md"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            aria-label="Collapse browser"
          >
            <IconDoubleChevronRight className="h-4 w-4" />
          </Button>

          {/* Favicon */}
          {favicon ? (
            <img
              src={favicon}
              alt=""
              className="w-4 h-4 shrink-0"
              onError={(e) => {
                e.currentTarget.style.display = "none"
              }}
            />
          ) : (
            <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
          )}

          {/* Title */}
          <span className="text-sm font-medium truncate">
            {title || "Browser"}
          </span>
        </div>

        {/* Close button */}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClose}
          className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] text-foreground shrink-0 rounded-md"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          aria-label="Close browser"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Browser content */}
      <div className="flex-1 min-h-0">
        <BrowserSidebar
          chatId={chatId}
          projectId={projectId}
          className="h-full"
          onScreenshot={onScreenshot}
        />
      </div>
    </div>
  )
}
