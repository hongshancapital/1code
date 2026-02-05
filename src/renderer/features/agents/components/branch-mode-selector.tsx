"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { GitBranch, Laptop, ChevronRight } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover"
import {
  IconChevronDown,
  CheckIcon,
  BranchIcon,
  SearchIcon,
} from "../../../components/ui/icons"
import { cn } from "../../../lib/utils"
import type { WorkMode } from "../atoms"

// ============================================================================
// Types
// ============================================================================

interface BranchInfo {
  name: string
  type: "local" | "remote"
  isDefault?: boolean
  committedAt?: string | null
}

interface BranchModeSelectorProps {
  /** Current work mode */
  workMode: WorkMode
  /** Callback when work mode changes */
  onWorkModeChange: (mode: WorkMode) => void
  /** Selected base branch name */
  selectedBranch: string
  /** Selected branch type */
  selectedBranchType?: "local" | "remote"
  /** Callback when branch changes */
  onBranchChange: (branch: string, type: "local" | "remote") => void
  /** Custom branch name */
  customBranchName: string
  /** Callback when custom branch name changes */
  onCustomBranchNameChange: (name: string) => void
  /** Branch name validation error */
  branchNameError: string | null
  /** Available branches */
  branches: BranchInfo[]
  /** Default branch name */
  defaultBranch: string
  /** Loading state */
  isLoading?: boolean
  /** Disabled state */
  disabled?: boolean
}

// ============================================================================
// Helper: Format relative time
// ============================================================================

function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return ""
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return "today"
  if (diffDays === 1) return "yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
  return `${Math.floor(diffDays / 365)}y ago`
}

// ============================================================================
// Component
// ============================================================================

