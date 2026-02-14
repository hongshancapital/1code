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
