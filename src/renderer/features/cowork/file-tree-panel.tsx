import { useState, useMemo, useCallback, useEffect } from "react"
import { useAtom, useSetAtom } from "jotai"
import { trpc } from "../../lib/trpc"
import { getFileIconByExtension } from "../agents/mentions/agents-file-mention"
import {
  ChevronRight,
  ChevronDown,
  Search,
  FolderOpen,
  FolderTree,
  Folder,
  X,
  PanelLeftClose,
  RefreshCw,
  Loader2,
  AtSign,
} from "lucide-react"
import { Input } from "../../components/ui/input"
import { Button } from "../../components/ui/button"
import { cn } from "../../lib/utils"
import {
  fileTreeExpandedPathsAtom,
  fileTreeSearchQueryAtom,
  pendingFileReferenceAtom,
} from "./atoms"

// ============================================================================
// Types
// ============================================================================

interface DirectoryEntry {
  name: string
  path: string
  type: "file" | "folder"
}

interface FileTreePanelProps {
  projectPath?: string
  onClose?: () => void
  onFileSelect?: (path: string) => void
  showHeader?: boolean
}

// ============================================================================
// Lazy Loading Directory Node
// ============================================================================

interface LazyDirectoryNodeProps {
  entry: DirectoryEntry
  projectPath: string
  depth: number
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  onSelect: (path: string, type: "file" | "folder") => void
  onReference: (path: string, name: string, type: "file" | "folder") => void
  searchQuery: string
}