export function BranchModeSelector({
  workMode,
  onWorkModeChange,
  selectedBranch,
  selectedBranchType,
  onBranchChange,
  customBranchName,
  onCustomBranchNameChange,
  branchNameError,
  branches,
  defaultBranch,
  isLoading = false,
  disabled = false,
}: BranchModeSelectorProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"main" | "branches">("main")
  const [branchSearch, setBranchSearch] = useState("")
  const branchListRef = useRef<HTMLDivElement>(null)

  // Reset view when popover closes
  useEffect(() => {
    if (!open) {
      setView("main")
      setBranchSearch("")
    }
  }, [open])

  // Filter branches
  const filteredBranches = branches.filter((b) =>
    b.name.toLowerCase().includes(branchSearch.toLowerCase())
  )

  // Virtualizer for branch list
  const branchVirtualizer = useVirtualizer({
    count: filteredBranches.length,
    getScrollElement: () => branchListRef.current,
    estimateSize: () => 36,
    overscan: 5,
  })

  // Get display text for trigger button
  const getTriggerText = () => {
    if (workMode === "local") {
      return "Edit directly"
    }
    const branch = selectedBranch || defaultBranch || "main"
    if (customBranchName) {
      return `${customBranchName} from ${branch}`
    }
    return `New branch from ${branch}`
  }

  // Handle branch selection
  const handleBranchSelect = useCallback(
    (branch: BranchInfo) => {
      onBranchChange(branch.name, branch.type)
      setView("main")
      setBranchSearch("")
    },
    [onBranchChange]
  )

  // Handle switching to worktree mode
  const handleSelectWorktree = useCallback(() => {
    if (workMode !== "worktree") {
      onWorkModeChange("worktree")
    }
  }, [workMode, onWorkModeChange])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-1.5 px-2 py-1 text-sm transition-[background-color,color] duration-150 ease-out rounded-md hover:bg-muted/50 outline-hidden",
            workMode === "worktree"
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
            customBranchName && workMode === "worktree" && "bg-emerald-500/10",
            branchNameError && "text-destructive bg-destructive/10",
            disabled && "opacity-50 pointer-events-none"
          )}
          disabled={disabled || isLoading}
        >
          {workMode === "worktree" ? (
            <GitBranch className="w-4 h-4" />
          ) : (
            <Laptop className="w-4 h-4" />
          )}
          <span className="truncate max-w-[200px]">{getTriggerText()}</span>
          <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[280px] p-0"
        align="start"
        side="bottom"
        sideOffset={4}
        collisionPadding={20}
      >
        {view === "main" ? (
          <div className="py-1">
            {/* Local mode option */}
            <button
              onClick={() => {
                onWorkModeChange("local")
                setOpen(false)
              }}
              className={cn(
                "flex items-center gap-2 w-[calc(100%-8px)] mx-1 px-2 py-2 text-sm text-left rounded-md cursor-default select-none outline-hidden transition-colors",
                workMode === "local"
                  ? "bg-accent text-foreground"
                  : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
              )}
            >
              <Laptop className="h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">Edit directly</div>
                <div className="text-xs text-muted-foreground">
                  Changes apply to project folder
                </div>
              </div>
              {workMode === "local" && (
                <CheckIcon className="h-4 w-4 shrink-0" />
              )}
            </button>

            {/* Divider */}
            <div className="h-px bg-border mx-2 my-1" />

            {/* Worktree mode option */}
            <button
              onClick={handleSelectWorktree}
              className={cn(
                "flex items-center gap-2 w-[calc(100%-8px)] mx-1 px-2 py-2 text-sm text-left rounded-md cursor-default select-none outline-hidden transition-colors",
                workMode === "worktree"
                  ? "bg-accent text-foreground"
                  : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
              )}
            >
              <GitBranch className="h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">New branch</div>
                <div className="text-xs text-muted-foreground">
                  Isolated copy, safe to experiment
                </div>
              </div>
              {workMode === "worktree" && (
                <CheckIcon className="h-4 w-4 shrink-0" />
              )}
            </button>

            {/* Worktree settings (only show when worktree is selected) */}
            {workMode === "worktree" && (
              <>
                <div className="h-px bg-border mx-2 my-1" />

                {/* Base branch selector */}
                <button
                  onClick={() => setView("branches")}
                  className="flex items-center gap-2 w-[calc(100%-8px)] mx-1 px-2 py-2 text-sm text-left rounded-md cursor-default select-none outline-hidden transition-colors hover:bg-accent/50"
                >
                  <BranchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-muted-foreground">
                      Base branch
                    </div>
                    <div className="font-medium truncate">
                      {selectedBranch || defaultBranch || "main"}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>

                {/* Custom branch name input */}
                <div className="px-3 py-2">
                  <div className="text-xs text-muted-foreground mb-1.5">
                    Branch name (optional)
                  </div>
                  <input
                    type="text"
                    placeholder="e.g. feature-login"
                    value={customBranchName}
                    onChange={(e) => onCustomBranchNameChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !branchNameError) {
                        e.preventDefault()
                        setOpen(false)
                      }
                    }}
                    className={cn(
                      "w-full px-2.5 py-1.5 text-sm rounded-md border bg-background outline-hidden transition-colors",
                      branchNameError
                        ? "border-destructive"
                        : "border-input focus:border-muted-foreground"
                    )}
                  />
                  {branchNameError ? (
                    <p className="text-xs text-destructive mt-1">
                      {branchNameError}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Leave empty to auto-generate
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          /* Branch selection view */
          <div>
            {/* Header with back button */}
            <div className="flex items-center gap-2 px-3 py-2 border-b">
              <button
                onClick={() => setView("main")}
                className="p-1 -ml-1 rounded hover:bg-accent/50 transition-colors"
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
              </button>
              <span className="text-sm font-medium">Select base branch</span>
            </div>

            {/* Search */}
            <div className="flex items-center gap-1.5 h-8 px-3 mx-2 my-2 rounded-md bg-muted/50">
              <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search branches..."
                value={branchSearch}
                onChange={(e) => setBranchSearch(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground"
                autoFocus
              />
            </div>

            {/* Branch list */}
            {filteredBranches.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No branches found
              </div>
            ) : (
              <div
                ref={branchListRef}
                className="overflow-auto py-1 scrollbar-hide"
                style={{
                  height: Math.min(filteredBranches.length * 36 + 8, 240),
                }}
              >
                <div
                  style={{
                    height: `${branchVirtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {branchVirtualizer.getVirtualItems().map((virtualItem) => {
                    const branch = filteredBranches[virtualItem.index]
                    const isSelected =
                      (selectedBranch === branch.name &&
                        selectedBranchType === branch.type) ||
                      (!selectedBranch &&
                        branch.isDefault &&
                        branch.type === "local")

                    return (
                      <button
                        key={`${branch.type}-${branch.name}`}
                        onClick={() => handleBranchSelect(branch)}
                        className={cn(
                          "flex items-center gap-1.5 w-[calc(100%-8px)] mx-1 px-2 text-sm text-left absolute left-0 top-0 rounded-md cursor-default select-none outline-hidden transition-colors",
                          isSelected
                            ? "bg-accent text-foreground"
                            : "hover:bg-accent/50 hover:text-foreground"
                        )}
                        style={{
                          height: `${virtualItem.size}px`,
                          transform: `translateY(${virtualItem.start}px)`,
                        }}
                      >
                        <BranchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="truncate flex-1">{branch.name}</span>
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded shrink-0",
                            branch.type === "local"
                              ? "bg-blue-500/10 text-blue-500"
                              : "bg-orange-500/10 text-orange-500"
                          )}
                        >
                          {branch.type}
                        </span>
                        {branch.committedAt && (
                          <span className="text-xs text-muted-foreground/70 shrink-0">
                            {formatRelativeTime(branch.committedAt)}
                          </span>
                        )}
                        {isSelected && (
                          <CheckIcon className="h-4 w-4 shrink-0 ml-auto" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
