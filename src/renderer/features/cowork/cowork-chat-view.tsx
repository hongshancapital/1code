import { PanelRight } from "lucide-react"
import { Button } from "../../components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { cn } from "../../lib/utils"
import { ChatView } from "../agents/main/active-chat"

// ============================================================================
// Types
// ============================================================================

interface CoworkChatViewProps {
  chatId: string
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  selectedTeamName?: string
  selectedTeamImageUrl?: string
  // Cowork specific props
  rightPanelOpen: boolean
  onToggleRightPanel: () => void
}

// ============================================================================
// Component - Wraps ChatView with Cowork-specific UI
// Hides Git/Terminal/Review/Changes panels and adds right panel toggle
// ============================================================================

export function CoworkChatView({
  chatId,
  isSidebarOpen,
  onToggleSidebar,
  selectedTeamName,
  selectedTeamImageUrl,
  rightPanelOpen,
  onToggleRightPanel,
}: CoworkChatViewProps) {
  // Right panel toggle button to be placed in the header
  const rightPanelToggle = (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 w-6 p-0 hover:bg-foreground/10 transition-colors text-foreground flex-shrink-0 rounded-md ml-2",
            rightPanelOpen && "bg-foreground/10"
          )}
          onClick={onToggleRightPanel}
          aria-label="Toggle workspace panel"
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {rightPanelOpen ? "关闭工作区面板" : "打开工作区面板"}
      </TooltipContent>
    </Tooltip>
  )

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Original ChatView with Git features hidden and custom header slot */}
      <ChatView
        key={chatId}
        chatId={chatId}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={onToggleSidebar}
        selectedTeamName={selectedTeamName}
        selectedTeamImageUrl={selectedTeamImageUrl}
        hideGitFeatures={true}
        rightHeaderSlot={rightPanelToggle}
      />
    </div>
  )
}
