/**
 * Browser Sidebar Atoms
 * Jotai atoms for browser state management
 */

import { atom } from "jotai"
import { atomFamily, atomWithStorage } from "jotai/utils"
import type { CursorPosition, RecentAction } from "./types"
import {
  panelIsOpenAtomFamily,
  createOpenPanelAction,
  createClosePanelAction,
  PANEL_IDS,
} from "../panel-system"

/** Browser sidebar visibility (deprecated - use browserVisibleAtomFamily) */
export const browserSidebarOpenAtom = atom(false)

/** Browser active state (has visited a URL) - per chat, persisted
 * Used for showing the activation dot on the Globe icon */
export const browserActiveAtomFamily = atomFamily((chatId: string) =>
  atomWithStorage<boolean>(`browser-active-${chatId}`, false)
)

/**
 * Browser visible state — proxy to the unified Panel System.
 *
 * Reads from panelIsOpenAtomFamily({ chatId, panelId: "browser" }),
 * writes dispatch open/close actions (with automatic mutual exclusion).
 *
 * This ensures all existing consumers (browser-panel.tsx, chat-view-layout.tsx,
 * agents-content.tsx, file-preview-dialog.tsx) stay in sync with PanelZone.
 */
export const browserVisibleAtomFamily = atomFamily((chatId: string) =>
  atom(
    (get) => get(panelIsOpenAtomFamily({ chatId, panelId: PANEL_IDS.BROWSER })),
    (get, set, isOpen: boolean) => {
      if (isOpen) {
        set(createOpenPanelAction(PANEL_IDS.BROWSER, chatId))
      } else {
        set(createClosePanelAction(PANEL_IDS.BROWSER, chatId))
      }
    },
  )
)

/** Browser loading state - per chat
 * Used for showing loading animation on the Globe icon when browser is hidden */
export const browserLoadingAtomFamily = atomFamily((_chatId: string) =>
  atom<boolean>(false)
)

/** Current URL in browser (per chat) */
export const browserUrlAtomFamily = atomFamily((chatId: string) =>
  atomWithStorage<string>(`browser-url-${chatId}`, "")
)

/** Current page title (per chat) */
export const browserTitleAtomFamily = atomFamily((_chatId: string) =>
  atom<string>("")
)

/** Current page favicon URL (per chat) */
export const browserFaviconAtomFamily = atomFamily((_chatId: string) =>
  atom<string>("")
)

/** Browser ready state - global singleton (only one webview instance exists at a time) */
export const browserReadyAtom = atom(false)

/** Browser operating state (AI is controlling) - global singleton */
export const browserOperatingAtom = atom(false)

/** Current action being performed */
export const browserCurrentActionAtom = atom<string | null>(null)

/** Recent actions for status bar */
export const browserRecentActionsAtom = atom<RecentAction[]>([])

/** AI cursor position */
export const browserCursorPositionAtom = atom<CursorPosition | null>(null)

/** Whether AI overlay is active */
export const browserOverlayActiveAtom = atom(false)

/** Whether the browser is locked by AI (lock/unlock MCP session) - global singleton */
export const browserLockedAtom = atom(false)

/** Webview URL history for back/forward - persisted */
export const browserHistoryAtomFamily = atomFamily((chatId: string) =>
  atomWithStorage<{ urls: string[]; index: number }>(`browser-history-${chatId}`, { urls: [], index: -1 })
)

/** Can go back in history */
export const browserCanGoBackAtomFamily = atomFamily((chatId: string) =>
  atom((get) => {
    const history = get(browserHistoryAtomFamily(chatId))
    return history.index > 0
  })
)

/** Can go forward in history */
export const browserCanGoForwardAtomFamily = atomFamily((chatId: string) =>
  atom((get) => {
    const history = get(browserHistoryAtomFamily(chatId))
    return history.index < history.urls.length - 1
  })
)

/** Browser history entry for project-level history */
export interface BrowserHistoryEntry {
  url: string
  title: string
  favicon?: string
  visitedAt: number // timestamp
}

/** Project-level browser history - persisted, max 50 entries */
export const projectBrowserHistoryAtomFamily = atomFamily((projectId: string) =>
  atomWithStorage<BrowserHistoryEntry[]>(`browser-project-history-${projectId}`, [])
)

/** Pending screenshot to be added to chat input - per chat */
export const browserPendingScreenshotAtomFamily = atomFamily((_chatId: string) =>
  atom<string | null>(null) // base64 data URL
)

/** Pending navigation URL - per chat
 * When set, BrowserSidebar will navigate to this URL and clear the atom.
 * Used by external components to trigger browser navigation without direct access to webview. */
export const browserPendingNavigationAtomFamily = atomFamily((_chatId: string) =>
  atom<string | null>(null)
)

/** Browser dev mode - per chat, persisted */
export const browserDevModeAtomFamily = atomFamily((chatId: string) =>
  atomWithStorage<boolean>(`browser-dev-mode-${chatId}`, false)
)

/** Browser terminal visible - per chat */
export const browserTerminalVisibleAtomFamily = atomFamily((_chatId: string) =>
  atom<boolean>(false)
)

/** Browser terminal panel height - per chat, persisted */
export const browserTerminalHeightAtomFamily = atomFamily((chatId: string) =>
  atomWithStorage<number>(`browser-terminal-height-${chatId}`, 200)
)

