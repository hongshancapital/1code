import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { CheckCircle, AlertCircle, ChevronDown, ChevronUp, Loader2, X, RotateCcw, SkipForward, FlaskConical, Package } from "lucide-react"
import { useState, useEffect, useMemo, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Progress } from "./ui/progress"
import { IconSpinner } from "../icons"
import {
  runtimeInitBannerDismissedAtom,
  runtimeSimulatedModeAtom,
  agentsSettingsDialogActiveTabAtom,
  desktopViewAtom,
} from "../lib/atoms"
import { trpc } from "../lib/trpc"

const AUTO_DISMISS_DELAY = 3000 // 3 seconds
const OVERALL_TIMEOUT = 60000 // 60 seconds overall timeout
const PM_INSTALL_TIMEOUT = 600000 // 10 minutes for package manager installation (Homebrew is slow)
const MAX_RETRIES = 3

type InstallPhase = "detecting" | "installing_pm" | "installing_tools" | "complete"

export function RuntimeInitBanner() {
  const { t } = useTranslation('common')
  const [dismissed, setDismissed] = useAtom(runtimeInitBannerDismissedAtom)
  const simulatedMode = useAtomValue(runtimeSimulatedModeAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const [expanded, setExpanded] = useState(false)
  const [installingCategory, setInstallingCategory] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(AUTO_DISMISS_DELAY / 1000)
  const [installError, setInstallError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [overallTimeout, setOverallTimeout] = useState(false)
  const [installPhase, setInstallPhase] = useState<InstallPhase>("detecting")
  const [isInstallingPM, setIsInstallingPM] = useState(false)

  // Simulated installation state query
  const { data: simulatedState } = trpc.debug.getSimulatedInstallState.useQuery(undefined, {
    enabled: simulatedMode,
    refetchInterval: (query) => {
      return query.state.data?.isRunning ? 300 : false
    },
  })

  // Get detected package manager info
  const { data: pmData, refetch: refetchPM } = trpc.runner.getDetectedPackageManager.useQuery(undefined, {
    enabled: !dismissed && !simulatedMode,
  })

  // Detect tools query
  const {
    data: toolsData,
    isLoading,
    refetch,
  } = trpc.runner.detectTools.useQuery(undefined, {
    enabled: !dismissed && !simulatedMode,
  })

  // Skip category mutation
  const skipCategoryMutation = trpc.runner.skipCategory.useMutation({
    onSuccess: () => {
      setInstallError(null)
      setRetryCount(0)
      refetch()
    },
  })

  // Polling state for dev mode Terminal.app installation
  const [pollingForPM, setPollingForPM] = useState(false)
  const refreshToolsMutation = trpc.runner.refreshTools.useMutation()

  // Install package manager mutation
  const installPMMutation = trpc.runner.installPackageManager.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setIsInstallingPM(false)
        setInstallError(null)
        setInstallPhase("installing_tools")
        refetchPM()
        refetch()
      } else if (result.error === "INSTALLING_IN_TERMINAL") {
        // Dev mode: Homebrew installing in Terminal.app, poll for completion
        setPollingForPM(true)
      } else if (result.error === "NO_ADMIN" || result.error === "INSTALL_FAILED") {
        setIsInstallingPM(false)
        setInstallError(result.error === "NO_ADMIN"
          ? t("runtime.noAdmin")
          : t("runtime.installFailedGeneric"))
      } else {
        setIsInstallingPM(false)
        setInstallError(result.error || t("runtime.installFailedGeneric"))
      }
    },
    onError: (error) => {
      setIsInstallingPM(false)
      setInstallError(error.message || t("runtime.installFailedGeneric"))
    },
  })

  // Poll for PM installation completion (dev mode Terminal.app)
  useEffect(() => {
    if (!pollingForPM) return
    const interval = setInterval(async () => {
      await refreshToolsMutation.mutateAsync()
      const { data } = await refetchPM()
      if (data?.packageManager) {
        setPollingForPM(false)
        setIsInstallingPM(false)
        setInstallPhase("installing_tools")
        refetch()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [pollingForPM]) // eslint-disable-line react-hooks/exhaustive-deps

  // Install tool mutation with improved error handling
  const installMutation = trpc.runner.installTool.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        setInstallError(null)
        setRetryCount(0)
        refetch()
      } else {
        setInstallError(result.error || t("runtime.installFailed"))
      }
    },
    onError: (error) => {
      setInstallError(error.message || t("runtime.installFailed"))
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

  // Phase 1: Check and install package manager if needed (macOS/Windows only)
  useEffect(() => {
    if (!pmData || dismissed || simulatedMode || installError || isInstallingPM) return

    // If package manager needs installation
    if (pmData.needsInstall && pmData.installCommand) {
      setInstallPhase("installing_pm")
      setIsInstallingPM(true)
      installPMMutation.mutate()
    } else if (pmData.packageManager || pmData.platform === "linux") {
      // Package manager is ready or Linux (always has PM)
      setInstallPhase("installing_tools")
    }
  }, [pmData, dismissed, simulatedMode, installError, isInstallingPM, installPMMutation])

  // Phase 2: Auto-install missing required tools (only after PM is ready)
  useEffect(() => {
    if (!toolsData?.categories || installingCategory || allSatisfied || installError) return
    if (installPhase !== "installing_tools") return

    // Find the first missing required category that has a recommended tool
    // Skip package_manager category as it's handled separately
    const toInstall = missingCategories.find(
      (c) => c.category !== "package_manager" && c.recommendedTool?.installCommand && !installingCategory
    )

    if (toInstall?.recommendedTool?.installCommand) {
      setInstallingCategory(toInstall.category)
      installMutation.mutate({
        toolName: toInstall.recommendedTool.name,
        command: toInstall.recommendedTool.installCommand,
      })
    }
  }, [toolsData, installingCategory, allSatisfied, missingCategories, installMutation, installError, installPhase])

  // Get current installing tool name - must be before conditional returns
  const installingTool = useMemo(() => {
    if (!installingCategory || !toolsData?.categories) return null
    const category = toolsData.categories.find((c) => c.category === installingCategory)
    return category?.recommendedTool?.displayName || null
  }, [installingCategory, toolsData])

  // IMPORTANT: All hooks must be called BEFORE any early returns (Rules of Hooks)
  // Retry installation for the failed category
  const handleRetry = useCallback(() => {
    if (retryCount >= MAX_RETRIES) {
      setInstallError(t("runtime.maxRetries"))
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

  const handleDismiss = () => {
    setDismissed(true)
  }

  const handleViewDetails = () => {
    setSettingsActiveTab("runtime")
    setDesktopView("settings")
    handleDismiss()
  }

  // Early returns must be AFTER all hooks (Rules of Hooks)
  // Don't show if dismissed (unless in simulated mode)
  if (dismissed && !simulatedMode) {
    return null
  }

  // Simulated mode - show simulated state using the SAME UI as real banner
  if (simulatedMode && simulatedState) {
    const simIsRunning = simulatedState.isRunning
    const simProgress = simulatedState.progress
    const simError = simulatedState.error
    const simStep = simulatedState.currentStep

    // Map step to installing tool name (simulate tool names)
    const getSimInstallingTool = (step: string) => {
      const toolMap: Record<string, string> = {
        checking: "Git",
        downloading: "ripgrep",
        installing: "Bun",
        verifying: "tools",
      }
      return toolMap[step] || null
    }

    const simInstallingTool = getSimInstallingTool(simStep)
    const simIsInstalling = ["checking", "downloading", "installing", "verifying"].includes(simStep)
    const simIsComplete = simStep === "complete"
    const simHasError = simStep === "error" || !!simError

    // Calculate simulated satisfied/total for display
    const simSatisfiedCount = Math.floor((simProgress / 100) * 3)
    const simTotalCategories = 3

    // Show nothing if no state yet
    if (!simStep) {
      return null
    }

    // Loading state (initializing/detecting)
    if (simStep === "initializing" || simStep === "detecting") {
      return (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[280px]">
          <IconSpinner className="h-4 w-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="text-foreground text-xs">{t("runtime.checkingEnv")}</div>
            <Progress value={simProgress} className="mt-2 h-1" />
          </div>
        </div>
      )
    }

    // Completed state - same as real success
    if (simIsComplete) {
      return (
        <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="text-foreground text-xs">{t("runtime.envReady")}</span>
        </div>
      )
    }

    // Error state - same structure as real error
    if (simHasError) {
      return (
        <div className="fixed top-4 right-4 z-50 flex flex-col rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[280px] max-w-[320px]">
          {/* Header - compact */}
          <div className="flex items-center gap-2 p-2">
            <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-foreground text-xs">{t("runtime.installFailed")}</div>
              <Progress value={simProgress} className="mt-1.5 h-1" />
            </div>
          </div>
          {/* Error state with retry/skip options */}
          <div className="border-t border-border px-2 py-1.5">
            <div className="text-[10px] text-destructive mb-1.5 break-words">
              {simError && simError.length > 100 ? simError.slice(0, 100) + "..." : simError}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                {t("runtime.retry")}
              </button>
              <button
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <SkipForward className="h-3 w-3" />
                {t("runtime.skip")}
              </button>
              <button
                onClick={handleViewDetails}
                className="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
              >
                {t("runtime.manualConfig")} →
              </button>
            </div>
          </div>
        </div>
      )
    }

    // Installing/running state - same structure as real installing
    return (
      <div className="fixed top-4 right-4 z-50 flex flex-col rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[280px] max-w-[320px]">
        {/* Header - compact */}
        <div className="flex items-center gap-2 p-2">
          {simIsInstalling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-foreground text-xs">
              {simIsInstalling && simInstallingTool
                ? `Installing ${simInstallingTool}...`
                : `Setting up environment (${simSatisfiedCount}/${simTotalCategories})`}
            </div>
            <Progress value={simProgress} className="mt-1.5 h-1" />
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="border-t border-border px-2 py-1.5 text-xs">
            {[
              { category: "vcs", displayName: "Version Control", tool: "Git" },
              { category: "search", displayName: "Search", tool: "ripgrep" },
              { category: "js_runtime", displayName: "JavaScript", tool: "Bun" },
            ].map((cat) => {
              const isSatisfied = simProgress >= (["vcs", "search", "js_runtime"].indexOf(cat.category) + 1) * 33
              const isCurrentlyInstalling = simInstallingTool === cat.tool
              return (
                <div
                  key={cat.category}
                  className="flex items-center justify-between py-1 gap-2"
                >
                  <span className="text-muted-foreground">{cat.displayName}</span>
                  <span className="text-foreground">
                    {isSatisfied ? (
                      <span className="text-green-500">✓ {cat.tool}</span>
                    ) : isCurrentlyInstalling ? (
                      <span className="text-primary">Installing {cat.tool}...</span>
                    ) : (
                      <span className="text-yellow-500">Need {cat.tool}</span>
                    )}
                  </span>
                </div>
              )
            })}
            <button
              onClick={handleViewDetails}
              className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("runtime.viewSettings")} →
            </button>
          </div>
        )}
      </div>
    )
  }

  // Show nothing if simulated mode is active but no state yet
  if (simulatedMode) {
    return null
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="fixed top-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover p-3 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[280px]">
        <IconSpinner className="h-4 w-4 text-muted-foreground" />
        <div className="flex-1">
          <div className="text-foreground text-xs">{t("runtime.checkingEnv")}</div>
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
        <span className="text-foreground text-xs">{t("runtime.envReady")}</span>
        <span className="text-[10px] text-muted-foreground">{countdown}s</span>
      </div>
    )
  }

  // Get display text based on current phase
  const getStatusText = () => {
    if (installError) return t("runtime.installFailed")
    if (isInstallingPM) {
      const pmName = pmData?.platform === "darwin" ? "Homebrew" : "Windows Package Manager"
      return t("runtime.installingPM", { name: pmName })
    }
    if (installingCategory) return t("runtime.installingTool", { name: installingTool })
    if (installPhase === "installing_pm") return t("runtime.preparingPM")
    return t("runtime.settingUp", { satisfied: satisfiedCount, total: totalCategories })
  }

  // Installing or missing required tools
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col rounded-lg border border-border bg-popover text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-top-2 min-w-[280px] max-w-[320px]">
      {/* Header - compact */}
      <div className="flex items-center gap-2 p-2">
        {installError ? (
          <AlertCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />
        ) : isInstallingPM ? (
          <Package className="h-3.5 w-3.5 animate-pulse text-primary flex-shrink-0" />
        ) : installingCategory ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-foreground text-xs">
            {getStatusText()}
          </div>
          <Progress value={isInstallingPM ? 10 : progress} className="mt-1.5 h-1" />
          {isInstallingPM && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {t("runtime.pmInstallMayTakeLong")}
            </div>
          )}
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
              {t("runtime.retry")} {retryCount > 0 && `(${retryCount}/${MAX_RETRIES})`}
            </button>
            <button
              onClick={handleSkip}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <SkipForward className="h-3 w-3" />
              {t("runtime.skip")}
            </button>
            <button
              onClick={handleViewDetails}
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
            >
              {t("runtime.manualConfig")} →
            </button>
          </div>
        </div>
      )}

      {/* Overall timeout warning */}
      {overallTimeout && !installError && !allSatisfied && (
        <div className="border-t border-border px-2 py-1.5">
          <div className="text-[10px] text-muted-foreground mb-1.5">
            {t("runtime.envTimeout")}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSkipAll}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <SkipForward className="h-3 w-3" />
              {t("runtime.skipAll")}
            </button>
            <button
              onClick={handleViewDetails}
              className="text-[10px] text-primary hover:text-primary/80 transition-colors ml-auto"
            >
              {t("runtime.manualConfig")} →
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
            {t("runtime.viewSettings")} →
          </button>
        </div>
      )}
    </div>
  )
}
