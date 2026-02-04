import { useMemo } from "react"
import { useSetAtom } from "jotai"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import { ChevronRight } from "lucide-react"
import { PluginFilledIcon, SkillIconFilled, OriginalMCPIcon, CustomAgentIconFilled } from "../../ui/icons"
import {
  agentsSettingsDialogActiveTabAtom,
} from "../../../lib/atoms"

interface ProjectPluginsTabProps {
  projectId: string
  projectPath: string | null
}

export function ProjectPluginsTab({ }: ProjectPluginsTabProps) {
  const setActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)

  // Fetch all plugins
  const { data: plugins, isLoading } = trpc.plugins.list.useQuery()

  // Filter to only show enabled plugins
  const enabledPlugins = useMemo(() => {
    if (!plugins) return []
    return plugins.filter((p) => !p.isDisabled)
  }, [plugins])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <PluginFilledIcon className="h-5 w-5 text-muted-foreground animate-pulse" />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
        {enabledPlugins.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <PluginFilledIcon className="h-10 w-10 text-border mb-4" />
            <p className="text-sm text-muted-foreground mb-1">No plugins enabled</p>
            <p className="text-xs text-muted-foreground">
              Enable plugins in the global settings
            </p>
          </div>
        ) : (
          <div>
            <h4 className="text-sm font-medium text-foreground mb-2">Enabled Plugins</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Plugins that are active and providing functionality
            </p>
            <div className="bg-background rounded-lg border border-border overflow-hidden divide-y divide-border">
              {enabledPlugins.map((plugin) => {
                const skillCount = plugin.components?.skills?.length ?? 0
                const mcpCount = plugin.components?.mcpServers?.length ?? 0
                const agentCount = plugin.components?.agents?.length ?? 0
                const hasComponents = skillCount > 0 || mcpCount > 0 || agentCount > 0

                return (
                  <div key={plugin.name} className="p-4">
                    <div className="flex items-start gap-3">
                      <PluginFilledIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">
                            {plugin.name}
                          </span>
                          {plugin.version && (
                            <span className="text-xs text-muted-foreground">
                              v{plugin.version}
                            </span>
                          )}
                        </div>
                        {plugin.description && (
                          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                            {plugin.description}
                          </p>
                        )}
                        {hasComponents && (
                          <div className="flex items-center gap-3 mt-2">
                            {skillCount > 0 && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <SkillIconFilled className="h-3 w-3" />
                                <span>{skillCount} skill{skillCount !== 1 ? "s" : ""}</span>
                              </div>
                            )}
                            {mcpCount > 0 && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <OriginalMCPIcon className="h-3 w-3" />
                                <span>{mcpCount} MCP</span>
                              </div>
                            )}
                            {agentCount > 0 && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <CustomAgentIconFilled className="h-3 w-3" />
                                <span>{agentCount} agent{agentCount !== 1 ? "s" : ""}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Link to global settings */}
        <div className="pt-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setActiveTab("plugins")}
          >
            Manage all plugins
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
}
