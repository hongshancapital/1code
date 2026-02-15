/**
 * useBrowserSidebar - Manages browser sidebar state and IPC events
 *
 * Bridges IPC events (onBrowserNavigate, onBrowserShowPanel) to the
 * new Panel System (panelIsOpenAtomFamily) so PanelZone can render the
 * Browser panel. Also maintains legacy atoms for backward compatibility.
 */

import { useCallback, useEffect, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { betaBrowserEnabledAtom } from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import {
  browserActiveAtomFamily,
  browserUrlAtomFamily,
  browserPendingScreenshotAtomFamily,
} from "../../browser-sidebar"
import { PANEL_IDS } from "../stores/panel-registry"
import {
  panelIsOpenAtomFamily,
  createOpenPanelAction,
  createClosePanelAction,
} from "../stores/panel-state-manager"

export interface UseBrowserSidebarOptions {
  chatId: string
}

export interface UseBrowserSidebarReturn {
  /** Whether browser beta feature is enabled */
  betaBrowserEnabled: boolean
  /** Whether browser sidebar is open (reads from new panel system) */
  isBrowserSidebarOpen: boolean
  /** Set browser active state */
  setBrowserActive: (active: boolean) => void
  /** Set browser URL */
  setBrowserUrl: (url: string) => void
  /** Set pending screenshot from browser */
  setBrowserPendingScreenshot: (imageData: string | null) => void
}

/**
 * Hook for managing browser sidebar state via the unified Panel System.
 *
 * IPC events directly dispatch panel open/close actions through appStore,
 * which triggers PanelZone rendering with automatic mutual exclusion.
 */
export function useBrowserSidebar({
  chatId,
}: UseBrowserSidebarOptions): UseBrowserSidebarReturn {
  const betaBrowserEnabled = useAtomValue(betaBrowserEnabledAtom)

  // Read browser open state from the new panel system
  const browserPanelOpenAtom = useMemo(
    () => panelIsOpenAtomFamily({ chatId, panelId: PANEL_IDS.BROWSER }),
    [chatId],
  )
  const [isBrowserSidebarOpen] = useAtom(browserPanelOpenAtom)

  // Browser-specific atoms (URL, active, screenshot)
  const browserActiveAtom = useMemo(
    () => browserActiveAtomFamily(chatId),
    [chatId],
  )
  const browserUrlAtom = useMemo(
    () => browserUrlAtomFamily(chatId),
    [chatId],
  )
  const browserPendingScreenshotAtom = useMemo(
    () => browserPendingScreenshotAtomFamily(chatId),
    [chatId],
  )

  const setBrowserActive = useSetAtom(browserActiveAtom)
  const setBrowserUrl = useSetAtom(browserUrlAtom)
  const setBrowserPendingScreenshot = useSetAtom(browserPendingScreenshotAtom)

  // Helper: open browser panel via the new panel system (handles mutual exclusion)
  const openBrowserPanel = useCallback(() => {
    const openAction = createOpenPanelAction(PANEL_IDS.BROWSER, chatId)
    appStore.set(openAction)
  }, [chatId])

  // Listen for browser navigation requests from chat links
  useEffect(() => {
    const cleanup = window.desktopApi.onBrowserNavigate((url: string) => {
      setBrowserUrl(url)
      setBrowserActive(true)
      openBrowserPanel()
    })
    return cleanup
  }, [setBrowserUrl, setBrowserActive, openBrowserPanel])

  // Listen for browser:show-panel from main process (AI lock/ensureReady)
  // Must be here (always mounted) — not in BrowserSidebar which only mounts when visible
  useEffect(() => {
    if (!window.desktopApi.onBrowserShowPanel) return
    const cleanup = window.desktopApi.onBrowserShowPanel(() => {
      setBrowserActive(true)
      openBrowserPanel()
    })
    return cleanup
  }, [setBrowserActive, openBrowserPanel])

  return {
    betaBrowserEnabled,
    isBrowserSidebarOpen,
    setBrowserActive,
    setBrowserUrl,
    setBrowserPendingScreenshot,
  }
}
