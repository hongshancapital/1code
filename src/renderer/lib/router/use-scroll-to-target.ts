import { useEffect, useRef } from "react"
import { useAtom, useSetAtom } from "jotai"
import { scrollTargetAtom } from "./atoms"
import { SCROLL_TO_BOTTOM } from "./types"
import {
  chatSearchOpenAtom,
  chatSearchInputAtom,
  chatSearchQueryAtom,
} from "../../features/agents/search/chat-search-atoms"

/**
 * Consumes the scrollTargetAtom to scroll to a specific message or bottom.
 * Uses the same double-rAF pattern as the existing chat search scroll.
 *
 * Supports two modes:
 * - SCROLL_TO_BOTTOM: Scroll to the end of the chat (for navigation without messageId)
 * - Specific messageId: Scroll to that message and optionally highlight search text
 *
 * Should be called inside ChatViewInner for each active sub-chat.
 */
export function useScrollToTarget(
  chatContainerRef: React.RefObject<HTMLElement | null>,
  subChatId: string,
  isActive: boolean,
  /** Called when scroll target is consumed - allows parent to enable auto-scroll */
  onScrollInitialized?: () => void,
  /** Whether messages have been loaded - for specific messageId targets, waits until true */
  messagesLoaded?: boolean,
) {
  const [scrollTarget, setScrollTarget] = useAtom(scrollTargetAtom)
  const setChatSearchOpen = useSetAtom(chatSearchOpenAtom)
  const setChatSearchInput = useSetAtom(chatSearchInputAtom)
  const setChatSearchQuery = useSetAtom(chatSearchQueryAtom)

  // Track if we've already processed this scroll target to avoid duplicate processing
  const processedTargetRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isActive || !scrollTarget || scrollTarget.consumed) return

    const container = chatContainerRef.current
    if (!container) return

    // Create a unique key for this scroll target to track if we've processed it
    const targetKey = `${scrollTarget.messageId}-${scrollTarget.highlight || ""}`
    if (processedTargetRef.current === targetKey) return

    // For specific message targets (not SCROLL_TO_BOTTOM), wait for messages to load
    // This ensures the target element exists in the DOM before we try to scroll
    if (scrollTarget.messageId !== SCROLL_TO_BOTTOM && !messagesLoaded) {
      return // Will re-run when messagesLoaded becomes true
    }

    // Handle SCROLL_TO_BOTTOM case
    if (scrollTarget.messageId === SCROLL_TO_BOTTOM) {
      processedTargetRef.current = targetKey
      // Mark as consumed immediately to prevent duplicate triggers
      setScrollTarget({ ...scrollTarget, consumed: true })

      // Double requestAnimationFrame + delay to ensure content is loaded
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            // Scroll to bottom
            container.scrollTop = container.scrollHeight

            // Notify parent to enable auto-scroll for subsequent streaming
            onScrollInitialized?.()

            // Additional scroll after a delay to catch late-loading content
            setTimeout(() => {
              container.scrollTop = container.scrollHeight
            }, 100)
          }, 100)
        })
      })
      return
    }

    // Handle specific message scroll
    // Messages are loaded at this point, so element should exist in DOM
    processedTargetRef.current = targetKey
    setScrollTarget({ ...scrollTarget, consumed: true })

    // Double requestAnimationFrame + delay to ensure DOM is ready after React render
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          // Find target element by message ID
          let el: Element | null = container.querySelector(
            `[data-message-id="${scrollTarget.messageId}"]`,
          )

          // Fallback: try tool-call-id
          if (!el) {
            el = container.querySelector(
              `[data-tool-call-id="${scrollTarget.messageId}"]`,
            )
          }

          if (el) {
            // Handle sticky user message container (same logic as search scroll)
            const stickyParent = el.closest("[data-user-message-id]")
            if (stickyParent?.parentElement) {
              stickyParent.parentElement.scrollIntoView({
                behavior: "smooth",
                block: "start",
              })
            } else {
              el.scrollIntoView({ behavior: "smooth", block: "center" })
            }

            // Flash highlight animation
            el.classList.add("router-highlight")
            setTimeout(() => el?.classList.remove("router-highlight"), 3000)
          } else {
            // Message not found - fallback to scroll to bottom
            container.scrollTop = container.scrollHeight
          }

          // Notify parent (useful for enabling auto-scroll after navigation)
          onScrollInitialized?.()

          // Activate search highlight if highlight text is specified
          if (scrollTarget.highlight) {
            setChatSearchOpen(true)
            setChatSearchInput(scrollTarget.highlight)
            setChatSearchQuery(scrollTarget.highlight)
          }
        }, 150)
      })
    })
  }, [
    scrollTarget,
    isActive,
    chatContainerRef,
    setScrollTarget,
    setChatSearchOpen,
    setChatSearchInput,
    setChatSearchQuery,
    onScrollInitialized,
    messagesLoaded,
  ])

  // Reset processed target when subChatId changes
  useEffect(() => {
    processedTargetRef.current = null
  }, [subChatId])
}
