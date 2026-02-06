import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useListKeyboardNav } from "./use-list-keyboard-nav"
import { useAtomValue } from "jotai"
import { selectedProjectAtom, settingsCommandsSidebarWidthAtom } from "../../../features/agents/atoms"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { Terminal } from "lucide-react"
import { Label } from "../../ui/label"
import { ResizableSidebar } from "../../ui/resizable-sidebar"
import { ChatMarkdownRenderer } from "../../chat-markdown-renderer"

interface CommandData {
  name: string
  displayName: string
  description: string
  argumentHint?: string
  source: "user" | "project" | "plugin"
  pluginName?: string
  pluginDisplayName?: string
  path: string
}

// --- Detail Panel ---
function CommandDetail({ command }: { command: CommandData; content: string }) {
  const { t } = useTranslation('settings')
  const { data: contentData } = trpc.commands.getContent.useQuery(
    { path: command.path },
    { staleTime: 1000 * 60 * 5 }
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Terminal className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground font-mono">
                /{command.displayName}
              </h3>
              {command.source === "plugin" && (
                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-medium">
                  {command.pluginDisplayName || t('commands.badges.plugin')}
                </span>
              )}
              {command.source === "user" && (
                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-medium">
                  {t('commands.badges.user')}
                </span>
              )}
              {command.source === "project" && (
                <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-medium">
                  {t('commands.badges.project')}
                </span>
              )}
            </div>
            {command.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{command.description}</p>
            )}
          </div>
        </div>

        {/* Namespaced name (for plugin commands) */}
        {command.source === "plugin" && command.name !== command.displayName && (
          <div className="flex flex-col gap-1.5">
            <Label>{t('commands.detail.namespacedName')}</Label>
            <div className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg">
              <code className="text-xs text-foreground font-mono">/{command.name}</code>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {t('commands.detail.namespacedHint')}
            </p>
          </div>
        )}

        {/* Usage */}
        <div className="flex flex-col gap-1.5">
          <Label>{t('commands.detail.usage')}</Label>
          <div className="px-3 py-2 text-sm bg-muted/50 border border-border rounded-lg">
            <code className="text-xs text-foreground font-mono">
              /{command.displayName}{command.argumentHint ? ` ${command.argumentHint}` : ""}
            </code>
          </div>
        </div>

        {/* Source */}
        <div className="flex flex-col gap-1.5">
          <Label>{t('commands.detail.source')}</Label>
          <p className="text-xs text-muted-foreground font-mono break-all">{command.path}</p>
        </div>

        {/* Instructions/Content */}
        <div className="flex flex-col gap-1.5">
          <Label>{t('commands.detail.instructions')}</Label>
          <div className="rounded-lg border border-border bg-background overflow-hidden px-4 py-3 min-h-[120px]">
            {contentData?.content ? (
              <ChatMarkdownRenderer content={contentData.content} size="sm" />
            ) : (
              <p className="text-sm text-muted-foreground">{t('commands.detail.noInstructions')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// --- Main Component ---
export function AgentsCommandsTab() {
  const { t } = useTranslation('settings')
  const [selectedCommandName, setSelectedCommandName] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  const selectedProject = useAtomValue(selectedProjectAtom)

  const { data: commands = [], isLoading } = trpc.commands.list.useQuery(
    selectedProject?.path ? { projectPath: selectedProject.path } : undefined,
    { staleTime: 1000 * 60 * 5 }
  )

  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return commands
    const q = searchQuery.toLowerCase()
    return commands.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.displayName.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.pluginDisplayName?.toLowerCase().includes(q)
    )
  }, [commands, searchQuery])

  // Group by source
  const projectCommands = filteredCommands.filter((c) => c.source === "project")
  const userCommands = filteredCommands.filter((c) => c.source === "user")
  const pluginCommands = filteredCommands.filter((c) => c.source === "plugin")

  // Group plugin commands by plugin
  const pluginGroups = useMemo(() => {
    const groups = new Map<string, CommandData[]>()
    for (const cmd of pluginCommands) {
      const key = cmd.pluginDisplayName || cmd.pluginName || "Unknown"
      const existing = groups.get(key) || []
      existing.push(cmd)
      groups.set(key, existing)
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [pluginCommands])

  const allCommandNames = useMemo(
    () => [
      ...projectCommands.map((c) => c.name),
      ...userCommands.map((c) => c.name),
      ...pluginCommands.map((c) => c.name),
    ],
    [projectCommands, userCommands, pluginCommands]
  )

  const { containerRef: listRef, onKeyDown: listKeyDown } = useListKeyboardNav({
    items: allCommandNames,
    selectedItem: selectedCommandName,
    onSelect: setSelectedCommandName,
  })

  const selectedCommand = commands.find((c) => c.name === selectedCommandName) || null

  // Auto-select first command when data loads
  useEffect(() => {
    if (selectedCommandName || isLoading || commands.length === 0) return
    setSelectedCommandName(commands[0]!.name)
  }, [commands, selectedCommandName, isLoading])

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left sidebar - command list */}
      <ResizableSidebar
        isOpen={true}
        onClose={() => {}}
        widthAtom={settingsCommandsSidebarWidthAtom}
        minWidth={200}
        maxWidth={400}
        side="left"
        animationDuration={0}
        initialWidth={240}
        exitWidth={240}
        disableClickToClose={true}
      >
        <div className="flex flex-col h-full bg-background border-r overflow-hidden" style={{ borderRightWidth: "0.5px" }}>
          {/* Search */}
          <div className="px-2 pt-2 shrink-0 flex items-center gap-1.5">
            <input
              ref={searchInputRef}
              placeholder={t('commands.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={listKeyDown}
              className="h-7 w-full rounded-lg text-sm bg-muted border border-input px-3 placeholder:text-muted-foreground/40 outline-hidden"
            />
          </div>
          {/* Command list */}
          <div ref={listRef} onKeyDown={listKeyDown} tabIndex={-1} className="flex-1 overflow-y-auto px-2 pt-2 pb-2 outline-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-muted-foreground">{t('commands.loading')}</p>
              </div>
            ) : commands.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <Terminal className="h-8 w-8 text-border mb-3" />
                <p className="text-sm text-muted-foreground mb-1">{t('commands.emptyState')}</p>
                <p className="text-[11px] text-muted-foreground/70">
                  {t('commands.emptyHint')}
                </p>
              </div>
            ) : filteredCommands.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-xs text-muted-foreground">{t('commands.noResults')}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Project Commands */}
                {projectCommands.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t('commands.sections.project')}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {projectCommands.map((cmd) => {
                        const isSelected = selectedCommandName === cmd.name
                        return (
                          <button
                            key={cmd.name}
                            data-item-id={cmd.name}
                            onClick={() => setSelectedCommandName(cmd.name)}
                            className={cn(
                              "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                              isSelected
                                ? "bg-foreground/5 text-foreground"
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                            )}
                          >
                            <span className="text-sm font-mono truncate block">/{cmd.displayName}</span>
                            {cmd.description && (
                              <span className="text-[11px] text-muted-foreground/60 truncate block mt-0.5">
                                {cmd.description}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* User Commands */}
                {userCommands.length > 0 && (
                  <div>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {t('commands.sections.user')}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {userCommands.map((cmd) => {
                        const isSelected = selectedCommandName === cmd.name
                        return (
                          <button
                            key={cmd.name}
                            data-item-id={cmd.name}
                            onClick={() => setSelectedCommandName(cmd.name)}
                            className={cn(
                              "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                              isSelected
                                ? "bg-foreground/5 text-foreground"
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                            )}
                          >
                            <span className="text-sm font-mono truncate block">/{cmd.displayName}</span>
                            {cmd.description && (
                              <span className="text-[11px] text-muted-foreground/60 truncate block mt-0.5">
                                {cmd.description}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Plugin Commands - grouped by plugin */}
                {pluginGroups.map(([pluginName, cmds]) => (
                  <div key={pluginName}>
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
                      {pluginName}
                    </p>
                    <div className="flex flex-col gap-0.5">
                      {cmds.map((cmd) => {
                        const isSelected = selectedCommandName === cmd.name
                        return (
                          <button
                            key={cmd.name}
                            data-item-id={cmd.name}
                            onClick={() => setSelectedCommandName(cmd.name)}
                            className={cn(
                              "w-full text-left py-1.5 px-2 rounded-md transition-colors duration-150 cursor-pointer outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70 focus-visible:-outline-offset-2",
                              isSelected
                                ? "bg-foreground/5 text-foreground"
                                : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                            )}
                          >
                            <span className="text-sm font-mono truncate block">/{cmd.displayName}</span>
                            {cmd.description && (
                              <span className="text-[11px] text-muted-foreground/60 truncate block mt-0.5">
                                {cmd.description}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ResizableSidebar>

      {/* Right content - detail panel */}
      <div className="flex-1 min-w-0 h-full overflow-hidden">
        {selectedCommand ? (
          <CommandDetail command={selectedCommand} content="" />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Terminal className="h-12 w-12 text-border mb-4" />
            <p className="text-sm text-muted-foreground">
              {commands.length > 0
                ? t('commands.selectToView')
                : t('commands.noCommandsFound')}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
