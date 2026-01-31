"use client"

import { memo, useState, useCallback } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import {
  GitBranchFilledIcon,
  FolderFilledIcon,
  GitPullRequestFilledIcon,
} from "@/components/ui/icons"
import { WandSparkles } from "lucide-react"
import { pendingBranchRenameMessageAtom } from "@/features/agents/atoms"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { trpc } from "@/lib/trpc"
import { editorConfigAtom } from "@/lib/atoms/editor"
import { getEditorIcon, GenericEditorIcon } from "@/icons/editor-icons"
import { preferredEditorAtom } from "@/lib/atoms"
import { useResolvedHotkeyDisplay } from "@/lib/hotkeys"
import { APP_META } from "../../../../shared/external-apps"
import { EDITOR_ICONS } from "@/lib/editor-icons"

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
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  title?: string
  onClick?: () => void
  copyable?: boolean
  /** Tooltip to show on hover (for clickable items) */
  tooltip?: string
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
      <div className="flex items-center gap-1.5 w-[100px] flex-shrink-0">
        <Icon className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
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
              {showCopied ? "Copied" : "Click to copy"}
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

/**
 * Info Section for Details Sidebar
 * Shows workspace info: branch, PR, path
 * Memoized to prevent re-renders when parent updates
 */
export const InfoSection = memo(function InfoSection({
  chatId,
  worktreePath,
  isExpanded = false,
  remoteInfo,
}: InfoSectionProps) {
  // Extract folder name from path
  const folderName = worktreePath?.split("/").pop() || "Unknown"

  // Mutations
  const openInFinderMutation = trpc.external.openInFinder.useMutation()
  const openInEditorMutation = trpc.editor.openWithEditor.useMutation()

  // Get editor config
  const editorConfig = useAtomValue(editorConfigAtom)

  // Detect installed editors
  const { data: detectedEditors } = trpc.editor.detectEditors.useQuery()

  // Determine active editor (configured or first installed)
  const configuredEditorId = editorConfig.defaultEditor
  const configuredEditor = configuredEditorId
    ? detectedEditors?.find((e) => e.id === configuredEditorId && e.installed)
    : null
  const firstInstalledEditor = detectedEditors?.find((e) => e.installed)
  const activeEditor = configuredEditor || firstInstalledEditor

  // Dynamic editor icon - use specific icon if editor detected, generic otherwise (will use system default)
  const EditorIcon = activeEditor
    ? getEditorIcon(activeEditor.id)
    : GenericEditorIcon

  // Check if this is a remote sandbox chat (no local worktree)
  const isRemoteChat = !worktreePath && !!remoteInfo

  // Fetch branch data directly (only for local chats)
  const { data: branchData, isLoading: isBranchLoading } = trpc.changes.getBranches.useQuery(
    { worktreePath: worktreePath || "" },
    { enabled: !!worktreePath }
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
      openInEditorMutation.mutate({
        path: worktreePath,
        editorId: editorConfig.defaultEditor ?? undefined,
        customArgs: editorConfig.customArgs || undefined,
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

  const handleOpenSandbox = () => {
    if (remoteInfo?.sandboxId) {
      const sandboxUrl = `https://3003-${remoteInfo.sandboxId}.e2b.app`
      window.desktopApi.openExternal(sandboxUrl)
    }
  }

  // AI branch rename
  const setPendingBranchRenameMessage = useSetAtom(pendingBranchRenameMessageAtom)

  const handleRenameBranch = useCallback(() => {
    if (branchName) {
      const message = `Current git branch: ${branchName}

Please help me rename this branch to a more descriptive name. Follow these conventions:
1. Use kebab-case (e.g., feat/add-user-auth, fix/login-bug)
2. Keep it concise but descriptive
3. Add a prefix if appropriate (feat/, fix/, refactor/, etc.)

Steps:
1. Suggest a better branch name based on recent changes or context
2. Ask for confirmation before renaming
3. Once confirmed, use \`git branch -m <new-name>\` to rename locally
4. If there's a remote branch, remind me to update remote tracking

Please suggest a new branch name.`
      setPendingBranchRenameMessage(message)
    }
  }, [branchName, setPendingBranchRenameMessage])

  // Show loading state while branch data is loading (only for local chats)
  if (!isRemoteChat && isBranchLoading) {
    return (
      <div className="px-2 py-1.5 flex flex-col gap-0.5">
        <div className="flex items-center min-h-[28px]">
          <div className="flex items-center gap-1.5 w-[100px] flex-shrink-0">
            <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
            <div className="h-3 w-12 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex-1 min-w-0 pl-2">
            <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          </div>
        </div>
        <div className="flex items-center min-h-[28px]">
          <div className="flex items-center gap-1.5 w-[100px] flex-shrink-0">
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

  const hasContent = branchName || worktreePath || repositoryName || remoteInfo?.sandboxId

  if (!hasContent) {
    return (
      <div className="px-2 py-2">
        <div className="text-xs text-muted-foreground">
          No workspace info available
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
          label="Repository"
          value={repositoryName}
          title={remoteInfo?.repository}
          onClick={handleOpenRepository}
          tooltip="Open in GitHub"
        />
      )}
      {/* Branch - for both local and remote */}
      {branchName && (
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0">
            <PropertyRow icon={GitBranchFilledIcon} label="Branch" value={branchName} copyable />
          </div>
          {/* Only show rename button for local chats */}
          {!isRemoteChat && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={handleRenameBranch}
                >
                  <WandSparkles className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Rename branch with AI
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
      {/* PR - only for local chats */}
      {pr && (
        <PropertyRow
          icon={GitPullRequestFilledIcon}
          label="Pull Request"
          value={`#${pr.number}`}
          title={pr.title}
          onClick={handleOpenPr}
          tooltip="Open in GitHub"
        />
      )}
      {/* Path - for local chats, with editor button */}
      {worktreePath && (
        <div className="flex items-center gap-1">
          <div className="flex-1 min-w-0">
            <PropertyRow
              icon={FolderFilledIcon}
              label="Path"
              value={folderName}
              title={worktreePath}
              onClick={handleOpenFolder}
              tooltip="Open in Finder"
            />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={handleOpenInEditor}
                disabled={openInEditorMutation.isPending}
              >
                <EditorIcon className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {activeEditor
                ? `Open in ${activeEditor.name}`
                : "Open in default editor"}
            </TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  )
})
