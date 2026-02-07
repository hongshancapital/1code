/**
 * Browser View Component
 * Full-screen browser view for AI automation (exclusive layout)
 */

import { X, Globe } from "lucide-react"
import { useAtomValue } from "jotai"
import { Button } from "@/components/ui/button"
import { BrowserSidebar } from "./browser-sidebar"
import { browserTitleAtomFamily, browserFaviconAtomFamily } from "./atoms"

interface BrowserViewProps {
  chatId: string
  projectId: string
  onClose: () => void
}

export function BrowserView({ chatId, projectId, onClose }: BrowserViewProps) {
  const title = useAtomValue(browserTitleAtomFamily(chatId))
  const favicon = useAtomValue(browserFaviconAtomFamily(chatId))

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header with page info and close button */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 h-10 shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Favicon */}
          {favicon ? (
            <img
              src={favicon}
              alt=""
              className="w-4 h-4 shrink-0"
              onError={(e) => {
                // Hide broken favicon
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
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7 shrink-0"
          aria-label="Close browser"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Browser content */}
      <div className="flex-1 min-h-0">
        <BrowserSidebar chatId={chatId} projectId={projectId} className="h-full" />
      </div>
    </div>
  )
}
