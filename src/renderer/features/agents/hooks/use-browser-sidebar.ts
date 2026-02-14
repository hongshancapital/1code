/**
 * useBrowserSidebar - Manages browser sidebar state and IPC events
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Handles:
 * - Browser sidebar visibility and active state
 * - Browser URL state
 * - Browser screenshot state
 * - Mutual exclusion with Details sidebar
 * - IPC events for browser navigation and panel show
 */

import { useCallback, useEffect, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { betaBrowserEnabledAtom } from "../../../lib/atoms"
import {
  browserVisibleAtomFamily,
  browserActiveAtomFamily,
  browserUrlAtomFamily,
  browserPendingScreenshotAtomFamily,
} from "../../browser-sidebar"

export interface UseBrowserSidebarOptions {
  chatId: string
  /** Raw setter for Details sidebar (from parent component) */
  setIsDetailsSidebarOpenRaw: (value: boolean) => void
}

export interface UseBrowserSidebarReturn {
  /** Whether browser beta feature is enabled */
  betaBrowserEnabled: boolean
  /** Whether browser sidebar is open */
  isBrowserSidebarOpen: boolean
  /** Set browser sidebar open state (handles mutual exclusion with Details) */
  setIsBrowserSidebarOpen: (open: boolean | ((prev: boolean) => boolean)) => void
  /** Set browser active state */
  setBrowserActive: (active: boolean) => void
  /** Set browser URL */
  setBrowserUrl: (url: string) => void
  /** Set pending screenshot from browser */
  setBrowserPendingScreenshot: (imageData: string | null) => void
}

/**
 * Hook for managing browser sidebar state
 *
 * Handles:
 * - Per-chat browser visibility, active, URL, and screenshot atoms
 * - Mutual exclusion: Browser sidebar and Details sidebar cannot be open at the same time
 * - IPC events: browser navigation requests and panel show requests
 */
export function useBrowserSidebar({
  chatId,
  setIsDetailsSidebarOpenRaw,
}: UseBrowserSidebarOptions): UseBrowserSidebarReturn {
  // Browser beta feature check
  const betaBrowserEnabled = useAtomValue(betaBrowserEnabledAtom)

  // Browser sidebar state (per-chat)
  const browserVisibleAtom = useMemo(
    () => browserVisibleAtomFamily(chatId),
    [chatId]
  )
  const browserActiveAtom = useMemo(
    () => browserActiveAtomFamily(chatId),
    [chatId]
  )
  const browserUrlAtom = useMemo(
    () => browserUrlAtomFamily(chatId),
    [chatId]
  )
  const browserPendingScreenshotAtom = useMemo(
    () => browserPendingScreenshotAtomFamily(chatId),
    [chatId]
  )

  const [isBrowserSidebarOpen, setIsBrowserSidebarOpenRaw] = useAtom(browserVisibleAtom)
  const setBrowserActive = useSetAtom(browserActiveAtom)
  const setBrowserUrl = useSetAtom(browserUrlAtom)
  const setBrowserPendingScreenshot = useSetAtom(browserPendingScreenshotAtom)

  // Mutual exclusion: Browser sidebar and Details sidebar cannot be open at the same time
  const setIsBrowserSidebarOpen = useCallback(
    (open: boolean | ((prev: boolean) => boolean)) => {
      const newValue = typeof open === "function" ? open(isBrowserSidebarOpen) : open
      if (newValue) {
        setIsDetailsSidebarOpenRaw(false) // Close details when opening browser
      }
      setIsBrowserSidebarOpenRaw(newValue)
    },
    [isBrowserSidebarOpen, setIsBrowserSidebarOpenRaw, setIsDetailsSidebarOpenRaw]
  )

  // Listen for browser navigation requests from chat links
  useEffect(() => {
    const cleanup = window.desktopApi.onBrowserNavigate((url: string) => {
      setBrowserUrl(url)
      setIsBrowserSidebarOpenRaw(true)
      setBrowserActive(true)
      // Close details sidebar (mutual exclusion)
      setIsDetailsSidebarOpenRaw(false)
    })
    return cleanup
  }, [setBrowserUrl, setIsBrowserSidebarOpenRaw, setBrowserActive, setIsDetailsSidebarOpenRaw])

  // Listen for browser:show-panel from main process (AI lock/ensureReady)
  // Must be here (always mounted) — not in BrowserSidebar which only mounts when visible
  useEffect(() => {
    if (!window.desktopApi.onBrowserShowPanel) return
    const cleanup = window.desktopApi.onBrowserShowPanel(() => {
      setIsBrowserSidebarOpenRaw(true)
      setBrowserActive(true)
      setIsDetailsSidebarOpenRaw(false)
    })
    return cleanup
  }, [setIsBrowserSidebarOpenRaw, setBrowserActive, setIsDetailsSidebarOpenRaw])

  return {
    betaBrowserEnabled,
    isBrowserSidebarOpen,
    setIsBrowserSidebarOpen,
    setBrowserActive,
    setBrowserUrl,
    setBrowserPendingScreenshot,
  }
}
