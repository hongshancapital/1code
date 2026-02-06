import { useCallback, useEffect, useRef } from "react"

/**
 * Hook for managing auto-scroll behavior in chat views
 *
 * @param isActive - Whether the chat tab is currently active
 * @returns Object containing scroll state and handlers
 */
export function useAutoScroll(isActive: boolean = true) {
  // Scroll management state
  const shouldAutoScrollRef = useRef(true)
  const isAutoScrollingRef = useRef(false)
  const isInitializingScrollRef = useRef(false)
  const hasUnapprovedPlanRef = useRef(false)
  const chatContainerRef = useRef<HTMLElement | null>(null)
  const prevScrollTopRef = useRef(0)

  // Keep isActive in ref for callbacks
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // Track chat container height via CSS custom property (no re-renders)
  const chatContainerObserverRef = useRef<ResizeObserver | null>(null)

  // Cleanup isAutoScrollingRef on unmount to prevent stuck state
  useEffect(() => {
    return () => {
      isAutoScrollingRef.current = false
    }
  }, [])

  // Check if user is at bottom of chat
  const isAtBottom = useCallback(() => {
    const container = chatContainerRef.current
    if (!container) return true
    const threshold = 50 // pixels from bottom
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight <=
      threshold
    )
  }, [])

  // Handle scroll events to detect user scrolling
  // Updates shouldAutoScrollRef based on scroll direction
  // Using refs only to avoid re-renders on scroll
  const handleScroll = useCallback(() => {
    // Skip scroll handling for inactive tabs (keep-alive)
    if (!isActiveRef.current) return

    const container = chatContainerRef.current
    if (!container) return

    const currentScrollTop = container.scrollTop
    const prevScrollTop = prevScrollTopRef.current
    prevScrollTopRef.current = currentScrollTop

    // Ignore scroll events during initialization (content loading)
    if (isInitializingScrollRef.current) return

    // If user scrolls UP - disable auto-scroll immediately
    // This works even during auto-scroll animation (user intent takes priority)
    if (currentScrollTop < prevScrollTop) {
      shouldAutoScrollRef.current = false
      return
    }

    // Ignore other scroll direction checks during auto-scroll animation
    if (isAutoScrollingRef.current) return

    // If user scrolls DOWN and reaches bottom - enable auto-scroll
    shouldAutoScrollRef.current = isAtBottom()
  }, [isAtBottom])

  // Scroll to bottom handler with ease-in-out animation
  const scrollToBottom = useCallback(() => {
    const container = chatContainerRef.current
    if (!container) return

    isAutoScrollingRef.current = true
    shouldAutoScrollRef.current = true

    const start = container.scrollTop
    const duration = 300 // ms
    const startTime = performance.now()

    // Ease-in-out cubic function
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

    const animateScroll = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easedProgress = easeInOutCubic(progress)

      // Calculate end on each frame to handle dynamic content
      const end = container.scrollHeight - container.clientHeight
      container.scrollTop = start + (end - start) * easedProgress

      if (progress < 1) {
        requestAnimationFrame(animateScroll)
      } else {
        // Ensure we're at the absolute bottom
        container.scrollTop = container.scrollHeight
        isAutoScrollingRef.current = false
      }
    }

    requestAnimationFrame(animateScroll)
  }, [])

  // Auto-scroll when content changes (if user was at bottom)
  const maybeScrollToBottom = useCallback(() => {
    if (shouldAutoScrollRef.current && !isAutoScrollingRef.current) {
      scrollToBottom()
    }
  }, [scrollToBottom])

  // Set initializing scroll state (to ignore scroll events during content loading)
  const setIsInitializingScroll = useCallback((value: boolean) => {
    isInitializingScrollRef.current = value
  }, [])

  // Set whether there's an unapproved plan (affects scroll behavior)
  const setHasUnapprovedPlan = useCallback((value: boolean) => {
    hasUnapprovedPlanRef.current = value
  }, [])

  // Enable auto-scroll (e.g., when new message is sent)
  const enableAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = true
  }, [])

  // Disable auto-scroll (e.g., when user scrolls up)
  const disableAutoScroll = useCallback(() => {
    shouldAutoScrollRef.current = false
  }, [])

  return {
    // Refs
    chatContainerRef,
    chatContainerObserverRef,
    shouldAutoScrollRef,
    isAutoScrollingRef,
    isInitializingScrollRef,
    hasUnapprovedPlanRef,
    // Callbacks
    handleScroll,
    scrollToBottom,
    maybeScrollToBottom,
    isAtBottom,
    setIsInitializingScroll,
    setHasUnapprovedPlan,
    enableAutoScroll,
    disableAutoScroll,
  }
}
