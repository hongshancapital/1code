/**
 * Marketplace View Component
 *
 * Browse and install plugins from configured marketplaces.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { useListKeyboardNav } from "./use-list-keyboard-nav"
import { settingsPluginsSidebarWidthAtom } from "../../../features/agents/atoms"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import {
  Download,
  RefreshCw,
  Settings2,
  Check,
  Loader2,
  ExternalLink,
  Store,
} from "lucide-react"
import { PluginFilledIcon } from "../../ui/icons"
import { Button } from "../../ui/button"
import { Label } from "../../ui/label"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select"
import { toast } from "sonner"
import { ManageMarketplacesDialog } from "../manage-marketplaces-dialog"

/** Format plugin name: "pyright-lsp" → "Pyright Lsp" */
function formatPluginName(name: string): string {
  return name
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

interface AvailablePlugin {
  name: string
  version?: string
  description?: string
  category?: string
  homepage?: string
  tags?: string[]
  sourcePath: string
  marketplaceName: string
  isInstalled: boolean
  installedVersion?: string
}

// --- Plugin Detail Panel ---
function AvailablePluginDetail({
  plugin,
  onInstall,
  onUninstall,
  isInstalling,
  t,
}: {
  plugin: AvailablePlugin
  onInstall: () => void
  onUninstall: () => void
  isInstalling: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Top bar with action button */}
      <div className="flex items-center justify-end px-6 py-3 shrink-0">
        {plugin.isInstalled ? (
          <Button
            variant="destructive"
            size="sm"
            onClick={onUninstall}
            disabled={isInstalling}
          >
            {isInstalling ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : null}
            {t("marketplace.uninstall")}
          </Button>
        ) : (
          <Button variant="default" size="sm" onClick={onInstall} disabled={isInstalling}>
            {isInstalling ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            {t("marketplace.install")}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
          {/* Name & category */}
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {formatPluginName(plugin.name)}
            </h3>
            {plugin.category && (
              <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                {plugin.category}
              </p>
            )}
          </div>

          {/* Description */}
          {plugin.description && (
            <p className="text-sm text-muted-foreground">{plugin.description}</p>
          )}

          {/* Info */}
          <div className="flex flex-col gap-3">
            {plugin.version && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("marketplace.detail.version")}</Label>
                <p className="text-sm text-foreground font-mono">{plugin.version}</p>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label>{t("marketplace.detail.marketplace")}</Label>
              <p className="text-sm text-foreground font-mono">
                {plugin.marketplaceName}
              </p>
            </div>
            {plugin.homepage && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("marketplace.detail.homepage")}</Label>
                <a
                  href={plugin.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-blue-400 hover:underline break-all"
                >
                  {plugin.homepage}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
            )}
            {plugin.tags && plugin.tags.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("marketplace.detail.tags")}</Label>
                <div className="flex flex-wrap gap-1">
                  {plugin.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {plugin.isInstalled && plugin.installedVersion && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("marketplace.detail.installedVersion")}</Label>
                <p className="text-sm text-foreground font-mono">
                  {plugin.installedVersion}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Sidebar list item ---
function AvailablePluginListItem({
  plugin,
  isSelected,
  onSelect,
}: {
  plugin: AvailablePlugin
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const id = `${plugin.name}@${plugin.marketplaceName}`
  return (
    <button
      data-item-id={id}
      onClick={() => onSelect(id)}
      className={cn(
        "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
        isSelected
          ? "bg-foreground/5 text-foreground"
          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-sm leading-tight truncate flex-1">
          {formatPluginName(plugin.name)}
        </span>
        {plugin.isInstalled && (
          <Check className="h-3 w-3 text-emerald-500 shrink-0" />
        )}
      </div>
      {plugin.description && (
        <div className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
          {plugin.description}
        </div>
      )}
    </button>
  )
}

// --- Main Component ---
export function MarketplaceView() {
  const { t } = useTranslation("settings")
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null)
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [showManageDialog, setShowManageDialog] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Focus search on "/" hotkey
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [])

  // Queries
  const { data: marketplaces = [], isLoading: loadingMarketplaces } =
    trpc.marketplace.listMarketplaces.useQuery()

  const { data: plugins = [], isLoading: loadingPlugins, refetch: refetchPlugins } =
    trpc.marketplace.listAvailablePlugins.useQuery(
      selectedMarketplace !== "all" ? { marketplace: selectedMarketplace } : undefined
    )

  const installMutation = trpc.marketplace.installPlugin.useMutation()
  const uninstallMutation = trpc.marketplace.uninstallPlugin.useMutation()

  // Utils ref for refetching installed plugins list
  const utils = trpc.useUtils()

  // Filter plugins by search
  const filteredPlugins = useMemo(() => {
    if (!searchQuery.trim()) return plugins
    const q = searchQuery.toLowerCase()
    const qNoDashes = q.replace(/-/g, " ")
    const qWithDashes = q.replace(/ /g, "-")
    return plugins.filter((p) => {
      const name = p.name.toLowerCase()
      if (
        name.includes(q) ||
        name.includes(qNoDashes) ||
        name.includes(qWithDashes)
      )
        return true
      if (p.description?.toLowerCase().includes(q)) return true
      if (p.category?.toLowerCase().includes(q)) return true
      if (p.tags?.some((t) => t.toLowerCase().includes(q))) return true
      return false
    })
  }, [plugins, searchQuery])

  // Group by marketplace
  const marketplaceGroups = useMemo(() => {
    const groups = new Map<string, AvailablePlugin[]>()
    for (const plugin of filteredPlugins) {
      const existing = groups.get(plugin.marketplaceName) || []
      existing.push(plugin)
      groups.set(plugin.marketplaceName, existing)
    }
    // Sort: official marketplaces first, then alphabetically
    return Array.from(groups.entries()).sort(([a], [b]) => {
      const aOfficial = marketplaces?.some((m) => m.name === a && m.isOfficial)
      const bOfficial = marketplaces?.some((m) => m.name === b && m.isOfficial)
      if (aOfficial && !bOfficial) return -1
      if (!aOfficial && bOfficial) return 1
      return a.localeCompare(b)
    })
  }, [filteredPlugins, marketplaces])

  const allPluginIds = useMemo(
    () => marketplaceGroups.flatMap(([, plugins]) =>
      plugins.map((p) => `${p.name}@${p.marketplaceName}`)
    ),
    [marketplaceGroups]
  )

  const { containerRef: listRef, onKeyDown: listKeyDown } = useListKeyboardNav({
    items: allPluginIds,
    selectedItem: selectedPluginId,
    onSelect: setSelectedPluginId,
  })

  const selectedPlugin = useMemo(() => {
    if (!selectedPluginId) return null
    return plugins.find(
      (p) => `${p.name}@${p.marketplaceName}` === selectedPluginId
    )
  }, [plugins, selectedPluginId])

  // Auto-select first plugin
  useEffect(() => {
    if (selectedPluginId || loadingPlugins || plugins.length === 0) return
    const first = marketplaceGroups[0]?.[1]?.[0]
    if (first) setSelectedPluginId(`${first.name}@${first.marketplaceName}`)
  }, [plugins, selectedPluginId, loadingPlugins, marketplaceGroups])

  const handleInstall = useCallback(
    async (plugin: AvailablePlugin) => {
      try {
        await installMutation.mutateAsync({
          pluginName: plugin.name,
          marketplaceName: plugin.marketplaceName,
        })
        toast.success(t("marketplace.toast.installed"), {
          description: formatPluginName(plugin.name),
        })
        await refetchPlugins()
        // Also invalidate installed plugins list
        await utils.plugins.list.invalidate()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("marketplace.toast.installFailed")
        )
      }
    },
    [installMutation, refetchPlugins, utils, t]
  )

  const handleUninstall = useCallback(
    async (plugin: AvailablePlugin) => {
      try {
        await uninstallMutation.mutateAsync({
          pluginSource: `${plugin.name}@${plugin.marketplaceName}`,
        })
        toast.success(t("marketplace.toast.uninstalled"), {
          description: formatPluginName(plugin.name),
        })
        await refetchPlugins()
        await utils.plugins.list.invalidate()
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : t("marketplace.toast.uninstallFailed")
        )
      }
    },
    [uninstallMutation, refetchPlugins, utils, t]
  )

  const isLoading = loadingMarketplaces || loadingPlugins
  const hasNoMarketplaces = !loadingMarketplaces && marketplaces.length === 0

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar - marketplace selector + plugin list */}
      <ResizableSidebar
        isOpen={true}
        onClose={() => {}}
        widthAtom={settingsPluginsSidebarWidthAtom}
        minWidth={200}
        maxWidth={400}
        side="left"
        animationDuration={0}
        initialWidth={240}
        exitWidth={240}
        disableClickToClose={true}
      >
        <div
          className="flex flex-col h-full bg-background border-r overflow-hidden"
          style={{ borderRightWidth: "0.5px" }}
        >
          {/* Marketplace selector */}
          <div className="px-2 pt-2 shrink-0 flex items-center gap-1.5">
            <Select value={selectedMarketplace} onValueChange={setSelectedMarketplace}>
              <SelectTrigger className="h-7 text-xs flex-1 focus:ring-0 focus:ring-offset-0 min-w-0 [&>span:first-child]:truncate">
                <SelectValue placeholder={t("marketplace.selectMarketplace")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("marketplace.allMarketplaces")}</SelectItem>
                {marketplaces.map((m) => (
                  <SelectItem key={m.name} value={m.name}>
                    <span className="flex items-center gap-1">
                      <span className="truncate">{m.name}</span>
                      {m.isOfficial && <span className="shrink-0">★</span>}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setShowManageDialog(true)}
              title={t("marketplace.manage.title")}
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Search */}
          <div className="px-2 pt-1.5 shrink-0">
            <input
              ref={searchInputRef}
              placeholder={t("marketplace.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={listKeyDown}
              className="h-7 w-full rounded-lg text-sm bg-muted border border-input px-3 placeholder:text-muted-foreground/40 outline-hidden"
            />
          </div>

          {/* Plugin list */}
          <div
            ref={listRef}
            onKeyDown={listKeyDown}
            tabIndex={-1}
            className="flex-1 overflow-y-auto px-2 pt-2 pb-2 outline-hidden"
          >
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : hasNoMarketplaces ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <Store className="h-8 w-8 text-border mb-3" />
                <p className="text-sm text-muted-foreground mb-1">
                  {t("marketplace.noMarketplaces")}
                </p>
                <p className="text-[11px] text-muted-foreground/70 mb-3">
                  {t("marketplace.addMarketplaceHint")}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowManageDialog(true)}
                >
                  {t("marketplace.addMarketplace")}
                </Button>
              </div>
            ) : filteredPlugins.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">
                  {t("marketplace.noPlugins")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {marketplaceGroups.map(([marketplace, groupPlugins]) => (
                  <div key={marketplace}>
                    <p className="sticky top-0 z-10 text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 py-1.5 mb-1 bg-muted/80 backdrop-blur-sm rounded-md">
                      {marketplace}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {groupPlugins.map((plugin) => (
                        <AvailablePluginListItem
                          key={`${plugin.name}@${plugin.marketplaceName}`}
                          plugin={plugin}
                          isSelected={
                            selectedPluginId ===
                            `${plugin.name}@${plugin.marketplaceName}`
                          }
                          onSelect={setSelectedPluginId}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ResizableSidebar>

      {/* Right content - detail panel */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {selectedPlugin ? (
          <AvailablePluginDetail
            plugin={selectedPlugin}
            onInstall={() => handleInstall(selectedPlugin)}
            onUninstall={() => handleUninstall(selectedPlugin)}
            isInstalling={
              installMutation.isPending || uninstallMutation.isPending
            }
            t={t}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <PluginFilledIcon className="h-12 w-12 text-border mb-4" />
            <p className="text-sm text-muted-foreground">
              {plugins.length > 0
                ? t("marketplace.selectToView")
                : t("marketplace.noPluginsAvailable")}
            </p>
          </div>
        )}
      </div>

      {/* Manage marketplaces dialog */}
      <ManageMarketplacesDialog
        open={showManageDialog}
        onOpenChange={setShowManageDialog}
      />
    </div>
  )
}
