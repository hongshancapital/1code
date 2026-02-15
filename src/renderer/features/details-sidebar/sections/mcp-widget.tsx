"use client"

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ChevronDown, Settings, Power, RefreshCw, AlertCircle, Clock } from "lucide-react"
import { memo, useCallback, useMemo, useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { OriginalMCPIcon } from "../../../components/ui/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { agentsSettingsDialogActiveTabAtom, agentsSettingsDialogOpenAtom, sessionInfoAtom, disabledMcpServersAtom, type MCPServer } from "../../../lib/atoms"
import { mcpStatusMapAtom } from "../../../lib/atoms/mcp-status"
import { cn } from "../../../lib/utils"
import { pendingMentionAtom, selectedProjectAtom } from "../../agents/atoms"
import { WIDGET_REGISTRY } from "../atoms"
import { trpc, trpcClient } from "../../../lib/trpc"
import { createLogger } from "../../../lib/logger"

const log = createLogger("mcpWidget")


/**
 * Internal MCP server names — injected by Extensions or built-in.
 * Must match the names used in:
 * - src/main/lib/builtin-mcp.ts (hong-internal)
 * - src/main/feature/browser-mcp (browser)
 * - src/main/feature/image-mcp (image-gen, image-process)
 * - src/main/feature/chat-title-mcp (chat-title)
 */
const INTERNAL_MCP_NAMES = new Set([
  "hong-internal",
  "browser",
  "image-gen",
  "image-process",
  "chat-title",
])

/**
 * Check if an MCP server is internal (Extension-injected or built-in)
 */
function isInternalMcp(serverName: string): boolean {
  return INTERNAL_MCP_NAMES.has(serverName)
}

function formatToolName(toolName: string): string {
  return toolName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Get the best icon URL for an MCP server.
 * Prefers SVG, then picks the largest raster icon.
 * Returns null if no icons available.
 */
function getServerIconUrl(server: MCPServer): string | null {
  const icons = server.serverInfo?.icons
  if (!icons || icons.length === 0) return null

  // Prefer SVG
  const svg = icons.find((i) => i.mimeType === "image/svg+xml")
  if (svg) return svg.src

  // Otherwise pick the one with the largest size, or first available
  let best = icons[0]
  let bestSize = 0
  for (const icon of icons) {
    if (icon.sizes?.length) {
      const size = parseInt(icon.sizes[0], 10) || 0
      if (size > bestSize) {
        bestSize = size
        best = icon
      }
    }
  }
  return best.src
}

function ServerIcon({ server }: { server: MCPServer }) {
  const iconUrl = getServerIconUrl(server)
  const [imgError, setImgError] = useState(false)

  if (iconUrl && !imgError) {
    return (
      <img
        src={iconUrl}
        alt=""
        className="h-3.5 w-3.5 shrink-0 rounded-sm object-contain"
        onError={() => setImgError(true)}
      />
    )
  }

  return <OriginalMCPIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
}

export const McpWidget = memo(function McpWidget() {
  const { t } = useTranslation("sidebar")
  const sessionInfo = useAtomValue(sessionInfoAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const [disabledServersMap, setDisabledServersMap] = useAtom(disabledMcpServersAtom)
  const [mcpStatusMap, setMcpStatusMap] = useAtom(mcpStatusMapAtom)
  const setPendingMention = useSetAtom(pendingMentionAtom)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())

  // 订阅 MCP 状态变化
  trpc.claude.mcpStatus.useSubscription(undefined, {
    onData: (message) => {
      if (message.type === "serverStatus") {
        const { name, status, retryCount, lastAttempt, error, tools } = message.data

        setMcpStatusMap((prev) => {
          const next = new Map(prev)
          next.set(name, {
            name,
            status,
            retryCount,
            lastAttempt,
            error,
            tools,
          })
          return next
        })
      }
    },
    onError: (error) => {
      log.error("[MCP Status] Subscription error:", error)
    },
  })

  // Get disabled servers for current project
  const projectPath = selectedProject?.path || ""
  const disabledServers = useMemo(
    () => new Set(disabledServersMap[projectPath] || []),
    [disabledServersMap, projectPath]
  )

  const openMcpSettings = useCallback(() => {
    setSettingsTab("mcp")
    setSettingsOpen(true)
  }, [setSettingsTab, setSettingsOpen])

  // Toggle MCP server enabled/disabled state
  const toggleMcpServer = useCallback(
    async (serverName: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!projectPath) return

      const currentDisabled = disabledServersMap[projectPath] || []
      const isCurrentlyDisabled = currentDisabled.includes(serverName)

      // 更新本地状态(立即生效,不等待后端)
      setDisabledServersMap((prev) => {
        if (isCurrentlyDisabled) {
          // Enable: remove from disabled list
          return {
            ...prev,
            [projectPath]: currentDisabled.filter((s) => s !== serverName),
          }
        } else {
          // Disable: add to disabled list
          return {
            ...prev,
            [projectPath]: [...currentDisabled, serverName],
          }
        }
      })

      // 调用后端更新缓存(异步,不阻塞 UI)
      try {
        await trpcClient.claude.updateMcpServer.mutate({
          name: serverName,
          scope: "project",
          projectPath,
          disabled: !isCurrentlyDisabled,
        })
      } catch (error) {
        log.error("[MCP Widget] Failed to update server:", error)
        // 回滚本地状态
        setDisabledServersMap((prev) => {
          return {
            ...prev,
            [projectPath]: currentDisabled,
          }
        })
      }
    },
    [projectPath, disabledServersMap, setDisabledServersMap]
  )

  const toolsByServer = useMemo(() => {
    if (!sessionInfo?.tools || !sessionInfo?.mcpServers) return new Map<string, string[]>()
    const map = new Map<string, string[]>()
    for (const server of sessionInfo.mcpServers) {
      map.set(server.name, [])
    }
    for (const tool of sessionInfo.tools) {
      if (!tool.startsWith("mcp__")) continue
      const parts = tool.split("__")
      if (parts.length < 3) continue
      const serverName = parts[1]
      const toolName = parts.slice(2).join("__")
      const serverTools = map.get(serverName) || []
      serverTools.push(toolName)
      map.set(serverName, serverTools)
    }
    return map
  }, [sessionInfo?.tools, sessionInfo?.mcpServers])

  // Deduplicate servers by name to prevent React key warnings
  const uniqueMcpServers = useMemo(
    () => {
      if (!sessionInfo?.mcpServers) return []
      const seen = new Set<string>()
      return sessionInfo.mcpServers.filter((s) => {
        if (seen.has(s.name)) return false
        seen.add(s.name)
        return true
      })
    },
    [sessionInfo?.mcpServers],
  )

  if (uniqueMcpServers.length === 0) {
    return (
      <div className="px-2 py-2">
        <button
          onClick={openMcpSettings}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group"
        >
          <Settings className="h-3 w-3 opacity-50 group-hover:opacity-100 transition-opacity" />
          <span>{t("details.mcpWidget.noServers")}</span>
        </button>
      </div>
    )
  }

  const toggleServerExpand = (name: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const handleServerMention = (server: MCPServer, e: React.MouseEvent) => {
    e.stopPropagation()
    setPendingMention({
      id: `tool:${server.name}`,
      label: server.name,
      path: server.name,
      repository: "",
      truncatedPath: "MCP Server",
      type: "tool",
      mcpServer: server.name,
    })
  }

  const handleToolClick = (serverName: string, toolName: string, fullToolId: string) => {
    setPendingMention({
      id: `tool:${fullToolId}`,
      label: formatToolName(toolName),
      path: fullToolId,
      repository: "",
      truncatedPath: serverName,
      type: "tool",
      mcpServer: serverName,
    })
  }

  // Split servers into internal (Extension-injected) and external (user-configured) groups
  const { internalServers, externalServers } = useMemo(() => {
    const internal: typeof uniqueMcpServers = []
    const external: typeof uniqueMcpServers = []
    for (const server of uniqueMcpServers) {
      if (isInternalMcp(server.name)) {
        internal.push(server)
      } else {
        external.push(server)
      }
    }
    return { internalServers: internal, externalServers: external }
  }, [uniqueMcpServers])

  // Get maxHeight from widget registry
  const widgetConfig = WIDGET_REGISTRY.find((w) => w.id === "mcp")
  const maxHeight = widgetConfig?.maxHeight

  const renderServer = (server: MCPServer) => {
    const tools = toolsByServer.get(server.name) || []
    const isExpanded = expandedServers.has(server.name)
    const hasTools = tools.length > 0
    const isDisabled = disabledServers.has(server.name)

    // 获取实时状态(如果有)
    const realtimeState = mcpStatusMap.get(server.name)
    const status = realtimeState?.status || server.status
    const error = realtimeState?.error
    const retryCount = realtimeState?.retryCount || 0

    return (
      <div key={server.name} className={cn(isDisabled && "opacity-50")}>
        {/* Server row */}
        <div
          className={cn(
            "w-full flex items-center gap-1.5 min-h-[28px] rounded px-1.5 py-0.5 -ml-0.5 transition-colors group/server",
            hasTools && !isDisabled
              ? "hover:bg-accent cursor-pointer"
              : "cursor-default",
          )}
        >
          {/* Toggle switch - shown on hover */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={(e) => toggleMcpServer(server.name, e)}
                className={cn(
                  "shrink-0 flex items-center justify-center h-4 w-4 rounded transition-all",
                  isDisabled
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-green-500 hover:text-green-600",
                )}
              >
                <Power className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isDisabled
                ? t("details.mcpWidget.enable")
                : t("details.mcpWidget.disable")}
            </TooltipContent>
          </Tooltip>

          {/* Server name - clickable to expand/collapse */}
          <button
            onClick={() => hasTools && !isDisabled && toggleServerExpand(server.name)}
            className="flex-1 flex items-center gap-1.5 min-w-0"
            disabled={isDisabled}
          >
            {/* 状态图标 */}
            {status === "connecting" && (
              <div className="h-2 w-2 rounded-full bg-blue-500 animate-pulse shrink-0" />
            )}
            {status === "retrying" && (
              <Tooltip>
                <TooltipTrigger>
                  <RefreshCw className="h-3 w-3 animate-spin text-blue-500 shrink-0" />
                </TooltipTrigger>
                <TooltipContent>重试中（第 {retryCount + 1} 次）</TooltipContent>
              </Tooltip>
            )}
            {status === "timeout" && (
              <Tooltip>
                <TooltipTrigger>
                  <Clock className="h-3 w-3 text-orange-500 shrink-0" />
                </TooltipTrigger>
                <TooltipContent>连接超时</TooltipContent>
              </Tooltip>
            )}
            {status === "failed" && (
              <Tooltip>
                <TooltipTrigger>
                  <AlertCircle className="h-3 w-3 text-red-500 shrink-0" />
                </TooltipTrigger>
                <TooltipContent>{error || "连接失败"}</TooltipContent>
              </Tooltip>
            )}

            <ServerIcon server={server} />
            <span className={cn(
              "text-xs truncate text-left",
              isDisabled ? "text-muted-foreground" : "text-foreground"
            )}>
              {server.name}
            </span>
            {/* @ mention button for server - shown on hover, after name */}
            {!isDisabled && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    role="button"
                    onClick={(e) => handleServerMention(server, e)}
                    className="shrink-0 text-[10px] text-muted-foreground/0 group-hover/server:text-muted-foreground/50 hover:!text-foreground transition-colors"
                  >
                    @
                  </span>
                </TooltipTrigger>
                <TooltipContent side="left">
                  {t("details.mcpWidget.mention", { name: server.name })}
                </TooltipContent>
              </Tooltip>
            )}
            <span className="flex-1" />
          </button>

          {hasTools && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {tools.length}
            </span>
          )}
          {hasTools && !isDisabled && (
            <ChevronDown
              className={cn(
                "h-3 w-3 text-muted-foreground/50 shrink-0 transition-transform duration-150",
                !isExpanded && "-rotate-90",
              )}
            />
          )}
        </div>

        {/* Tools list - hidden when disabled */}
        {isExpanded && hasTools && !isDisabled && (
          <div className="ml-[22px] py-0.5 flex flex-col gap-px">
            {tools.map((tool) => {
              const fullToolId = `mcp__${server.name}__${tool}`
              return (
                <button
                  key={tool}
                  onClick={() => handleToolClick(server.name, tool, fullToolId)}
                  className="group/tool w-full flex items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground py-1 px-1.5 rounded hover:bg-accent transition-colors truncate"
                >
                  <span className="truncate flex-1">{formatToolName(tool)}</span>
                  <span className="text-[10px] text-muted-foreground/0 group-hover/tool:text-muted-foreground/50 transition-colors shrink-0">
                    @
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="px-2 py-1.5 flex flex-col gap-0.5 overflow-y-auto"
      style={maxHeight ? { maxHeight } : undefined}
    >
      {/* Internal MCP servers (Extension-injected) */}
      {internalServers.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 px-1 pt-0.5 pb-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Internal</span>
            <span className="text-[10px] text-muted-foreground/50">{internalServers.length}</span>
          </div>
          {internalServers.map(renderServer)}
        </>
      )}

      {/* External MCP servers (user-configured) */}
      {externalServers.length > 0 && (
        <>
          <div className={cn("flex items-center gap-1.5 px-1 pb-1", internalServers.length > 0 && "pt-2 mt-1 border-t border-border/50")}>
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">External</span>
            <span className="text-[10px] text-muted-foreground/50">{externalServers.length}</span>
          </div>
          {externalServers.map(renderServer)}
        </>
      )}
    </div>
  )
})
