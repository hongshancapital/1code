import { useState, useEffect } from "react"
import { useAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import { trpc } from "../../../lib/trpc"
import { toast } from "sonner"
import { Copy, FolderOpen, RefreshCw, Terminal, Check, Scan, WifiOff, FileJson, Database } from "lucide-react"
import { showMessageJsonAtom } from "../../../features/agents/atoms"

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
  const [showMessageJson, setShowMessageJson] = useAtom(showMessageJsonAtom)
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
                <FileJson className="h-4 w-4 text-muted-foreground" />
                <div>
                  <span className="text-sm">{t('debug.devTools.showMessageJson')}</span>
                  <p className="text-xs text-muted-foreground">
                    {t('debug.devTools.showMessageJsonDesc')}
                  </p>
                </div>
              </div>
              <Switch
                checked={showMessageJson}
                onCheckedChange={setShowMessageJson}
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
