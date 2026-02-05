"use client"

import { memo, useState, useMemo, useEffect } from "react"
import { useSetAtom, useAtom } from "jotai"
import { ChevronDown } from "lucide-react"
import { motion, AnimatePresence } from "motion/react"
import { Button } from "../../../components/ui/button"
import { cn } from "../../../lib/utils"
import { trpc } from "../../../lib/trpc"
import { useFileChangeListener } from "../../../lib/hooks/use-file-change-listener"
import { getFileIconByExtension } from "../mentions/agents-file-mention"
import {
  diffSidebarOpenAtomFamily,
  agentsFocusedDiffFileAtom,
  filteredDiffFilesAtom,
  filteredSubChatIdAtom,
  type SubChatFileChange,
  type ProjectMode,
} from "../atoms"
import { filePreviewPathAtom } from "../../cowork/atoms"

// Animated dots component that cycles through ., .., ...
function AnimatedDots() {
  const [dotCount, setDotCount] = useState(1)

  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1)
    }, 400)
    return () => clearInterval(interval)
  }, [])

  return <span className="inline-block w-[1em] text-left">{".".repeat(dotCount)}</span>
}

interface SubChatStatusCardProps {
  chatId: string // Parent chat ID for per-chat diff sidebar state
  subChatId: string // Sub-chat ID for filtering (used when Review is clicked)
  isStreaming: boolean
  isCompacting?: boolean
  changedFiles: SubChatFileChange[]
  worktreePath?: string | null // For git status check to hide committed files
  onStop?: () => void
  /** Whether there's a queue card above this one - affects border radius */
  hasQueueCardAbove?: boolean
  /** Project mode - "cowork" hides git features, "coding" shows full git features */
  projectMode?: ProjectMode
}

