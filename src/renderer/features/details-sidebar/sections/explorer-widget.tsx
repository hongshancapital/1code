"use client"

import { memo, useCallback } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { cn } from "@/lib/utils"
import { FolderTree } from "lucide-react"
import { ExpandIcon } from "@/components/ui/icons"
import { FileTreePanel } from "@/features/cowork/file-tree-panel"
import { filePreviewPathAtom } from "@/features/cowork/atoms"
import { selectedProjectAtom } from "@/features/agents/atoms"
import { api } from "@/lib/mock-api"

// ============================================================================
// Explorer Widget Props
// ============================================================================

interface ExplorerWidgetProps {
  chatId: string
  worktreePath?: string
  onExpand?: () => void
}

// ============================================================================
// Main Widget Component
// ============================================================================

export const ExplorerWidget = memo(function ExplorerWidget({
  chatId,
  worktreePath,
  onExpand,
}: ExplorerWidgetProps) {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setPreviewPath = useSetAtom(filePreviewPathAtom)

  // Fetch current chat data to get worktree path
  const { data: chatData } = api.agents.getAgentChat.useQuery(
    { chatId },
    { enabled: !!chatId }
  )

  // Use chat's worktreePath if available, otherwise fall back to project path
  const effectivePath = worktreePath || chatData?.worktreePath || selectedProject?.path

  // Handle file selection from file tree (relative path)
  const handleFileTreeSelect = useCallback(
    (relativePath: string) => {
      // Convert relative path to absolute path
      const absolutePath = effectivePath
        ? `${effectivePath}/${relativePath}`
        : relativePath
      setPreviewPath(absolutePath)
    },
    [effectivePath, setPreviewPath]
  )

  if (!effectivePath) {
    return null
  }

  return (
    <div className="mx-2 mb-2">
      {/* Header */}
      <div className="rounded-t-lg border border-b-0 border-border/50 bg-muted/30 px-2 h-8 flex items-center">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FolderTree className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-medium text-foreground">Explorer</span>
          <span className="text-xs text-muted-foreground truncate flex-1 ml-2">
            {selectedProject?.name || effectivePath.split("/").pop()}
          </span>
        </div>
        {onExpand && (
          <button
            onClick={onExpand}
            className="p-1 hover:bg-accent/50 rounded transition-colors"
            aria-label="Expand explorer"
          >
            <ExpandIcon className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      {/* Content */}
      <div className="rounded-b-lg border border-border/50 border-t-0 h-[250px] overflow-hidden">
        <FileTreePanel
          projectPath={effectivePath}
          onFileSelect={handleFileTreeSelect}
          showHeader={false}
          hideSearchBorder={true}
        />
      </div>
    </div>
  )
})

// ============================================================================
// Explorer Section (for expanded view)
// ============================================================================

interface ExplorerSectionProps {
  chatId: string
  worktreePath?: string
  onClose?: () => void
}

export const ExplorerSection = memo(function ExplorerSection({
  chatId,
  worktreePath,
  onClose,
}: ExplorerSectionProps) {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setPreviewPath = useSetAtom(filePreviewPathAtom)

  // Fetch current chat data to get worktree path
  const { data: chatData } = api.agents.getAgentChat.useQuery(
    { chatId },
    { enabled: !!chatId }
  )

  const effectivePath = worktreePath || chatData?.worktreePath || selectedProject?.path

  const handleFileTreeSelect = useCallback(
    (relativePath: string) => {
      const absolutePath = effectivePath
        ? `${effectivePath}/${relativePath}`
        : relativePath
      setPreviewPath(absolutePath)
    },
    [effectivePath, setPreviewPath]
  )

  if (!effectivePath) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No project selected
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <FileTreePanel
        projectPath={effectivePath}
        onFileSelect={handleFileTreeSelect}
        onClose={onClose}
        showHeader={true}
      />
    </div>
  )
})
