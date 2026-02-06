import { useEffect } from "react"
import { useAtom, useSetAtom } from "jotai"
import { scrollTargetAtom } from "./atoms"
import {
  chatSearchOpenAtom,
  chatSearchInputAtom,
  chatSearchQueryAtom,
} from "../../features/agents/search/chat-search-atoms"

/**
 * Consumes the scrollTargetAtom to scroll to a specific message and optionally
 * activate search highlighting. Uses the same double-rAF pattern as the existing
 * chat search scroll (active-chat.tsx:3583).
 *
 * Should be called inside ChatViewInner for each active sub-chat.
 */
export function useScrollToTarget(
  chatContainerRef: React.RefObject<HTMLElement | null>,
  subChatId: string,
  isActive: boolean,
) {
  const [scrollTarget, setScrollTarget] = useAtom(scrollTargetAtom)
  const setChatSearchOpen = useSetAtom(chatSearchOpenAtom)
  const setChatSearchInput = useSetAtom(chatSearchInputAtom)
  const setChatSearchQuery = useSetAtom(chatSearchQueryAtom)

  useEffect(() => {
    if (!isActive || !scrollTarget || scrollTarget.consumed) return

    const container = chatContainerRef.current
    if (!container) return

    // Mark as consumed immediately to prevent duplicate triggers
    setScrollTarget({ ...scrollTarget, consumed: true })

    // Double requestAnimationFrame + delay — matches existing search scroll pattern
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
          }

          // Activate search highlight if highlight text is specified
          if (scrollTarget.highlight) {
            setChatSearchOpen(true)
            setChatSearchInput(scrollTarget.highlight)
            setChatSearchQuery(scrollTarget.highlight)
          }
        }, 100) // Slightly longer than search scroll (50ms) to allow lazy-loaded messages
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
  ])
}
