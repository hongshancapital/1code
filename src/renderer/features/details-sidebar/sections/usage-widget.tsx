"use client"

import { useEffect, useRef, useCallback, useState } from "react"
import { useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import { Activity, RefreshCw } from "lucide-react"
import { trpc } from "@/lib/trpc"
import { loadingSubChatsAtom } from "@/lib/atoms"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { createLogger } from "../../../lib/logger"

const usageWidgetLog = createLogger("UsageWidget")


// Types matching Anthropic API response
interface UsageLimit {
  utilization: number
  resets_at: string
}

interface AnthropicUsageData {
  five_hour: UsageLimit | null
  seven_day: UsageLimit | null
  seven_day_sonnet?: UsageLimit | null
  extra_usage?: {
    is_enabled: boolean
    monthly_limit: number | null
    used_credits: number | null
    utilization: number | null
  } | null
}

/**
 * Random interval between 5-10 minutes (non-regular for API friendliness)
 */
function getRandomInterval(): number {
  return (5 + Math.random() * 5) * 60 * 1000
}

/**
 * Format reset time as relative duration (locale-independent units)
 */
function formatResetTime(isoString: string, soon: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()

  if (diffMs <= 0) return soon

  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const remainingMins = diffMins % 60

  if (diffHours >= 24) {
    const days = Math.floor(diffHours / 24)
    const hrs = diffHours % 24
    return `${days}d ${hrs}h`
  }
  if (diffHours > 0) {
    return `${diffHours}h ${remainingMins}m`
  }
  return `${remainingMins}m`
}

/**
 * Format reset time as absolute local time
 */
function formatResetTimeAbsolute(isoString: string): string {
  const date = new Date(isoString)
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

/**
 * Get progress bar color class based on utilization percentage
 */
function getUtilizationColor(util: number): string {
  if (util >= 90) return "bg-red-500"
  if (util >= 70) return "bg-amber-500"
  return "bg-blue-500"
}

function getUtilizationTextColor(util: number): string {
  if (util >= 90) return "text-red-500"
  if (util >= 70) return "text-amber-500"
  return "text-muted-foreground"
}

/**
 * Single usage row: label + bar + percentage
 */
function UsageRow({ label, limit, t }: { label: string; limit: UsageLimit; t: (key: string, opts?: Record<string, string>) => string }) {
  const soon = t("details.usageWidget.soon")
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground w-5 text-right shrink-0">{label}</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", getUtilizationColor(limit.utilization))}
              style={{ width: `${Math.min(limit.utilization, 100)}%` }}
            />
          </div>
          <span className={cn("text-[11px] tabular-nums w-8 text-right shrink-0", getUtilizationTextColor(limit.utilization))}>
            {limit.utilization}%
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="left">
        <div className="text-xs">
          <div>{t("details.usageWidget.used", { percent: String(limit.utilization) })}</div>
          <div className="text-muted-foreground">
            {t("details.usageWidget.resetsAt", {
              time: formatResetTimeAbsolute(limit.resets_at),
              relative: formatResetTime(limit.resets_at, soon),
            })}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Usage Widget for Details Sidebar - shows Anthropic subscription usage.
 * Only renders when an Anthropic account is configured (regardless of current billing method).
 * Stops auto-refresh on API errors to avoid rate limiting.
 */
export function UsageWidget() {
  const { t } = useTranslation("sidebar")

  // Check if Anthropic account is configured
  const { data: activeAccount, isLoading: isLoadingAccount } = trpc.anthropicAccounts.getActive.useQuery()
  const hasAccount = !!activeAccount

  // Track if we encountered an error - stops auto-refresh
  const [hasError, setHasError] = useState(false)

  // tRPC query - manual refresh control
  const { data, refetch, isRefetching } = trpc.usage.getAnthropicUsage.useQuery(
    undefined,
    {
      enabled: hasAccount && !isLoadingAccount,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: false, // Don't retry on error
    }
  )

  // Check for errors and stop timer
  useEffect(() => {
    if (data?.error) {
      setHasError(true)
      usageWidgetLog.warn("API error, stopping auto-refresh:", data.error)
    }
  }, [data?.error])

  // Random interval timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleNextRefetch = useCallback(() => {
    // Don't schedule if there was an error
    if (hasError) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      refetch()
      scheduleNextRefetch()
    }, getRandomInterval())
  }, [refetch, hasError])

  useEffect(() => {
    if (!hasAccount || hasError) return
    scheduleNextRefetch()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [hasAccount, hasError, scheduleNextRefetch])

  // Watch for chat response completion (loadingSubChats size decrease)
  const loadingSubChats = useAtomValue(loadingSubChatsAtom)
  const prevLoadingSizeRef = useRef(loadingSubChats.size)

  useEffect(() => {
    // Don't trigger if there was an error
    if (hasError) return

    const prevSize = prevLoadingSizeRef.current
    const currentSize = loadingSubChats.size
    prevLoadingSizeRef.current = currentSize

    // A subchat finished streaming → refresh after short delay
    if (prevSize > 0 && currentSize < prevSize) {
      const timeout = setTimeout(() => {
        refetch()
        scheduleNextRefetch()
      }, 2000)
      return () => clearTimeout(timeout)
    }
  }, [loadingSubChats.size, refetch, scheduleNextRefetch, hasError])

  // Manual refresh - also clears error state to retry
  const handleManualRefresh = useCallback(() => {
    setHasError(false)
    refetch()
    scheduleNextRefetch()
  }, [refetch, scheduleNextRefetch])

  // Track last successful data for stable display
  const [lastData, setLastData] = useState<AnthropicUsageData | null>(null)
  useEffect(() => {
    if (data?.data) {
      setLastData(data.data as AnthropicUsageData)
      setHasError(false) // Clear error on success
    }
  }, [data])

  // Don't render if no account configured or still loading
  if (isLoadingAccount || !hasAccount) return null

  const usage = lastData
  if (!usage) return null

  const fiveHour = usage.five_hour
  const sevenDay = usage.seven_day
  const sonnet = usage.seven_day_sonnet

  // Need at least one limit to show
  if (!fiveHour && !sevenDay) return null

  const soon = t("details.usageWidget.soon")

  return (
    <div className="mx-2 mb-2">
      <div className="rounded-lg border border-border/50 overflow-hidden">
        {/* Widget Header */}
        <div className="flex items-center gap-2 px-2 h-8 bg-muted/30 select-none group">
          <Activity className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground flex-1">{t("details.widgets.usage")}</span>
          {/* Reset time hint */}
          {fiveHour && (
            <span className="text-[10px] text-muted-foreground/60">
              {t("details.usageWidget.resetsIn", { time: formatResetTime(fiveHour.resets_at, soon) })}
            </span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleManualRefresh}
                className={cn(
                  "h-5 w-5 p-0 flex items-center justify-center hover:bg-foreground/10 text-muted-foreground hover:text-foreground rounded-md transition-[background-color,opacity] duration-150 ease-out shrink-0",
                  hasError ? "opacity-100 text-amber-500" : "opacity-0 group-hover:opacity-100"
                )}
              >
                <RefreshCw className={cn("h-3 w-3", isRefetching && "animate-spin")} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {hasError ? t("details.usageWidget.retryAfterError") : t("details.usageWidget.refresh")}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Usage bars */}
        <div className="px-3 py-2 space-y-1.5">
          {fiveHour && <UsageRow label={t("details.usageWidget.fiveHour")} limit={fiveHour} t={t} />}
          {sevenDay && <UsageRow label={t("details.usageWidget.sevenDay")} limit={sevenDay} t={t} />}
          {sonnet && sonnet.utilization != null && sonnet.utilization > 0 && (
            <UsageRow label={t("details.usageWidget.sonnet")} limit={sonnet} t={t} />
          )}
        </div>
      </div>
    </div>
  )
}
