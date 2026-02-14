/**
 * Chat Utility Components and Functions
 *
 * Extracted from active-chat.tsx to reduce file size and improve maintainability.
 * Contains helper functions and isolated UI components used by ChatView and ChatViewInner.
 */

import { memo, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { ArrowDown } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { Kbd } from "../../../components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { cn } from "../../../lib/utils"
import { useStreamingStatusStore } from "../stores/streaming-status-store"

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * UTF-8 safe base64 encoding (btoa doesn't support Unicode)
 */
export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const binString = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(
    ""
  )
  return btoa(binString)
}

/**
 * Wait for streaming to finish by subscribing to the status store.
 * Includes a 30s safety timeout — if the store never transitions to "ready",
 * the promise resolves anyway to prevent hanging the UI indefinitely.
 */
const STREAMING_READY_TIMEOUT_MS = 30_000

export function waitForStreamingReady(subChatId: string): Promise<void> {
  return new Promise((resolve) => {
    if (!useStreamingStatusStore.getState().isStreaming(subChatId)) {
      resolve()
      return
    }

    const timeout = setTimeout(() => {
      console.warn(
        `[waitForStreamingReady] Timed out after ${STREAMING_READY_TIMEOUT_MS}ms for subChat ${subChatId.slice(-8)}, proceeding anyway`
      )
      unsub()
      resolve()
    }, STREAMING_READY_TIMEOUT_MS)

    const unsub = useStreamingStatusStore.subscribe(
      (state) => state.statuses[subChatId],
      (status) => {
        if (status === "ready" || status === undefined) {
          clearTimeout(timeout)
          unsub()
          resolve()
        }
      }
    )
  })
}

/**
 * Get the ID of the first sub-chat by creation date
 */
export function getFirstSubChatId(
  subChats:
    | Array<{ id: string; created_at?: Date | string | null }>
    | undefined
): string | null {
  if (!subChats?.length) return null
  const sorted = [...subChats].sort(
    (a, b) =>
      (a.created_at ? new Date(a.created_at).getTime() : 0) -
      (b.created_at ? new Date(b.created_at).getTime() : 0)
  )
  return sorted[0]?.id ?? null
}

// =============================================================================
// Tab Computation
// =============================================================================

/**
 * Maximum number of tabs to keep mounted for keep-alive behavior
 * Prevents memory growth while maintaining smooth tab switching
 */
export const MAX_MOUNTED_TABS = 10

/**
 * Computes which sub-chat tabs should be rendered (keep-alive pool)
 *
 * This handles workspace isolation and race conditions:
 * - Validates sub-chat IDs against server and local store data
 * - Trusts localStorage during initial loading (before data arrives)
 * - Always includes active tab + pinned tabs + recent tabs up to limit
 *
 * @param activeSubChatId - Currently active sub-chat ID
 * @param pinnedSubChatIds - IDs of pinned sub-chats
 * @param openSubChatIds - IDs of open sub-chats (in order)
 * @param allSubChats - SubChats from local Zustand store
 * @param agentSubChats - SubChats from server (React Query cache)
 * @returns Array of sub-chat IDs to render
 */
export function computeTabsToRender(
  activeSubChatId: string | null,
  pinnedSubChatIds: string[],
  openSubChatIds: string[],
  allSubChats: Array<{ id: string }>,
  agentSubChats: Array<{ id: string }>
): string[] {
  if (!activeSubChatId) return []

  // Combine server data (agentSubChats) with local store (allSubChats) for validation.
  // This handles:
  // 1. Race condition where setChatId resets allSubChats but activeSubChatId loads from localStorage
  // 2. Optimistic updates when creating new sub-chats (new sub-chat is in allSubChats but not in agentSubChats yet)
  const validSubChatIds = new Set([
    ...agentSubChats.map((sc) => sc.id),
    ...allSubChats.map((sc) => sc.id),
  ])

  // When both data sources are still empty (loading), trust activeSubChatId from localStorage.
  // Without this, there's a race condition:
  //   1. setChatId() resets allSubChats to []
  //   2. Server query for agentChat is still loading → agentSubChats is []
  //   3. activeSubChatId is restored from localStorage (valid)
  //   4. validSubChatIds is empty → activeSubChatId fails validation → returns []
  //   5. No ChatViewInner renders → blank screen
  const dataNotYetLoaded = validSubChatIds.size === 0

  // If active sub-chat doesn't belong to this workspace → return []
  // This prevents rendering sub-chats from another workspace during race condition
  // But skip this check when data hasn't loaded yet (trust localStorage)
  if (!dataNotYetLoaded && !validSubChatIds.has(activeSubChatId)) {
    return []
  }

  // Filter openSubChatIds and pinnedSubChatIds to only valid IDs for this workspace
  // When data hasn't loaded, allow all IDs through (they came from localStorage for this chatId)
  const validOpenIds = dataNotYetLoaded
    ? openSubChatIds
    : openSubChatIds.filter((id) => validSubChatIds.has(id))
  const validPinnedIds = dataNotYetLoaded
    ? pinnedSubChatIds
    : pinnedSubChatIds.filter((id) => validSubChatIds.has(id))

  // Start with active (must always be mounted)
  const mustRender = new Set([activeSubChatId])

  // Add pinned tabs (only valid ones)
  for (const id of validPinnedIds) {
    mustRender.add(id)
  }

  // If we have room, add recent tabs from openSubChatIds (only valid ones)
  if (mustRender.size < MAX_MOUNTED_TABS) {
    const remaining = MAX_MOUNTED_TABS - mustRender.size
    const recentTabs = validOpenIds
      .filter((id) => !mustRender.has(id))
      .slice(-remaining) // Take the most recent (end of array)

    for (const id of recentTabs) {
      mustRender.add(id)
    }
  }

  // Return tabs to render
  // Always include activeSubChatId even if not in validOpenIds (handles race condition
  // where openSubChatIds from localStorage doesn't include the active tab yet)
  const result = validOpenIds.filter((id) => mustRender.has(id))
  if (!result.includes(activeSubChatId)) {
    result.unshift(activeSubChatId)
  }
  return result
}

// =============================================================================
// UI Components
// =============================================================================

/**
 * Isolated scroll-to-bottom button - uses own scroll listener to avoid re-renders of parent
 */
export interface ScrollToBottomButtonProps {
  containerRef: React.RefObject<HTMLElement | null>
  onScrollToBottom: () => void
  hasStackedCards?: boolean
  subChatId?: string
  isActive?: boolean
}

export const ScrollToBottomButton = memo(function ScrollToBottomButton({
  containerRef,
  onScrollToBottom,
  hasStackedCards = false,
  subChatId,
  isActive = true,
}: ScrollToBottomButtonProps) {
  const [isVisible, setIsVisible] = useState(false)

  // Keep isActive in ref for scroll event handler
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  useEffect(() => {
    // Skip scroll monitoring for inactive tabs (keep-alive)
    if (!isActive) return

    const container = containerRef.current
    if (!container) return

    // RAF throttle to avoid setState on every scroll event
    let rafId: number | null = null
    let lastAtBottom: boolean | null = null

    const checkVisibility = () => {
      // Skip if not active or RAF already pending
      if (!isActiveRef.current || rafId !== null) return

      rafId = requestAnimationFrame(() => {
        rafId = null
        // Double-check active state in RAF callback
        if (!isActiveRef.current) return

        const threshold = 50
        const atBottom =
          container.scrollHeight - container.scrollTop - container.clientHeight <=
          threshold

        // Only update state if value actually changed
        if (lastAtBottom !== atBottom) {
          lastAtBottom = atBottom
          setIsVisible(!atBottom)
        }
      })
    }

    // Check initial state after a short delay to allow scroll position to be set
    // This handles the case when entering a sub-chat that's scrolled to a specific position
    const timeoutId = setTimeout(() => {
      // Skip if not active
      if (!isActiveRef.current) return

      // Direct check for initial state (no RAF needed)
      const threshold = 50
      const atBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight <=
        threshold
      lastAtBottom = atBottom
      setIsVisible(!atBottom)
    }, 50)

    container.addEventListener("scroll", checkVisibility, { passive: true })
    return () => {
      clearTimeout(timeoutId)
      if (rafId !== null) cancelAnimationFrame(rafId)
      container.removeEventListener("scroll", checkVisibility)
    }
  }, [containerRef, subChatId, isActive])

  return (
    <AnimatePresence>
      {isVisible && (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <motion.button
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              onClick={onScrollToBottom}
              className={cn(
                "absolute right-4 p-2 rounded-full bg-background border border-border shadow-md hover:bg-accent active:scale-[0.97] transition-colors z-20",
                hasStackedCards
                  ? "bottom-44 sm:bottom-36"
                  : "bottom-32 sm:bottom-24"
              )}
              aria-label="Scroll to bottom"
            >
              <ArrowDown className="h-4 w-4 text-muted-foreground" />
            </motion.button>
          </TooltipTrigger>
          <TooltipContent side="top">
            Scroll to bottom
            <span className="inline-flex items-center gap-0.5">
              <Kbd>⌘</Kbd>
              <Kbd>
                <ArrowDown className="h-3 w-3" />
              </Kbd>
            </span>
          </TooltipContent>
        </Tooltip>
      )}
    </AnimatePresence>
  )
})

/**
 * Message group wrapper - measures user message height for sticky todo positioning
 */
export interface MessageGroupProps {
  children: React.ReactNode
  isLastGroup?: boolean
}

export function MessageGroup({ children, isLastGroup }: MessageGroupProps) {
  const groupRef = useRef<HTMLDivElement>(null)
  const userMessageRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const groupEl = groupRef.current
    if (!groupEl) return

    // Find the actual bubble element (not the wrapper which includes gradient)
    const bubbleEl = groupEl.querySelector(
      "[data-user-bubble]"
    ) as HTMLDivElement | null
    if (!bubbleEl) return

    userMessageRef.current = bubbleEl

    const updateHeight = () => {
      const height = bubbleEl.offsetHeight
      // Set CSS variable directly on DOM - no React state, no re-renders
      groupEl.style.setProperty("--user-message-height", `${height}px`)
    }

    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(bubbleEl)

    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={groupRef}
      className="relative"
      style={{
        // content-visibility: auto - browser skips layout/paint for elements outside viewport
        // This is a HUGE optimization for long chats - only visible content is rendered
        contentVisibility: "auto",
        // Approximate height for correct scrollbar before rendering
        containIntrinsicSize: "auto 200px",
        // Last group has minimum height of chat container (minus padding)
        ...(isLastGroup && {
          minHeight: "calc(var(--chat-container-height) - 32px)",
        }),
      }}
      data-last-group={isLastGroup || undefined}
    >
      {children}
    </div>
  )
}
