import { useAtom, useSetAtom } from "jotai"
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp, Loader2 } from "lucide-react"
import { useState, useEffect, useMemo } from "react"
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
  const [installingCategory, setInstallingCategory] = useState<string | null>(null)
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
      refetch()
    },
    onSettled: () => {
      setInstallingCategory(null)
    },
  })

  // Calculate progress based on categories
  const { progress, missingCategories, allSatisfied, totalCategories, satisfiedCount } = useMemo(() => {
    if (!toolsData?.categories) {
      return { progress: 0, missingCategories: [], allSatisfied: false, totalCategories: 0, satisfiedCount: 0 }
    }

    // Only consider required categories for progress
    const requiredCategories = toolsData.categories.filter((c) => c.required)
    const satisfiedRequired = requiredCategories.filter((c) => c.satisfied)
    const missing = requiredCategories.filter((c) => !c.satisfied)

    return {
      progress: requiredCategories.length > 0
        ? Math.round((satisfiedRequired.length / requiredCategories.length) * 100)
        : 100,
      missingCategories: missing,
      allSatisfied: missing.length === 0,
      totalCategories: requiredCategories.length,
      satisfiedCount: satisfiedRequired.length,
    }
  }, [toolsData])

  // Auto-dismiss countdown for success state
  useEffect(() => {
    if (!allSatisfied || !toolsData || dismissed) return

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
  }, [allSatisfied, toolsData, dismissed, setDismissed])

  // Auto-install missing required tools
  useEffect(() => {
    if (!toolsData?.categories || installingCategory || allSatisfied) return

    // Find the first missing required category that has a recommended tool
    const toInstall = missingCategories.find(
      (c) => c.recommendedTool?.installCommand && !installingCategory
    )

    if (toInstall?.recommendedTool?.installCommand) {
      setInstallingCategory(toInstall.category)
      installMutation.mutate({
        toolName: toInstall.recommendedTool.name,
        command: toInstall.recommendedTool.installCommand,
      })
    }
  }, [toolsData, installingCategory, allSatisfied, missingCategories, installMutation])

  // Get current installing tool name - must be before conditional returns
  const installingTool = useMemo(() => {
    if (!installingCategory || !toolsData?.categories) return null
    const category = toolsData.categories.find((c) => c.category === installingCategory)
    return category?.recommendedTool?.displayName || null
  }, [installingCategory, toolsData])

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

  // Loading state
  if (isLoading) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[280px]">
        <IconSpinner className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-foreground text-xs">Checking environment...</div>
          <Progress value={0} className="mt-2 h-1" />
        </div>
      </div>
    )
  }

  // All required tools installed - brief success message with auto-dismiss
  if (allSatisfied && toolsData) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2">
        <CheckCircle className="h-4 w-4 text-green-500" />
        <span className="text-foreground text-xs">Environment ready</span>
        <span className="text-[10px] text-muted-foreground">{countdown}s</span>
      </div>
    )
  }

  // Installing or missing required tools
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[280px] max-w-[320px]">
      {/* Header - compact */}
      <div className="flex items-center gap-2 p-2">
        {installingCategory ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-foreground text-xs">
            {installingCategory
              ? `Installing ${installingTool}...`
              : `Setting up environment (${satisfiedCount}/${totalCategories})`}
          </div>
          <Progress value={progress} className="mt-1.5 h-1" />
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Expanded details - only show when user expands */}
      {expanded && (
        <div className="border-t border-border px-2 py-1.5 text-xs">
          {missingCategories.map((cat) => (
            <div
              key={cat.category}
              className="flex items-center justify-between py-1 gap-2"
            >
              <span className="text-muted-foreground">{cat.displayName}</span>
              <span className="text-foreground">
                {installingCategory === cat.category ? (
                  <span className="text-primary">Installing {cat.recommendedTool?.displayName}...</span>
                ) : (
                  <span className="text-yellow-500">Need {cat.recommendedTool?.displayName}</span>
                )}
              </span>
            </div>
          ))}
          <button
            onClick={handleViewDetails}
            className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            View all in Settings →
          </button>
        </div>
      )}
    </div>
  )
}
