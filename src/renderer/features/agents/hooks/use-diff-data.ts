/**
 * useDiffData - Manages diff data fetching and state
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Handles:
 * - Diff cache management (diffStats, parsedFileDiffs, prefetchedFileContents, diffContent)
 * - fetchDiffStats function (fetches diff from local worktree or remote sandbox)
 * - Throttled refresh when sub-chat files change
 * - Automatic refresh on mount, worktreePath/sandboxId changes, and sidebar open/close
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { trpcClient } from "../../../lib/trpc"
import {
  workspaceDiffCacheAtomFamily,
  type CachedParsedDiffFile,
} from "../atoms"
import {
  splitUnifiedDiffByFile,
  type ParsedDiffFile,
} from "../ui/agent-diff-view"
import { subChatFilesAtom } from "../atoms"

// =============================================================================
// Types
// =============================================================================

export interface DiffStats {
  isLoading: boolean
  hasChanges: boolean
  fileCount: number
  additions: number
  deletions: number
}

export interface UseDiffDataOptions {
  chatId: string
  worktreePath: string | null
  sandboxId?: string
  isDesktopPlatform: boolean
  isDiffSidebarOpen: boolean
  setHasPendingDiffChanges: (value: boolean) => void
  /** Agent chat data for remote stats (optional, only needed for sandbox mode on desktop) */
  agentChat?: { meta?: unknown; remoteStats?: unknown } | null
}

export interface UseDiffDataResult {
  // State
  diffStats: DiffStats
  parsedFileDiffs: ParsedDiffFile[] | null
  prefetchedFileContents: Record<string, string>
  diffContent: string | null
  /** Total file count across all sub-chats (for change detection) */
  totalSubChatFileCount: number

  // Setters
  setDiffStats: (val: DiffStats | ((prev: DiffStats) => DiffStats)) => void
  setParsedFileDiffs: (files: ParsedDiffFile[] | null) => void
  setPrefetchedFileContents: (contents: Record<string, string>) => void
  setDiffContent: (content: string | null) => void

  // Actions
  fetchDiffStats: () => Promise<void>
  fetchDiffStatsDebounced: () => void
  /** Ref to hold latest fetchDiffStatsDebounced for use in onFinish callbacks */
  fetchDiffStatsRef: React.MutableRefObject<() => void>
}

// =============================================================================
// Constants
// =============================================================================

/** Throttle period for diff fetches triggered by file changes */
const DIFF_THROTTLE_MS = 2000

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get normalized remote stats from agent chat data
 */
function getRemoteStats(
  agentChat: { meta?: unknown; remoteStats?: unknown } | null | undefined
): {
  fileCount: number
  additions: number
  deletions: number
} | null {
  if (!agentChat) return null

  // Try remoteStats first (new format)
  const remoteStats = agentChat.remoteStats as {
    fileCount?: number
    additions?: number
    deletions?: number
  } | null

  if (remoteStats && typeof remoteStats.fileCount === "number") {
    return {
      fileCount: remoteStats.fileCount,
      additions: remoteStats.additions ?? 0,
      deletions: remoteStats.deletions ?? 0,
    }
  }

  // Try meta.diffStats (legacy format)
  const meta = agentChat.meta as { diffStats?: unknown } | null
  const diffStats = meta?.diffStats as {
    fileCount?: number
    additions?: number
    deletions?: number
  } | null

  if (diffStats && typeof diffStats.fileCount === "number") {
    return {
      fileCount: diffStats.fileCount,
      additions: diffStats.additions ?? 0,
      deletions: diffStats.deletions ?? 0,
    }
  }

  return null
}

// =============================================================================
// Hook
// =============================================================================

