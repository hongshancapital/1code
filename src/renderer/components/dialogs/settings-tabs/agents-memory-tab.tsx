/**
 * Memory Settings Tab
 * Displays memory statistics, timeline, and management options
 * Borrowed from claude-mem architecture
 */

import { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "../../ui/button"
import { ScrollArea } from "../../ui/scroll-area"
import { trpc } from "../../../lib/trpc"
import { toast } from "sonner"
import {
  Brain,
  Calendar,
  Eye,
  MessageSquare,
  Search,
  Trash2,
  RefreshCw,
  Bug,
  Sparkles,
  Target,
  FileEdit,
  Circle,
  Database,
  CheckCircle,
  XCircle,
  X,
  MessageCircle,
  Filter,
  ChevronDown,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "../../ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../ui/alert-dialog"
import { useAtomValue } from "jotai"
import { selectedProjectAtom } from "../../../features/agents/atoms"

// Observation type icons (borrowed from claude-mem)
const OBSERVATION_ICONS: Record<string, React.ReactNode> = {
  discovery: <Search className="h-4 w-4 text-blue-500" />,
  decision: <Target className="h-4 w-4 text-purple-500" />,
  bugfix: <Bug className="h-4 w-4 text-red-500" />,
  feature: <Sparkles className="h-4 w-4 text-green-500" />,
  refactor: <RefreshCw className="h-4 w-4 text-orange-500" />,
  change: <FileEdit className="h-4 w-4 text-gray-500" />,
  response: <MessageCircle className="h-4 w-4 text-indigo-500" />,
}

// Observation type labels
const OBSERVATION_TYPE_LABELS: Record<string, string> = {
  discovery: "Discovery",
  decision: "Decision",
  bugfix: "Bug Fix",
  feature: "Feature",
  refactor: "Refactor",
  change: "Change",
  response: "AI Response",
}

// Helper to format date
function formatDate(epoch: number | null): string {
  if (!epoch) return "Unknown"
  const date = new Date(epoch)
  const now = new Date()
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  )

  if (diffDays === 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`

  return date.toLocaleDateString()
}

// Safe JSON parse helper
function safeJsonParse<T extends unknown[]>(json: string | null, fallback: T): T {
  if (!json) return fallback
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as T) : fallback
  } catch {
    return fallback
  }
}

// Stat card component
function StatCard({
  title,
  value,
  icon,
  isLoading,
}: {
  title: string
  value: number
  icon: React.ReactNode
  isLoading?: boolean
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 overflow-hidden">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-primary/10 shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-2xl font-bold truncate">
            {isLoading ? "..." : value.toLocaleString()}
          </p>
          <p className="text-sm text-muted-foreground truncate">{title}</p>
        </div>
      </div>
    </div>
  )
}

// Session with counts type
interface SessionWithCounts {
  id: string
  projectId: string | null
  chatId: string | null
  subChatId: string | null
  status: string
  startedAtEpoch: number | null
  completedAtEpoch: number | null
  summaryRequest: string | null
  summaryLearned: string | null
  summaryCompleted: string | null
  observationCount: number
  promptCount: number
}

// Session item component
function SessionItem({
  session,
}: {
  session: SessionWithCounts
}) {
  const totalItems = session.observationCount + session.promptCount
  const statusIcon = session.status === "completed" ? (
    <CheckCircle className="h-3 w-3 text-green-500" />
  ) : session.status === "failed" ? (
    <XCircle className="h-3 w-3 text-red-500" />
  ) : (
    <Circle className="h-3 w-3 text-yellow-500 animate-pulse" />
  )

  return (
    <div className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors">
      <div className="shrink-0">{statusIcon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {session.summaryRequest || `Session ${session.id.slice(0, 8)}`}
          </span>
          <span className="text-xs text-muted-foreground">
            {session.startedAtEpoch ? formatDate(session.startedAtEpoch) : "Unknown"}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {session.observationCount} observations
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {session.promptCount} prompts
          </span>
        </div>
      </div>
      {totalItems > 0 && (
        <div className="shrink-0 px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
          {totalItems} items
        </div>
      )}
    </div>
  )
}

// Sessions list component
function SessionsList({
  sessions,
}: {
  sessions: SessionWithCounts[]
}) {
  // Sort by time (newest first)
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => (b.startedAtEpoch || 0) - (a.startedAtEpoch || 0))
  }, [sessions])

  // Group by date
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, SessionWithCounts[]>()
    for (const session of sortedSessions) {
      const date = formatDate(session.startedAtEpoch)
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(session)
    }
    return groups
  }, [sortedSessions])

  if (sortedSessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Calendar className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground">No sessions yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Sessions are created when you chat with the AI
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {Array.from(groupedByDate.entries()).map(([date, items]) => (
        <div key={date}>
          {/* Date header */}
          <div className="flex items-center gap-2 mb-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium text-muted-foreground px-2">
              {date}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Session items */}
          <div className="space-y-1">
            {items.map((session) => (
              <SessionItem key={session.id} session={session} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Full observation type for detail view
interface FullObservation {
  id: string
  type: string
  title: string | null
  subtitle: string | null
  narrative: string | null
  facts: string | null
  concepts: string | null
  filesRead: string | null
  filesModified: string | null
  toolName: string | null
  toolCallId: string | null
  createdAtEpoch: number | null
}

// Vertical timeline with step indicator
function MemoryTimeline({
  observations,
  typeFilter,
  onSelectObservation,
  onDeleteObservation,
}: {
  observations: Array<{
    id: string
    type: string
    title: string | null
    subtitle: string | null
    narrative: string | null
    createdAtEpoch: number | null
  }>
  typeFilter: string | null
  onSelectObservation?: (id: string) => void
  onDeleteObservation?: (id: string) => void
}) {
  // Apply type filter
  const filteredObservations = useMemo(() => {
    if (!typeFilter) return observations
    return observations.filter((obs) => obs.type === typeFilter)
  }, [observations, typeFilter])

  // Sort by time (newest first)
  const sortedObservations = useMemo(() => {
    return [...filteredObservations].sort((a, b) => (b.createdAtEpoch || 0) - (a.createdAtEpoch || 0))
  }, [filteredObservations])

  // Group by date
  const groupedByDate = useMemo(() => {
    const groups = new Map<string, typeof sortedObservations>()
    for (const obs of sortedObservations) {
      const date = formatDate(obs.createdAtEpoch)
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(obs)
    }
    return groups
  }, [sortedObservations])

  if (sortedObservations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Brain className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground">No memories yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Memories are collected as you use the chat
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {Array.from(groupedByDate.entries()).map(([date, items]) => (
        <div key={date}>
          {/* Date header */}
          <div className="flex items-center gap-2 mb-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs font-medium text-muted-foreground px-2">
              {date}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Timeline items */}
          <div className="relative pl-6">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

            <div className="space-y-3">
              {items.map((obs, index) => (
                <div
                  key={obs.id}
                  className="relative flex items-start gap-3 cursor-pointer group"
                  onClick={() => onSelectObservation?.(obs.id)}
                >
                  {/* Step indicator */}
                  <div className="absolute -left-6 mt-1 flex items-center justify-center w-4 h-4 rounded-full bg-background border-2 border-primary/50 group-hover:border-primary transition-colors">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary/50 group-hover:bg-primary transition-colors" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 p-2 rounded-md hover:bg-muted/50 transition-colors -ml-1">
                    <div className="flex items-center gap-2">
                      {OBSERVATION_ICONS[obs.type] || <Circle className="h-4 w-4 text-gray-400" />}
                      <span className="text-sm font-medium truncate">
                        {obs.title || "Untitled"}
                      </span>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">
                        {obs.createdAtEpoch ? new Date(obs.createdAtEpoch).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    {obs.subtitle && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate pl-6">
                        {obs.subtitle}
                      </p>
                    )}
                    {obs.narrative && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2 pl-6">
                        {obs.narrative}
                      </p>
                    )}
                  </div>

                  {/* Delete button */}
                  {onDeleteObservation && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteObservation(obs.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function AgentsMemoryTab() {
  const { t } = useTranslation("settings")
  const selectedProject = useAtomValue(selectedProjectAtom)
  // Default to showing all projects, can filter to specific project
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const projectId = selectedProjectId
  const [isClearing, setIsClearing] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [selectedObservationId, setSelectedObservationId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"observations" | "sessions">("observations")

  // Fetch stats
  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = trpc.memory.getStats.useQuery({ projectId: projectId || undefined })

  // Fetch recent memories
  const {
    data: recent,
    isLoading: recentLoading,
    refetch: refetchRecent,
  } = trpc.memory.getRecentMemories.useQuery({
    projectId: projectId || undefined,
    limit: 50,
  })

  // Fetch single observation for detail view
  const { data: selectedObservation, isLoading: observationLoading } =
    trpc.memory.getObservation.useQuery(
      { id: selectedObservationId! },
      { enabled: !!selectedObservationId }
    )

  // Clear all memory mutation
  const clearAllMutation = trpc.memory.clearAllMemory.useMutation({
    onSuccess: () => {
      toast.success("All memory cleared")
      refetchStats()
      refetchRecent()
      setIsClearing(false)
    },
    onError: (error) => {
      toast.error(error.message)
      setIsClearing(false)
    },
  })

  // Delete single observation mutation
  const deleteMutation = trpc.memory.deleteObservation.useMutation({
    onSuccess: () => {
      toast.success("Memory deleted")
      refetchStats()
      refetchRecent()
      setSelectedObservationId(null)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleClear = () => {
    setIsClearing(true)
    clearAllMutation.mutate()
  }

  const handleRefresh = () => {
    refetchStats()
    refetchRecent()
    toast.success("Memory refreshed")
  }

  const handleDeleteObservation = (id: string) => {
    if (confirm("Delete this memory?")) {
      deleteMutation.mutate({ id })
    }
  }

  const isLoading = statsLoading || recentLoading

  // Get unique types from observations for filter dropdown
  const availableTypes = useMemo(() => {
    const types = new Set<string>()
    recent?.observations?.forEach((obs) => {
      if (obs.type) types.add(obs.type)
    })
    return Array.from(types)
  }, [recent?.observations])

  return (
    <div className="p-6 flex flex-col gap-4 h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Memory
          </h3>
          <p className="text-sm text-muted-foreground">
            {projectId
              ? "Filtered by project"
              : "All memories"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 shrink-0">
        <StatCard
          title="Sessions"
          value={stats?.sessions ?? 0}
          icon={<Calendar className="h-5 w-5 text-primary" />}
          isLoading={statsLoading}
        />
        <StatCard
          title="Observations"
          value={stats?.observations ?? 0}
          icon={<Eye className="h-5 w-5 text-primary" />}
          isLoading={statsLoading}
        />
        <StatCard
          title="Prompts"
          value={stats?.prompts ?? 0}
          icon={<MessageSquare className="h-5 w-5 text-primary" />}
          isLoading={statsLoading}
        />
        <StatCard
          title="Vectors"
          value={stats?.vectors ?? 0}
          icon={<Database className="h-5 w-5 text-primary" />}
          isLoading={statsLoading}
        />
      </div>

      {/* Vector Store Status */}
      <div className="flex items-center gap-2 text-sm shrink-0">
        {stats?.vectorStoreReady ? (
          <>
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-green-600 dark:text-green-400">
              Vector search enabled
            </span>
          </>
        ) : (
          <>
            <XCircle className="h-4 w-4 text-yellow-500" />
            <span className="text-yellow-600 dark:text-yellow-400">
              Vector search initializing...
            </span>
          </>
        )}
      </div>

      {/* Timeline */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between mb-2 shrink-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Recent Memory
            </h4>
            {/* View toggle */}
            <div className="flex items-center border rounded-md p-0.5 bg-muted/30">
              <Button
                variant={viewMode === "observations" ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setViewMode("observations")}
              >
                <Eye className="h-3 w-3 mr-1" />
                Observations
              </Button>
              <Button
                variant={viewMode === "sessions" ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setViewMode("sessions")}
              >
                <Calendar className="h-3 w-3 mr-1" />
                Sessions
              </Button>
            </div>
          </div>
          {viewMode === "observations" && availableTypes.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-7 text-xs">
                  <Filter className="h-3 w-3 mr-1" />
                  {typeFilter ? OBSERVATION_TYPE_LABELS[typeFilter] || typeFilter : "All Types"}
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setTypeFilter(null)}>
                  All Types
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {availableTypes.map((type) => (
                  <DropdownMenuItem key={type} onClick={() => setTypeFilter(type)}>
                    <span className="mr-2">{OBSERVATION_ICONS[type]}</span>
                    {OBSERVATION_TYPE_LABELS[type] || type}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <ScrollArea className="flex-1 border rounded-lg p-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : viewMode === "observations" ? (
            <MemoryTimeline
              observations={recent?.observations ?? []}
              typeFilter={typeFilter}
              onSelectObservation={setSelectedObservationId}
              onDeleteObservation={handleDeleteObservation}
            />
          ) : (
            <SessionsList
              sessions={(recent?.sessions ?? []) as SessionWithCounts[]}
            />
          )}
        </ScrollArea>
      </div>

      {/* Observation Detail Dialog */}
      <Dialog open={!!selectedObservationId} onOpenChange={(open) => !open && setSelectedObservationId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedObservation?.type && OBSERVATION_ICONS[selectedObservation.type]}
              {selectedObservation?.title || "Observation Detail"}
            </DialogTitle>
            {selectedObservation?.subtitle && (
              <DialogDescription>{selectedObservation.subtitle}</DialogDescription>
            )}
          </DialogHeader>

          {observationLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectedObservation ? (
            <div className="space-y-4">
              {/* Type & Time */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  {OBSERVATION_ICONS[selectedObservation.type]}
                  {OBSERVATION_TYPE_LABELS[selectedObservation.type] || selectedObservation.type}
                </span>
                <span>{formatDate(selectedObservation.createdAtEpoch)}</span>
                {selectedObservation.toolName && (
                  <span className="px-2 py-0.5 bg-muted rounded text-xs">
                    {selectedObservation.toolName}
                  </span>
                )}
              </div>

              {/* Narrative */}
              {selectedObservation.narrative && (
                <div>
                  <h5 className="text-sm font-medium mb-1">Content</h5>
                  <div className="p-3 bg-muted/50 rounded-lg text-sm whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                    {selectedObservation.narrative}
                  </div>
                </div>
              )}

              {/* Facts */}
              {safeJsonParse(selectedObservation.facts, []).length > 0 && (
                <div>
                  <h5 className="text-sm font-medium mb-1">Facts</h5>
                  <div className="flex flex-wrap gap-1">
                    {safeJsonParse(selectedObservation.facts, []).map((fact: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-blue-500/10 text-blue-600 rounded text-xs">
                        {fact}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Concepts */}
              {safeJsonParse(selectedObservation.concepts, []).length > 0 && (
                <div>
                  <h5 className="text-sm font-medium mb-1">Concepts</h5>
                  <div className="flex flex-wrap gap-1">
                    {safeJsonParse(selectedObservation.concepts, []).map((concept: string, i: number) => (
                      <span key={i} className="px-2 py-0.5 bg-purple-500/10 text-purple-600 rounded text-xs">
                        {concept}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Files Read */}
              {safeJsonParse(selectedObservation.filesRead, []).length > 0 && (
                <div>
                  <h5 className="text-sm font-medium mb-1">Files Read</h5>
                  <div className="space-y-1">
                    {safeJsonParse(selectedObservation.filesRead, []).map((file: string, i: number) => (
                      <div key={i} className="text-xs text-muted-foreground font-mono truncate">
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Files Modified */}
              {safeJsonParse(selectedObservation.filesModified, []).length > 0 && (
                <div>
                  <h5 className="text-sm font-medium mb-1">Files Modified</h5>
                  <div className="space-y-1">
                    {safeJsonParse(selectedObservation.filesModified, []).map((file: string, i: number) => (
                      <div key={i} className="text-xs text-muted-foreground font-mono truncate">
                        {file}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Delete Button */}
              <div className="pt-4 border-t">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm("Delete this memory?")) {
                      deleteMutation.mutate({ id: selectedObservation.id })
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Memory
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Danger Zone */}
      {stats && stats.observations > 0 && (
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-destructive mb-2">
            Danger Zone
          </h4>
          <p className="text-sm text-muted-foreground mb-3">
            Clear all memory. This action cannot be undone.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={isClearing}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {isClearing ? "Clearing..." : "Clear All Memory"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all {stats?.observations || 0} observations,
                  {stats?.prompts || 0} prompts, and {stats?.sessions || 0} sessions.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClear}>
                  Delete All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  )
}
