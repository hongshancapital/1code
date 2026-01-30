"use client"

import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { KeyboardIcon } from "../../../components/ui/icons"
import { HandHelping as HandHelpingIcon } from "lucide-react"

const FEEDBACK_URL = "https://github.com/anthropics/claude-code/issues"
import { useSetAtom } from "jotai"
import { agentsSettingsDialogOpenAtom, agentsSettingsDialogActiveTabAtom } from "../../../lib/atoms"

interface AgentsHelpPopoverProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  isMobile?: boolean
}

export function AgentsHelpPopover({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  isMobile = false,
}: AgentsHelpPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)

  // Use controlled state if provided, otherwise use internal state
  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen

  const handleKeyboardShortcutsClick = () => {
    setOpen(false)
    setSettingsActiveTab("keyboard")
    setSettingsDialogOpen(true)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-36">
        {!isMobile && (
          <DropdownMenuItem
            onClick={handleKeyboardShortcutsClick}
            className="gap-2"
          >
            <KeyboardIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1">Shortcuts</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => window.open(FEEDBACK_URL, "_blank")}
          className="gap-2"
        >
          <HandHelpingIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1">Feedback</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
