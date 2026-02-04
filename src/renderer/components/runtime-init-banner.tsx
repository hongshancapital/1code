import { useAtom, useSetAtom } from "jotai"
import { CheckCircle, AlertCircle, Settings, X, ChevronDown, ChevronUp, Download, Loader2 } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
import { Button } from "./ui/button"
import { Progress } from "./ui/progress"
import { IconSpinner } from "../icons"
import {
  runtimeInitBannerDismissedAtom,
  agentsSettingsDialogActiveTabAtom,
  desktopViewAtom,
} from "../lib/atoms"
import { trpc } from "../lib/trpc"

const AUTO_DISMISS_DELAY = 3000 // 3 seconds

export function RuntimeInitBanner() {
  const [dismissed, setDismissed] = useAtom(runtimeInitBannerDismissedAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const [expanded, setExpanded] = useState(false)
  const [installingTool, setInstallingTool] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(AUTO_DISMISS_DELAY / 1000)

  // Detect tools query
  const {
    data: toolsData,
    isLoading,
    refetch,
  } = trpc.runner.detectTools.useQuery(undefined, {
    enabled: !dismissed,
  })

  // Install tool mutation
  const installMutation = trpc.runner.installTool.useMutation({
    onSuccess: () => {
      // Refresh tools after install
      refetch()
    },
    onSettled: () => {
      setInstallingTool(null)
    },
  })

  // Calculate progress and status
  const { progress, missingCount, missingTools, allInstalled } = useMemo(() => {
    if (!toolsData?.tools) {
      return { progress: 0, missingCount: 0, missingTools: [], allInstalled: false }
    }

    const total = toolsData.tools.length
    const installed = toolsData.tools.filter((t) => t.installed).length
    const missing = toolsData.tools.filter((t) => !t.installed && t.required)
    const recommended = toolsData.tools.filter((t) => !t.installed && !t.required)

    return {
      progress: Math.round((installed / total) * 100),
      missingCount: missing.length + recommended.length,
      missingTools: [...missing, ...recommended],
      allInstalled: missing.length === 0 && recommended.length === 0,
    }
  }, [toolsData])

  // Auto-dismiss countdown for success state
  useEffect(() => {
    if (!allInstalled || !toolsData || dismissed) return

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setDismissed(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [allInstalled, toolsData, dismissed, setDismissed])

  // Don't show if dismissed
  if (dismissed) {
    return null
  }

  const handleDismiss = () => {
    setDismissed(true)
  }

  const handleViewDetails = () => {
    setSettingsActiveTab("runtime")
    setDesktopView("settings")
    handleDismiss()
  }

  const handleInstall = (toolName: string, command: string) => {
    setInstallingTool(toolName)
    installMutation.mutate({ toolName, command })
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[300px]">
        <IconSpinner className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-foreground font-medium">Setting up Claude's workspace...</div>
          <Progress value={0} className="mt-2 h-1.5" />
        </div>
      </div>
    )
  }

  // All tools installed - brief success message with auto-dismiss
  if (allInstalled && toolsData) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2">
        <CheckCircle className="h-4 w-4 text-green-500" />
        <span className="text-foreground">Environment ready!</span>
        <span className="text-xs text-muted-foreground">{countdown}s</span>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  // Some tools missing
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[320px] max-w-[400px]">
      {/* Header */}
      <div className="flex items-center gap-3 p-3">
        <AlertCircle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-foreground font-medium">
            {missingCount} tool{missingCount !== 1 ? "s" : ""} not installed
          </div>
          <Progress value={progress} className="mt-2 h-1.5" />
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Expanded tool list */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 max-h-[200px] overflow-y-auto">
          {missingTools.map((tool) => (
            <div
              key={tool.name}
              className="flex items-center justify-between py-1.5 gap-2"
            >
              <div className="flex-1 min-w-0">
                <span className="text-foreground">{tool.displayName}</span>
                {tool.required && (
                  <span className="ml-1 text-[10px] text-yellow-500">(recommended)</span>
                )}
                <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
              </div>
              {tool.installCommand && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 flex-shrink-0"
                  onClick={() => handleInstall(tool.name, tool.installCommand!)}
                  disabled={installingTool !== null}
                >
                  {installingTool === tool.name ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Download className="h-3 w-3" />
                  )}
                  Install
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 p-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={handleDismiss}
        >
          Later
        </Button>
        <Button
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={handleViewDetails}
        >
          <Settings className="h-3 w-3" />
          View Details
        </Button>
      </div>
    </div>
  )
}
