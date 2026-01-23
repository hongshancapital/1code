import { useMemo, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { getFileIconByExtension } from "../agents/mentions/agents-file-mention"
import { ChevronRight, FileEdit, FilePlus, FileX, FolderOpen, Globe, Package } from "lucide-react"
import { cn } from "../../lib/utils"
import { selectedAgentChatIdAtom } from "../agents/atoms"
import { artifactsAtomFamily, type Artifact, type ArtifactContext } from "./atoms"
import { filePreviewPathAtom } from "./atoms"

// ============================================================================
// Types
// ============================================================================

interface ArtifactsPanelProps {
  onFileSelect?: (path: string) => void
}

// ============================================================================
// Hook for artifacts count (for auto-collapse logic)
// ============================================================================

export function useArtifactsCount(): number {
  // Use chatId (not subChatId) to get artifacts for the entire chat
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const artifactsAtom = useMemo(
    () => artifactsAtomFamily(selectedChatId || "default"),
    [selectedChatId]
  )
  const [rawArtifacts] = useAtom(artifactsAtom)
  const artifacts = Array.isArray(rawArtifacts) ? rawArtifacts : []
  return artifacts.length
}

// ============================================================================
// Components
// ============================================================================

/**
 * Status icon for artifacts
 */
function ArtifactStatusIcon({ status }: { status: Artifact["status"] }) {
  switch (status) {
    case "created":
      return <FilePlus className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
    case "modified":
      return <FileEdit className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" />
    case "deleted":
      return <FileX className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
    default:
      return <FileEdit className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
  }
}

/**
 * Context item (file or URL)
 */
function ContextItem({
  context,
  onFileSelect,
}: {
  context: ArtifactContext
  onFileSelect?: (path: string) => void
}) {
  if (context.type === "file" && context.filePath) {
    const fileName = context.filePath.split("/").pop() || context.filePath
    const FileIcon = getFileIconByExtension(fileName) ?? FolderOpen

    return (
      <button
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full text-left py-0.5"
        onClick={(e) => {
          e.stopPropagation()
          onFileSelect?.(context.filePath!)
        }}
      >
        <FileIcon className="h-3 w-3 flex-shrink-0" />
        <span className="truncate flex-1">{fileName}</span>
        {context.toolType && (
          <span className="text-[9px] text-muted-foreground/60">{context.toolType}</span>
        )}
      </button>
    )
  }

  if (context.type === "url" && context.url) {
    const displayUrl = context.title || new URL(context.url).hostname

    return (
      <button
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground w-full text-left py-0.5"
        onClick={(e) => {
          e.stopPropagation()
          window.desktopApi?.openExternal?.(context.url!)
        }}
      >
        <Globe className="h-3 w-3 flex-shrink-0" />
        <span className="truncate flex-1">{displayUrl}</span>
      </button>
    )
  }

  return null
}

/**
 * Individual artifact item
 * Layout: [StatusIcon] [FileIcon] [FileName/Path] [ContextIndicator]
 */
function ArtifactItem({
  artifact,
  onClick,
  onFileSelect,
}: {
  artifact: Artifact
  onClick?: () => void
  onFileSelect?: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const fileName = artifact.path.split("/").pop() || artifact.path
  const dirPath = artifact.path.split("/").slice(0, -1).join("/")
  const FileIcon = getFileIconByExtension(fileName) ?? FolderOpen
  const hasContexts = artifact.contexts && artifact.contexts.length > 0

  return (
    <div className="rounded hover:bg-accent/50">
      <div
        className={cn(
          "flex items-center gap-2 py-1.5 px-2 text-xs cursor-pointer",
          artifact.status === "deleted" && "opacity-60"
        )}
        onClick={onClick}
      >
        {/* Status icon (green/yellow/red) */}
        <ArtifactStatusIcon status={artifact.status} />

        {/* File icon */}
        <FileIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

        {/* File name and path */}
        <div className="flex-1 min-w-0">
          <span className="truncate block">{fileName}</span>
          {dirPath && (
            <span className="text-muted-foreground/60 text-[10px] truncate block">
              {dirPath}
            </span>
          )}
        </div>

        {/* Context indicator (right side) */}
        {hasContexts && (
          <button
            className="flex items-center gap-0.5 text-muted-foreground/60 hover:text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded(!expanded)
            }}
          >
            <span className="text-[10px]">{artifact.contexts!.length}</span>
            <ChevronRight className={cn(
              "h-3 w-3 transition-transform",
              expanded && "rotate-90"
            )} />
          </button>
        )}
      </div>

      {/* Expanded contexts */}
      {expanded && hasContexts && (
        <div className="ml-6 py-1 px-2 space-y-0.5">
          {artifact.contexts!.map((ctx, i) => (
            <ContextItem
              key={i}
              context={ctx}
              onFileSelect={onFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Empty state when no artifacts
 */
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
      <Package className="h-8 w-8 mb-2 opacity-40" />
      <p className="text-xs">暂无交付物</p>
    </div>
  )
}

// ============================================================================
// Content Component (for use in collapsible section)
// ============================================================================

export function ArtifactsPanelContent({ onFileSelect }: ArtifactsPanelProps) {
  // Use chatId (not subChatId) to get artifacts for the entire chat
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const artifactsAtom = useMemo(
    () => artifactsAtomFamily(selectedChatId || "default"),
    [selectedChatId]
  )
  const [rawArtifacts] = useAtom(artifactsAtom)
  const setPreviewPath = useSetAtom(filePreviewPathAtom)

  // Ensure artifacts is always an array
  const artifacts = Array.isArray(rawArtifacts) ? rawArtifacts : []

  // Group artifacts by status
  const groupedArtifacts = useMemo(() => {
    const groups: Record<string, Artifact[]> = {
      created: [],
      modified: [],
      deleted: [],
    }

    artifacts.forEach((item) => {
      if (groups[item.status]) {
        groups[item.status].push(item)
      }
    })

    return groups
  }, [artifacts])

  const handleFileSelect = (path: string) => {
    // Use file preview for context files too
    setPreviewPath(path)
    onFileSelect?.(path)
  }

  if (artifacts.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="p-1">
      {/* Created files */}
      {groupedArtifacts.created.length > 0 && (
        <div className="mb-2">
          {groupedArtifacts.created.map((item) => (
            <ArtifactItem
              key={item.path}
              artifact={item}
              onClick={() => handleFileSelect(item.path)}
              onFileSelect={handleFileSelect}
            />
          ))}
        </div>
      )}

      {/* Modified files */}
      {groupedArtifacts.modified.length > 0 && (
        <div className="mb-2">
          {groupedArtifacts.modified.map((item) => (
            <ArtifactItem
              key={item.path}
              artifact={item}
              onClick={() => handleFileSelect(item.path)}
              onFileSelect={handleFileSelect}
            />
          ))}
        </div>
      )}

      {/* Deleted files */}
      {groupedArtifacts.deleted.length > 0 && (
        <div className="mb-2">
          {groupedArtifacts.deleted.map((item) => (
            <ArtifactItem
              key={item.path}
              artifact={item}
              onClick={() => handleFileSelect(item.path)}
              onFileSelect={handleFileSelect}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Component (with header, for standalone use)
// ============================================================================

export function ArtifactsPanel({ onFileSelect }: ArtifactsPanelProps) {
  const artifactsCount = useArtifactsCount()

  return (
    <div className="flex flex-col h-full">
      {/* Header with stats */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">交付物</span>
        </div>
        {artifactsCount > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {artifactsCount} 个文件
          </span>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        <ArtifactsPanelContent onFileSelect={onFileSelect} />
      </div>
    </div>
  )
}
