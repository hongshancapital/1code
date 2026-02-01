import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"

/**
 * Hook that listens for file changes from Claude Write/Edit tools
 * and invalidates the git status query to trigger a refetch
 */
export function useFileChangeListener(worktreePath: string | null | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!worktreePath) return

    const cleanup = window.desktopApi?.onFileChanged((data) => {
      // Check if the changed file is within our worktree
      if (data.filePath.startsWith(worktreePath)) {
        // Invalidate git status queries to trigger refetch
        queryClient.invalidateQueries({
          queryKey: [["changes", "getStatus"]],
        })

        // Invalidate file tree queries to refresh file list
        queryClient.invalidateQueries({
          queryKey: [["files", "listDirectory"]],
        })
      }
    })

    return () => {
      cleanup?.()
    }
  }, [worktreePath, queryClient])
}

export interface UseGitWatcherOptions {
  /** When true, diff changes will NOT auto-refresh. Instead onPendingChange(true) is called. */
  isDiffSidebarOpen?: boolean
  /** Callback when pending diff changes state changes */
  onPendingChange?: (hasPending: boolean) => void
}

/**
 * Hook that subscribes to the GitWatcher for real-time file system monitoring.
 * Uses chokidar on the main process for efficient file watching.
 * Automatically invalidates git status queries when files change.
 *
 * When isDiffSidebarOpen is true, diff data will NOT auto-refresh to prevent
 * disrupting the user's review. Instead, onPendingChange(true) is called to
 * show a "Refresh" button.
 */
export function useGitWatcher(
  worktreePath: string | null | undefined,
  options?: UseGitWatcherOptions
) {
  const queryClient = useQueryClient()
  const isSubscribedRef = useRef(false)
  // Use refs to avoid re-subscribing when options change
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    if (!worktreePath) return

    // Subscribe to git watcher on main process
    const subscribe = async () => {
      try {
        await window.desktopApi?.subscribeToGitWatcher(worktreePath)
        isSubscribedRef.current = true
      } catch (error) {
        console.error("[useGitWatcher] Failed to subscribe:", error)
      }
    }

    subscribe()

    // Listen for git status changes from the watcher
    const cleanup = window.desktopApi?.onGitStatusChanged((data) => {
      if (data.worktreePath === worktreePath) {
        // Invalidate git status queries to trigger refetch
        queryClient.invalidateQueries({
          queryKey: [["changes", "getStatus"]],
        })

        // Invalidate file tree queries to refresh file list
        queryClient.invalidateQueries({
          queryKey: [["files", "listDirectory"]],
        })

        // Handle parsed diff - check if files were modified
        const hasModifiedFiles = data.changes.some(
          (change) => change.type === "change" || change.type === "add"
        )
        if (hasModifiedFiles) {
          const { isDiffSidebarOpen, onPendingChange } = optionsRef.current || {}

          if (isDiffSidebarOpen) {
            // Diff sidebar is open - don't auto-refresh, just mark as pending
            onPendingChange?.(true)
          } else {
            // Diff sidebar is closed - auto-refresh as before
            queryClient.invalidateQueries({
              queryKey: [["changes", "getParsedDiff"]],
            })
          }
        }
      }
    })

    return () => {
      cleanup?.()

      // Unsubscribe from git watcher
      if (isSubscribedRef.current) {
        window.desktopApi?.unsubscribeFromGitWatcher(worktreePath).catch((error) => {
          console.error("[useGitWatcher] Failed to unsubscribe:", error)
        })
        isSubscribedRef.current = false
      }
    }
  }, [worktreePath, queryClient])
}
