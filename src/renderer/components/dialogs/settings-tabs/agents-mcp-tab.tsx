"use client"

import { Loader2, Plus, Power, Trash2, Settings2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Button } from "../../ui/button"
import { toast } from "sonner"
import { useListKeyboardNav } from "./use-list-keyboard-nav"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { LoadingDot, OriginalMCPIcon } from "../../ui/icons"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { selectedProjectAtom, settingsMcpSidebarWidthAtom } from "../../../features/agents/atoms"
import { agentsSettingsDialogActiveTabAtom, disabledMcpServersAtom, sessionInfoAtom, type MCPServer, type MCPServerStatus } from "../../../lib/atoms"
import {
  AddMcpServerDialog,
  EditMcpServerDialog,
  DeleteServerConfirm,
  getStatusText,
  type McpServer,
  type ScopeType,
} from "./mcp"

// Status indicator dot - exported for reuse in other components
export function McpStatusDot({ status }: { status: string }) {
  switch (status) {
    case "connected":
      return <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
    case "failed":
      return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
    case "needs-auth":
      return <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
    case "needs-login":
      return <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0" />
    case "pending":
      return <LoadingDot isLoading={true} className="w-3 h-3 text-muted-foreground shrink-0" />
    default:
      return <span className="w-2 h-2 rounded-full bg-muted-foreground/50 shrink-0" />
  }
}


// Extract connection info from server config
function getConnectionInfo(config: Record<string, unknown>) {
  const url = config.url as string | undefined
  const command = config.command as string | undefined
  const args = config.args as string[] | undefined
  const env = config.env as Record<string, string> | undefined

  if (url) {
    return { type: "HTTP (SSE)" as const, url, command: undefined, args: undefined, env: undefined }
  }
  if (command) {
    return { type: "stdio" as const, url: undefined, command, args, env }
  }
  return { type: "unknown" as const, url: undefined, command: undefined, args: undefined, env: undefined }
}

