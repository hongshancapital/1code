"use client"

import { useMemo, useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"
import { IconSpinner } from "../../icons/icons"

interface UsageBarChartProps {
  className?: string
}

export function UsageBarChart({ className }: UsageBarChartProps) {
  const { t } = useTranslation("home")
  const { data: hourlyData, isLoading } = trpc.usage.getYesterdayHourly.useQuery()

  // Get a random "no data" message on each mount
  const [noDataMessage, setNoDataMessage] = useState("")

  useEffect(() => {
    const messages = t("usage.noData", { returnObjects: true })
    if (Array.isArray(messages) && messages.length > 0) {
      const index = Math.floor(Math.random() * messages.length)
      setNoDataMessage(messages[index])
    } else {
      setNoDataMessage(typeof messages === "string" ? messages : "")
    }
  }, [t])

  // Fill 24 hours data (fill 0 for hours without data)
  const chartData = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      tokens: 0,
    }))
    hourlyData?.forEach((item) => {
      const hourIndex = parseInt(item.hour, 10)
      if (hourIndex >= 0 && hourIndex < 24) {
        hours[hourIndex].tokens = item.totalTokens ?? 0
      }
    })
    return hours
  }, [hourlyData])

  const maxTokens = useMemo(() => {
    const max = Math.max(...chartData.map((d) => d.tokens))
    return max > 0 ? max : 1
  }, [chartData])

  const totalTokens = useMemo(() => {
    return chartData.reduce((sum, d) => sum + d.tokens, 0)
  }, [chartData])

  const hasData = totalTokens > 0

  if (isLoading) {
    return (
      <div className={cn("rounded-xl border border-border bg-background p-4", className)}>
        <div className="flex items-center justify-center h-20">
          <IconSpinner className="h-5 w-5" />
        </div>
      </div>
    )
  }

  return (
    <div className={cn("rounded-xl border border-border bg-background p-4", className)}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium">{t("usage.yesterdayTitle")}</h3>
        {hasData && (
          <span className="text-xs text-muted-foreground">
            {t("usage.totalTokens", { count: totalTokens.toLocaleString() })}
          </span>
        )}
      </div>

      {hasData ? (
        <>
          <div className="flex items-end gap-0.5 h-16">
            {chartData.map((d, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/20 hover:bg-primary/40 rounded-t transition-colors cursor-default"
                style={{
                  height: d.tokens > 0 ? `${Math.max((d.tokens / maxTokens) * 100, 4)}%` : "2px",
                  minHeight: d.tokens > 0 ? "4px" : "2px",
                }}
                title={`${d.hour}:00 - ${d.tokens.toLocaleString()} tokens`}
              />
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0:00</span>
            <span>12:00</span>
            <span>24:00</span>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-16 text-sm text-muted-foreground">
          {noDataMessage}
        </div>
      )}
    </div>
  )
}
