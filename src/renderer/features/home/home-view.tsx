"use client"

import { useAtomValue, useSetAtom, useAtom } from "jotai"
import {
  desktopViewAtom,
  agentsSidebarOpenAtom,
  agentsMobileViewModeAtom,
  selectedAgentChatIdAtom,
} from "../agents/atoms"
import { betaAutomationsEnabledAtom, isDesktopAtom, isFullscreenAtom } from "../../lib/atoms"
import { trpc } from "../../lib/trpc"
import { IconSpinner } from "../../components/ui/icons"
import { MessageCircle, Inbox as InboxIcon, Zap, AlignJustify } from "lucide-react"
import { cn } from "../../lib/utils"
import { useCallback, useMemo } from "react"
import { useIsMobile } from "../../lib/hooks/use-mobile"
import { useTranslation } from "react-i18next"
import { useTypingGreeting } from "./use-greeting"
import { UsageBarChart } from "./usage-bar-chart"
import { NewChatForm } from "../agents/main/new-chat-form"
import { AgentsHeaderControls } from "../agents/ui/agents-header-controls"

// Format relative time helper (returns key and count for translation)
function getRelativeTimeKey(date: Date): { key: string; count?: number; fallback?: string } {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)
  if (diffSec < 60) return { key: "time.justNow" }
  if (diffMin < 60) return { key: "time.minutesAgo", count: diffMin }
  if (diffHr < 24) return { key: "time.hoursAgo", count: diffHr }
  if (diffDay < 7) return { key: "time.daysAgo", count: diffDay }
  return { key: "", fallback: date.toLocaleDateString() }
}

