import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Loader2, RefreshCw, User } from "lucide-react"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { UsageDetailsDialog } from "./usage-details-dialog"
import {
  agentsSettingsDialogOpenAtom,
  anthropicOnboardingCompletedAtom,
  autoOfflineModeAtom,
  billingMethodAtom,
  customClaudeConfigAtom,
  openaiApiKeyAtom,
  showOfflineModeFeaturesAtom,
  overrideModelModeAtom,
  litellmSelectedModelAtom,
  type CustomClaudeConfig,
} from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Switch } from "../../ui/switch"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/tooltip"
import { cn } from "../../../lib/utils"

// Authentication method type: null = OAuth, "litellm", "custom"
type AuthMethod = "oauth" | "litellm" | "custom"

// OAuth Section - shows account connection status
function OAuthSection() {
  const { t } = useTranslation('settings')
  const { data: activeAccount, isLoading } = trpc.anthropicAccounts.getActive.useQuery()
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)

  const handleConnect = () => {
    setSettingsOpen(false)
    setBillingMethod("claude-subscription")  // 设置 billingMethod 以触发 onboarding 页面
    setAnthropicOnboardingCompleted(false)
  }

  if (isLoading) {
    return (
      <div className="mt-3 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-sm">{t('models.auth.oauth.checking')}</span>
      </div>
    )
  }

  if (activeAccount) {
    return (
      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-md mt-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div>
            <div className="text-sm font-medium">
              {activeAccount.displayName || activeAccount.email || t('models.auth.oauth.title')}
            </div>
            <div className="text-xs text-muted-foreground">{t('models.auth.oauth.connected')}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open("https://claude.ai/settings/usage", "_blank")}
            className="text-muted-foreground"
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            {t('models.usage.viewDetails')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleConnect}>
            {t('models.auth.oauth.reconnect')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3">
      <Button onClick={handleConnect} className="w-full">
        {t('models.auth.oauth.connect')}
      </Button>
    </div>
  )
}

// LiteLLM Section - model selector
function LiteLLMSection() {
  const { t } = useTranslation('settings')
  const [litellmSelectedModel, setLitellmSelectedModel] = useAtom(litellmSelectedModelAtom)
  const { data: litellmConfig } = trpc.litellm.getConfig.useQuery()
  const { data: litellmModelsData, isLoading: isLoadingModels, refetch: refetchModels } = trpc.litellm.getModels.useQuery(undefined, {
    enabled: litellmConfig?.available === true,
  })

  const litellmModels = litellmModelsData?.models || []

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-2">
        <Label className="text-xs text-muted-foreground">{t('models.auth.litellm.selectModel')}</Label>
        <button
          onClick={() => refetchModels()}
          disabled={isLoadingModels}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          title="Refresh model list"
        >
          <RefreshCw className={cn("w-3 h-3", isLoadingModels && "animate-spin")} />
        </button>
      </div>
      {isLoadingModels ? (
        <div className="flex items-center justify-center h-9 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin mr-2" />
          {t('models.auth.litellm.loading')}
        </div>
      ) : litellmModels.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center justify-between w-full h-9 px-3 rounded-md border border-input bg-transparent text-sm focus:outline-hidden focus:ring-1 focus:ring-ring"
            >
              <span className={cn(!litellmSelectedModel && "text-muted-foreground")}>
                {litellmSelectedModel || t('models.auth.litellm.selectPlaceholder')}
              </span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-full max-h-64 overflow-y-auto">
            {litellmModels.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onClick={() => {
                  setLitellmSelectedModel(m.id)
                  toast.success(`Model set to ${m.id}`)
                }}
                className={cn(litellmSelectedModel === m.id && "bg-accent")}
              >
                <span className="truncate">{m.id}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="text-sm text-muted-foreground p-2 bg-muted/30 rounded">
          {litellmModelsData?.error || t('models.auth.litellm.noModels')}
        </div>
      )}
    </div>
  )
}

