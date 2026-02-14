import { useState, useEffect, useRef } from "react"
import { useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { trpc } from "../../../lib/trpc"
import { toast } from "sonner"
import { Copy, FolderOpen, RefreshCw, Terminal, Check, Scan, WifiOff, Database, Play, RotateCcw, Loader2, AlertCircle, CheckCircle2, Brain, ChevronDown, ChevronRight, ChevronLeft, Trash2 } from "lucide-react"
import { runtimeSimulatedModeAtom, runtimeInitBannerDismissedAtom } from "../../../lib/atoms"
import { Progress } from "../../ui/progress"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible"

// Hook to detect narrow screen
function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth <= 768)
    }

    checkWidth()
    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [])

  return isNarrow
}

// React Scan state management (only available in dev mode)
const REACT_SCAN_SCRIPT_ID = "react-scan-script"
const REACT_SCAN_STORAGE_KEY = "react-scan-enabled"

function loadReactScan(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(REACT_SCAN_SCRIPT_ID)) {
      resolve()
      return
    }

    const script = document.createElement("script")
    script.id = REACT_SCAN_SCRIPT_ID
    script.src = "https://unpkg.com/react-scan/dist/auto.global.js"
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error("Failed to load React Scan"))
    document.head.appendChild(script)
  })
}

function unloadReactScan(): void {
  const script = document.getElementById(REACT_SCAN_SCRIPT_ID)
  if (script) {
    script.remove()
  }
  // React Scan adds a toolbar element, try to remove it
  const toolbar = document.querySelector("[data-react-scan]")
  if (toolbar) {
    toolbar.remove()
  }
}

