"use client"

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { ChevronDown, Settings, Power } from "lucide-react"
import { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { OriginalMCPIcon } from "../../../components/ui/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { agentsSettingsDialogActiveTabAtom, agentsSettingsDialogOpenAtom, sessionInfoAtom, disabledMcpServersAtom, type MCPServer } from "../../../lib/atoms"
import { cn } from "../../../lib/utils"
import { pendingMentionAtom, selectedProjectAtom } from "../../agents/atoms"
import { WIDGET_REGISTRY } from "../atoms"

/**
 * Built-in MCP server name
 * Must match BUILTIN_MCP_NAME in src/main/lib/builtin-mcp.ts
 */
const BUILTIN_MCP_NAME = "hong-internal"

/**
 * Check if an MCP server is built-in
 */
function isBuiltinMcp(serverName: string): boolean {
  return serverName === BUILTIN_MCP_NAME
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
  const setPendingMention = useSetAtom(pendingMentionAtom)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())

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
    (serverName: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!projectPath) return

      setDisabledServersMap((prev) => {
        const currentDisabled = prev[projectPath] || []
        const isCurrentlyDisabled = currentDisabled.includes(serverName)

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
    },
    [projectPath, setDisabledServersMap]
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

  if (!sessionInfo?.mcpServers || sessionInfo.mcpServers.length === 0) {
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

  // Get maxHeight from widget registry
  const widgetConfig = WIDGET_REGISTRY.find((w) => w.id === "mcp")
  const maxHeight = widgetConfig?.maxHeight

  return (
    <div
      className="px-2 py-1.5 flex flex-col gap-0.5 overflow-y-auto"
      style={maxHeight ? { maxHeight } : undefined}
    >
      {sessionInfo.mcpServers.map((server) => {
        const tools = toolsByServer.get(server.name) || []
        const isExpanded = expandedServers.has(server.name)
        const hasTools = tools.length > 0
        const isBuiltin = isBuiltinMcp(server.name)
        const isDisabled = disabledServers.has(server.name)

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
                <ServerIcon server={server} />
                <span className={cn(
                  "text-xs truncate flex-1 text-left",
                  isDisabled ? "text-muted-foreground" : "text-foreground"
                )}>
                  {server.name}
                </span>
              </button>

              {isBuiltin && (
                <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">
                  {t("details.mcpWidget.builtin")}
                </span>
              )}
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
      })}
    </div>
  )
})
