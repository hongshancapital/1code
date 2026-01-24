import { RotateCw, Square, ArrowDownToLine, Trash2, MoreVertical } from "lucide-react"
import { Button } from "../../components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"
import { cn } from "../../lib/utils"
import type { TerminalInstance } from "./types"

// ============================================================================
// Types
// ============================================================================

interface RunTerminalHeaderProps {
  terminal: TerminalInstance
  isRunning: boolean
  terminalBg?: string
  onRestart: () => void
  onStop: () => void
  onClear: () => void
  onScrollToBottom: () => void
}

// ============================================================================
// Component
// ============================================================================

export function RunTerminalHeader({
  terminal,
  isRunning,
  terminalBg,
  onRestart,
  onStop,
  onClear,
  onScrollToBottom,
}: RunTerminalHeaderProps) {
  const scriptName = terminal.runConfig?.scriptName || terminal.name
  const packageManager = terminal.runConfig?.packageManager || "npm"

  return (
    <div
      className="flex items-center justify-between h-8 px-2 border-b border-border/50"
      style={{ backgroundColor: terminalBg }}
    >
      {/* Left side: Run label + script info */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Run</span>
        <div className="flex items-center gap-1.5">
          {/* Status indicator */}
          <div
            className={cn(
              "w-2 h-2 rounded-full transition-colors",
              isRunning ? "bg-red-500 animate-pulse" : "bg-muted-foreground/40"
            )}
          />
          {/* Script name with package manager icon */}
          <span className="text-sm font-medium">{scriptName}</span>
          <span className="text-xs text-muted-foreground">
            ({packageManager})
          </span>
        </div>
      </div>

      {/* Right side: Control buttons */}
      <div className="flex items-center gap-0.5">
        {/* Restart button */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onRestart}
            >
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Restart</TooltipContent>
        </Tooltip>

        {/* Stop button */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onStop}
              disabled={!isRunning}
            >
              <Square
                className={cn(
                  "h-3.5 w-3.5",
                  isRunning ? "text-red-500" : "text-muted-foreground"
                )}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Stop</TooltipContent>
        </Tooltip>

        {/* Separator */}
        <div className="w-px h-4 bg-border mx-1" />

        {/* Scroll to bottom */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onScrollToBottom}
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Scroll to bottom</TooltipContent>
        </Tooltip>

        {/* Clear output */}
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={onClear}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Clear output</TooltipContent>
        </Tooltip>

        {/* More options dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onRestart}>
              <RotateCw className="h-4 w-4 mr-2" />
              Restart
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onStop} disabled={!isRunning}>
              <Square className="h-4 w-4 mr-2" />
              Stop
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onClear}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear output
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
