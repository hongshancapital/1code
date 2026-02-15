/**
 * useSearchResultScroll - Scroll to current search match
 *
 * Watches for search match changes and scrolls the chat container
 * to the highlighted element. Uses a lock mechanism to prevent
 * race conditions from rapid match changes.
 */

import { useEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { chatSearchCurrentMatchAtom } from "../search"

export interface UseSearchResultScrollOptions {
  chatContainerRef: React.RefObject<HTMLElement | null>
}

export function useSearchResultScroll({
  chatContainerRef,
}: UseSearchResultScrollOptions): void {
  const searchScrollLockRef = useRef<number>(0)
  const currentSearchMatch = useAtomValue(chatSearchCurrentMatchAtom)

  useEffect(() => {
    if (!currentSearchMatch) return

    const container = chatContainerRef.current
    if (!container) return

    const currentLock = ++searchScrollLockRef.current

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (searchScrollLockRef.current !== currentLock) return

          let targetElement: Element | null = container.querySelector(
            ".search-highlight-current",
          )

          if (!targetElement) {
            const selector = `[data-message-id="${currentSearchMatch.messageId}"][data-part-index="${currentSearchMatch.partIndex}"]`
            targetElement = container.querySelector(selector)
          }

          if (targetElement) {
            const stickyParent = targetElement.closest(
              "[data-user-message-id]",
            )
            if (stickyParent) {
              const messageGroupWrapper = stickyParent.parentElement
              if (messageGroupWrapper) {
                messageGroupWrapper.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
                return
              }
            }

            targetElement.scrollIntoView({
              behavior: "smooth",
              block: "center",
            })
          }
        }, 50)
      })
    })
  }, [currentSearchMatch])
}