export function AgentsDebugTab() {
  const { t } = useTranslation("settings")
  const [copiedPath, setCopiedPath] = useState(false)
  const [copiedInfo, setCopiedInfo] = useState(false)
  const [reactScanEnabled, setReactScanEnabled] = useState(false)
  const [reactScanLoading, setReactScanLoading] = useState(false)
  const setRuntimeBannerDismissed = useSetAtom(runtimeInitBannerDismissedAtom)
  const isNarrowScreen = useIsNarrowScreen()

  // Check if we're in dev mode (only show React Scan in dev)
  const isDev = import.meta.env.DEV

  // Fetch system info
  const { data: systemInfo, isLoading: isLoadingSystem } =
    trpc.debug.getSystemInfo.useQuery()

  // Offline simulation state
  const { data: offlineSimulation, refetch: refetchOfflineSimulation } =
    trpc.debug.getOfflineSimulation.useQuery()
  const setOfflineSimulationMutation = trpc.debug.setOfflineSimulation.useMutation({
    onSuccess: (data) => {
      refetchOfflineSimulation()
      toast.success(data.enabled ? t('debug.toast.offlineSimEnabled') : t('debug.toast.offlineSimDisabled'), {
        description: data.enabled
          ? t('debug.toast.offlineSimEnabledDesc')
          : t('debug.toast.offlineSimDisabledDesc')
      })
    },
    onError: (error) => toast.error(error.message),
  })


  // Fetch DB stats
  const { data: dbStats, isLoading: isLoadingDb, refetch: refetchDb } =
    trpc.debug.getDbStats.useQuery()

  // Mutations
  const clearChatsMutation = trpc.debug.clearChats.useMutation({
    onSuccess: () => {
      toast.success(t('debug.toast.allChatsCleared'))
      refetchDb()
    },
    onError: (error) => toast.error(error.message),
  })

  const clearAllDataMutation = trpc.debug.clearAllData.useMutation({
    onSuccess: () => {
      // Clear localStorage (onboarding state, preferences, etc.)
      localStorage.clear()
      toast.success(t('debug.toast.allDataCleared'))
      setTimeout(() => window.location.reload(), 500)
    },
    onError: (error) => toast.error(error.message),
  })

  // Factory reset - clear everything and return to login page
  const factoryResetMutation = trpc.debug.factoryReset.useMutation({
    onSuccess: () => {
      // Clear all localStorage
      localStorage.clear()
      toast.success(t('debug.toast.factoryResetComplete'))
      // The main process will navigate to login.html, no need to reload here
    },
    onError: (error) => toast.error(error.message),
  })

  // Copy production database to dev (dev only)
  const copyProductionDbMutation = trpc.debug.copyProductionDb.useMutation({
    onSuccess: (_data) => {
      toast.success(t('debug.toast.productionDbCopied'), {
        description: t('debug.toast.productionDbCopiedDesc'),
      })
      refetchDb()
      // Reload to pick up new data
      setTimeout(() => window.location.reload(), 1000)
    },
    onError: (error) => toast.error(error.message),
  })

  // Reset onboarding state (clear localStorage keys related to onboarding)
  const handleResetOnboarding = () => {
    // Clear onboarding-related localStorage keys
    localStorage.removeItem("onboarding:billing-method")
    localStorage.removeItem("onboarding:anthropic-completed")
    localStorage.removeItem("onboarding:api-key-completed")
    localStorage.removeItem("onboarding:litellm-completed")
    toast.success(t('debug.toast.onboardingReset'))
    setTimeout(() => window.location.reload(), 500)
  }

  const openFolderMutation = trpc.debug.openUserDataFolder.useMutation({
    onError: (error) => toast.error(error.message),
  })

  const handleCopyPath = async () => {
    if (systemInfo?.userDataPath) {
      await navigator.clipboard.writeText(systemInfo.userDataPath)
      setCopiedPath(true)
      setTimeout(() => setCopiedPath(false), 2000)
    }
  }

  const handleCopyDebugInfo = async () => {
    const info = {
      ...systemInfo,
      dbStats,
      timestamp: new Date().toISOString(),
    }
    await navigator.clipboard.writeText(JSON.stringify(info, null, 2))
    setCopiedInfo(true)
    toast.success(t('debug.toast.debugInfoCopied'))
    setTimeout(() => setCopiedInfo(false), 2000)
  }

  const handleOpenDevTools = () => {
    window.desktopApi?.toggleDevTools()
  }

  const handleReactScanToggle = async (enabled: boolean) => {
    if (!isDev) return

    setReactScanLoading(true)
    try {
      if (enabled) {
        await loadReactScan()
        localStorage.setItem(REACT_SCAN_STORAGE_KEY, "true")
        setReactScanEnabled(true)
        toast.success(t('debug.toast.reactScanEnabled'), {
          description: t('debug.toast.reactScanEnabledDesc'),
        })
      } else {
        unloadReactScan()
        localStorage.removeItem(REACT_SCAN_STORAGE_KEY)
        setReactScanEnabled(false)
        toast.success(t('debug.toast.reactScanDisabled'), {
          description: t('debug.toast.reactScanDisabledDesc'),
        })
      }
    } catch (error) {
      toast.error("Failed to toggle React Scan")
      console.error(error)
    } finally {
      setReactScanLoading(false)
    }
  }

  // Initialize React Scan state from localStorage (dev only)
  useEffect(() => {
    if (isDev && localStorage.getItem(REACT_SCAN_STORAGE_KEY) === "true") {
      loadReactScan()
        .then(() => setReactScanEnabled(true))
        .catch(console.error)
    }
  }, [isDev])

  const isLoading = isLoadingSystem || isLoadingDb

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header - hidden on narrow screens since it's in the navigation bar */}
      {!isNarrowScreen && (
        <div>
          <h3 className="text-lg font-semibold mb-1">{t('debug.title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('debug.description')}
          </p>
        </div>
      )}

      {/* System Info */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {t('debug.systemInfo.title')}
        </h4>
        <div className="rounded-lg border bg-muted/30 divide-y">
          <InfoRow label={t('debug.systemInfo.version')} value={systemInfo?.version} isLoading={isLoading} />
          <InfoRow
            label={t('debug.systemInfo.platform')}
            value={systemInfo ? `${systemInfo.platform} (${systemInfo.arch})` : undefined}
            isLoading={isLoading}
          />
          <InfoRow
            label={t('debug.systemInfo.devMode')}
            value={systemInfo?.isDev ? t('debug.systemInfo.yes') : t('debug.systemInfo.no')}
            isLoading={isLoading}
          />
          <InfoRow
            label={t('debug.systemInfo.protocol')}
            value={systemInfo?.protocolRegistered ? t('debug.systemInfo.registered') : t('debug.systemInfo.notRegistered')}
            isLoading={isLoading}
            status={systemInfo?.protocolRegistered ? "success" : "warning"}
          />
          <div className="flex items-center justify-between p-3">
            <span className="text-sm text-muted-foreground">{t('debug.systemInfo.userData')}</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono truncate max-w-[200px]">
                {isLoading ? "..." : systemInfo?.userDataPath}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleCopyPath}
                disabled={!systemInfo?.userDataPath}
              >
                {copiedPath ? (
                  <Check className="h-3 w-3 text-green-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* DB Stats */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {t('debug.database.title')}
        </h4>
        <div className="rounded-lg border bg-muted/30 divide-y">
          <InfoRow label={t('debug.database.projects')} value={dbStats?.projects?.toString()} isLoading={isLoading} />
          <InfoRow label={t('debug.database.chats')} value={dbStats?.chats?.toString()} isLoading={isLoading} />
          <InfoRow label={t('debug.database.subChats')} value={dbStats?.subChats?.toString()} isLoading={isLoading} />
        </div>
      </div>

      {/* Developer Tools (dev mode only) */}
      {isDev && (
        <div className="flex flex-col gap-3">
          <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            {t('debug.devTools.title')}
          </h4>
          <div className="rounded-lg border bg-muted/30 divide-y">
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2">
                <Scan className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm">{t('debug.devTools.reactScan')}</span>
                  <p className="text-xs text-muted-foreground">
                    {t('debug.devTools.reactScanDesc')}
                  </p>
                </div>
              </div>
              <Switch
                checked={reactScanEnabled}
                onCheckedChange={handleReactScanToggle}
                disabled={reactScanLoading}
              />
            </div>
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2">
                <WifiOff className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm">{t('debug.devTools.simulateOffline')}</span>
                  <p className="text-xs text-muted-foreground">
                    {t('debug.devTools.simulateOfflineDesc')}
                  </p>
                </div>
              </div>
              <Switch
                checked={offlineSimulation?.enabled ?? false}
                onCheckedChange={(enabled) =>
                  setOfflineSimulationMutation.mutate({ enabled })
                }
                disabled={setOfflineSimulationMutation.isPending}
              />
            </div>
            <div className="flex items-center justify-between p-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm">{t('debug.devTools.copyProductionDb')}</span>
                  <p className="text-xs text-muted-foreground">
                    {t('debug.devTools.copyProductionDbDesc')}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm(t('debug.devTools.confirmCopyProductionDb'))) {
                    copyProductionDbMutation.mutate()
                  }
                }}
                disabled={copyProductionDbMutation.isPending}
              >
                {copyProductionDbMutation.isPending ? "..." : t('debug.devTools.copyButton')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Simulated Runtime Installation (dev mode only) */}
      {isDev && (
        <SimulatedInstallSection />
      )}

      {/* Quick Actions */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {t('debug.quickActions.title')}
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openFolderMutation.mutate()}
            disabled={openFolderMutation.isPending}
          >
            <FolderOpen className="h-4 w-4 mr-2" />
            {t('debug.quickActions.openUserData')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleOpenDevTools}>
            <Terminal className="h-4 w-4 mr-2" />
            {t('debug.quickActions.devTools')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('debug.quickActions.reload')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyDebugInfo}
            disabled={isLoading}
          >
            {copiedInfo ? (
              <Check className="h-4 w-4 mr-2 text-green-500" />
            ) : (
              <Copy className="h-4 w-4 mr-2" />
            )}
            {t('debug.quickActions.copyInfo')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRuntimeBannerDismissed(false)
              toast.success(t('debug.quickActions.runtimeInitTriggered'))
            }}
          >
            <Play className="h-4 w-4 mr-2" />
            {t('debug.quickActions.retriggerRuntimeInit')}
          </Button>
        </div>
      </div>

      {/* Toast Testing */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {t('debug.toastTesting.title')}
        </h4>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              toast.info("Cancelation sent", {
                description: "Sent to John Smith",
                action: {
                  label: "Undo",
                  onClick: () => toast("Undone!"),
                },
              })
            }
          >
            {t('debug.toastTesting.infoUndo')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.success("Success!", { description: "Operation completed" })}
          >
            {t('debug.toastTesting.success')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.error("Error", { description: "Something went wrong" })}
          >
            {t('debug.toastTesting.error')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => toast("Default toast", { description: "This is a description" })}
          >
            {t('debug.toastTesting.default')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const id = toast.loading("Loading...", { description: "Please wait" })
              setTimeout(() => toast.dismiss(id), 3000)
            }}
          >
            {t('debug.toastTesting.loading')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const id = toast.loading("Processing...")
              setTimeout(() => {
                toast.success("Done!", { id })
              }, 2000)
            }}
          >
            {t('debug.toastTesting.promise')}
          </Button>
        </div>
      </div>

      {/* Memory Sync */}
      <MemorySyncSection />

      {/* Data Management */}
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          {t('debug.dataManagement.title')}
        </h4>
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm(t('debug.dataManagement.confirmClearChats'))) {
                clearChatsMutation.mutate()
              }
            }}
            disabled={clearChatsMutation.isPending}
          >
            {clearChatsMutation.isPending ? "..." : t('debug.dataManagement.clearChats')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (confirm(t('debug.dataManagement.confirmResetOnboarding'))) {
                handleResetOnboarding()
              }
            }}
          >
            {t('debug.dataManagement.resetOnboarding')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (
                confirm(t('debug.dataManagement.confirmResetAll'))
              ) {
                clearAllDataMutation.mutate()
              }
            }}
            disabled={clearAllDataMutation.isPending}
          >
            {clearAllDataMutation.isPending ? "..." : t('debug.dataManagement.resetAll')}
          </Button>
        </div>
        {/* Factory Reset - Nuclear option */}
        <div className="mt-4 pt-4 border-t">
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => {
              if (
                confirm(t('debug.dataManagement.confirmFactoryReset'))
              ) {
                // Clear localStorage first
                localStorage.clear()
                // Then trigger factory reset which will navigate to login
                factoryResetMutation.mutate()
              }
            }}
            disabled={factoryResetMutation.isPending}
          >
            {factoryResetMutation.isPending ? "..." : t('debug.dataManagement.factoryReset')}
          </Button>
          <p className="text-xs text-muted-foreground mt-2 text-center">
            {t('debug.dataManagement.factoryResetDesc')}
          </p>
        </div>
      </div>
    </div>
  )
}