/** React Grab element selector active state - per chat */
export const browserSelectorActiveAtomFamily = atomFamily((_chatId: string) =>
  atom<boolean>(false)
)

/** React Grab availability state - per chat (null = unknown, true = available, false = unavailable) */
export const browserReactGrabAvailableAtomFamily = atomFamily((_chatId: string) =>
  atom<boolean | null>(null)
)

/** DevTools open state - per chat */
export const browserDevToolsOpenAtomFamily = atomFamily((_chatId: string) =>
  atom<boolean>(false)
)

/** Device preset for browser viewport emulation */
export interface DevicePreset {
  id: string
  name: string
  width: number
  height: number
  deviceScaleFactor?: number
  isMobile?: boolean
  hasTouch?: boolean
  userAgent?: string
}

/** Default desktop user agent */
export const DEFAULT_DESKTOP_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"

/** Mobile user agents for different devices */
const MOBILE_USER_AGENTS = {
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidTablet: "Mozilla/5.0 (Linux; Android 15; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
}

/** Built-in device presets */
export const DEVICE_PRESETS: DevicePreset[] = [
  // Responsive (no emulation)
  { id: "responsive", name: "Responsive", width: 0, height: 0 },
  // Mobile devices (2024-2025 models)
  { id: "iphone-16-pro", name: "iPhone 16 Pro", width: 402, height: 874, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.iphone },
  { id: "iphone-16-pro-max", name: "iPhone 16 Pro Max", width: 440, height: 956, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.iphone },
  { id: "iphone-15", name: "iPhone 15", width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.iphone },
  { id: "pixel-9-pro", name: "Pixel 9 Pro", width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.android },
  { id: "samsung-s24", name: "Samsung S24 Ultra", width: 412, height: 915, deviceScaleFactor: 3.5, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.android },
  // Tablets
  { id: "ipad-pro-11-m4", name: "iPad Pro 11\" M4", width: 834, height: 1210, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.ipad },
  { id: "ipad-pro-13-m4", name: "iPad Pro 13\" M4", width: 1032, height: 1376, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.ipad },
  { id: "ipad-air-13", name: "iPad Air 13\"", width: 1024, height: 1366, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.ipad },
  { id: "ipad-mini-7", name: "iPad mini 7", width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: MOBILE_USER_AGENTS.ipad },
  // Desktop sizes
  { id: "macbook-air-13", name: "MacBook Air 13\"", width: 1470, height: 956, deviceScaleFactor: 2, userAgent: DEFAULT_DESKTOP_USER_AGENT },
  { id: "macbook-pro-14", name: "MacBook Pro 14\"", width: 1512, height: 982, deviceScaleFactor: 2, userAgent: DEFAULT_DESKTOP_USER_AGENT },
  { id: "desktop-fhd", name: "Desktop FHD", width: 1920, height: 1080, deviceScaleFactor: 1, userAgent: DEFAULT_DESKTOP_USER_AGENT },
  { id: "desktop-2k", name: "Desktop 2K", width: 2560, height: 1440, deviceScaleFactor: 1, userAgent: DEFAULT_DESKTOP_USER_AGENT },
  { id: "desktop-4k", name: "Desktop 4K", width: 3840, height: 2160, deviceScaleFactor: 2, userAgent: DEFAULT_DESKTOP_USER_AGENT },
]

/** Current device preset for browser - per chat, persisted */
export const browserDevicePresetAtomFamily = atomFamily((chatId: string) =>
  atomWithStorage<string>(`browser-device-preset-${chatId}`, "responsive")
)

/** Search engine definitions */
export interface SearchEngine {
  id: string
  name: string
  urlTemplate: string // {query} placeholder
  icon?: string
}

export const SEARCH_ENGINES: SearchEngine[] = [
  { id: "google", name: "Google", urlTemplate: "https://www.google.com/search?q={query}" },
  { id: "bing", name: "Bing", urlTemplate: "https://www.bing.com/search?q={query}" },
  { id: "baidu", name: "Baidu", urlTemplate: "https://www.baidu.com/s?wd={query}" },
]

/** Default search engine - global, persisted */
export const browserSearchEngineAtom = atomWithStorage<string>("browser-search-engine", "google")

/** Browser zoom level - per chat, persisted */
export const browserZoomAtomFamily = atomFamily((chatId: string) =>
  atomWithStorage<number>(`browser-zoom-${chatId}`, 1.0)
)

/** Zoom range settings */
export const ZOOM_MIN = 0.05  // 5%
export const ZOOM_MAX = 5.0   // 500%
export const ZOOM_STEP = 0.25 // 25% step

/** Fit zoom level special value */
export const ZOOM_FIT = 0  // Special value for "fit to width"

/** Check if zoom is fit mode */
export function isZoomFitMode(zoom: number): boolean {
  return zoom === ZOOM_FIT
}

/** Common zoom levels for quick selection */
export const ZOOM_QUICK_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]

/** Clamp zoom to valid range */
export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom))
}

/** Zoom in by step */
export function zoomIn(current: number): number {
  return clampZoom(current + ZOOM_STEP)
}

/** Zoom out by step */
export function zoomOut(current: number): number {
  return clampZoom(current - ZOOM_STEP)
}

/** Check if can zoom in */
export function canZoomIn(current: number): boolean {
  return current < ZOOM_MAX
}

/** Check if can zoom out */
export function canZoomOut(current: number): boolean {
  return current > ZOOM_MIN
}
