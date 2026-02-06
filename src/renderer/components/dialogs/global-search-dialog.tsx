/**
 * Global Search Dialog
 * Cmd+K style search dialog for searching across memories, chats, and files
 */

import * as React from "react"
import { useCallback, useEffect, useState, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "../ui/command"
import {
  Dialog,
  DialogContent,
} from "../ui/dialog"
import { trpc } from "../../lib/trpc"
import { selectedProjectAtom, selectedAgentChatIdAtom, showNewChatFormAtom, selectedChatIsRemoteAtom } from "../../features/agents/atoms"
import { betaMemoryEnabledAtom, chatSourceModeAtom } from "../../lib/atoms"
import { useAgentSubChatStore } from "../../features/agents/stores/sub-chat-store"
import { toast } from "sonner"
import {
  Search,
  Brain,
  MessageSquare,
  Eye,
  FileText,
  Clock,
  Sparkles,
  Bug,
  Target,
  RefreshCw,
  FileEdit,
  ArrowRight,
} from "lucide-react"
import { cn } from "../../lib/utils"
import { useTranslation } from "react-i18next"

// Match the type from hybrid-search.ts but define locally to avoid main->renderer import
export interface HybridSearchResult {
  type: "observation" | "prompt" | "session"
  id: string
  title: string
  subtitle: string | null
  excerpt: string | null
  sessionId: string
  projectId: string | null
  createdAtEpoch: number
  score: number
  // For scrolling to specific content after navigation
  toolCallId?: string | null
  // Debug info
  ftsScore?: number
  vectorScore?: number
}

// Atom for dialog open state
export const globalSearchOpenAtom = atomWithStorage("global-search-open", false)

// Atom for dialog height (persisted)
export const globalSearchHeightAtom = atomWithStorage("global-search-height", 500)

// Height constraints
const MIN_HEIGHT = 300
const MAX_HEIGHT = 800

// Observation type icons
const OBSERVATION_ICONS: Record<string, React.ReactNode> = {
  discovery: <Eye className="h-4 w-4 text-blue-500" />,
  decision: <Target className="h-4 w-4 text-purple-500" />,
  bugfix: <Bug className="h-4 w-4 text-red-500" />,
  feature: <Sparkles className="h-4 w-4 text-green-500" />,
  refactor: <RefreshCw className="h-4 w-4 text-orange-500" />,
  change: <FileEdit className="h-4 w-4 text-gray-500" />,
}

// Result type icons
const TYPE_ICONS: Record<string, React.ReactNode> = {
  observation: <Brain className="h-4 w-4 text-primary" />,
  prompt: <MessageSquare className="h-4 w-4 text-blue-500" />,
  session: <Clock className="h-4 w-4 text-gray-500" />,
}

// Format relative time
function formatRelativeTime(epoch: number): string {
  const now = Date.now()
  const diff = now - epoch
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(epoch).toLocaleDateString()
}

// Highlight matching text
function HighlightedText({
  text,
  query,
  maxLength = 150,
}: {
  text: string
  query: string
  maxLength?: number
}) {
  if (!query.trim()) {
    return <span>{text.slice(0, maxLength)}</span>
  }

  const truncated = text.length > maxLength ? text.slice(0, maxLength) + "..." : text
  const parts = truncated.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"))

  return (
    <span>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </span>
  )
}

// Search result item component
function SearchResultItem({
  result,
  query,
  onSelect,
}: {
  result: HybridSearchResult
  query: string
  onSelect: () => void
}) {
  const icon = result.type === "observation"
    ? OBSERVATION_ICONS[(result as any).observationType] || TYPE_ICONS.observation
    : TYPE_ICONS[result.type]

  return (
    <CommandItem
      value={result.id}
      onSelect={onSelect}
      className="flex items-start gap-3 py-2"
    >
      <div className="mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            <HighlightedText text={result.title} query={query} maxLength={60} />
          </span>
          {result.score !== undefined && result.score > 0.5 && (
            <span className="text-xs text-green-500">High match</span>
          )}
        </div>
        {result.excerpt && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            <HighlightedText text={result.excerpt} query={query} maxLength={120} />
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(result.createdAtEpoch)}
          </span>
          {result.ftsScore !== undefined && result.vectorScore !== undefined && (
            <span className="text-xs text-muted-foreground opacity-50">
              FTS: {result.ftsScore.toFixed(3)} | Vec: {result.vectorScore.toFixed(3)}
            </span>
          )}
        </div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </CommandItem>
  )
}

// Group results by type
function groupResults(results: HybridSearchResult[]): Map<string, HybridSearchResult[]> {
  const groups = new Map<string, HybridSearchResult[]>()

  for (const result of results) {
    const key = result.type
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(result)
  }

  return groups
}

// Group label keys for i18n
const GROUP_LABEL_KEYS: Record<string, string> = {
  observation: "globalSearch.groups.observation",
  prompt: "globalSearch.groups.prompt",
  session: "globalSearch.groups.session",
}

export function GlobalSearchDialog() {
  const { t } = useTranslation('dialogs')
  const [open, setOpen] = useAtom(globalSearchOpenAtom)
  const [dialogHeight, setDialogHeight] = useAtom(globalSearchHeightAtom)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const selectedProject = useAtomValue(selectedProjectAtom)
  const betaMemoryEnabled = useAtomValue(betaMemoryEnabledAtom)

  // Resize state
  const [isResizing, setIsResizing] = useState(false)
  const resizeStartY = useRef(0)
  const resizeStartHeight = useRef(0)

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
    resizeStartY.current = e.clientY
    resizeStartHeight.current = dialogHeight
  }, [dialogHeight])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - resizeStartY.current
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, resizeStartHeight.current + deltaY))
      setDialogHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isResizing, setDialogHeight])

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  // Search query (only when beta memory is enabled)
  const { data: results, isLoading } = trpc.memory.search.useQuery(
    {
      query: debouncedQuery,
      projectId: selectedProject?.id,
      limit: 30,
      mode: "hybrid",
    },
    {
      enabled: betaMemoryEnabled && debouncedQuery.length > 1,
      staleTime: 30000,
    },
  )

  // Group results
  const groupedResults = useMemo((): Map<string, HybridSearchResult[]> => {
    if (!results) return new Map<string, HybridSearchResult[]>()
    return groupResults(results as HybridSearchResult[])
  }, [results])

  // Handle keyboard shortcut (only when beta memory is enabled)
  useEffect(() => {
    if (!betaMemoryEnabled) return

    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((open) => !open)
      }
    }

    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [setOpen, betaMemoryEnabled])

  // Reset query when dialog closes
  useEffect(() => {
    if (!open) {
      setQuery("")
      setDebouncedQuery("")
    }
  }, [open])

  // Navigation helpers
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setChatSourceMode = useSetAtom(chatSourceModeAtom)
  const subChatStore = useAgentSubChatStore()
  const utils = trpc.useUtils()

  // Restore archived chat mutation - with optimistic cache update (matching archive-popover behavior)
  const restoreChatMutation = trpc.chats.restore.useMutation({
    onSuccess: (restoredChat) => {
      // Optimistically add restored chat to the main list cache
      if (restoredChat) {
        utils.chats.list.setData({}, (oldData) => {
          if (!oldData) return [restoredChat]
          // Add to beginning if not already present
          if (oldData.some((c) => c.id === restoredChat.id)) return oldData
          return [restoredChat, ...oldData]
        })
      }
      // Invalidate both lists to refresh
      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()
    },
  })

  const handleSelect = useCallback(async (result: HybridSearchResult) => {
    setOpen(false)

    // Navigate based on result type
    // sessionId here is memory_sessions.id, not sub_chats.sessionId
    if (result.sessionId) {
      try {
        // Find the subChat via memory_sessions.sub_chat_id
        const data = await utils.chats.getSubChatByMemorySessionId.fetch({
          memorySessionId: result.sessionId
        })

        if (data?.subChat && data.chat) {
          // If chat is archived, restore it first
          const wasArchived = !!data.chat.archivedAt
          if (wasArchived) {
            // Use sync mutate (not async) like archive-popover does
            // The optimistic cache update in onSuccess makes it work immediately
            restoreChatMutation.mutate({ id: data.chat.id })
            toast.info(t('globalSearch.restoredFromArchive'))
          }

          // Navigate immediately (matching archive-popover pattern)
          // Set source mode and remote flags for proper data loading
          setSelectedChatId(data.chat.id)
          setSelectedChatIsRemote(false)
          setChatSourceMode("local")
          setShowNewChatForm(false)

          // Set the active subChat after a delay
          const delay = wasArchived ? 300 : 100
          setTimeout(() => {
            subChatStore.setChatId(data.chat!.id)
            subChatStore.setActiveSubChat(data.subChat.id)

            // Scroll to specific content if toolCallId is available
            if (result.toolCallId) {
              // Wait for messages to render, then scroll to the tool call
              setTimeout(() => {
                // Try multiple selector patterns for tool calls
                const selectors = [
                  `[data-tool-call-id="${result.toolCallId}"]`,
                  `[data-message-id="${result.toolCallId}"]`,
                  `[id="${result.toolCallId}"]`,
                ]

                for (const selector of selectors) {
                  const targetElement = document.querySelector(selector)
                  if (targetElement) {
                    targetElement.scrollIntoView({ behavior: "smooth", block: "center" })
                    // Add highlight effect
                    targetElement.classList.add("ring-2", "ring-primary", "ring-offset-2")
                    setTimeout(() => {
                      targetElement.classList.remove("ring-2", "ring-primary", "ring-offset-2")
                    }, 2000)
                    break
                  }
                }
              }, 300)
            }
          }, delay)

          toast.success(t('globalSearch.navigatedTo', { name: data.subChat.name || t('globalSearch.untitled') }))
        } else {
          toast.info(t('globalSearch.notFound'))
        }
      } catch (error) {
        console.error("[GlobalSearch] Navigation error:", error)
        toast.error(t('globalSearch.navigationError'))
      }
    } else {
      toast.info(t('globalSearch.noSession'))
    }
  }, [setOpen, setSelectedChatId, setSelectedChatIsRemote, setChatSourceMode, setShowNewChatForm, subChatStore, utils, t, restoreChatMutation])

  // Calculate content height (total - header - footer - resize handle)
  const contentHeight = dialogHeight - 44 - 36 - 8 // header ~44px, footer ~36px, handle 8px

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="overflow-hidden p-0 shadow-lg max-w-2xl flex flex-col"
        style={{ height: dialogHeight }}
        showCloseButton={false}
      >
        <Command className="flex flex-col flex-1 min-h-0 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          <div className="flex items-center border-b px-3 shrink-0">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              placeholder={t('globalSearch.placeholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {isLoading && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground ml-2 shrink-0" />
            )}
          </div>
          <CommandList className="flex-1 overflow-y-auto" style={{ maxHeight: contentHeight }}>
            {debouncedQuery.length <= 1 ? (
              <div className="py-6 text-center">
                <Brain className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  {t('globalSearch.typeToSearch')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('globalSearch.pressToClose')} <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Esc</kbd> {t('globalSearch.toClose')}
                </p>
              </div>
            ) : results && results.length === 0 ? (
              <CommandEmpty>
                <div className="py-6 text-center">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {t('globalSearch.noResultsFor', { query: debouncedQuery })}
                  </p>
                </div>
              </CommandEmpty>
            ) : (
              Array.from(groupedResults.entries()).map(([type, items], groupIndex) => (
                <React.Fragment key={type}>
                  {groupIndex > 0 && <CommandSeparator />}
                  <CommandGroup heading={GROUP_LABEL_KEYS[type] ? t(GROUP_LABEL_KEYS[type]) : type}>
                    {items.map((result) => (
                      <SearchResultItem
                        key={result.id}
                        result={result}
                        query={debouncedQuery}
                        onSelect={() => handleSelect(result)}
                      />
                    ))}
                  </CommandGroup>
                </React.Fragment>
              ))
            )}
          </CommandList>
          <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-muted-foreground shrink-0">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-muted rounded">↑</kbd>
                <kbd className="px-1 py-0.5 bg-muted rounded">↓</kbd>
                to navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="px-1 py-0.5 bg-muted rounded">↵</kbd>
                to select
              </span>
            </div>
            {results && results.length > 0 && (
              <span>{results.length} results</span>
            )}
          </div>
        </Command>
        {/* Resize handle */}
        <div
          className={cn(
            "h-2 cursor-ns-resize shrink-0 flex items-center justify-center",
            "hover:bg-muted/50 transition-colors",
            isResizing && "bg-muted/50"
          )}
          onMouseDown={handleResizeStart}
        >
          <div className="w-8 h-1 rounded-full bg-muted-foreground/30" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