export const SubChatStatusCard = memo(function SubChatStatusCard({
  chatId,
  subChatId,
  isStreaming,
  isCompacting,
  changedFiles,
  worktreePath,
  onStop,
  hasQueueCardAbove = false,
  projectMode = "coding",
}: SubChatStatusCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isCodingMode = projectMode === "coding"

  // Use per-chat atom family instead of legacy global atom
  const diffSidebarAtom = useMemo(
    () => diffSidebarOpenAtomFamily(chatId),
    [chatId],
  )
  const [, setDiffSidebarOpen] = useAtom(diffSidebarAtom)
  const setFilteredDiffFiles = useSetAtom(filteredDiffFilesAtom)
  const setFilteredSubChatId = useSetAtom(filteredSubChatIdAtom)
  const setFocusedDiffFile = useSetAtom(agentsFocusedDiffFileAtom)
  const setFilePreviewPath = useSetAtom(filePreviewPathAtom)

  // Listen for file changes from Claude Write/Edit tools
  useFileChangeListener(worktreePath)

  // Fetch git status to filter out committed files (only in Coding mode)
  const { data: gitStatus } = trpc.changes.getStatus.useQuery(
    { worktreePath: worktreePath || "", defaultBranch: "main" },
    {
      // Only query git status in Coding mode
      enabled: isCodingMode && !!worktreePath && changedFiles.length > 0 && !isStreaming,
      // No polling - updates triggered by file-changed events from Claude tools
      staleTime: 30000,
      placeholderData: (prev) => prev,
    },
  )

  // Filter changedFiles to only include files that are still uncommitted
  // In Cowork mode, show all files without git filtering
  const displayFiles = useMemo(() => {
    // In Cowork mode, show all changed files (no git filtering)
    if (!isCodingMode) {
      return changedFiles
    }

    // Coding mode: filter by git status
    // If no git status yet, no worktreePath, or still streaming - show all files
    if (!gitStatus || !worktreePath || isStreaming) {
      return changedFiles
    }

    // Build set of all uncommitted file paths from git status
    const uncommittedPaths = new Set<string>()
    // Safely iterate - arrays might be undefined in edge cases
    if (gitStatus.staged) {
      for (const file of gitStatus.staged) {
        uncommittedPaths.add(file.path)
      }
    }
    if (gitStatus.unstaged) {
      for (const file of gitStatus.unstaged) {
        uncommittedPaths.add(file.path)
      }
    }
    if (gitStatus.untracked) {
      for (const file of gitStatus.untracked) {
        uncommittedPaths.add(file.path)
      }
    }

    // Filter changedFiles to only include files that are still uncommitted
    return changedFiles.filter((file) => uncommittedPaths.has(file.displayPath))
  }, [changedFiles, gitStatus, worktreePath, isStreaming, isCodingMode])

  // Calculate totals from uncommitted files only
  const totals = useMemo(() => {
    let additions = 0
    let deletions = 0
    for (const file of displayFiles) {
      additions += file.additions
      deletions += file.deletions
    }
    return { additions, deletions, fileCount: displayFiles.length }
  }, [displayFiles])

  // Check if there's expandable content (only files now)
  const hasExpandableContent = displayFiles.length > 0

  // Don't show if no changed files - only show when there are files to review
  if (displayFiles.length === 0) {
    return null
  }

  const handleReview = () => {
    // Set filter to only show files from this sub-chat
    // Use displayPath (relative path) to match git diff paths
    const filePaths = displayFiles.map((f) => f.displayPath)
    setFilteredDiffFiles(filePaths.length > 0 ? filePaths : null)
    // Also set subchat ID filter for ChangesPanel - use the prop, not activeSubChatId from store
    setFilteredSubChatId(subChatId)
    setDiffSidebarOpen(true)
  }

  return (
    <div
      className={cn(
        "border border-border bg-muted/30 overflow-hidden flex flex-col border-b-0 pb-6",
        // If queue card above - no top radius
        hasQueueCardAbove ? "rounded-none" : "rounded-t-xl"
      )}
    >
      {/* Header - at top */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setIsExpanded(!isExpanded)
          }
        }}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} status details`}
        className="flex items-center justify-between pr-1 pl-3 h-8 cursor-pointer hover:bg-muted/50 transition-colors duration-150 focus:outline-hidden rounded-sm"
      >
        <div className="flex items-center gap-2 text-xs flex-1 min-w-0">
          {/* Expand/Collapse chevron - always show */}
          <ChevronDown
            className={cn(
              "w-4 h-4 text-muted-foreground transition-transform duration-200",
              !isExpanded && "-rotate-90",
            )}
          />

          {/* Streaming indicator */}
          {isStreaming && (
            <span className="text-xs text-muted-foreground">
              {isCompacting ? "Compacting" : "Generating"}<AnimatedDots />
            </span>
          )}

          {/* File count and stats - only show when not streaming */}
          {!isStreaming && (
            <span className="text-xs text-muted-foreground">
              {totals.fileCount} {totals.fileCount === 1 ? "file" : "files"}
              {/* Only show line stats in Coding mode */}
              {isCodingMode && (totals.additions > 0 || totals.deletions > 0) && (
                <>
                  {" "}
                  <span className="text-green-600 dark:text-green-400">
                    +{totals.additions}
                  </span>{" "}
                  <span className="text-red-600 dark:text-red-400">
                    -{totals.deletions}
                  </span>
                </>
              )}
            </span>
          )}
        </div>

        {/* Right side: buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Stop button */}
          {isStreaming && onStop && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                onStop()
              }}
              className="h-6 px-2 text-xs font-normal rounded-md transition-transform duration-150 active:scale-[0.97]"
            >
              Stop
              <span className="text-muted-foreground/60 ml-1">⌃C</span>
            </Button>
          )}

          {/* Review button - only show in Coding mode */}
          {isCodingMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleReview()
              }}
              className="h-6 px-3 text-xs font-medium rounded-md transition-transform duration-150 active:scale-[0.97]"
            >
              Review
            </Button>
          )}
        </div>
      </div>

      {/* Expanded content - files */}
      <AnimatePresence initial={false}>
        {isExpanded && hasExpandableContent && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-border max-h-[200px] overflow-y-auto">
              {displayFiles.map((file) => {
                const FileIcon = getFileIconByExtension(file.displayPath)

                const handleFileClick = () => {
                  if (isCodingMode) {
                    // Coding mode: Open diff sidebar
                    // Set filter to only show files from this sub-chat
                    // Use displayPath (relative path) to match git diff paths
                    const filePaths = displayFiles.map((f) => f.displayPath)
                    setFilteredDiffFiles(filePaths.length > 0 ? filePaths : null)
                    // Set focus on this specific file
                    setFocusedDiffFile(file.displayPath)
                    // Open diff sidebar
                    setDiffSidebarOpen(true)
                  } else {
                    // Cowork mode: Open file preview
                    setFilePreviewPath(file.filePath)
                  }
                }

                const handleKeyDown = (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    handleFileClick()
                  }
                }

                return (
                  <div
                    key={file.filePath}
                    role="button"
                    tabIndex={0}
                    onClick={handleFileClick}
                    onKeyDown={handleKeyDown}
                    aria-label={`View diff for ${file.displayPath}`}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/50 transition-colors cursor-pointer focus:outline-hidden rounded-sm"
                  >
                    {FileIcon && (
                      <FileIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate flex-1 text-foreground">
                      {file.displayPath}
                    </span>
                    {/* Only show line stats in Coding mode */}
                    {isCodingMode && (
                      <>
                        <span className="shrink-0 text-green-600 dark:text-green-400">
                          +{file.additions}
                        </span>
                        <span className="shrink-0 text-red-600 dark:text-red-400">
                          -{file.deletions}
                        </span>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
})