// Memory Sync Section
function MemorySyncSection() {
  const { t } = useTranslation("settings")
  const [lastResult, setLastResult] = useState<{
    synced: number
    skipped: number
    failed: number
    total: number
  } | null>(null)

  const syncMutation = trpc.memory.syncAllHistoricalData.useMutation({
    onSuccess: (data) => {
      setLastResult(data)
      toast.success("Memory sync completed", {
        description: `Synced: ${data.synced}, Skipped: ${data.skipped}, Failed: ${data.failed}`,
      })
    },
    onError: (error) => {
      toast.error(`Sync failed: ${error.message}`)
    },
  })

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        Memory Sync
      </h4>
      <div className="rounded-lg border bg-muted/30 p-4 flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Brain className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium">Sync Historical Data</p>
            <p className="text-xs text-muted-foreground mt-1">
              Sync all historical chat sessions to memory database.
              Already synced sessions will be skipped (deduplication).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
          >
            {syncMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Syncing...
              </>
            ) : (
              <>
                <Database className="mr-2 h-4 w-4" />
                Sync All Historical Data
              </>
            )}
          </Button>

          {lastResult && (
            <div className="text-xs text-muted-foreground">
              <span className="text-green-500">+{lastResult.synced}</span>
              {" / "}
              <span className="text-yellow-500">{lastResult.skipped} skipped</span>
              {lastResult.failed > 0 && (
                <>
                  {" / "}
                  <span className="text-red-500">{lastResult.failed} failed</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Simulated Runtime Installation Section
function SimulatedInstallSection() {
  const { t } = useTranslation("settings")
  const [injectError, setInjectError] = useState<"none" | "detection" | "download" | "install" | "timeout">("none")
  const logContainerRef = useRef<HTMLDivElement>(null)
  const setSimulatedMode = useSetAtom(runtimeSimulatedModeAtom)

  // Query for current state
  const { data: installState, refetch } = trpc.debug.getSimulatedInstallState.useQuery(undefined, {
    refetchInterval: (query) => {
      // Poll more frequently when running
      return query.state.data?.isRunning ? 500 : false
    },
  })

  // Mutations
  const startMutation = trpc.debug.startSimulatedInstall.useMutation({
    onSuccess: () => {
      toast.info(t("debug.simulatedInstall.started"))
      setSimulatedMode(true) // Enable simulated mode for RuntimeInitBanner
      refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  const resetMutation = trpc.debug.resetSimulatedInstall.useMutation({
    onSuccess: () => {
      toast.success(t("debug.simulatedInstall.reset"))
      setSimulatedMode(false) // Disable simulated mode
      refetch()
    },
    onError: (error) => toast.error(error.message),
  })

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [installState?.logs])

  const isRunning = installState?.isRunning ?? false
  const progress = installState?.progress ?? 0
  const currentStep = installState?.currentStep ?? ""
  const error = installState?.error
  const logs = installState?.logs ?? []

  const getStepLabel = (step: string) => {
    const labels: Record<string, string> = {
      initializing: t("debug.simulatedInstall.steps.initializing"),
      detecting: t("debug.simulatedInstall.steps.detecting"),
      checking: t("debug.simulatedInstall.steps.checking"),
      downloading: t("debug.simulatedInstall.steps.downloading"),
      installing: t("debug.simulatedInstall.steps.installing"),
      verifying: t("debug.simulatedInstall.steps.verifying"),
      complete: t("debug.simulatedInstall.steps.complete"),
      error: t("debug.simulatedInstall.steps.error"),
    }
    return labels[step] || step
  }

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
        {t("debug.simulatedInstall.title")}
      </h4>
      <div className="rounded-lg border bg-muted/30 p-4 flex flex-col gap-4">
        {/* Controls */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground mb-1 block">
              {t("debug.simulatedInstall.injectError")}
            </label>
            <Select
              value={injectError}
              onValueChange={(v) => setInjectError(v as typeof injectError)}
              disabled={isRunning}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("debug.simulatedInstall.errors.none")}</SelectItem>
                <SelectItem value="detection">{t("debug.simulatedInstall.errors.detection")}</SelectItem>
                <SelectItem value="download">{t("debug.simulatedInstall.errors.download")}</SelectItem>
                <SelectItem value="install">{t("debug.simulatedInstall.errors.install")}</SelectItem>
                <SelectItem value="timeout">{t("debug.simulatedInstall.errors.timeout")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => startMutation.mutate({ injectError })}
              disabled={isRunning || startMutation.isPending}
            >
              {isRunning ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              {t("debug.simulatedInstall.start")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => resetMutation.mutate()}
              disabled={isRunning}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("debug.simulatedInstall.resetButton")}
            </Button>
          </div>
        </div>

        {/* Progress */}
        {(isRunning || logs.length > 0) && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5">
                {currentStep === "complete" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                ) : currentStep === "error" ? (
                  <AlertCircle className="h-3.5 w-3.5 text-destructive" />
                ) : isRunning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : null}
                {getStepLabel(currentStep)}
              </span>
              <span className="font-mono">{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
            {error}
          </div>
        )}

        {/* Log output */}
        {logs.length > 0 && (
          <div
            ref={logContainerRef}
            className="bg-background border rounded-md p-3 h-48 overflow-y-auto font-mono text-xs leading-relaxed"
          >
            {logs.map((log, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap ${
                  log.includes("❌") ? "text-destructive" :
                  log.includes("✅") ? "text-green-600 dark:text-green-400" :
                  log.includes("⚠️") ? "text-yellow-600 dark:text-yellow-400" :
                  "text-muted-foreground"
                }`}
              >
                {log}
              </div>
            ))}
          </div>
        )}

        {/* Description */}
        <p className="text-xs text-muted-foreground">
          {t("debug.simulatedInstall.description")}
        </p>
      </div>
    </div>
  )
}

// Helper component for info rows
function InfoRow({
  label,
  value,
  isLoading,
  status,
}: {
  label: string
  value?: string
  isLoading?: boolean
  status?: "success" | "warning" | "error"
}) {
  return (
    <div className="flex items-center justify-between p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`text-sm font-medium ${
          status === "success"
            ? "text-green-500"
            : status === "warning"
              ? "text-yellow-500"
              : status === "error"
                ? "text-red-500"
                : ""
        }`}
      >
        {isLoading ? "..." : value ?? "-"}
      </span>
    </div>
  )
}