function LazyDirectoryNode({
  entry,
  projectPath,
  depth,
  expandedPaths,
  onToggle,
  onSelect,
  onReference,
  searchQuery,
}: LazyDirectoryNodeProps) {
  const isExpanded = expandedPaths.has(entry.path)
  const isFolder = entry.type === "folder"
  const [isHovered, setIsHovered] = useState(false)

  // Lazy load children when folder is expanded
  const { data: children, isLoading, refetch } = trpc.files.listDirectory.useQuery(
    { projectPath, relativePath: entry.path },
    {
      enabled: isFolder && isExpanded,
      staleTime: 30000, // 30 seconds
    }
  )

  // Filter children by search query
  const filteredChildren = useMemo(() => {
    if (!children) return []
    if (!searchQuery) return children

    const queryLower = searchQuery.toLowerCase()
    return children.filter((child) => {
      // Keep folders that might have matching descendants (show all folders when searching)
      if (child.type === "folder") return true
      // Filter files by name
      return child.name.toLowerCase().includes(queryLower)
    })
  }, [children, searchQuery])

  const FileIcon = isFolder
    ? (isExpanded ? FolderOpen : Folder)
    : (getFileIconByExtension(entry.name) ?? FolderOpen)

  const handleClick = useCallback(() => {
    if (isFolder) {
      onToggle(entry.path)
    } else {
      onSelect(entry.path, entry.type)
    }
  }, [isFolder, entry.path, entry.type, onToggle, onSelect])

  // Highlight matching text
  const highlightMatch = (text: string) => {
    if (!searchQuery) return text
    const idx = text.toLowerCase().indexOf(searchQuery.toLowerCase())
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <span className="bg-yellow-500/30 text-foreground">{text.slice(idx, idx + searchQuery.length)}</span>
        {text.slice(idx + searchQuery.length)}
      </>
    )
  }

  const handleReference = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onReference(entry.path, entry.name, entry.type)
  }, [entry.path, entry.name, entry.type, onReference])

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-1 py-1 px-1.5 rounded text-xs cursor-pointer group",
          "hover:bg-accent hover:text-accent-foreground"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Expand/collapse chevron for folders */}
        {isFolder ? (
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {isLoading ? (
              <Loader2 className="h-3 w-3 text-muted-foreground animate-spin" />
            ) : isExpanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}

        {/* File/folder icon */}
        <FileIcon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

        {/* Name with highlight */}
        <span className="truncate flex-1">{highlightMatch(entry.name)}</span>

        {/* Reference button - only show on hover for files */}
        {!isFolder && isHovered && (
          <button
            onClick={handleReference}
            className="flex-shrink-0 p-0.5 rounded hover:bg-primary/20 transition-colors"
            title="Insert reference to chat"
          >
            <AtSign className="h-3 w-3 text-muted-foreground hover:text-primary" />
          </button>
        )}
      </div>

      {/* Children (lazy loaded when expanded) */}
      {isFolder && isExpanded && filteredChildren && filteredChildren.length > 0 && (
        <div>
          {filteredChildren.map((child) => (
            <LazyDirectoryNode
              key={child.path}
              entry={child}
              projectPath={projectPath}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              onToggle={onToggle}
              onSelect={onSelect}
              onReference={onReference}
              searchQuery={searchQuery}
            />
          ))}
        </div>
      )}

      {/* Empty folder indicator */}
      {isFolder && isExpanded && !isLoading && filteredChildren && filteredChildren.length === 0 && (
        <div
          className="text-xs text-muted-foreground/60 italic py-1"
          style={{ paddingLeft: `${(depth + 1) * 12 + 8 + 16}px` }}
        >
          {searchQuery ? "No matches" : "Empty folder"}
        </div>
      )}
    </>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function FileTreePanel({
  projectPath,
  onClose,
  onFileSelect,
  showHeader = true,
}: FileTreePanelProps) {
  const [expandedPaths, setExpandedPaths] = useAtom(fileTreeExpandedPathsAtom)
  const [searchQuery, setSearchQuery] = useAtom(fileTreeSearchQueryAtom)
  const setPendingFileReference = useSetAtom(pendingFileReferenceAtom)

  // Fetch root directory contents
  const { data: rootEntries, isLoading, refetch, isFetching } = trpc.files.listDirectory.useQuery(
    { projectPath: projectPath ?? "", relativePath: "" },
    {
      enabled: !!projectPath,
      staleTime: 30000, // 30 seconds
    }
  )

  // Filter root entries by search query
  const filteredRootEntries = useMemo(() => {
    if (!rootEntries) return []
    if (!searchQuery) return rootEntries

    const queryLower = searchQuery.toLowerCase()
    return rootEntries.filter((entry) => {
      // Keep folders that might have matching descendants
      if (entry.type === "folder") return true
      // Filter files by name
      return entry.name.toLowerCase().includes(queryLower)
    })
  }, [rootEntries, searchQuery])

  // Refresh file list
  const handleRefresh = useCallback(() => {
    // Clear cache and refetch
    refetch()
  }, [refetch])

  // Toggle folder expansion
  const handleToggle = useCallback(
    (path: string) => {
      setExpandedPaths((prev: Set<string>) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
        }
        return next
      })
    },
    [setExpandedPaths]
  )

  // Select file/folder (no persistent selection state)
  const handleSelect = useCallback(
    (path: string, type: "file" | "folder") => {
      // Don't persist selection state - just trigger the callback
      if (type === "file" && onFileSelect) {
        onFileSelect(path)
      }
    },
    [onFileSelect]
  )

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchQuery("")
  }, [setSearchQuery])

  // Reference file in chat input
  const handleReference = useCallback(
    (path: string, name: string, type: "file" | "folder") => {
      setPendingFileReference({ path, name, type })
    },
    [setPendingFileReference]
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header (optional) */}
      {showHeader && (
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <div className="flex items-center gap-2">
            <FolderTree className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">File Tree</span>
          </div>
          <div className="flex items-center gap-1">
            {/* Refresh button */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleRefresh}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
            {onClose && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={onClose}
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-xs"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={handleClearSearch}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* File Tree */}
      <div className="flex-1 overflow-auto p-1">
        {!projectPath ? (
          <div className="text-xs text-muted-foreground p-2 text-center">
            Select a project first
          </div>
        ) : isLoading ? (
          <div className="text-xs text-muted-foreground p-2 text-center flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : filteredRootEntries.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2 text-center">
            {searchQuery ? "No matching files" : "No files"}
          </div>
        ) : (
          filteredRootEntries.map((entry) => (
            <LazyDirectoryNode
              key={entry.path}
              entry={entry}
              projectPath={projectPath}
              depth={0}
              expandedPaths={expandedPaths}
              onToggle={handleToggle}
              onSelect={handleSelect}
              onReference={handleReference}
              searchQuery={searchQuery}
            />
          ))
        )}
      </div>
    </div>
  )
}