// Custom API Section - manual configuration
function CustomAPISection() {
  const { t } = useTranslation('settings')
  const [storedConfig, setStoredConfig] = useAtom(customClaudeConfigAtom)
  const [model, setModel] = useState(storedConfig.model)
  const [baseUrl, setBaseUrl] = useState(storedConfig.baseUrl)
  const [token, setToken] = useState(storedConfig.token)

  const savedConfigRef = useRef(storedConfig)

  // Sync from storage
  useEffect(() => {
    setModel(storedConfig.model)
    setBaseUrl(storedConfig.baseUrl)
    setToken(storedConfig.token)
  }, [storedConfig.model, storedConfig.baseUrl, storedConfig.token])

  const handleBlurSave = useCallback(() => {
    const trimmedModel = model.trim()
    const trimmedBaseUrl = baseUrl.trim()
    const trimmedToken = token.trim()

    if (trimmedModel && trimmedBaseUrl && trimmedToken) {
      const next: CustomClaudeConfig = {
        model: trimmedModel,
        token: trimmedToken,
        baseUrl: trimmedBaseUrl,
      }
      if (
        next.model !== savedConfigRef.current.model ||
        next.token !== savedConfigRef.current.token ||
        next.baseUrl !== savedConfigRef.current.baseUrl
      ) {
        setStoredConfig(next)
        savedConfigRef.current = next
      }
    } else if (!trimmedModel && !trimmedBaseUrl && !trimmedToken) {
      const EMPTY_CONFIG = { model: "", token: "", baseUrl: "" }
      if (savedConfigRef.current.model || savedConfigRef.current.token || savedConfigRef.current.baseUrl) {
        setStoredConfig(EMPTY_CONFIG)
        savedConfigRef.current = EMPTY_CONFIG
      }
    }
  }, [model, baseUrl, token, setStoredConfig])

  return (
    <div className="mt-3 space-y-3">
      <div>
        <Label className="text-xs text-muted-foreground">{t('models.auth.custom.baseUrl')}</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onBlur={handleBlurSave}
          placeholder="https://api.anthropic.com"
          className="mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t('models.auth.custom.apiToken')}</Label>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onBlur={handleBlurSave}
          placeholder="sk-ant-..."
          className="mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">{t('models.auth.custom.model')}</Label>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          onBlur={handleBlurSave}
          placeholder="claude-sonnet-4-20250514"
          className="mt-1"
        />
      </div>
    </div>
  )
}

