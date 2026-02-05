import { useAtom, useSetAtom } from "jotai"
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp, Loader2, X, RotateCcw, SkipForward } from "lucide-react"
import { useState, useEffect, useMemo, useCallback } from "react"
import { Progress } from "./ui/progress"
import { IconSpinner } from "../icons"
import {
  runtimeInitBannerDismissedAtom,
  agentsSettingsDialogActiveTabAtom,
  desktopViewAtom,
} from "../lib/atoms"
import { trpc } from "../lib/trpc"

const AUTO_DISMISS_DELAY = 3000 // 3 seconds
const OVERALL_TIMEOUT = 60000 // 60 seconds overall timeout
const MAX_RETRIES = 3

export function RuntimeInitBanner() {
  const [dismissed, setDismissed] = useAtom(runtimeInitBannerDismissedAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const [expanded, setExpanded] = useState(false)
  const [installingCategory, setInstallingCategory] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(AUTO_DISMISS_DELAY / 1000)
  const [installError, setInstallError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [overallTimeout, setOverallTimeout] = useState(false)

  // Detect tools query
  const {
    data: toolsData,
    isLoading,
    refetch,
  } = trpc.runner.detectTools.useQuery(undefined, {
    enabled: !dismissed,
  })

  // Skip category mutation
  const skipCategoryMutation = trpc.runner.skipCategory.useMutation({
    onSuccess: () => {
      setInstallError(null)
      setRetryCount(0)
      refetch()
    },
  })

  // Install tool mutation with improved error handling
  const installMutation = trpc.runner.installTool.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setInstallError(null)
        setRetryCount(0)
        refetch()
      } else {
        setInstallError(result.error || "安装失败")
      }
    },
    onError: (error) => {
      setInstallError(error.message || "安装失败")
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

  // Overall timeout - show manual config option after 60s
  useEffect(() => {
    if (dismissed || allSatisfied) return

    const timer = setTimeout(() => {
      setOverallTimeout(true)
    }, OVERALL_TIMEOUT)

    return () => clearTimeout(timer)
  }, [dismissed, allSatisfied])

  // Auto-install missing required tools (only if no error and retry count allows)
  useEffect(() => {
    if (!toolsData?.categories || installingCategory || allSatisfied || installError) return

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
  }, [toolsData, installingCategory, allSatisfied, missingCategories, installMutation, installError])

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

  // Retry installation for the failed category
  const handleRetry = useCallback(() => {
    if (retryCount >= MAX_RETRIES) {
      setInstallError("已达最大重试次数，请手动安装或跳过")
      return
    }

    // Find the category that was being installed
    const failedCategory = missingCategories.find(
      (c) => c.recommendedTool?.installCommand
    )

    if (failedCategory?.recommendedTool?.installCommand) {
      setRetryCount((prev) => prev + 1)
      setInstallError(null)
      setInstallingCategory(failedCategory.category)
      installMutation.mutate({
        toolName: failedCategory.recommendedTool.name,
        command: failedCategory.recommendedTool.installCommand,
      })
    }
  }, [retryCount, missingCategories, installMutation])

  // Skip the current failing category
  const handleSkip = useCallback(() => {
    const failedCategory = missingCategories.find(
      (c) => c.recommendedTool?.installCommand
    )

    if (failedCategory) {
      setInstallingCategory(null)
      setInstallError(null)
      setRetryCount(0)
      skipCategoryMutation.mutate({ category: failedCategory.category })
    }
  }, [missingCategories, skipCategoryMutation])

  // Skip all remaining categories and dismiss
  const handleSkipAll = useCallback(() => {
    // Skip all missing categories
    for (const cat of missingCategories) {
      skipCategoryMutation.mutate({ category: cat.category })
    }
    setDismissed(true)
  }, [missingCategories, skipCategoryMutation, setDismissed])

  // Loading state
  if (isLoading) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[280px]">
        <IconSpinner className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-foreground text-xs">Checking environment...</div>
          <Progress value={0} className="mt-2 h-1" />
        </div>
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
        {installError ? (
          <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
        ) : installingCategory ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-foreground text-xs">
            {installError
              ? "安装失败"
              : installingCategory
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
        <button
          onClick={handleDismiss}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Error state with retry/skip options */}
      {installError && (
        <div className="border-t border-border px-2 py-1.5">
          <div className="text-[10px] text-destructive mb-1.5 break-words">
            {installError.length > 100 ? installError.slice(0, 100) + "..." : installError}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRetry}
              disabled={retryCount >= MAX_RETRIES}
              className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="h-3 w-3" />
              重试 {retryCount > 0 && `(${retryCount}/${MAX_RETRIES})`}
            </button>
            <button
              onClick={handleSkip}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <SkipForward className="h-3 w-3" />
              跳过
            </button>
            <button
              onClick={handleViewDetails}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              手动配置 →
            </button>
          </div>
        </div>
      )}

      {/* Overall timeout warning */}
      {overallTimeout && !installError && !allSatisfied && (
        <div className="border-t border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground mb-1.5">
            环境检测超时，可选择跳过或手动配置
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSkipAll}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <SkipForward className="h-3 w-3" />
              跳过全部
            </button>
            <button
              onClick={handleViewDetails}
              className="text-[10px] text-primary hover:text-primary/80 transition-colors ml-auto"
            >
              手动配置 →
            </button>
          </div>
        </div>
      )}

      {/* Expanded details - only show when user expands */}
      {expanded && !installError && (
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
