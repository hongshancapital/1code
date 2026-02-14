/**
 * useDiffSidebarLayout - Manages diff sidebar layout state and effects
 *
 * Handles:
 * - Force narrow width when switching to side-peek mode
 * - Traffic light visibility for full-page views
 * - Real-time width tracking via ResizeObserver
 * - Narrow/wide breakpoint calculation
 */

import { useEffect, useRef, useState } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { appStore } from "../../../lib/jotai-store"
import {
  agentsDiffSidebarWidthAtom,
  isDesktopAtom,
  isFullscreenAtom,
} from "../../../lib/atoms"
import {
  setTrafficLightRequestAtom,
  removeTrafficLightRequestAtom,
  TRAFFIC_LIGHT_PRIORITIES,
} from "../../../lib/atoms/traffic-light"

export interface UseDiffSidebarLayoutOptions {
  isDiffSidebarOpen: boolean
  diffDisplayMode: "side-peek" | "center-peek" | "full-page"
  fileViewerPath: string | null
  fileViewerDisplayMode: "side-peek" | "center-peek" | "full-page"
}

export interface UseDiffSidebarLayoutReturn {
  diffSidebarRef: React.MutableRefObject<HTMLDivElement | null>
  diffSidebarWidth: number
  isDiffSidebarNarrow: boolean
}

export function useDiffSidebarLayout({
  isDiffSidebarOpen,
  diffDisplayMode,
  fileViewerPath,
  fileViewerDisplayMode,
}: UseDiffSidebarLayoutOptions): UseDiffSidebarLayoutReturn {
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const storedDiffSidebarWidth = useAtomValue(agentsDiffSidebarWidthAtom)
  const setTrafficLightRequest = useSetAtom(setTrafficLightRequestAtom)
  const removeTrafficLightRequest = useSetAtom(removeTrafficLightRequestAtom)

  const diffSidebarRef = useRef<HTMLDivElement>(null)
  const [diffSidebarWidth, setDiffSidebarWidth] = useState(storedDiffSidebarWidth)

  // Force narrow width when switching to side-peek mode (from dialog/fullscreen)
  useEffect(() => {
    if (diffDisplayMode === "side-peek") {
      appStore.set(agentsDiffSidebarWidthAtom, 400)
    }
  }, [diffDisplayMode])

  // Hide/show traffic lights based on full-page diff or full-page file viewer
  useEffect(() => {
    if (!isDesktop || isFullscreen) return

    const isFullPageDiff = isDiffSidebarOpen && diffDisplayMode === "full-page"
    const isFullPageFileViewer = !!fileViewerPath && fileViewerDisplayMode === "full-page"
    const shouldHide = isFullPageDiff || isFullPageFileViewer

    if (shouldHide) {
      setTrafficLightRequest({
        requester: "active-chat-viewer",
        visible: false,
        priority: TRAFFIC_LIGHT_PRIORITIES.ACTIVE_CHAT_VIEWER,
      })
    } else {
      removeTrafficLightRequest("active-chat-viewer")
    }

    return () => removeTrafficLightRequest("active-chat-viewer")
  }, [
    isDiffSidebarOpen,
    diffDisplayMode,
    fileViewerPath,
    fileViewerDisplayMode,
    isDesktop,
    isFullscreen,
    setTrafficLightRequest,
    removeTrafficLightRequest,
  ])

  // ResizeObserver to track diff sidebar width in real-time (atom only updates after resize ends)
  useEffect(() => {
    if (!isDiffSidebarOpen) {
      return
    }

    let observer: ResizeObserver | null = null
    let rafId: number | null = null

    const checkRef = () => {
      const element = diffSidebarRef.current
      if (!element) {
        // Retry if ref not ready yet
        rafId = requestAnimationFrame(checkRef)
        return
      }

      // Set initial width
      setDiffSidebarWidth(element.offsetWidth || storedDiffSidebarWidth)

      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width
          if (width > 0) {
            setDiffSidebarWidth(width)
          }
        }
      })

      observer.observe(element)
    }

    checkRef()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      if (observer) observer.disconnect()
    }
  }, [isDiffSidebarOpen, storedDiffSidebarWidth])

  // Compute isNarrow for filtering logic (same threshold as DiffSidebarContent)
  const isDiffSidebarNarrow = diffSidebarWidth < 500

  return {
    diffSidebarRef,
    diffSidebarWidth,
    isDiffSidebarNarrow,
  }
}