export function useDiffData(options: UseDiffDataOptions): UseDiffDataResult {
  const {
    chatId,
    worktreePath,
    sandboxId,
    isDesktopPlatform,
    isDiffSidebarOpen,
    setHasPendingDiffChanges,
    agentChat,
  } = options

  // Diff data cache - stored in atoms to persist across workspace switches
  const diffCacheAtom = useMemo(
    () => workspaceDiffCacheAtomFamily(chatId),
    [chatId]
  )
  const [diffCache, setDiffCache] = useAtom(diffCacheAtom)

  // Extract diff data from cache
  const diffStats = diffCache.diffStats
  const parsedFileDiffs = diffCache.parsedFileDiffs as ParsedDiffFile[] | null
  const prefetchedFileContents = diffCache.prefetchedFileContents
  const diffContent = diffCache.diffContent

  // Smart setters that update the cache
  const setDiffStats = useCallback(
    (val: DiffStats | ((prev: DiffStats) => DiffStats)) => {
      setDiffCache((prev) => {
        const newVal = typeof val === "function" ? val(prev.diffStats) : val
        // Only update if something changed
        if (
          prev.diffStats.fileCount === newVal.fileCount &&
          prev.diffStats.additions === newVal.additions &&
          prev.diffStats.deletions === newVal.deletions &&
          prev.diffStats.isLoading === newVal.isLoading &&
          prev.diffStats.hasChanges === newVal.hasChanges
        ) {
          return prev // Return same reference to prevent re-render
        }
        return { ...prev, diffStats: newVal }
      })
    },
    [setDiffCache]
  )

  const setParsedFileDiffs = useCallback(
    (files: ParsedDiffFile[] | null) => {
      setDiffCache((prev) => ({
        ...prev,
        parsedFileDiffs: files as CachedParsedDiffFile[] | null,
      }))
    },
    [setDiffCache]
  )

  const setPrefetchedFileContents = useCallback(
    (contents: Record<string, string>) => {
      setDiffCache((prev) => ({ ...prev, prefetchedFileContents: contents }))
    },
    [setDiffCache]
  )

  const setDiffContent = useCallback(
    (content: string | null) => {
      setDiffCache((prev) => ({ ...prev, diffContent: content }))
    },
    [setDiffCache]
  )

  // Track changed files across all sub-chats
  const subChatFiles = useAtomValue(subChatFilesAtom)

  // Initialize to Date.now() to prevent double-fetch on mount
  const lastDiffFetchTimeRef = useRef<number>(Date.now())
  const fetchDiffStatsDebounceRef = useRef<NodeJS.Timeout | null>(null)
  const isFetchingDiffRef = useRef(false)

  // Fetch diff stats function
  const fetchDiffStats = useCallback(async () => {
    console.log("[fetchDiffStats] Called with:", {
      worktreePath,
      sandboxId,
      chatId,
      isDesktop: isDesktopPlatform,
    })

    // Desktop uses worktreePath, web uses sandboxId
    // Don't reset stats if worktreePath is temporarily undefined - just skip the fetch
    if (!worktreePath && !sandboxId) {
      console.log("[fetchDiffStats] Skipping - no worktreePath or sandboxId")
      return
    }

    // Prevent duplicate parallel fetches
    if (isFetchingDiffRef.current) {
      console.log("[fetchDiffStats] Skipping - already fetching")
      return
    }
    isFetchingDiffRef.current = true
    console.log("[fetchDiffStats] Starting fetch...")

    try {
      // Desktop: use new getParsedDiff endpoint (all-in-one: parsing + file contents)
      if (worktreePath && chatId) {
        const result = await trpcClient.chats.getParsedDiff.query({ chatId })

        if (result.files && result.files.length > 0) {
          setParsedFileDiffs(result.files)
          setPrefetchedFileContents(result.fileContents)
          setDiffContent(null)

          setDiffStats({
            fileCount: result.files.length,
            additions: result.totalAdditions,
            deletions: result.totalDeletions,
            isLoading: false,
            hasChanges: result.files.length > 0,
          })
        } else {
          setDiffStats({
            fileCount: 0,
            additions: 0,
            deletions: 0,
            isLoading: false,
            hasChanges: false,
          })
          setParsedFileDiffs([])
          setPrefetchedFileContents({})
          setDiffContent(null)
        }
        return
      }

      // Desktop without chat (viewing main repo directly)
      if (worktreePath && !chatId) {
        // TODO: Need to add endpoint that accepts worktreePath directly
        return
      }

      // Remote sandbox: use stats from chat data (desktop) or fetch diff (web)
      if (sandboxId) {
        console.log("[fetchDiffStats] Sandbox mode - sandboxId:", sandboxId)

        // Desktop app: use stats already provided in chat data
        if (isDesktopPlatform) {
          const normalizedStats = getRemoteStats(agentChat)
          console.log(
            "[fetchDiffStats] Desktop remote chat - using remoteStats:",
            normalizedStats
          )

          if (normalizedStats) {
            setDiffStats({
              fileCount: normalizedStats.fileCount,
              additions: normalizedStats.additions,
              deletions: normalizedStats.deletions,
              isLoading: false,
              hasChanges: normalizedStats.fileCount > 0,
            })
          } else {
            setDiffStats({
              fileCount: 0,
              additions: 0,
              deletions: 0,
              isLoading: false,
              hasChanges: false,
            })
          }
          setParsedFileDiffs([])
          setPrefetchedFileContents({})
          setDiffContent(null)
          return
        }

        // Web: use relative fetch to get actual diff
        let rawDiff: string | null = null
        const response = await fetch(`/api/agents/sandbox/${sandboxId}/diff`)
        if (!response.ok) {
          setDiffStats((prev) => ({ ...prev, isLoading: false }))
          return
        }
        const data = await response.json()
        rawDiff = data.diff || null

        console.log(
          "[fetchDiffStats] Setting diff content, length:",
          rawDiff?.length ?? 0
        )
        setDiffContent(rawDiff)

        if (rawDiff && rawDiff.trim()) {
          console.log("[fetchDiffStats] Parsing diff...")
          const parsedFiles = splitUnifiedDiffByFile(rawDiff)
          console.log(
            "[fetchDiffStats] Parsed files:",
            parsedFiles.length,
            "files"
          )
          setParsedFileDiffs(parsedFiles)

          let additions = 0
          let deletions = 0
          for (const file of parsedFiles) {
            additions += file.additions
            deletions += file.deletions
          }

          console.log("[fetchDiffStats] Setting stats:", {
            fileCount: parsedFiles.length,
            additions,
            deletions,
          })
          setDiffStats({
            fileCount: parsedFiles.length,
            additions,
            deletions,
            isLoading: false,
            hasChanges: parsedFiles.length > 0,
          })
        } else {
          console.log("[fetchDiffStats] No diff content, setting empty stats")
          setDiffStats({
            fileCount: 0,
            additions: 0,
            deletions: 0,
            isLoading: false,
            hasChanges: false,
          })
          setParsedFileDiffs([])
          setPrefetchedFileContents({})
        }
      }
    } catch (error) {
      console.error("[fetchDiffStats] Error:", error)
      setDiffStats((prev) => ({ ...prev, isLoading: false }))
    } finally {
      console.log("[fetchDiffStats] Done")
      isFetchingDiffRef.current = false
    }
  }, [
    worktreePath,
    sandboxId,
    chatId,
    agentChat,
    isDesktopPlatform,
    setDiffStats,
    setParsedFileDiffs,
    setPrefetchedFileContents,
    setDiffContent,
  ])

  // Debounced version for calling after stream ends
  const fetchDiffStatsDebounced = useCallback(() => {
    if (fetchDiffStatsDebounceRef.current) {
      clearTimeout(fetchDiffStatsDebounceRef.current)
    }
    fetchDiffStatsDebounceRef.current = setTimeout(() => {
      fetchDiffStats()
    }, 500) // 500ms debounce to avoid spamming if multiple streams end
  }, [fetchDiffStats])

  // Ref to hold the latest fetchDiffStatsDebounced for use in onFinish callbacks
  const fetchDiffStatsRef = useRef(fetchDiffStatsDebounced)
  useEffect(() => {
    fetchDiffStatsRef.current = fetchDiffStatsDebounced
  }, [fetchDiffStatsDebounced])

  // Fetch diff stats on mount and when worktreePath/sandboxId changes
  useEffect(() => {
    fetchDiffStats()
  }, [fetchDiffStats])

  // Refresh diff stats when diff sidebar opens or closes
  useEffect(() => {
    if (isDiffSidebarOpen) {
      fetchDiffStats()
    } else {
      setHasPendingDiffChanges(false)
      fetchDiffStats()
    }
  }, [isDiffSidebarOpen, fetchDiffStats, setHasPendingDiffChanges])

  // Calculate total file count across all sub-chats for change detection
  const totalSubChatFileCount = useMemo(() => {
    let count = 0
    subChatFiles.forEach((files) => {
      count += files.length
    })
    return count
  }, [subChatFiles])

  // Throttled refetch when sub-chat files change
  useEffect(() => {
    if (totalSubChatFileCount === 0) return

    const now = Date.now()
    const timeSinceLastFetch = now - lastDiffFetchTimeRef.current

    if (timeSinceLastFetch >= DIFF_THROTTLE_MS) {
      lastDiffFetchTimeRef.current = now
      fetchDiffStats()
    } else {
      const delay = DIFF_THROTTLE_MS - timeSinceLastFetch
      const timer = setTimeout(() => {
        lastDiffFetchTimeRef.current = Date.now()
        fetchDiffStats()
      }, delay)
      return () => clearTimeout(timer)
    }
  }, [totalSubChatFileCount, fetchDiffStats])

  return {
    // State
    diffStats,
    parsedFileDiffs,
    prefetchedFileContents,
    diffContent,
    totalSubChatFileCount,

    // Setters
    setDiffStats,
    setParsedFileDiffs,
    setPrefetchedFileContents,
    setDiffContent,

    // Actions
    fetchDiffStats,
    fetchDiffStatsDebounced,
    fetchDiffStatsRef,
  }
}