// Auth Method Card component
function AuthMethodCard({
  title,
  description,
  isSelected,
  onSelect,
  children,
  disabled,
  disabledReason,
}: {
  id:string
  title: string
  description: string
  isSelected: boolean
  onSelect: () => void
  children?: React.ReactNode
  disabled?: boolean
  disabledReason?: string
}) {
  return (
    <div
      className={cn(
        "relative rounded-lg border p-4 transition-colors cursor-pointer",
        isSelected
          ? "border-primary bg-primary/5"
          : disabled
            ? "border-border bg-muted/20 cursor-not-allowed opacity-60"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
      )}
      onClick={() => !disabled && onSelect()}
    >
      <div className="flex items-start gap-3">
        {/* Radio indicator */}
        <div
          className={cn(
            "mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
            isSelected
              ? "border-primary bg-primary"
              : disabled
                ? "border-muted-foreground/30"
                : "border-muted-foreground/50"
          )}
        >
          {isSelected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn("font-medium text-sm", disabled && "text-muted-foreground")}>
              {title}
            </span>
            {disabled && disabledReason && (
              <span className="text-xs text-muted-foreground">({disabledReason})</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>

          {/* Expanded content when selected */}
          {isSelected && children}
        </div>
      </div>
    </div>
  )
}

// Helper to format token count
function formatTokenCount(tokens: number): string {
  if (!tokens) return "0"
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
  return String(tokens)
}

// Helper to format cost
function formatCost(cost: number): string {
  if (!cost) return "$0.00"
  return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`
}

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

// GitHub-style contribution heatmap component (auto-fit width with navigation)
function ContributionHeatmap() {
  const { t } = useTranslation('settings')
  const { data: activity } = trpc.usage.getDailyActivity.useQuery()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [numWeeks, setNumWeeks] = useState(20) // Default, will be calculated
  const [pageOffset, setPageOffset] = useState(0) // 0 = current, 1 = previous page, etc.
  const [slideDirection, setSlideDirection] = useState<"left" | "right" | null>(null)

  // Calculate how many weeks fit in the container
  useEffect(() => {
    const calculateWeeks = () => {
      if (!containerRef.current) return
      const containerWidth = containerRef.current.offsetWidth
      // Each week column: 10px cell + 2px gap = 12px
      const cellSize = 10
      const gap = 2
      const weekWidth = cellSize + gap
      const availableWidth = containerWidth - 8 // Small padding
      const weeks = Math.floor(availableWidth / weekWidth)
      setNumWeeks(Math.max(weeks, 4)) // Minimum 4 weeks
    }

    calculateWeeks()
    window.addEventListener("resize", calculateWeeks)
    return () => window.removeEventListener("resize", calculateWeeks)
  }, [])

  // Reset slide direction after animation
  useEffect(() => {
    if (slideDirection) {
      const timer = setTimeout(() => setSlideDirection(null), 300)
      return () => clearTimeout(timer)
    }
  }, [slideDirection])

  // Build activity map for quick lookup
  const activityMap = new Map<string, { count: number; totalTokens: number; totalCostUsd: number }>()
  activity?.forEach((d) => {
    activityMap.set(d.date, { count: d.count, totalTokens: d.totalTokens, totalCostUsd: d.totalCostUsd || 0 })
  })

  // Generate days based on calculated weeks and page offset
  const today = new Date()
  const days: { date: string; count: number; totalTokens: number; totalCostUsd: number }[] = []

  // Calculate end date based on page offset
  const endDate = new Date(today)
  endDate.setDate(endDate.getDate() - pageOffset * numWeeks * 7)

  // Calculate start date: go back numWeeks weeks from endDate, align to Sunday
  const daysToGoBack = (numWeeks - 1) * 7 + endDate.getDay()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - daysToGoBack)

  for (let i = 0; i <= daysToGoBack + (6 - endDate.getDay()); i++) {
    const d = new Date(startDate)
    d.setDate(d.getDate() + i)
    if (d > endDate || d > today) break

    const dateStr = d.toISOString().split("T")[0]!
    const data = activityMap.get(dateStr)
    days.push({
      date: dateStr,
      count: data?.count || 0,
      totalTokens: data?.totalTokens || 0,
      totalCostUsd: data?.totalCostUsd || 0,
    })
  }

  // Cost-based color scaling: $200 as max threshold
  const MAX_COST_THRESHOLD = 200
  const EASTER_EGG_THRESHOLD = 1000

  // Get color intensity based on cost (0-4 levels, with easter egg at 5)
  const getLevel = (cost: number): number => {
    if (cost === 0) return 0
    if (cost >= EASTER_EGG_THRESHOLD) return 5 // Easter egg level
    const ratio = cost / MAX_COST_THRESHOLD
    if (ratio <= 0.25) return 1
    if (ratio <= 0.5) return 2
    if (ratio <= 0.75) return 3
    return 4
  }

  // Colors for each level (GitHub green theme, with special easter egg)
  const levelColors = [
    "bg-muted/30", // level 0 - no activity
    "bg-emerald-900/50", // level 1
    "bg-emerald-700/70", // level 2
    "bg-emerald-500/80", // level 3
    "bg-emerald-400", // level 4
  ]

  // Easter egg emojis for $1000+ days
  const easterEggEmojis = ["🔥", "💸", "🤯", "💰", "🚀", "⚡", "🌟", "💎"]
  const getEasterEggEmoji = (date: string): string => {
    // Use date string to deterministically pick an emoji
    const hash = date.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return easterEggEmojis[hash % easterEggEmojis.length]!
  }

  // Group days into weeks (columns)
  const weeks: typeof days[] = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7))
  }

  // Month labels - show at most every 4 weeks to avoid crowding
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const monthLabels: { label: string; weekIndex: number }[] = []
  let lastMonth = -1
  weeks.forEach((week, weekIndex) => {
    const firstDay = week[0]
    if (firstDay) {
      const month = new Date(firstDay.date).getMonth()
      if (month !== lastMonth) {
        // Only add label if there's enough space from the last one
        const lastLabel = monthLabels[monthLabels.length - 1]
        if (!lastLabel || weekIndex - lastLabel.weekIndex >= 3) {
          monthLabels.push({ label: months[month]!, weekIndex })
        }
        lastMonth = month
      }
    }
  })

  // Calculate total contributions for this view
  const totalContributions = days.reduce((sum, d) => sum + d.count, 0)

  // Check if there's older data available (max ~52 weeks back)
  const maxPages = Math.floor(52 / Math.max(numWeeks, 1))
  const canGoBack = pageOffset < maxPages
  const canGoForward = pageOffset > 0

  // Navigation handlers with slide animation
  const goBack = () => {
    if (canGoBack) {
      setSlideDirection("right")
      setPageOffset((p) => p + 1)
    }
  }

  const goForward = () => {
    if (canGoForward) {
      setSlideDirection("left")
      setPageOffset((p) => p - 1)
    }
  }

  // Slide animation classes
  const getSlideClass = () => {
    if (!slideDirection) return ""
    return slideDirection === "left"
      ? "animate-slide-in-left"
      : "animate-slide-in-right"
  }

  return (
    <div ref={containerRef} className="space-y-1">
      {/* Inline styles for slide animations */}
      <style>{`
        @keyframes slideInLeft {
          from { transform: translateX(30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(-30px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-left { animation: slideInLeft 0.25s ease-out; }
        .animate-slide-in-right { animation: slideInRight 0.25s ease-out; }
      `}</style>

      {/* Header with navigation */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{totalContributions.toLocaleString()} {t('models.usage.contributions')}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={goBack}
            disabled={!canGoBack}
            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="View older"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[140px] text-center text-[10px]">
            {days[0]?.date} ~ {days[days.length - 1]?.date}
          </span>
          <button
            onClick={goForward}
            disabled={!canGoForward}
            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="View newer"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative overflow-hidden">
        {/* Month labels */}
        <div className={`flex text-[10px] text-muted-foreground mb-1 h-3 ${getSlideClass()}`}>
          {monthLabels.map((m, i) => (
            <div
              key={i}
              className="absolute"
              style={{ left: `${m.weekIndex * 12}px` }}
            >
              {m.label}
            </div>
          ))}
        </div>

        {/* Grid with slide animation */}
        <TooltipProvider delayDuration={100}>
          <div className={`flex gap-[2px] ${getSlideClass()}`} key={pageOffset}>
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-[2px]">
                {[0, 1, 2, 3, 4, 5, 6].map((dayIndex) => {
                  const day = week[dayIndex]
                  if (!day) return <div key={dayIndex} className="w-[10px] h-[10px]" />

                  const level = getLevel(day.totalCostUsd)
                  const isEasterEgg = level === 5
                  const hasActivity = level > 0

                  // No tooltip for empty days
                  if (!hasActivity) {
                    return (
                      <div
                        key={dayIndex}
                        className={`w-[10px] h-[10px] rounded-[2px] ${levelColors[0]} cursor-default`}
                      />
                    )
                  }

                  const tooltipContent = (
                    <div className="space-y-0.5">
                      <div className="font-medium">{day.date}</div>
                      <div>{day.count} {t('models.usage.requests')}</div>
                      <div>{formatTokenCount(day.totalTokens)} {t('models.usage.tokens')}</div>
                      <div>{formatCost(day.totalCostUsd)}{isEasterEgg ? " 🎉" : ""}</div>
                    </div>
                  )

                  if (isEasterEgg) {
                    return (
                      <Tooltip key={dayIndex}>
                        <TooltipTrigger asChild>
                          <div className="w-[10px] h-[10px] rounded-[2px] flex items-center justify-center cursor-default transition-transform hover:scale-150">
                            <span className="text-[8px] leading-none">{getEasterEggEmoji(day.date)}</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="pointer-events-none">{tooltipContent}</TooltipContent>
                      </Tooltip>
                    )
                  }

                  return (
                    <Tooltip key={dayIndex}>
                      <TooltipTrigger asChild>
                        <div
                          className={`w-[10px] h-[10px] rounded-[2px] ${levelColors[level]} cursor-default transition-colors hover:ring-1 hover:ring-foreground/30`}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="pointer-events-none">{tooltipContent}</TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            ))}
          </div>
        </TooltipProvider>

        {/* Legend */}
        <div className="flex items-center justify-end gap-1 mt-1 text-[10px] text-muted-foreground">
          <span>Less</span>
          {levelColors.map((color, i) => (
            <div key={i} className={`w-[10px] h-[10px] rounded-[2px] ${color}`} />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  )
}

// Usage Statistics Section component
function UsageStatisticsSection({ onViewDetails }: { onViewDetails: () => void }) {
  const { t } = useTranslation('settings')
  const { data: summary, isLoading } = trpc.usage.getSummary.useQuery()

  if (isLoading) {
    return (
      <div className="bg-background rounded-lg border border-border p-4 text-center text-sm text-muted-foreground">
        {t('models.usage.loading')}
      </div>
    )
  }

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="p-4 space-y-4">
        {/* Contribution Heatmap - at top */}
        <ContributionHeatmap />

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">{t('models.usage.today')}</div>
            <div className="text-lg font-semibold">
              {formatTokenCount(summary?.today?.totalTokens || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCost(summary?.today?.totalCostUsd || 0)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">{t('models.usage.week')}</div>
            <div className="text-lg font-semibold">
              {formatTokenCount(summary?.week?.totalTokens || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCost(summary?.week?.totalCostUsd || 0)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">{t('models.usage.month')}</div>
            <div className="text-lg font-semibold">
              {formatTokenCount(summary?.month?.totalTokens || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCost(summary?.month?.totalCostUsd || 0)}
            </div>
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground mb-1">{t('models.usage.allTime')}</div>
            <div className="text-lg font-semibold">
              {formatTokenCount(summary?.total?.totalTokens || 0)}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatCost(summary?.total?.totalCostUsd || 0)}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-muted p-3 rounded-b-lg flex justify-end border-t">
        <Button size="sm" variant="outline" onClick={onViewDetails}>
          <BarChart3 className="h-3 w-3 mr-1" />
          {t('models.usage.viewDetails')}
        </Button>
      </div>
    </div>
  )
}

export function AgentsModelsTab() {
  const { t } = useTranslation('settings')
  // Override mode state: null = OAuth, "litellm", "custom"
  const [overrideMode, setOverrideMode] = useAtom(overrideModelModeAtom)
  const [litellmSelectedModel, setLitellmSelectedModel] = useAtom(litellmSelectedModelAtom)

  const [autoOffline, setAutoOffline] = useAtom(autoOfflineModeAtom)
  const [usageDetailsOpen, setUsageDetailsOpen] = useState(false)
  const isNarrowScreen = useIsNarrowScreen()

  // Get Ollama status
  const { data: ollamaStatus } = trpc.ollama.getStatus.useQuery(undefined, {
    refetchInterval: 30000, // Refresh every 30s
  })

  // Check if offline features should be visible (debug flag)
  const showOfflineFeatures = useAtomValue(showOfflineModeFeaturesAtom)

  // OpenAI API key state
  const [storedOpenAIKey, setStoredOpenAIKey] = useAtom(openaiApiKeyAtom)
  const [openaiKey, setOpenaiKey] = useState(storedOpenAIKey)
  const setOpenAIKeyMutation = trpc.voice.setOpenAIKey.useMutation()
  const trpcUtils = trpc.useUtils()

  // LiteLLM config from backend (env-based)
  const { data: litellmConfig } = trpc.litellm.getConfig.useQuery()
  const { data: litellmModelsData } = trpc.litellm.getModels.useQuery(undefined, {
    enabled: litellmConfig?.available === true,
  })

  const litellmAvailable = litellmConfig?.available === true

  // Convert overrideMode to authMethod for UI
  const authMethod: AuthMethod = overrideMode === null ? "oauth" : overrideMode as AuthMethod

  // Handle auth method change
  const handleAuthMethodChange = (method: AuthMethod) => {
    const newMode = method === "oauth" ? null : method
    setOverrideMode(newMode)
    if (method === "oauth") {
      toast.success("Using Anthropic Account")
    } else if (method === "litellm") {
      toast.success("Using LiteLLM Proxy")
    } else {
      toast.success("Using Custom API")
    }
  }

  // Auto-select default model if LiteLLM and no model selected
  useEffect(() => {
    if (overrideMode === "litellm" && litellmModelsData?.defaultModel && !litellmSelectedModel) {
      setLitellmSelectedModel(litellmModelsData.defaultModel)
    }
  }, [overrideMode, litellmModelsData?.defaultModel, litellmSelectedModel, setLitellmSelectedModel])

  useEffect(() => {
    setOpenaiKey(storedOpenAIKey)
  }, [storedOpenAIKey])

  // OpenAI key handlers
  const trimmedOpenAIKey = openaiKey.trim()
  const canResetOpenAI = !!trimmedOpenAIKey

  const handleSaveOpenAI = async () => {
    if (trimmedOpenAIKey === storedOpenAIKey) return // No change
    if (trimmedOpenAIKey && !trimmedOpenAIKey.startsWith("sk-")) {
      toast.error("Invalid OpenAI API key format. Key should start with 'sk-'")
      return
    }

    try {
      await setOpenAIKeyMutation.mutateAsync({ key: trimmedOpenAIKey })
      setStoredOpenAIKey(trimmedOpenAIKey)
      // Invalidate voice availability check
      await trpcUtils.voice.isAvailable.invalidate()
      toast.success("OpenAI API key saved")
    } catch {
      toast.error("Failed to save OpenAI API key")
    }
  }

  const handleResetOpenAI = async () => {
    try {
      await setOpenAIKeyMutation.mutateAsync({ key: "" })
      setStoredOpenAIKey("")
      setOpenaiKey("")
      await trpcUtils.voice.isAvailable.invalidate()
      toast.success("OpenAI API key removed")
    } catch {
      toast.error("Failed to remove OpenAI API key")
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header - hidden on narrow screens since it's in the navigation bar */}
      {!isNarrowScreen && (
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">{t('models.title')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('models.description')}
          </p>
        </div>
      )}

      {/* Offline Mode Section - only show if debug flag enabled */}
      {showOfflineFeatures && (
        <div className="space-y-2">
          <div className="pb-2">
            <h4 className="text-sm font-medium text-foreground">{t('models.offline.title')}</h4>
          </div>

          <div className="bg-background rounded-lg border border-border overflow-hidden">
            <div className="p-4 space-y-4">
              {/* Status */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {t('models.offline.ollamaStatus.title')}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {ollamaStatus?.ollama.available
                      ? `${t('models.offline.ollamaStatus.running')} - ${t('models.offline.ollamaStatus.modelsInstalled', { count: ollamaStatus.ollama.models.length })}`
                      : t('models.offline.ollamaStatus.notRunning')}
                  </p>
                  {ollamaStatus?.ollama.recommendedModel && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('models.offline.ollamaStatus.recommended', { model: ollamaStatus.ollama.recommendedModel })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {ollamaStatus?.ollama.available ? (
                    <span className="text-green-600 text-sm font-medium">● {t('models.offline.ollamaStatus.available')}</span>
                  ) : (
                    <span className="text-muted-foreground text-sm">○ {t('models.offline.ollamaStatus.unavailable')}</span>
                  )}
                </div>
              </div>

              {/* Auto-fallback toggle */}
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1">
                  <span className="text-sm font-medium text-foreground">
                    {t('models.offline.autoOffline.title')}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {t('models.offline.autoOffline.description')}
                  </p>
                </div>
                <Switch
                  checked={autoOffline}
                  onCheckedChange={setAutoOffline}
                />
              </div>

              {/* Info message */}
              {!ollamaStatus?.ollama.available && (
                <div className="text-xs text-muted-foreground bg-muted p-3 rounded">
                  <p className="font-medium mb-1">{t('models.offline.setupInstructions.title')}</p>
                  <ol className="list-decimal list-inside space-y-1 ml-2">
                    <li>{t('models.offline.setupInstructions.step1')} <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" className="underline">ollama.com</a></li>
                    <li>{t('models.offline.setupInstructions.step2')} <code className="bg-background px-1 py-0.5 rounded">ollama pull qwen2.5-coder:7b</code></li>
                    <li>{t('models.offline.setupInstructions.step3')}</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Authentication Method Section - Three options */}
      <div className="space-y-3">
        {/* OAuth Option */}
        <AuthMethodCard
          id="oauth"
          title={t('models.auth.oauth.title')}
          description={t('models.auth.oauth.description')}
          isSelected={authMethod === "oauth"}
          onSelect={() => handleAuthMethodChange("oauth")}
        >
          <OAuthSection />
        </AuthMethodCard>

        {/* LiteLLM Option */}
        <AuthMethodCard
          id="litellm"
          title={t('models.auth.litellm.title')}
          description={t('models.auth.litellm.description')}
          isSelected={authMethod === "litellm"}
          onSelect={() => handleAuthMethodChange("litellm")}
          disabled={!litellmAvailable}
          disabledReason={t('models.auth.litellm.notConfigured')}
        >
          <LiteLLMSection />
        </AuthMethodCard>

        {/* Custom API Option */}
        <AuthMethodCard
          id="custom"
          title={t('models.auth.custom.title')}
          description={t('models.auth.custom.description')}
          isSelected={authMethod === "custom"}
          onSelect={() => handleAuthMethodChange("custom")}
        >
          <CustomAPISection />
        </AuthMethodCard>
      </div>

      {/* Usage Statistics Section */}
      <div className="space-y-2">
        <div className="pb-2">
          <h4 className="text-sm font-medium text-foreground">
            {t('models.usage.title')}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t('models.usage.description')}
          </p>
        </div>

        <UsageStatisticsSection onViewDetails={() => setUsageDetailsOpen(true)} />
      </div>

      {/* OpenAI API Key for Voice Input */}
      <div className="space-y-2">
        <div className="pb-2 flex items-center justify-between">
          <h4 className="text-sm font-medium text-foreground">{t('models.voice.title')}</h4>
          {canResetOpenAI && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetOpenAI}
              disabled={setOpenAIKeyMutation.isPending}
              className="text-muted-foreground hover:text-red-600 hover:bg-red-500/10"
            >
              {t('models.voice.openaiKey.remove')}
            </Button>
          )}
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between gap-6 p-4">
            <div className="flex-1">
              <Label className="text-sm font-medium">{t('models.voice.openaiKey.title')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('models.voice.openaiKey.description')}
              </p>
            </div>
            <div className="shrink-0 w-80">
              <Input
                type="password"
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                onBlur={handleSaveOpenAI}
                className="w-full"
                placeholder="sk-..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Usage Details Dialog */}
      <UsageDetailsDialog
        open={usageDetailsOpen}
        onOpenChange={setUsageDetailsOpen}
      />
    </div>
  )
}