export function HomeView() {
  const { t } = useTranslation("home")

  // Helper to format relative time with translation
  const formatDistanceToNow = useCallback((date: Date): string => {
    const { key, count, fallback } = getRelativeTimeKey(date)
    if (fallback) return fallback
    return t(key, { count })
  }, [t])

  const setDesktopView = useSetAtom(desktopViewAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const setMobileViewMode = useSetAtom(agentsMobileViewModeAtom)
  const isMobile = useIsMobile()
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)

  // Beta features flag
  const automationsEnabled = useAtomValue(betaAutomationsEnabledAtom)

  // Typing greeting
  const { displayText, isTyping } = useTypingGreeting(35, 300)

  // Fetch automations for stats (only if enabled)
  const { data: automations, isLoading: automationsLoading } = trpc.automations.list.useQuery(
    undefined,
    { enabled: automationsEnabled }
  )

  // Fetch recent chats
  const { data: allChats, isLoading: chatsLoading } = trpc.chats.list.useQuery()
  const recentChats = useMemo(() => (allChats || []).slice(0, 5), [allChats])

  // Fetch recent inbox items (only if automations enabled)
  const { data: inboxData, isLoading: inboxLoading } = trpc.automations.getInboxChats.useQuery(
    { limit: 5 },
    { enabled: automationsEnabled }
  )

  // Calculate stats
  const automationStats = useMemo(() => {
    if (!automations) return { total: 0, enabled: 0 }
    const total = automations.length
    const enabled = automations.filter((a) => a.isEnabled).length
    return { total, enabled }
  }, [automations])

  // Calculate recent activity stats (last 7 days)
  const activityStats = useMemo(() => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const recentCount = allChats?.filter(
      (c) => c.updatedAt && new Date(c.updatedAt) > sevenDaysAgo
    ).length ?? 0
    return {
      recentChats: recentCount,
      totalChats: allChats?.length ?? 0,
    }
  }, [allChats])

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) {
      setDesktopView(null)
      setMobileViewMode("chats")
    } else {
      setSidebarOpen(true)
    }
  }, [isMobile, setDesktopView, setMobileViewMode, setSidebarOpen])

  const handleOpenInbox = useCallback(() => {
    setDesktopView("inbox")
  }, [setDesktopView])

  const handleOpenAutomations = useCallback(() => {
    setDesktopView("automations")
  }, [setDesktopView])

  const handleOpenChat = useCallback((chatId: string) => {
    setSelectedChatId(chatId)
    setDesktopView(null)
  }, [setSelectedChatId, setDesktopView])

  const isLoading = chatsLoading || (automationsEnabled && (automationsLoading || inboxLoading))

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* Draggable area for window movement - covers header area (hidden in fullscreen/mobile) */}
      {isDesktop && !isFullscreen && !isMobile && (
        <div
          className="absolute top-0 left-0 right-0 h-12 z-10"
          style={{
            WebkitAppRegion: "drag",
          } as React.CSSProperties}
        />
      )}
      {/* Header bar with sidebar toggle - matches NewChatForm layout */}
      <div
        className="shrink-0 flex items-center bg-background p-1.5 relative z-20"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {isMobile ? (
            <button
              onClick={handleSidebarToggle}
              className="h-7 w-7 p-0 flex items-center justify-center hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] shrink-0 rounded-md text-muted-foreground hover:text-foreground"
              aria-label={t("aria.backToChats")}
            >
              <AlignJustify className="h-4 w-4" />
            </button>
          ) : (
            <AgentsHeaderControls
              isSidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Section 1: Header with dynamic greeting */}
      <div className="shrink-0 px-4 md:px-6 pt-4">
        <div className={isMobile ? "max-w-full" : "max-w-3xl mx-auto"}>
          <div className="mb-6">
            <div className="min-h-[40px] flex items-center">
              <h1 className="text-xl md:text-2xl font-medium text-foreground">
                {displayText}
                {isTyping && (
                  <span className="inline-block w-0.5 h-5 md:h-6 bg-foreground/70 ml-0.5 animate-pulse" />
                )}
              </h1>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-4 md:px-6">
        <div className={isMobile ? "max-w-full" : "max-w-3xl mx-auto"}>
          {/* Yesterday Usage Bar Chart */}
          <UsageBarChart className="mb-6" />

          {/* Stats Cards */}
          <div className={cn(
            "grid gap-3 mb-8",
            automationsEnabled ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2"
          )}>
            <div className="p-4 rounded-xl border border-border bg-background">
              <div className="text-2xl font-semibold">{activityStats.totalChats}</div>
              <div className="text-xs text-muted-foreground">{t("stats.recentChats")}</div>
            </div>
            <div className="p-4 rounded-xl border border-border bg-background">
              <div className="text-2xl font-semibold text-primary">{activityStats.recentChats}</div>
              <div className="text-xs text-muted-foreground">{t("stats.last7Days")}</div>
            </div>
            {automationsEnabled && (
              <>
                <div className="p-4 rounded-xl border border-border bg-background">
                  <div className="text-2xl font-semibold">{automationStats.total}</div>
                  <div className="text-xs text-muted-foreground">{t("stats.totalAutomations")}</div>
                </div>
                <div className="p-4 rounded-xl border border-border bg-background">
                  <div className="text-2xl font-semibold text-green-500">{automationStats.enabled}</div>
                  <div className="text-xs text-muted-foreground">{t("stats.active")}</div>
                </div>
              </>
            )}
          </div>

          {/* Recent Activity */}
          <div className={cn(
            "grid gap-6",
            automationsEnabled ? "md:grid-cols-2" : "md:grid-cols-1"
          )}>
            {/* Recent Chats */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium">{t("sections.recentChats")}</h2>
              </div>
              <div className="rounded-xl border border-border bg-background overflow-hidden">
                {chatsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconSpinner className="h-5 w-5" />
                  </div>
                ) : recentChats && recentChats.length > 0 ? (
                  <div className="divide-y divide-border">
                    {recentChats.map((chat) => (
                      <button
                        key={chat.id}
                        onClick={() => handleOpenChat(chat.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-foreground/5 transition-colors text-left"
                      >
                        <MessageCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{chat.name || "Untitled"}</div>
                          <div className="text-xs text-muted-foreground">
                            {chat.createdAt ? formatDistanceToNow(new Date(chat.createdAt)) : ""}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                    <MessageCircle className="h-8 w-8 text-border mb-2" />
                    <p className="text-sm text-muted-foreground">{t("empty.recentChats")}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Inbox Items (only if automations enabled) */}
            {automationsEnabled && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium">{t("sections.inbox")}</h2>
                  <button
                    onClick={handleOpenInbox}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t("actions.viewAll")}
                  </button>
                </div>
                <div className="rounded-xl border border-border bg-background overflow-hidden">
                  {inboxLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <IconSpinner className="h-5 w-5" />
                    </div>
                  ) : inboxData?.chats && inboxData.chats.length > 0 ? (
                    <div className="divide-y divide-border">
                      {inboxData.chats.slice(0, 5).map((item) => (
                        <button
                          key={item.id}
                          onClick={handleOpenInbox}
                          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-foreground/5 transition-colors text-left"
                        >
                          <InboxIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm truncate">{item.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {item.automationName} &bull; {item.createdAt ? formatDistanceToNow(new Date(item.createdAt)) : ""}
                            </div>
                          </div>
                          <span className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded",
                            item.status === "success" ? "bg-green-500/10 text-green-600" :
                            item.status === "failed" ? "bg-red-500/10 text-red-600" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {item.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                      <InboxIcon className="h-8 w-8 text-border mb-2" />
                      <p className="text-sm text-muted-foreground">{t("empty.inboxItems")}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Automations Section (only if enabled) */}
          {automationsEnabled && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium">{t("sections.automations")}</h2>
                <button
                  onClick={handleOpenAutomations}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("actions.viewAll")}
                </button>
              </div>
              <div className="rounded-xl border border-border bg-background overflow-hidden">
                {automationsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <IconSpinner className="h-5 w-5" />
                  </div>
                ) : automations && automations.length > 0 ? (
                  <div className="divide-y divide-border">
                    {automations.slice(0, 3).map((automation) => (
                      <button
                        key={automation.id}
                        onClick={handleOpenAutomations}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-foreground/5 transition-colors text-left"
                      >
                        <Zap className={cn(
                          "h-4 w-4 shrink-0",
                          automation.isEnabled ? "text-orange-500" : "text-muted-foreground"
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{automation.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {automation.isEnabled ? t("stats.active") : t("stats.paused")}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                    <Zap className="h-8 w-8 text-border mb-2" />
                    <p className="text-sm text-muted-foreground">{t("empty.automations")}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Section 3: New Conversation Title */}
      <div className="shrink-0 px-4 md:px-6 pt-4">
        <div className={isMobile ? "max-w-full" : "max-w-3xl mx-auto"}>
          <h2 className="text-base font-medium text-foreground">
            {t("quickInput.startNewTopic")}
          </h2>
        </div>
      </div>

      {/* Section 4: NewChatForm */}
      <div className="shrink-0 px-4 md:px-6 pt-3 pb-4">
        <div className={isMobile ? "max-w-full" : "max-w-3xl mx-auto"}>
          <NewChatForm embedded />
        </div>
      </div>
    </div>
  )
}
