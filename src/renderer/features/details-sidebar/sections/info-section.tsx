"use client"

import { memo, useState, useCallback, useRef, useEffect } from "react"
import { useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import {
  GitBranchFilledIcon,
  FolderFilledIcon,
  GitPullRequestFilledIcon,
} from "@/components/ui/icons"
import { Pencil, ArrowRightCircle, HelpCircle, Loader2 } from "lucide-react"
import { MoveToWorkspaceDialog } from "@/components/dialogs/move-to-workspace-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { trpc } from "@/lib/trpc"
import { preferredEditorAtom } from "@/lib/atoms"
import { APP_META } from "../../../../shared/external-apps"
import { EDITOR_ICONS } from "@/lib/editor-icons"
import { toast } from "sonner"

interface InfoSectionProps {
  chatId: string
  worktreePath: string | null
  isExpanded?: boolean
  /** Remote chat data for sandbox workspaces */
  remoteInfo?: {
    repository?: string
    branch?: string | null
    sandboxId?: string
  } | null
}

/** Property row component - Notion-style with icon, label, and value */
function PropertyRow({
  icon: Icon,
  label,
  value,
  title,
  onClick,
  copyable,
  tooltip,
  copiedText,
  clickToCopyText,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  title?: string
  onClick?: () => void
  copyable?: boolean
  /** Tooltip to show on hover (for clickable items) */
  tooltip?: string
  /** "Copied" text for i18n */
  copiedText?: string
  /** "Click to copy" text for i18n */
  clickToCopyText?: string
}) {
  const [showCopied, setShowCopied] = useState(false)

  const handleClick = useCallback(() => {
    if (copyable) {
      navigator.clipboard.writeText(value)
      setShowCopied(true)
      setTimeout(() => setShowCopied(false), 1500)
    } else if (onClick) {
      onClick()
    }
  }, [copyable, value, onClick])

  const isClickable = onClick || copyable

  const valueEl = isClickable ? (
    <button
      type="button"
      className="text-xs text-foreground cursor-pointer rounded px-1.5 py-0.5 -ml-1.5 truncate hover:bg-accent hover:text-accent-foreground transition-colors"
      title={!tooltip ? title : undefined}
      onClick={handleClick}
    >
      {value}
    </button>
  ) : (
    <span className="text-xs text-foreground truncate" title={!tooltip ? title : undefined}>
      {value}
    </span>
  )

  return (
    <div className="flex items-center min-h-[28px]">
      {/* Label column - fixed width */}
      <div className="flex items-center gap-1.5 w-[100px] shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{label}</span>
      </div>
      {/* Value column - flexible */}
      <div className="flex-1 min-w-0 pl-2 truncate">
        {copyable ? (
          <Tooltip open={showCopied ? true : undefined}>
            <TooltipTrigger asChild>
              {valueEl}
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {showCopied ? (copiedText || "Copied") : (clickToCopyText || "Click to copy")}
            </TooltipContent>
          </Tooltip>
        ) : tooltip ? (
          <Tooltip delayDuration={500}>
            <TooltipTrigger asChild>
              {valueEl}
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        ) : (
          valueEl
        )}
      </div>
    </div>
  )
}

/** Inline edit component shared by branch and folder rename */
function InlineEdit({
  currentValue,
  onSubmit,
  onCancel,
  isLoading,
  placeholder,
}: {
  currentValue: string
  onSubmit: (value: string) => void
  onCancel: () => void
  isLoading: boolean
  placeholder?: string
}) {
  const [value, setValue] = useState(currentValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || trimmed === currentValue) {
      onCancel()
      return
    }
    onSubmit(trimmed)
  }, [value, currentValue, onCancel, onSubmit])

  return (
    <div className="flex items-center gap-1 min-h-[28px] flex-1 min-w-0">
      <input
        ref={inputRef}
        className="flex-1 min-w-0 text-xs bg-background border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-ring"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit()
          if (e.key === "Escape") onCancel()
        }}
        onBlur={handleSubmit}
        disabled={isLoading}
        placeholder={placeholder}
        autoFocus
      />
      {isLoading && <Loader2 className="h-3 w-3 animate-spin shrink-0 text-muted-foreground" />}
    </div>
  )
}

/**
 * Info Section for Details Sidebar
 * Shows workspace info: branch, PR, path
 * Memoized to prevent re-renders when parent updates
 */