// --- Detail Panel ---
function McpServerDetail({
  server,
  groupName,
  onAuth,
  onRetry,
  onEdit,
  onDelete,
  isDeleting,
}: {
  server: McpServer
  groupName: string
  onAuth?: () => void
  onRetry?: () => void
  onEdit?: () => void
  onDelete?: () => void
  isDeleting?: boolean
}) {
  const { t } = useTranslation('settings')
  const { tools, needsAuth } = server
  const hasTools = tools.length > 0
  const isConnected = server.status === "connected"
  const isFailed = server.status === "failed"
  const connection = getConnectionInfo(server.config)

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{server.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isConnected
                ? (hasTools ? `${tools.length} ${tools.length !== 1 ? t('mcp.tools_plural') : t('mcp.tools')}` : t('mcp.detail.noTools'))
                : getStatusText(server.status)}
              {server.serverInfo?.version && ` \u00B7 v${server.serverInfo.version}`}
            </p>
          </div>
          {/* Retry button for failed connections */}
          {isFailed && onRetry && (
            <Button variant="secondary" size="sm" className="h-7 px-3 text-xs" onClick={onRetry}>
              {t('common:actions.retry')}
            </Button>
          )}
          {/* Auth button for servers needing authentication */}
          {needsAuth && onAuth && !server.requiresLogin && (
            <Button variant="secondary" size="sm" className="h-7 px-3 text-xs" onClick={onAuth}>
              {isConnected ? t('mcp.detail.reconnect') : t('mcp.detail.authenticate')}
            </Button>
          )}
          {/* Edit button */}
          {onEdit && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
                  <Settings2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('mcp.detail.edit')}</TooltipContent>
            </Tooltip>
          )}
          {/* Delete button */}
          {onDelete && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={onDelete}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('mcp.detail.delete')}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Requires Login Notice */}
        {server.requiresLogin && (
          <div className="rounded-md border border-orange-500/20 bg-orange-500/5 px-3 py-3">
            <p className="text-xs text-orange-600 dark:text-orange-400">
              {t('mcp.detail.requiresLoginNotice')}
            </p>
          </div>
        )}

        {/* Connection Section */}
        <div>
          <h5 className="text-xs font-medium text-foreground mb-2">{t('mcp.detail.connection')}</h5>
          <div className="rounded-md border border-border bg-background overflow-hidden">
            <div className="divide-y divide-border">
              <div className="flex gap-3 px-3 py-2">
                <span className="text-xs text-muted-foreground w-16 shrink-0">{t('mcp.detail.type')}</span>
                <span className="text-xs text-foreground font-mono">{connection.type}</span>
              </div>
              {connection.url && (
                <div className="flex gap-3 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{t('mcp.detail.url')}</span>
                  <span className="text-xs text-foreground font-mono break-all">{connection.url}</span>
                </div>
              )}
              {connection.command && (
                <div className="flex gap-3 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{t('mcp.detail.command')}</span>
                  <span className="text-xs text-foreground font-mono break-all">{connection.command}</span>
                </div>
              )}
              {connection.args && connection.args.length > 0 && (
                <div className="flex gap-3 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{t('mcp.detail.args')}</span>
                  <span className="text-xs text-foreground font-mono break-all">{connection.args.join(" ")}</span>
                </div>
              )}
              {connection.env && Object.keys(connection.env).length > 0 && (
                <div className="flex gap-3 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{t('mcp.detail.env')}</span>
                  <div className="flex flex-wrap gap-1">
                    {Object.keys(connection.env).map((key) => (
                      <span key={key} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {key}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error Section */}
        {server.error && (
          <div>
            <h5 className="text-xs font-medium text-red-500 mb-2">{t('mcp.detail.error')}</h5>
            <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2">
              <p className="text-xs text-red-400 font-mono break-all">{server.error}</p>
            </div>
          </div>
        )}

        {/* Tools Section */}
        {hasTools && (
          <div>
            <h5 className="text-xs font-medium text-foreground mb-3">
              {t('mcp.detail.toolsCount', { count: tools.length })}
            </h5>
            <div className="grid gap-2">
              {tools.map((tool, i) => {
                const toolName = typeof tool === "string" ? tool : tool.name
                const toolDesc = typeof tool === "string" ? undefined : tool.description
                return (
                  <div key={toolName || i} className="rounded-lg border border-border bg-background px-3.5 py-2.5">
                    <p className="text-[13px] font-medium text-foreground font-mono">{toolName}</p>
                    {toolDesc && (
                      <p className="text-xs text-muted-foreground leading-relaxed mt-1">{toolDesc}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// --- Create Form ---
function CreateMcpServerForm({
  onCreated,
  onCancel,
  hasProject,
}: {
  onCreated: () => void
  onCancel: () => void
  hasProject: boolean
}) {
  const { t } = useTranslation('settings')
  const addServerMutation = trpc.claude.addMcpServer.useMutation()
  const isSaving = addServerMutation.isPending
  const [name, setName] = useState("")
  const [type, setType] = useState<"stdio" | "http">("stdio")
  const [command, setCommand] = useState("")
  const [args, setArgs] = useState("")
  const [url, setUrl] = useState("")
  const [scope, setScope] = useState<"global" | "project">("global")

  const canSave = name.trim().length > 0 && (
    (type === "stdio" && command.trim().length > 0) ||
    (type === "http" && url.trim().length > 0)
  )

  const handleSubmit = async () => {
    const parsedArgs = args.trim() ? args.split(/\s+/) : undefined
    try {
      await addServerMutation.mutateAsync({
        name: name.trim(),
        transport: type,
        command: type === "stdio" ? command.trim() : undefined,
        args: type === "stdio" ? parsedArgs : undefined,
        url: type === "http" ? url.trim() : undefined,
        scope,
      })
      toast.success("Server added", { description: name.trim() })
      onCreated()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to add server"
      toast.error("Failed to add", { description: message })
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{t('mcp.form.title')}</h3>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel}>{t('mcp.form.cancel')}</Button>
            <Button size="sm" onClick={handleSubmit} disabled={!canSave || isSaving}>
              {isSaving ? t('mcp.form.adding') : t('mcp.form.add')}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('mcp.form.nameLabel')}</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('mcp.form.namePlaceholder')}
            autoFocus
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>{t('mcp.form.transportLabel')}</Label>
          <Select value={type} onValueChange={(v) => setType(v as "stdio" | "http")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="stdio">{t('mcp.form.transportStdio')}</SelectItem>
              <SelectItem value="http">{t('mcp.form.transportHttp')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {type === "stdio" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>{t('mcp.form.commandLabel')}</Label>
              <Input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('mcp.form.commandPlaceholder')}
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t('mcp.form.argsLabel')}</Label>
              <Input
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder={t('mcp.form.argsPlaceholder')}
                className="font-mono"
              />
              <p className="text-[11px] text-muted-foreground">{t('mcp.form.argsHint')}</p>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label>{t('mcp.form.urlLabel')}</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('mcp.form.urlPlaceholder')}
              className="font-mono"
            />
          </div>
        )}

        {hasProject && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('mcp.form.scopeLabel')}</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as "global" | "project")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">{t('mcp.form.scopeGlobal')}</SelectItem>
                <SelectItem value="project">{t('mcp.form.scopeProject')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    </div>
  )
}

// --- Main Component ---
export function AgentsMcpTab() {
  const { t } = useTranslation('settings')
  const [selectedServerKey, setSelectedServerKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddForm, setShowAddForm] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [disabledServersMap, setDisabledServersMap] = useAtom(disabledMcpServersAtom)
  const setSessionInfo = useSetAtom(sessionInfoAtom)
  const trpcUtils = trpc.useUtils()

  // Get disabled servers for current project
  const projectPath = selectedProject?.path || ""
  const disabledServers = useMemo(
    () => new Set(disabledServersMap[projectPath] || []),
    [disabledServersMap, projectPath]
  )

  // Toggle MCP server enabled/disabled state
  const toggleMcpServer = useCallback(
    (serverName: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!projectPath) {
        toast.error(t('mcp.noProjectSelected'))
        return
      }

      setDisabledServersMap((prev) => {
        const currentDisabled = prev[projectPath] || []
        const isCurrentlyDisabled = currentDisabled.includes(serverName)

        if (isCurrentlyDisabled) {
          toast.success(t('mcp.serverEnabled', { name: serverName }))
          return {
            ...prev,
            [projectPath]: currentDisabled.filter((s) => s !== serverName),
          }
        } else {
          toast.success(t('mcp.serverDisabled', { name: serverName }))
          return {
            ...prev,
            [projectPath]: [...currentDisabled, serverName],
          }
        }
      })
    },
    [projectPath, setDisabledServersMap, t]
  )

  // Dialog state for Add/Edit/Delete MCP server dialogs
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [editingServer, setEditingServer] = useState<{
    server: McpServer
    scope: ScopeType
    projectPath: string | null
    pluginSource?: string
  } | null>(null)
  const [deletingServer, setDeletingServer] = useState<{
    server: McpServer
    scope: ScopeType
    projectPath: string | null
    pluginSource?: string
  } | null>(null)

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

  const {
    data: allMcpConfig,
    isLoading: isLoadingConfig,
    refetch,
  } = trpc.claude.getAllMcpConfig.useQuery(undefined, {
    staleTime: 10 * 60 * 1000,
  })

  const [, setIsManualRefreshing] = useState(false)

  const startOAuthMutation = trpc.claude.startMcpOAuth.useMutation()
  // [STUB] testMcpConnections is not yet implemented in the router
  const testConnectionsMutation = {
    mutateAsync: async (_opts: { projectPath: string }) => {},
    isPending: false,
  }

  const groups = useMemo(
    () => (allMcpConfig?.groups || []).filter(g => g.mcpServers.length > 0),
    [allMcpConfig?.groups]
  )
  const totalServers = useMemo(
    () => groups.reduce((acc, g) => acc + g.mcpServers.length, 0),
    [groups]
  )

  // Sort servers by status: connected first, then needs-auth, then failed/other
  const sortedGroups = useMemo(() => {
    const statusOrder: Record<string, number> = {
      connected: 0,
      pending: 1,
      "needs-auth": 2,
      failed: 3,
    }
    return groups.map((g) => ({
      ...g,
      mcpServers: [...g.mcpServers].sort(
        (a, b) => (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3)
      ),
    }))
  }, [groups])

  // Filter groups by search query
  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return sortedGroups
    const q = searchQuery.toLowerCase()
    return sortedGroups
      .map((g) => ({
        ...g,
        mcpServers: g.mcpServers.filter((s) => s.name.toLowerCase().includes(q)),
      }))
      .filter((g) => g.mcpServers.length > 0)
  }, [sortedGroups, searchQuery])

  // Flat list of all server keys for keyboard navigation
  const allServerKeys = useMemo(
    () => filteredGroups.flatMap((g) => g.mcpServers.map((s) => `${g.groupName}-${s.name}`)),
    [filteredGroups]
  )

  const { containerRef: listRef, onKeyDown: listKeyDown } = useListKeyboardNav({
    items: allServerKeys,
    selectedItem: selectedServerKey,
    onSelect: setSelectedServerKey,
  })

  // Auto-select first server when data loads (sorted, so connected first)
  useEffect(() => {
    if (selectedServerKey || isLoadingConfig) return
    for (const group of sortedGroups) {
      if (group.mcpServers.length > 0) {
        setSelectedServerKey(`${group.groupName}-${group.mcpServers[0]!.name}`)
        return
      }
    }
  }, [sortedGroups, selectedServerKey, isLoadingConfig])

  // Find selected server
  const selectedServer = useMemo(() => {
    if (!selectedServerKey) return null
    for (const group of groups) {
      for (const server of group.mcpServers) {
        if (`${group.groupName}-${server.name}` === selectedServerKey) {
          return { server, group }
        }
      }
    }
    return null
  }, [selectedServerKey, groups])

const handleRefresh = useCallback(async (silent = false, testConnections = false) => {
    setIsManualRefreshing(true)
    try {
      if (testConnections) {
        // First fetch config to get project paths
        const configResult = await refetch()
        const groups = configResult.data?.groups || []

        // Find a project path to test connections with
        const projectPath = groups.find(g => g.projectPath)?.projectPath
        if (projectPath) {
          try {
            await testConnectionsMutation.mutateAsync({ projectPath })
          } catch {
            // Ignore test connection errors, just proceed with refresh
          }
          // Refetch again to get updated statuses from cache
          await refetch()
        }
      } else {
        await refetch()
      }

      if (!silent) {
        toast.success("Refreshed MCP servers")
      }
    } catch {
      if (!silent) {
        toast.error("Failed to refresh MCP servers")
      }
    } finally {
      setIsManualRefreshing(false)
    }
  }, [refetch, testConnectionsMutation])

// Initial load on mount - test connections and refresh
  const hasInitialized = useRef(false)
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true
      handleRefresh(true, true)
    }
  }, [handleRefresh])

  // Sync Settings MCP data → sessionInfoAtom (Widget's data source)
  useEffect(() => {
    if (!allMcpConfig?.groups) return

    const allServers: MCPServer[] = []
    const allTools: string[] = []

    for (const group of allMcpConfig.groups) {
      for (const server of group.mcpServers) {
        allServers.push({
          name: server.name,
          status: server.status as MCPServerStatus,
        })
        if (server.tools) {
          for (const tool of server.tools) {
            const toolName = typeof tool === "string" ? tool : tool.name
            allTools.push(`mcp__${server.name}__${toolName}`)
          }
        }
      }
    }

    setSessionInfo((prev) => ({
      tools: allTools.length > 0 ? allTools : (prev?.tools || []),
      mcpServers: allServers,
      plugins: prev?.plugins || [],
      skills: prev?.skills || [],
    }))
  }, [allMcpConfig?.groups, setSessionInfo])

  // Invalidate tRPC cache on unmount so next open gets fresh data
  useEffect(() => {
    return () => {
      trpcUtils.claude.getAllMcpConfig.invalidate()
    }
  }, [trpcUtils])

  const handleAuth = async (serverName: string, projectPath: string | null) => {
    try {
      const result = await startOAuthMutation.mutateAsync({
        serverName,
        projectPath: projectPath ?? "__global__",
      })
      if (result.success) {
        toast.success(`${serverName} authenticated, refreshing...`)
        // Plugin servers get promoted to Global after OAuth — update selection
        setSelectedServerKey(`Global-${serverName}`)
        await handleRefresh(true)
      } else {
        toast.error(result.error || "Authentication failed")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Authentication failed"
      toast.error(message)
    }
  }

  const retryMcpMutation = trpc.claude.retryMcpServer.useMutation()

  const handleRetry = async (serverName: string, groupName: string) => {
    try {
      toast.loading(`Retrying ${serverName}...`, { id: `retry-${serverName}` })
      const result = await retryMcpMutation.mutateAsync({ serverName, groupName })

      if (result.success) {
        toast.success(`${serverName} connected (${result.tools.length} tools)`, { id: `retry-${serverName}` })
        await handleRefresh(true)
      } else {
        toast.error(result.error || "Connection failed", { id: `retry-${serverName}` })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Retry failed"
      toast.error(message, { id: `retry-${serverName}` })
    }
  }

  // Delete MCP server
  const removeServerMutation = trpc.claude.removeMcpServer.useMutation()

  const handleDelete = async () => {
    if (!deletingServer) return
    const { server, scope, projectPath: serverProjectPath, pluginSource } = deletingServer

    try {
      await removeServerMutation.mutateAsync({
        name: server.name,
        scope,
        projectPath: serverProjectPath ?? undefined,
        pluginSource,
      })
      toast.success(t('mcp.serverDeleted', { name: server.name }))
      setDeletingServer(null)
      setSelectedServerKey(null)
      await handleRefresh(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('mcp.deleteError')
      toast.error(message)
    }
  }

  // Get scope type from group name
  const getScopeFromGroupName = (groupName: string): ScopeType => {
    if (groupName === "Global") return "global"
    if (groupName.startsWith("Plugin:")) return "plugin"
    if (groupName === "Built-in") return "global"
    return "project"
  }

  // Extract plugin source from group name (e.g., "Plugin: foo:bar" → "foo:bar")
  const getPluginSourceFromGroupName = (groupName: string): string | undefined => {
    if (groupName.startsWith("Plugin: ")) return groupName.slice("Plugin: ".length)
    return undefined
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar - server list */}
      <ResizableSidebar
        isOpen={true}
        onClose={() => {}}
        widthAtom={settingsMcpSidebarWidthAtom}
        minWidth={200}
        maxWidth={400}
        side="left"
        animationDuration={0}
        initialWidth={240}
        exitWidth={240}
        disableClickToClose={true}
      >
        <div className="flex flex-col h-full bg-background border-r overflow-hidden" style={{ borderRightWidth: "0.5px" }}>
          {/* Search + Add */}
          <div className="px-2 pt-2 shrink-0 flex items-center gap-1.5">
            <input
              ref={searchInputRef}
              placeholder={t('mcp.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={listKeyDown}
              className="h-7 w-full rounded-lg text-sm bg-muted border border-input px-3 placeholder:text-muted-foreground/40 outline-hidden"
            />
            <button
              onClick={() => { setShowAddForm(true); setSelectedServerKey(null) }}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors cursor-pointer"
              title={t('mcp.addTooltip')}
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {/* Server list */}
          <div ref={listRef} onKeyDown={listKeyDown} tabIndex={-1} className="flex-1 overflow-y-auto px-2 pt-2 pb-2 outline-hidden">
            {isLoadingConfig ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
              </div>
            ) : totalServers === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <OriginalMCPIcon className="h-8 w-8 text-border mb-3" />
                <p className="text-sm text-muted-foreground mb-1">{t('mcp.emptyState')}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-1"
                  onClick={() => setShowAddForm(true)}
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add server
                </Button>
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">{t('mcp.noResults')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredGroups.map((group) => (
                  <div key={group.groupName} className="flex flex-col gap-0.5">
                    {group.mcpServers.map((server) => {
                      const key = `${group.groupName}-${server.name}`
                      const isSelected = selectedServerKey === key
                      const needsLogin = server.status === "needs-login"
                      const isDisabled = disabledServers.has(server.name)

                      const handleClick = () => {
                        if (needsLogin) {
                          // Navigate to Account settings for login
                          setSettingsActiveTab("profile")
                        } else {
                          setSelectedServerKey(key)
                        }
                      }

                      return (
                        <div
                          key={key}
                          data-item-id={key}
                          className={cn(
                            "w-full text-left py-1.5 pl-2 pr-2 rounded-md cursor-pointer group relative flex items-center gap-1.5",
                            "transition-colors duration-75",
                            "outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70",
                            needsLogin && "opacity-50",
                            isDisabled && "opacity-50",
                            isSelected
                              ? "bg-foreground/5 text-foreground"
                              : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                          )}
                        >
                          {/* Toggle button */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => toggleMcpServer(server.name, e)}
                                className={cn(
                                  "shrink-0 flex items-center justify-center h-5 w-5 rounded transition-all hover:bg-foreground/10",
                                  isDisabled
                                    ? "text-muted-foreground hover:text-foreground"
                                    : "text-green-500 hover:text-green-600",
                                )}
                              >
                                <Power className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              {isDisabled ? t('mcp.enableServer') : t('mcp.disableServer')}
                            </TooltipContent>
                          </Tooltip>

                          {/* Server info - clickable */}
                          <button
                            onClick={handleClick}
                            className="flex-1 min-w-0 flex flex-col gap-0.5 text-left"
                          >
                            <div className="flex items-center gap-1">
                              <span className={cn(
                                "truncate block text-sm leading-tight flex-1",
                                isDisabled && "line-through"
                              )}>
                                {server.name}
                              </span>
                              <div className="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                                <McpStatusDot status={server.status} />
                              </div>
                            </div>
                            <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 min-w-0">
                              <span className="truncate flex-1 min-w-0">
                                {group.groupName}
                              </span>
                              {isDisabled ? (
                                <span className="shrink-0 text-orange-500">
                                  {t('mcp.disabled')}
                                </span>
                              ) : server.status !== "pending" && (
                                <span className={cn("shrink-0", needsLogin && "text-orange-500")}>
                                  {needsLogin
                                    ? t('mcp.requiresLogin')
                                    : server.status === "connected"
                                      ? `${server.tools.length} ${server.tools.length !== 1 ? t('mcp.tools_plural') : t('mcp.tools')}`
                                      : getStatusText(server.status)}
                                </span>
                              )}
                            </div>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}

          </div>
        </div>
      </ResizableSidebar>

      {/* Right content - detail panel */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {showAddForm ? (
          <CreateMcpServerForm
            onCreated={() => { setShowAddForm(false); handleRefresh(true) }}
            onCancel={() => setShowAddForm(false)}
            hasProject={!!selectedProject?.path}
          />
        ) : selectedServer ? (
          <McpServerDetail
            server={selectedServer.server}
            groupName={selectedServer.group.groupName}
            onAuth={() => handleAuth(selectedServer.server.name, selectedServer.group.projectPath)}
            onRetry={() => handleRetry(selectedServer.server.name, selectedServer.group.groupName)}
            onEdit={() => setEditingServer({
              server: selectedServer.server,
              scope: getScopeFromGroupName(selectedServer.group.groupName),
              projectPath: selectedServer.group.projectPath,
              pluginSource: getPluginSourceFromGroupName(selectedServer.group.groupName),
            })}
            onDelete={() => setDeletingServer({
              server: selectedServer.server,
              scope: getScopeFromGroupName(selectedServer.group.groupName),
              projectPath: selectedServer.group.projectPath,
              pluginSource: getPluginSourceFromGroupName(selectedServer.group.groupName),
            })}
            isDeleting={removeServerMutation.isPending}
          />
        ) : isLoadingConfig ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <OriginalMCPIcon className="h-12 w-12 text-border mb-4" />
            <p className="text-sm text-muted-foreground">
              {totalServers > 0
                ? t('mcp.selectToView')
                : t('mcp.noServersConfigured')}
            </p>
            {totalServers === 0 && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setShowAddForm(true)}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                {t('mcp.addFirst')}
              </Button>
            )}
          </div>
        )}
      </div>

      <AddMcpServerDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onServerAdded={() => handleRefresh(true)}
      />
      <EditMcpServerDialog
        open={!!editingServer}
        onOpenChange={(open) => { if (!open) setEditingServer(null) }}
        server={editingServer?.server || null}
        scope={editingServer?.scope || "global"}
        projectPath={editingServer?.projectPath ?? undefined}
        pluginSource={editingServer?.pluginSource}
        onServerUpdated={() => handleRefresh(true)}
        onServerDeleted={() => { handleRefresh(true); setSelectedServerKey(null) }}
      />
      <DeleteServerConfirm
        open={!!deletingServer}
        onOpenChange={(open) => { if (!open) setDeletingServer(null) }}
        serverName={deletingServer?.server.name || ""}
        onConfirm={handleDelete}
        isDeleting={removeServerMutation.isPending}
      />
    </div>
  )
}
