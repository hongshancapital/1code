import { useMemo, useState } from "react"
import { useSetAtom } from "jotai"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import { ChevronRight, ChevronDown } from "lucide-react"
import { OriginalMCPIcon } from "../../ui/icons"
import {
  agentsSettingsDialogActiveTabAtom,
} from "../../../lib/atoms"
import { cn } from "../../../lib/utils"

interface ProjectMcpTabProps {
  projectId: string
  projectPath: string | null
}

// Status dot component
function McpStatusDot({ status }: { status: string }) {
  const isConnected = status === "connected" || status === "ready"
  const isError = status === "error" || status === "failed"

  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full shrink-0",
        isConnected && "bg-green-500",
        isError && "bg-red-500",
        !isConnected && !isError && "bg-yellow-500"
      )}
    />
  )
}

export function ProjectMcpTab({ projectId, projectPath }: ProjectMcpTabProps) {
  const setActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())

  // Fetch all MCP config
  const { data: mcpConfig, isLoading } = trpc.claude.getAllMcpConfig.useQuery()

  // Filter to only show Global and current project's MCP servers
  type McpGroup = NonNullable<typeof mcpConfig>["groups"][number]
  const filteredGroups = useMemo(() => {
    if (!mcpConfig?.groups) return { global: [] as McpGroup[], project: [] as McpGroup[] }

    const global = mcpConfig.groups.filter((g) => g.groupName === "Global")
    const project = mcpConfig.groups.filter(
      (g) => projectPath && g.projectPath === projectPath
    )

    return { global, project }
  }, [mcpConfig?.groups, projectPath])

  const toggleServer = (serverKey: string) => {
    setExpandedServers((prev) => {
      const next = new Set(prev)
      if (next.has(serverKey)) {
        next.delete(serverKey)
      } else {
        next.add(serverKey)
      }
      return next
    })
  }

  const hasServers =
    filteredGroups.global.some((g) => g.mcpServers.length > 0) ||
    filteredGroups.project.some((g) => g.mcpServers.length > 0)

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <OriginalMCPIcon className="h-5 w-5 text-muted-foreground animate-pulse" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
        {!hasServers ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <OriginalMCPIcon className="h-10 w-10 text-border mb-4" />
            <p className="text-sm text-muted-foreground mb-1">No MCP servers configured</p>
            <p className="text-xs text-muted-foreground">
              Add MCP servers in the global settings
            </p>
          </div>
        ) : (
          <>
            {/* Global MCP Servers */}
            {filteredGroups.global.map((group) =>
              group.mcpServers.length > 0 ? (
                <div key="global">
                  <h4 className="text-sm font-medium text-foreground mb-2">Global</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    MCP servers from your global configuration
                  </p>
                  <div className="bg-background rounded-lg border border-border overflow-hidden divide-y divide-border">
                    {group.mcpServers.map((server) => {
                      const serverKey = `global-${server.name}`
                      const isExpanded = expandedServers.has(serverKey)
                      const toolCount = server.tools?.length ?? 0

                      return (
                        <div key={server.name}>
                          <button
                            type="button"
                            onClick={() => toolCount > 0 && toggleServer(serverKey)}
                            className={cn(
                              "w-full flex items-center gap-3 p-4 text-left",
                              toolCount > 0 && "hover:bg-muted/50 cursor-pointer"
                            )}
                          >
                            <OriginalMCPIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-foreground">
                                {server.name}
                              </span>
                            </div>
                            <McpStatusDot status={server.status} />
                            {toolCount > 0 && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {toolCount} tools
                              </span>
                            )}
                            {toolCount > 0 && (
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 text-muted-foreground transition-transform",
                                  !isExpanded && "-rotate-90"
                                )}
                              />
                            )}
                          </button>
                          {isExpanded && toolCount > 0 && (
                            <div className="px-4 pb-4 pl-11">
                              <div className="flex flex-wrap gap-1.5">
                                {server.tools?.map((tool) => {
                                  const toolName = typeof tool === "string" ? tool : tool.name
                                  return (
                                    <span
                                      key={toolName}
                                      className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground"
                                    >
                                      {toolName}
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null
            )}

            {/* Project MCP Servers */}
            {filteredGroups.project.map((group) =>
              group.mcpServers.length > 0 ? (
                <div key={`project-${group.projectPath}`}>
                  <h4 className="text-sm font-medium text-foreground mb-2">Project</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    MCP servers specific to this project
                  </p>
                  <div className="bg-background rounded-lg border border-border overflow-hidden divide-y divide-border">
                    {group.mcpServers.map((server) => {
                      const serverKey = `project-${server.name}`
                      const isExpanded = expandedServers.has(serverKey)
                      const toolCount = server.tools?.length ?? 0

                      return (
                        <div key={server.name}>
                          <button
                            type="button"
                            onClick={() => toolCount > 0 && toggleServer(serverKey)}
                            className={cn(
                              "w-full flex items-center gap-3 p-4 text-left",
                              toolCount > 0 && "hover:bg-muted/50 cursor-pointer"
                            )}
                          >
                            <OriginalMCPIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-foreground">
                                {server.name}
                              </span>
                            </div>
                            <McpStatusDot status={server.status} />
                            {toolCount > 0 && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {toolCount} tools
                              </span>
                            )}
                            {toolCount > 0 && (
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 text-muted-foreground transition-transform",
                                  !isExpanded && "-rotate-90"
                                )}
                              />
                            )}
                          </button>
                          {isExpanded && toolCount > 0 && (
                            <div className="px-4 pb-4 pl-11">
                              <div className="flex flex-wrap gap-1.5">
                                {server.tools?.map((tool) => {
                                  const toolName = typeof tool === "string" ? tool : tool.name
                                  return (
                                    <span
                                      key={toolName}
                                      className="text-xs bg-muted px-2 py-1 rounded text-muted-foreground"
                                    >
                                      {toolName}
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null
            )}
          </>
        )}

        {/* Link to global settings */}
        <div className="pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setActiveTab("mcp")}
          >
            Manage all MCP servers
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
