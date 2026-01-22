import { useMemo } from "react"
import { useAtom } from "jotai"
import { getFileIconByExtension } from "../agents/mentions/agents-file-mention"
import { FileEdit, FilePlus, FileX, FolderOpen, Package } from "lucide-react"
import { cn } from "../../lib/utils"
import { useAgentSubChatStore } from "../../lib/stores/sub-chat-store"
import { deliverablesAtomFamily, type Deliverable } from "./atoms"

// ============================================================================
// Types
// ============================================================================

interface DeliverablesPanelProps {
  onFileSelect?: (path: string) => void
}

// ============================================================================
// Hook for deliverables count (for auto-collapse logic)
// ============================================================================

export function useDeliverablesCount(): number {
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const deliverablesAtom = useMemo(
    () => deliverablesAtomFamily(activeSubChatId || "default"),
    [activeSubChatId]
  )
  const [rawDeliverables] = useAtom(deliverablesAtom)
  const deliverables = Array.isArray(rawDeliverables) ? rawDeliverables : []
  return deliverables.length
}

// ============================================================================
// Components
// ============================================================================

/**
 * Status icon for deliverables
 */
function DeliverableStatusIcon({ status }: { status: Deliverable["status"] }) {
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
 * Get status label
 */
function getStatusLabel(status: Deliverable["status"]): string {
  switch (status) {
    case "created":
      return "新建"
    case "modified":
      return "修改"
    case "deleted":
      return "删除"
    default:
      return status
  }
}

/**
 * Individual deliverable item
 */
function DeliverableItem({
  deliverable,
  onClick,
}: {
  deliverable: Deliverable
  onClick?: () => void
}) {
  const fileName = deliverable.path.split("/").pop() || deliverable.path
  const dirPath = deliverable.path.split("/").slice(0, -1).join("/")
  const FileIcon = getFileIconByExtension(fileName) ?? FolderOpen

  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1.5 px-2 rounded text-xs cursor-pointer",
        "hover:bg-accent hover:text-accent-foreground",
        deliverable.status === "deleted" && "opacity-60"
      )}
      onClick={onClick}
    >
      {/* Status icon */}
      <DeliverableStatusIcon status={deliverable.status} />

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
        {deliverable.description && (
          <span className="text-muted-foreground/80 text-[10px] truncate block">
            {deliverable.description}
          </span>
        )}
      </div>

      {/* Status badge */}
      <span className={cn(
        "text-[10px] px-1.5 py-0.5 rounded flex-shrink-0",
        deliverable.status === "created" && "bg-green-500/10 text-green-500",
        deliverable.status === "modified" && "bg-yellow-500/10 text-yellow-500",
        deliverable.status === "deleted" && "bg-red-500/10 text-red-500"
      )}>
        {getStatusLabel(deliverable.status)}
      </span>
    </div>
  )
}

/**
 * Empty state when no deliverables
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

export function DeliverablesPanelContent({ onFileSelect }: DeliverablesPanelProps) {
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const deliverablesAtom = useMemo(
    () => deliverablesAtomFamily(activeSubChatId || "default"),
    [activeSubChatId]
  )
  const [rawDeliverables] = useAtom(deliverablesAtom)

  // Ensure deliverables is always an array
  const deliverables = Array.isArray(rawDeliverables) ? rawDeliverables : []

  // Group deliverables by status
  const groupedDeliverables = useMemo(() => {
    const groups: Record<string, Deliverable[]> = {
      created: [],
      modified: [],
      deleted: [],
    }

    deliverables.forEach((item) => {
      if (groups[item.status]) {
        groups[item.status].push(item)
      }
    })

    return groups
  }, [deliverables])

  if (deliverables.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="p-1">
      {/* Created files */}
      {groupedDeliverables.created.length > 0 && (
        <div className="mb-2">
          {groupedDeliverables.created.map((item) => (
            <DeliverableItem
              key={item.path}
              deliverable={item}
              onClick={() => onFileSelect?.(item.path)}
            />
          ))}
        </div>
      )}

      {/* Modified files */}
      {groupedDeliverables.modified.length > 0 && (
        <div className="mb-2">
          {groupedDeliverables.modified.map((item) => (
            <DeliverableItem
              key={item.path}
              deliverable={item}
              onClick={() => onFileSelect?.(item.path)}
            />
          ))}
        </div>
      )}

      {/* Deleted files */}
      {groupedDeliverables.deleted.length > 0 && (
        <div className="mb-2">
          {groupedDeliverables.deleted.map((item) => (
            <DeliverableItem
              key={item.path}
              deliverable={item}
              onClick={() => onFileSelect?.(item.path)}
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

export function DeliverablesPanel({ onFileSelect }: DeliverablesPanelProps) {
  const deliverablesCount = useDeliverablesCount()

  return (
    <div className="flex flex-col h-full">
      {/* Header with stats */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">交付物</span>
        </div>
        {deliverablesCount > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {deliverablesCount} 个文件
          </span>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-auto">
        <DeliverablesPanelContent onFileSelect={onFileSelect} />
      </div>
    </div>
  )
}
