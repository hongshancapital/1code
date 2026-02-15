"use client"

import { memo, useMemo, useState, useCallback } from "react"
import { useAtom, useSetAtom } from "jotai"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Package, ChevronRight, FileEdit, FilePlus, FileX, FolderOpen, Globe } from "lucide-react"
import { ExpandIcon, CollapseIcon } from "@/icons/icons"
import { getFileIconByExtension } from "@/features/agents/mentions/agents-file-mention"
import { useAgentSubChatStore } from "@/features/agents/stores/sub-chat-store"
import { artifactsAtomFamily, filePreviewPathAtom, type Artifact, type ArtifactContext } from "@/lib/atoms"
import { ResizableWidgetCard } from "../components/resizable-widget-card"

// ============================================================================
// Hook for artifacts count
// ============================================================================

export function useArtifactsCount(): number {
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const artifactsAtom = useMemo(
    () => artifactsAtomFamily(activeSubChatId || "default"),
    [activeSubChatId]
  )
  const [rawArtifacts] = useAtom(artifactsAtom)
  const artifacts = Array.isArray(rawArtifacts) ? rawArtifacts : []
  return artifacts.length
}

// ============================================================================
// Status Icon
// ============================================================================

function ArtifactStatusIcon({ status }: { status: Artifact["status"] }) {
  switch (status) {
    case "created":
      return <FilePlus className="h-3 w-3 text-green-500 shrink-0" />
    case "modified":
      return <FileEdit className="h-3 w-3 text-yellow-500 shrink-0" />
    case "deleted":
      return <FileX className="h-3 w-3 text-red-500 shrink-0" />
    default:
      return <FileEdit className="h-3 w-3 text-muted-foreground shrink-0" />
  }
}

// ============================================================================
// Context Item (file or URL reference)
// ============================================================================

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
        <FileIcon className="h-3 w-3 shrink-0" />
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
        <Globe className="h-3 w-3 shrink-0" />
        <span className="truncate flex-1">{displayUrl}</span>
      </button>
    )
  }

  return null
}

// ============================================================================
// Artifact Item
// ============================================================================

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
  const FileIcon = getFileIconByExtension(fileName) ?? FolderOpen
  const hasContexts = artifact.contexts && artifact.contexts.length > 0

  return (
    <div className={cn(
      "rounded",
      artifact.status === "deleted" && "opacity-60"
    )}>
      <div
        className="flex items-center gap-1.5 py-1 px-2 text-xs cursor-pointer hover:bg-accent/50 rounded"
        onClick={onClick}
      >
        <ArtifactStatusIcon status={artifact.status} />
        <FileIcon className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="truncate flex-1 min-w-0">{fileName}</span>
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

      {expanded && hasContexts && (
        <div className="ml-5 py-1 px-2 flex flex-col gap-0.5">
          {artifact.contexts!.map((ctx, i) => (
            <ContextItem key={i} context={ctx} onFileSelect={onFileSelect} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Widget Component
// ============================================================================

interface ArtifactsWidgetProps {
  subChatId: string | null
}

export const ArtifactsWidget = memo(function ArtifactsWidget({ subChatId }: ArtifactsWidgetProps) {
  const { t } = useTranslation("sidebar")
  const effectiveId = subChatId || "default"
  const artifactsAtom = useMemo(
    () => artifactsAtomFamily(effectiveId),
    [effectiveId]
  )
  const [rawArtifacts] = useAtom(artifactsAtom)
  const setPreviewPath = useSetAtom(filePreviewPathAtom)

  const artifacts = Array.isArray(rawArtifacts) ? rawArtifacts : []

  const [isExpanded, setIsExpanded] = useState(true)

  const handleToggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      setIsExpanded((prev) => !prev)
    }
  }, [])

  const handleFileSelect = useCallback((path: string) => {
    setPreviewPath(path)
  }, [setPreviewPath])

  // Don't render if no artifacts
  if (artifacts.length === 0) {
    return null
  }

  return (
    <div className="mx-2 mb-2">
      {/* Header */}
      <div
        className="rounded-t-lg border border-b-0 border-border/50 bg-muted/30 px-2 h-8 cursor-pointer hover:bg-muted/50 transition-colors duration-150 flex items-center"
        onClick={handleToggleExpand}
        role="button"
        aria-expanded={isExpanded}
        aria-label={t("details.artifactsWidget.expandLabel", { count: artifacts.length, action: isExpanded ? t("details.todosWidget.collapse") : t("details.todosWidget.expand") })}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-medium text-foreground">{t("details.artifactsWidget.title")}</span>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-auto">
            {t("details.artifactsWidget.file", { count: artifacts.length })}
          </span>
          <div className="relative w-3.5 h-3.5 shrink-0">
            <ExpandIcon
              className={cn(
                "absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                isExpanded ? "opacity-0 scale-75" : "opacity-100 scale-100",
              )}
            />
            <CollapseIcon
              className={cn(
                "absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                isExpanded ? "opacity-100 scale-100" : "opacity-0 scale-75",
              )}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="rounded-b-lg border border-border/50 border-t-0 overflow-hidden">
        {!isExpanded && (
          <div
            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors duration-150"
            onClick={() => setIsExpanded(true)}
          >
            <span className="text-xs text-muted-foreground truncate">
              {artifacts[0]?.path.split("/").pop()}
            </span>
          </div>
        )}

        {isExpanded && (
          <ResizableWidgetCard widgetId="artifacts" subChatId={effectiveId}>
            <div className="h-full overflow-y-auto py-1">
              {artifacts.map((artifact) => (
                <ArtifactItem
                  key={artifact.path}
                  artifact={artifact}
                  onClick={() => handleFileSelect(artifact.path)}
                  onFileSelect={handleFileSelect}
                />
              ))}
            </div>
          </ResizableWidgetCard>
        )}
      </div>
    </div>
  )
})