export const InfoSection = memo(function InfoSection({
  chatId,
  worktreePath,
  isExpanded: _isExpanded = false,
  remoteInfo,
}: InfoSectionProps) {
  const { t } = useTranslation("sidebar")
  const { t: tCommon } = useTranslation("common")

  // Move to workspace dialog state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)

  // Inline edit states
  const [isEditingBranch, setIsEditingBranch] = useState(false)
  const [isEditingPath, setIsEditingPath] = useState(false)

  // Extract folder name from path
  const folderName = worktreePath?.split("/").pop() || "Unknown"

  // Get chat data to check if this is a playground chat
  const { data: chatData } = trpc.chats.get.useQuery(
    { id: chatId },
    { enabled: !!chatId }
  )

  // Get project info to check if playground (must include playground projects in query)
  const { data: projects } = trpc.projects.list.useQuery({ includePlayground: true })
  const project = chatData?.projectId
    ? projects?.find(p => p.id === chatData.projectId)
    : null
  const isPlayground = project?.isPlayground ?? false

  // Mutations
  const openInFinderMutation = trpc.external.openInFinder.useMutation()
  const openInAppMutation = trpc.external.openInApp.useMutation()

  // tRPC utils for invalidation
  const utils = trpc.useUtils()

  // Branch rename mutation
  const renameBranchMutation = trpc.chats.renameBranch.useMutation({
    onSuccess: () => {
      setIsEditingBranch(false)
      utils.chats.get.invalidate({ id: chatId })
      utils.changes.getBranches.invalidate()
      toast.success(t("details.workspace.branchRenamed"))
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Move worktree mutation
  const moveWorktreeMutation = trpc.chats.moveWorktree.useMutation({
    onSuccess: () => {
      setIsEditingPath(false)
      utils.chats.get.invalidate({ id: chatId })
      toast.success(t("details.workspace.folderRenamed"))
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Get preferred editor from settings
  const preferredEditor = useAtomValue(preferredEditorAtom)

  // Get editor icon for the preferred editor
  const editorIcon = EDITOR_ICONS[preferredEditor]
  const editorLabel = APP_META[preferredEditor]?.label || "Editor"

  // Check if this is a remote sandbox chat (no local worktree)
  const isRemoteChat = !worktreePath && !!remoteInfo

  // Fetch branch data directly (only for local chats)
  const { data: branchData, isLoading: isBranchLoading } = trpc.changes.getBranches.useQuery(
    { worktreePath: worktreePath || "" },
    { enabled: !!worktreePath && !isPlayground }
  )

  // Get PR status for current branch (only for local chats)
  const { data: prStatus } = trpc.chats.getPrStatus.useQuery(
    { chatId },
    {
      refetchInterval: 30000, // Poll every 30 seconds
      enabled: !!chatId && !!worktreePath, // Only enable for local chats
    }
  )

  // For local chats: use fetched branch data
  // For remote chats: use remoteInfo from props
  const branchName = isRemoteChat ? remoteInfo?.branch : branchData?.current
  const pr = prStatus?.pr

  // Extract repo name from repository URL (e.g., "owner/repo" from "github.com/owner/repo")
  const repositoryName = remoteInfo?.repository
    ? remoteInfo.repository.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")
    : null

  const handleOpenFolder = () => {
    if (worktreePath) {
      openInFinderMutation.mutate(worktreePath)
    }
  }

  const handleOpenInEditor = () => {
    if (worktreePath) {
      openInAppMutation.mutate({
        path: worktreePath,
        app: preferredEditor,
      })
    }
  }

  const handleOpenPr = () => {
    if (pr?.url) {
      window.desktopApi.openExternal(pr.url)
    }
  }

  const handleOpenRepository = () => {
    if (remoteInfo?.repository) {
      const repoUrl = remoteInfo.repository.startsWith("http")
        ? remoteInfo.repository
        : `https://github.com/${remoteInfo.repository}`
      window.desktopApi.openExternal(repoUrl)
    }
  }

  // Show loading state while branch data is loading (only for local chats)
  if (!isRemoteChat && isBranchLoading) {
    return (
      <div className="px-2 py-1.5 flex flex-col gap-0.5">
        <div className="flex items-center min-h-[28px]">
          <div className="flex items-center gap-1.5 w-[100px] shrink-0">
            <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
            <div className="h-3 w-12 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex-1 min-w-0 pl-2">
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="flex items-center min-h-[28px]">
          <div className="flex items-center gap-1.5 w-[100px] shrink-0">
            <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
            <div className="h-3 w-8 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex-1 min-w-0 pl-2">
            <div className="h-3 w-24 rounded bg-muted animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  const hasContent = branchName || worktreePath || repositoryName || remoteInfo?.sandboxId || isPlayground

  if (!hasContent) {
    return (
      <div className="px-2 py-2">
        <div className="text-xs text-muted-foreground">
          {t("details.workspace.noInfo")}
        </div>
      </div>
    )
  }

  return (
    <div className="px-2 py-1.5 flex flex-col gap-0.5">
      {/* Repository - only for remote chats */}
      {repositoryName && (
        <PropertyRow
          icon={FolderFilledIcon}
          label={t("details.workspace.repository")}
          value={repositoryName}
          title={remoteInfo?.repository}
          onClick={handleOpenRepository}
          tooltip={t("details.workspace.openInGitHub")}
        />
      )}
      {/* Branch - for both local and remote */}
      {branchName && (
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0">
            {isEditingBranch ? (
              <InlineEdit
                currentValue={branchName}
                onSubmit={(newName) => {
                  renameBranchMutation.mutate({ chatId, newBranchName: newName })
                }}
                onCancel={() => setIsEditingBranch(false)}
                isLoading={renameBranchMutation.isPending}
                placeholder={t("details.workspace.branchNamePlaceholder")}
              />
            ) : (
              <PropertyRow
                icon={GitBranchFilledIcon}
                label={t("details.workspace.branch")}
                value={branchName}
                copyable
                copiedText={t("details.workspace.copied")}
                clickToCopyText={t("details.workspace.clickToCopy")}
              />
            )}
          </div>
          {/* Only show rename button for local chats */}
          {!isRemoteChat && !isEditingBranch && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => setIsEditingBranch(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                {t("details.workspace.renameBranch")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      {/* PR - only for local chats */}
      {pr && (
        <PropertyRow
          icon={GitPullRequestFilledIcon}
          label={t("details.workspace.pullRequest")}
          value={`#${pr.number}`}
          title={pr.title}
          onClick={handleOpenPr}
          tooltip={t("details.workspace.openInGitHub")}
        />
      )}
      {/* Path - for non-playground local chats, with editor & rename buttons */}
      {worktreePath && !isPlayground && (
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0">
            {isEditingPath ? (
              <InlineEdit
                currentValue={folderName}
                onSubmit={(newName) => {
                  moveWorktreeMutation.mutate({ chatId, newFolderName: newName })
                }}
                onCancel={() => setIsEditingPath(false)}
                isLoading={moveWorktreeMutation.isPending}
                placeholder={t("details.workspace.folderNamePlaceholder")}
              />
            ) : (
              <PropertyRow
                icon={FolderFilledIcon}
                label={t("details.workspace.path")}
                value={folderName}
                title={worktreePath}
                onClick={handleOpenFolder}
                tooltip={t("details.workspace.openInFinder")}
              />
            )}
          </div>
          {project?.mode === "coding" && !isEditingPath && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={handleOpenInEditor}
                    disabled={openInAppMutation.isPending}
                  >
                    {editorIcon ? (
                      <img src={editorIcon} alt="" className="h-3.5 w-3.5" />
                    ) : (
                      <span className="h-3.5 w-3.5 text-muted-foreground">E</span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t("details.workspace.openIn", { editor: editorLabel })}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => setIsEditingPath(true)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {t("details.workspace.renameFolder")}
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      )}

      {/* Convert to Project - for playground chats */}
      {isPlayground && project && (
        <>
          <div className="flex items-center min-h-[28px]">
            {/* Clickable left section: icon + text */}
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
              onClick={() => setMoveDialogOpen(true)}
            >
              <ArrowRightCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{t("details.workspace.convertToProject")}</span>
            </button>
            {/* Help icon on the right */}
            <div className="flex-1" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="h-4 w-4 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px] text-xs">
                {t("details.workspace.convertToProjectHelp")}
              </TooltipContent>
            </Tooltip>
          </div>

          <MoveToWorkspaceDialog
            open={moveDialogOpen}
            onOpenChange={setMoveDialogOpen}
            projectId={project.id}
            projectName={project.name || chatData?.name || ""}
          />
        </>
      )}
    </div>
  )
})
