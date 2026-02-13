/**
 * Browser Toolbar Component
 * Navigation controls and URL input with history dropdown
 */

import { useState, useCallback, KeyboardEvent, useRef, useMemo, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { useAtom } from "jotai"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Switch } from "@/components/ui/switch"
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Globe,
  X,
  ChevronDown,
  ExternalLink,
  Camera,
  Trash2,
  History,
  Shield,
  Cookie,
  Lock,
  Bug,
  MousePointer2,
  Terminal,
  ChevronRight,
  Settings2,
  Monitor,
  Code2,
  Search,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
} from "lucide-react"
import {
  projectBrowserHistoryAtomFamily,
  browserDevModeAtomFamily,
  browserTerminalVisibleAtomFamily,
  browserSelectorActiveAtomFamily,
  browserDevicePresetAtomFamily,
  browserSearchEngineAtom,
  browserZoomAtomFamily,
  ZOOM_FIT,
  isZoomFitMode,
  DEVICE_PRESETS,
  SEARCH_ENGINES,
  type BrowserHistoryEntry,
} from "./atoms"
import { cn } from "@/lib/utils"
import { CertificateDialog } from "./certificate-dialog"

/** Check if input looks like a URL (not a search query) */
function isLikelyUrl(input: string): boolean {
  const trimmed = input.trim()
  // Has protocol
  if (/^https?:\/\//i.test(trimmed)) return true
  // localhost or IP
  if (/^(localhost|127\.0\.0\.1|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?(\/|$)/i.test(trimmed)) return true
  // Has a dot followed by a valid TLD-like segment, no spaces
  if (!trimmed.includes(" ") && /^[^\s]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return true
  return false
}

interface BrowserToolbarProps {
  url: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  projectId: string
  chatId: string
  title?: string
  favicon?: string
  devToolsOpen?: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
  onStop: () => void
  onNavigate: (url: string) => void
  onOpenExternal: () => void
  onScreenshot: () => void
  onClearCache: () => void
  onToggleDevTools: () => void
  onToggleReactGrab: () => void
  zoomLevel: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomReset: () => void
  onFitWidth: () => void
  onZoomSet: (level: number) => void
  fitMode?: boolean
}

export function BrowserToolbar({
  url,
  isLoading,
  canGoBack,
  canGoForward,
  projectId,
  chatId,
  title,
  favicon,
  devToolsOpen,
  onBack,
  onForward,
  onReload,
  onStop,
  onNavigate,
  onOpenExternal,
  onScreenshot,
  onClearCache,
  onToggleDevTools,
  onToggleReactGrab,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onFitWidth,
  onZoomSet,
  fitMode,
}: BrowserToolbarProps) {
  const { t } = useTranslation("common")
  const [inputValue, setInputValue] = useState(url)
  const [isFocused, setIsFocused] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [siteInfoOpen, setSiteInfoOpen] = useState(false)
  const [certDialogOpen, setCertDialogOpen] = useState(false)
  const [history, setHistory] = useAtom(projectBrowserHistoryAtomFamily(projectId))
  const [devMode, setDevMode] = useAtom(browserDevModeAtomFamily(chatId))
  const [terminalVisible, setTerminalVisible] = useAtom(browserTerminalVisibleAtomFamily(chatId))
  const [selectorActive] = useAtom(browserSelectorActiveAtomFamily(chatId))
  const [devicePresetId, setDevicePresetId] = useAtom(browserDevicePresetAtomFamily(chatId))
  const [searchEngineId, setSearchEngineId] = useAtom(browserSearchEngineAtom)
  const currentDevice = DEVICE_PRESETS.find(d => d.id === devicePresetId) || DEVICE_PRESETS[0]
  const currentSearchEngine = SEARCH_ENGINES.find(e => e.id === searchEngineId) || SEARCH_ENGINES[0]
  const inputRef = useRef<HTMLInputElement>(null)
  const inputContainerRef = useRef<HTMLDivElement>(null)
  // Autocomplete state
  const [autocompleteOpen, setAutocompleteOpen] = useState(false)
  const [selectedAutocompleteIndex, setSelectedAutocompleteIndex] = useState(-1)
  // Track favicon load errors per URL to show fallback
  const [faviconError, setFaviconError] = useState(false)
  // Track failed favicons in history by URL
  const [failedHistoryFavicons, setFailedHistoryFavicons] = useState<Set<string>>(new Set())
  // Reset favicon error when favicon URL changes
  const prevFaviconRef = useRef(favicon)
  if (favicon !== prevFaviconRef.current) {
    prevFaviconRef.current = favicon
    setFaviconError(false)
  }

  // Check if current URL is HTTPS
  const isHttps = url?.startsWith("https://")
  const hasValidUrl = url && url !== "about:blank"

  // Update input when URL changes (but not while editing)
  if (!isFocused && inputValue !== url) {
    setInputValue(url)
  }

  // Filter history for autocomplete suggestions
  const autocompleteSuggestions = useMemo(() => {
    if (!isFocused || !inputValue.trim()) return []

    const query = inputValue.toLowerCase()
    return history
      .filter((entry) => {
        // Match against URL or title
        return (
          entry.url.toLowerCase().includes(query) ||
          (entry.title && entry.title.toLowerCase().includes(query))
        )
      })
      .slice(0, 8) // Limit suggestions
  }, [history, inputValue, isFocused])

  // Show/hide autocomplete
  useEffect(() => {
    if (isFocused && autocompleteSuggestions.length > 0) {
      setAutocompleteOpen(true)
    } else {
      setAutocompleteOpen(false)
    }
    setSelectedAutocompleteIndex(-1)
  }, [isFocused, autocompleteSuggestions.length])

  // Add to project history (deduplicates by normalized URL, updates timestamp)
  const addToProjectHistory = useCallback((entry: Omit<BrowserHistoryEntry, "visitedAt">) => {
    if (!entry.url || entry.url === "about:blank") return

    const normalizedNewUrl = normalizeUrlForHistory(entry.url)

    setHistory(prev => {
      // Find existing entry with same normalized URL
      const existingIndex = prev.findIndex(h => normalizeUrlForHistory(h.url) === normalizedNewUrl)

      if (existingIndex >= 0) {
        // Update existing entry: keep better title/favicon, update timestamp, move to top
        const existing = prev[existingIndex]
        const updated: BrowserHistoryEntry = {
          url: entry.url, // Use new URL (might have better casing)
          title: entry.title || existing.title, // Prefer new title if available
          favicon: entry.favicon || existing.favicon, // Prefer new favicon if available
          visitedAt: Date.now(),
        }
        const filtered = prev.filter((_, i) => i !== existingIndex)
        return [updated, ...filtered]
      }

      // Add new entry at the beginning
      const newHistory: BrowserHistoryEntry[] = [
        { ...entry, visitedAt: Date.now() },
        ...prev,
      ].slice(0, 50) // Limit to 50 entries
      return newHistory
    })
  }, [setHistory])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    // Handle autocomplete navigation
    if (autocompleteOpen && autocompleteSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setSelectedAutocompleteIndex((prev) =>
          prev < autocompleteSuggestions.length - 1 ? prev + 1 : prev
        )
        return
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setSelectedAutocompleteIndex((prev) => (prev > 0 ? prev - 1 : -1))
        return
      }
      if (e.key === "Enter" && !e.nativeEvent.isComposing && selectedAutocompleteIndex >= 0) {
        e.preventDefault()
        const selected = autocompleteSuggestions[selectedAutocompleteIndex]
        if (selected) {
          setInputValue(selected.url)
          onNavigate(selected.url)
          setAutocompleteOpen(false)
          e.currentTarget.blur()
        }
        return
      }
    }

    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      const trimmed = inputValue.trim()
      if (!trimmed) return

      let targetUrl: string
      if (isLikelyUrl(trimmed)) {
        // Treat as URL
        targetUrl = trimmed.startsWith("http://") || trimmed.startsWith("https://")
          ? trimmed
          : `https://${trimmed}`
      } else {
        // Treat as search query
        targetUrl = currentSearchEngine.urlTemplate.replace("{query}", encodeURIComponent(trimmed))
      }

      addToProjectHistory({ url: targetUrl, title: "", favicon: "" })
      onNavigate(targetUrl)
      setAutocompleteOpen(false)
      e.currentTarget.blur()
    }
    if (e.key === "Escape") {
      if (autocompleteOpen) {
        setAutocompleteOpen(false)
      } else {
        setInputValue(url)
        e.currentTarget.blur()
      }
    }
  }, [inputValue, url, onNavigate, addToProjectHistory, autocompleteOpen, autocompleteSuggestions, selectedAutocompleteIndex, currentSearchEngine])

  const handleBlur = useCallback(() => {
    // Delay to allow clicking on autocomplete items
    setTimeout(() => {
      setIsFocused(false)
      setAutocompleteOpen(false)
      // Reset to current URL if not submitted
      setInputValue(url)
    }, 150)
  }, [url])

  // Delete single history entry
  const deleteHistoryEntry = useCallback((urlToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setHistory(prev => prev.filter(h => h.url !== urlToDelete))
  }, [setHistory])

  // Clear all history
  const clearHistory = useCallback(() => {
    setHistory([])
  }, [setHistory])

  // Navigate to history entry
  const navigateToHistory = useCallback((historyUrl: string) => {
    onNavigate(historyUrl)
    setHistoryOpen(false)
  }, [onNavigate])

  // Select autocomplete suggestion
  const selectAutocompleteSuggestion = useCallback((suggestion: BrowserHistoryEntry) => {
    setInputValue(suggestion.url)
    onNavigate(suggestion.url)
    setAutocompleteOpen(false)
    setIsFocused(false)
  }, [onNavigate])

  // Format URL for display (shorten if needed)
  const formatUrl = (urlStr: string) => {
    try {
      const u = new URL(urlStr)
      return u.hostname + (u.pathname !== "/" ? u.pathname : "")
    } catch {
      return urlStr
    }
  }

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)

    if (minutes < 1) return t("browser.history.justNow")
    if (minutes < 60) return t("browser.history.minutesAgo", { count: minutes })
    if (hours < 24) return t("browser.history.hoursAgo", { count: hours })
    return t("browser.history.daysAgo", { count: days })
  }

  return (
    <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/30">
      {/* Navigation buttons */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canGoBack}
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("browser.toolbar.back")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={!canGoForward}
            onClick={onForward}
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("browser.toolbar.forward")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={isLoading ? onStop : onReload}
          >
            {isLoading ? (
              <X className="h-4 w-4" />
            ) : (
              <RotateCw className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isLoading ? t("browser.toolbar.stop") : t("browser.toolbar.reload")}
        </TooltipContent>
      </Tooltip>

      {/* URL Input with Settings and History Dropdown */}
      <div ref={inputContainerRef} className="flex-1 relative flex items-center">
        {/* Settings Dropdown - organized menu */}
        <DropdownMenu open={siteInfoOpen} onOpenChange={setSiteInfoOpen}>
          <DropdownMenuTrigger asChild>
            <button
              className="absolute left-1.5 top-1/2 -translate-y-1/2 z-10 p-0.5 rounded hover:bg-foreground/10 transition-colors cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="w-72">
            {/* Site title */}
            <div className="px-2 py-1.5 border-b border-border/50">
              <div className="flex items-center gap-2">
                {favicon && !faviconError ? (
                  <img
                    src={favicon}
                    alt=""
                    className="w-4 h-4 shrink-0"
                    onError={() => setFaviconError(true)}
                  />
                ) : (
                  <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
                <span className="text-sm font-medium truncate">
                  {title || (hasValidUrl ? new URL(url).hostname : t("browser.siteInfo.noSite"))}
                </span>
              </div>
            </div>

            {/* 1. 链接证书 / Certificate */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <Lock className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="flex-1">证书</span>
                {isHttps ? (
                  <Lock className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Shield className="w-3.5 h-3.5 text-yellow-500" />
                )}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {isHttps ? (
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      setSiteInfoOpen(false)
                      setCertDialogOpen(true)
                    }}
                  >
                    <Lock className="w-4 h-4 mr-2 text-green-500" />
                    <span className="flex-1">{t("browser.siteInfo.connectionSecure")}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50" />
                  </DropdownMenuItem>
                ) : (
                  <div className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      {hasValidUrl ? (
                        <>
                          <Shield className="w-4 h-4 text-yellow-500" />
                          <span className="text-muted-foreground text-sm">{t("browser.siteInfo.connectionNotSecure")}</span>
                        </>
                      ) : (
                        <>
                          <Globe className="w-4 h-4 text-muted-foreground" />
                          <span className="text-muted-foreground text-sm">{t("browser.siteInfo.noConnection")}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* 2. 搜索引擎 / Search Engine */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <Search className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="flex-1">搜索引擎</span>
                <span className="text-muted-foreground/60 mr-1">
                  {currentSearchEngine.name}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={searchEngineId} onValueChange={setSearchEngineId}>
                  {SEARCH_ENGINES.map((engine) => (
                    <DropdownMenuRadioItem key={engine.id} value={engine.id} className="cursor-pointer">
                      {engine.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            {/* 3. 设备模拟 / Device Emulation */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <Monitor className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="flex-1">设备模拟</span>
                <span className="text-muted-foreground/60 mr-1">
                  {currentDevice.id === "responsive" ? t("browser.device.responsive") : currentDevice.name}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                <DropdownMenuRadioGroup value={devicePresetId} onValueChange={setDevicePresetId}>
                  {/* Responsive */}
                  <DropdownMenuRadioItem value="responsive" className="cursor-pointer">
                    <span className="flex-1">{t("browser.device.responsive")}</span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {/* Mobile */}
                  <DropdownMenuLabel className="text-muted-foreground/60 font-normal">
                    {t("browser.device.mobile")}
                  </DropdownMenuLabel>
                  {DEVICE_PRESETS.filter(d => d.isMobile && d.width < 500).map((device) => (
                    <DropdownMenuRadioItem key={device.id} value={device.id} className="cursor-pointer">
                      <span className="flex-1">{device.name}</span>
                      <span className="text-muted-foreground/60">{device.width}×{device.height}</span>
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuSeparator />
                  {/* Tablet */}
                  <DropdownMenuLabel className="text-muted-foreground/60 font-normal">
                    {t("browser.device.tablet")}
                  </DropdownMenuLabel>
                  {DEVICE_PRESETS.filter(d => d.isMobile && d.width >= 500).map((device) => (
                    <DropdownMenuRadioItem key={device.id} value={device.id} className="cursor-pointer">
                      <span className="flex-1">{device.name}</span>
                      <span className="text-muted-foreground/60">{device.width}×{device.height}</span>
                    </DropdownMenuRadioItem>
                  ))}
                  <DropdownMenuSeparator />
                  {/* Desktop */}
                  <DropdownMenuLabel className="text-muted-foreground/60 font-normal">
                    {t("browser.device.desktop")}
                  </DropdownMenuLabel>
                  {DEVICE_PRESETS.filter(d => !d.isMobile && d.id !== "responsive").map((device) => (
                    <DropdownMenuRadioItem key={device.id} value={device.id} className="cursor-pointer">
                      <span className="flex-1">{device.name}</span>
                      <span className="text-muted-foreground/60">{device.width}×{device.height}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* 4. 缩放 / Zoom */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <Maximize2 className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="flex-1">缩放</span>
                <span className="text-muted-foreground/60 mr-1">
                  {isZoomFitMode(zoomLevel) ? "自动" : `${Math.round(zoomLevel * 100)}%`}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {/* Zoom control row */}
                <div className="flex items-center gap-1 px-3 py-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
                        onClick={onZoomOut}
                        disabled={zoomLevel <= 0.05}
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>缩小</TooltipContent>
                  </Tooltip>

                  <button
                    className="flex-1 h-8 items-center justify-center rounded bg-muted/50 hover:bg-accent transition-colors text-sm font-medium tabular-nums cursor-pointer"
                    onClick={onZoomReset}
                  >
                    {isZoomFitMode(zoomLevel) ? "自动" : `${Math.round(zoomLevel * 100)}%`}
                  </button>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="h-8 w-8 flex items-center justify-center rounded hover:bg-accent transition-colors"
                        onClick={onZoomIn}
                        disabled={zoomLevel >= 5.0}
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>放大</TooltipContent>
                  </Tooltip>
                </div>

                {/* Fit width toggle button */}
                <div className="px-3 py-2">
                  <button
                    className={cn(
                      "w-full h-8 flex items-center justify-center gap-2 rounded transition-colors text-sm cursor-pointer",
                      fitMode ? "bg-primary text-primary-foreground" : "hover:bg-accent text-muted-foreground hover:text-foreground"
                    )}
                    onClick={onFitWidth}
                  >
                    <Maximize2 className="w-4 h-4" />
                    {fitMode ? "自动适应" : "最佳适应"}
                  </button>
                </div>

                {/* Zoom range hint */}
                <div className="px-3 py-1 text-xs text-muted-foreground/60 text-center">
                  缩放范围：5% - 500%
                </div>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuSeparator />

            {/* 5. 开发者功能 / Developer Mode */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="cursor-pointer">
                <Code2 className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="flex-1">开发者功能</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onSelect={(e) => e.preventDefault()}
                >
                  <Code2 className="w-4 h-4 mr-2 text-muted-foreground" />
                  <span className="flex-1">{t("browser.devMode.label")}</span>
                  <Switch
                    checked={devMode}
                    onCheckedChange={setDevMode}
                    className="scale-75"
                  />
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onClearCache}
                  className="cursor-pointer"
                >
                  <Cookie className="w-4 h-4 mr-2 text-muted-foreground" />
                  {t("browser.siteInfo.clearCache")}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        <Input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={handleBlur}
          placeholder={t("browser.toolbar.searchOrUrl", `Search ${currentSearchEngine.name} or enter URL...`)}
          className="h-7 pl-7 pr-8 text-xs focus-visible:ring-1 focus-visible:ring-offset-0"
        />

        {/* Autocomplete dropdown */}
        {autocompleteOpen && autocompleteSuggestions.length > 0 && (
          <div
            className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md z-50 overflow-hidden"
          >
            {autocompleteSuggestions.map((suggestion, index) => (
              <div
                key={suggestion.url}
                className={cn(
                  "flex items-center gap-2 px-2 py-1.5 cursor-pointer text-sm",
                  "hover:bg-accent",
                  index === selectedAutocompleteIndex && "bg-accent"
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectAutocompleteSuggestion(suggestion)
                }}
                onMouseEnter={() => setSelectedAutocompleteIndex(index)}
              >
                {suggestion.favicon && !failedHistoryFavicons.has(suggestion.url) ? (
                  <img
                    src={suggestion.favicon}
                    alt=""
                    className="w-4 h-4 shrink-0"
                    onError={() => {
                      setFailedHistoryFavicons(prev => new Set(prev).add(suggestion.url))
                    }}
                  />
                ) : (
                  <Globe className="w-4 h-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0 overflow-hidden">
                  <div className="truncate">
                    {suggestion.title || formatUrl(suggestion.url)}
                  </div>
                  {suggestion.title && (
                    <div className="text-xs text-muted-foreground truncate">
                      {formatUrl(suggestion.url)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Zoom indicator inside address bar - only show when not 100% */}
        {(zoomLevel !== 1.0 || fitMode) && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className="absolute right-7 top-1/2 -translate-y-1/2 z-10 px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  >
                    {fitMode ? "自动" : `${Math.round(zoomLevel * 100)}%`}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">缩放设置</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" sideOffset={4} className="w-48">
              {/* Zoom control row */}
              <div className="flex items-center gap-1 px-2 py-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent transition-colors"
                      onClick={onZoomOut}
                      disabled={zoomLevel <= 0.05}
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>缩小</TooltipContent>
                </Tooltip>

                <button
                  className="flex-1 h-7 items-center justify-center rounded bg-muted/50 hover:bg-accent transition-colors text-xs font-medium tabular-nums cursor-pointer"
                  onClick={onZoomReset}
                >
                  {fitMode ? "自动" : `${Math.round(zoomLevel * 100)}%`}
                </button>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-accent transition-colors"
                      onClick={onZoomIn}
                      disabled={zoomLevel >= 5.0}
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>放大</TooltipContent>
                </Tooltip>
              </div>

              <DropdownMenuSeparator />

              {/* Fit width toggle */}
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={onFitWidth}
              >
                <Maximize2 className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="flex-1">{fitMode ? "自动适应" : "最佳适应"}</span>
                {fitMode && <span className="text-xs text-primary">✓</span>}
              </DropdownMenuItem>

              {/* Reset to 100% */}
              <DropdownMenuItem
                className="cursor-pointer"
                onClick={onZoomReset}
              >
                <RotateCcw className="w-4 h-4 mr-2 text-muted-foreground" />
                <span className="flex-1">重置为 100%</span>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              {/* Zoom range hint */}
              <div className="px-2 py-1 text-[10px] text-muted-foreground/60 text-center">
                缩放范围：5% - 500%
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* History dropdown trigger */}
        <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 h-6 w-6 p-0 hover:bg-foreground/10"
                >
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("browser.history.title")}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent
            align="end"
            sideOffset={4}
            className="max-h-80 overflow-y-auto p-1"
            style={{ width: inputContainerRef.current?.offsetWidth || 300 }}
          >
            {history.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{t("browser.history.noHistory")}</p>
              </div>
            ) : (
              <>
                {history.map((entry) => (
                  <DropdownMenuItem
                    key={entry.url}
                    className="flex items-start gap-2 cursor-pointer group px-2 py-1.5"
                    onClick={() => navigateToHistory(entry.url)}
                  >
                    {entry.favicon && !failedHistoryFavicons.has(entry.url) ? (
                      <img
                        src={entry.favicon}
                        alt=""
                        className="w-4 h-4 shrink-0 mt-0.5"
                        onError={() => {
                          setFailedHistoryFavicons(prev => new Set(prev).add(entry.url))
                        }}
                      />
                    ) : (
                      <Globe className="w-4 h-4 shrink-0 text-muted-foreground mt-0.5" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate font-medium">
                        {entry.title || formatUrl(entry.url)}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="truncate">{formatUrl(entry.url)}</span>
                        <span className="text-muted-foreground/60 shrink-0">·</span>
                        <span className="text-muted-foreground/60 shrink-0">{formatTime(entry.visitedAt)}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={(e) => deleteHistoryEntry(entry.url, e)}
                    >
                      <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </DropdownMenuItem>
                ))}
                {/* Clear all - subtle style */}
                <div className="border-t border-border/50 mt-1 pt-1">
                  <button
                    className="w-full text-xs text-muted-foreground/60 hover:text-muted-foreground py-1 px-2 text-center transition-colors cursor-pointer"
                    onClick={clearHistory}
                  >
                    {t("browser.history.clearAll")}
                  </button>
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

      </div>

      {/* External tools */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onOpenExternal}
            disabled={!url || url === "about:blank"}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("browser.toolbar.openExternal")}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onScreenshot}
            disabled={!url || url === "about:blank"}
          >
            <Camera className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("browser.toolbar.screenshot")}</TooltipContent>
      </Tooltip>

      {/* Dev Mode Tools - only show when devMode is enabled */}
      {devMode && (
        <>
          <div className="w-px h-4 bg-border mx-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7",
                  devToolsOpen && "bg-primary/20 text-primary"
                )}
                onClick={onToggleDevTools}
                disabled={!url || url === "about:blank"}
              >
                <Bug className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("browser.toolbar.devTools")}</TooltipContent>
          </Tooltip>

          {/* Select Element button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-7 w-7",
                  selectorActive && "bg-primary/20 text-primary"
                )}
                onClick={onToggleReactGrab}
                disabled={!url || url === "about:blank"}
              >
                <MousePointer2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {selectorActive ? t("browser.toolbar.reactGrabCancel") : t("browser.toolbar.reactGrab")}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`h-7 w-7 ${terminalVisible ? "bg-accent" : ""}`}
                onClick={() => setTerminalVisible(!terminalVisible)}
              >
                <Terminal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("browser.toolbar.terminal")}</TooltipContent>
          </Tooltip>
        </>
      )}

      {/* Certificate Dialog */}
      <CertificateDialog
        open={certDialogOpen}
        onOpenChange={setCertDialogOpen}
        url={url}
        hostname={hasValidUrl ? new URL(url).hostname : ""}
      />
    </div>
  )
}

// Normalize URL for comparison
function normalizeUrlForHistory(urlStr: string): string {
  try {
    const u = new URL(urlStr)
    let normalized = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`
    if (normalized.endsWith("/") && normalized !== `${u.protocol}//${u.host.toLowerCase()}/`) {
      normalized = normalized.slice(0, -1)
    }
    normalized += u.search + u.hash
    return normalized
  } catch {
    return urlStr.toLowerCase()
  }
}

// Export helper to add to history from parent
export function useAddToProjectHistory(projectId: string) {
  const [, setHistory] = useAtom(projectBrowserHistoryAtomFamily(projectId))

  return useCallback((entry: Omit<BrowserHistoryEntry, "visitedAt">) => {
    if (!entry.url || entry.url === "about:blank") return

    const normalizedNewUrl = normalizeUrlForHistory(entry.url)

    setHistory(prev => {
      // Find existing entry with same normalized URL
      const existingIndex = prev.findIndex(h => normalizeUrlForHistory(h.url) === normalizedNewUrl)

      if (existingIndex >= 0) {
        // Update existing entry: keep better title/favicon, update timestamp, move to top
        const existing = prev[existingIndex]
        const updated: BrowserHistoryEntry = {
          url: entry.url,
          title: entry.title || existing.title,
          favicon: entry.favicon || existing.favicon,
          visitedAt: Date.now(),
        }
        const filtered = prev.filter((_, i) => i !== existingIndex)
        return [updated, ...filtered]
      }

      // Add new entry
      const newHistory: BrowserHistoryEntry[] = [
        { ...entry, visitedAt: Date.now() },
        ...prev,
      ].slice(0, 50)
      return newHistory
    })
  }, [setHistory])
}
