/**
 * PlatformContext - Centralized platform detection and capabilities
 *
 * This context provides:
 * 1. Platform type detection (desktop/web/mobile)
 * 2. Operating system detection (macOS/Windows/Linux)
 * 3. Platform-aware keyboard shortcuts
 * 4. Capability detection (desktopApi, deep links, notifications)
 *
 * Usage:
 *   const { isDesktop, isMacOS, getShortcut } = usePlatform()
 *
 * This eliminates the need for 50+ scattered isDesktopApp() calls
 */

import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from "react"
import {
  isDesktopApp,
  getPlatform as getPlatformUtil,
  isMacOS as isMacOSUtil,
  isWindows as isWindowsUtil,
  isLinux as isLinuxUtil,
  getShortcut as getShortcutUtil,
  SHORTCUTS,
  type ShortcutKey,
} from "../lib/utils/platform"

// ============================================================================
// Types
// ============================================================================

export type Platform = "darwin" | "win32" | "linux" | "web"

export interface ShortcutInfo {
  hotkey: string
  display: string
}

export interface PlatformContextValue {
  // Platform type
  isDesktop: boolean // Running in Electron
  isWeb: boolean // Running in browser
  isMobile: boolean // Mobile viewport (responsive)

  // Operating system
  platform: Platform
  isMacOS: boolean
  isWindows: boolean
  isLinux: boolean

  // Modifier key (for display and code)
  modKey: "⌘" | "Ctrl"
  modKeyCode: "Meta" | "Control"

  // Shortcut helpers
  getShortcut: (key: ShortcutKey) => ShortcutInfo
  getShortcutDisplay: (key: ShortcutKey) => string
  getShortcutHotkey: (key: ShortcutKey) => string

  // Capability detection
  hasDesktopApi: boolean
  supportsDeepLinks: boolean
  supportsNotifications: boolean
  supportsFileSystem: boolean
}

// ============================================================================
// Context
// ============================================================================

const PlatformContext = createContext<PlatformContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

export interface PlatformProviderProps {
  children: ReactNode
}

export function PlatformProvider({ children }: PlatformProviderProps) {
  // Detect mobile viewport with useState to handle SSR and resize
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    // Initial check
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()

    // Listen for resize
    window.addEventListener("resize", checkMobile)
    return () => window.removeEventListener("resize", checkMobile)
  }, [])

  const value = useMemo<PlatformContextValue>(() => {
    const isDesktop = isDesktopApp()
    const platform = getPlatformUtil()
    const isMac = isMacOSUtil()
    const isWin = isWindowsUtil()
    const isLin = isLinuxUtil()

    // Determine actual platform for context
    const platformValue: Platform = platform === "unknown" ? "web" : platform

    return {
      // Platform type
      isDesktop,
      isWeb: !isDesktop,
      isMobile,

      // Operating system
      platform: platformValue,
      isMacOS: isMac,
      isWindows: isWin,
      isLinux: isLin,

      // Modifier key
      modKey: isMac || platformValue === "web" ? "⌘" : "Ctrl",
      modKeyCode: isMac || platformValue === "web" ? "Meta" : "Control",

      // Shortcut helpers
      getShortcut: getShortcutUtil,
      getShortcutDisplay: (key: ShortcutKey) => getShortcutUtil(key).display,
      getShortcutHotkey: (key: ShortcutKey) => getShortcutUtil(key).hotkey,

      // Capability detection
      hasDesktopApi: typeof window !== "undefined" && !!window.desktopApi,
      supportsDeepLinks: isDesktop,
      supportsNotifications: isDesktop || ("Notification" in globalThis),
      supportsFileSystem: isDesktop,
    }
  }, [isMobile])

  return (
    <PlatformContext.Provider value={value}>
      {children}
    </PlatformContext.Provider>
  )
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Access platform context
 * @throws Error if used outside PlatformProvider
 */
export function usePlatform(): PlatformContextValue {
  const context = useContext(PlatformContext)
  if (!context) {
    throw new Error("usePlatform must be used within a PlatformProvider")
  }
  return context
}

/**
 * Safe version that returns defaults if outside provider
 * Useful for components that may be rendered before provider is mounted
 */
export function usePlatformSafe(): PlatformContextValue {
  const context = useContext(PlatformContext)
  if (context) return context

  // Fallback values when outside provider (SSR or early render)
  const isDesktop = typeof window !== "undefined" && isDesktopApp()
  const platform = typeof window !== "undefined" ? getPlatformUtil() : "web"

  return {
    isDesktop,
    isWeb: !isDesktop,
    isMobile: false,
    platform: platform === "unknown" ? "web" : platform,
    isMacOS: platform === "darwin",
    isWindows: platform === "win32",
    isLinux: platform === "linux",
    modKey: platform === "darwin" || platform === "unknown" ? "⌘" : "Ctrl",
    modKeyCode: platform === "darwin" || platform === "unknown" ? "Meta" : "Control",
    getShortcut: getShortcutUtil,
    getShortcutDisplay: (key: ShortcutKey) => getShortcutUtil(key).display,
    getShortcutHotkey: (key: ShortcutKey) => getShortcutUtil(key).hotkey,
    hasDesktopApi: isDesktop,
    supportsDeepLinks: isDesktop,
    supportsNotifications: isDesktop,
    supportsFileSystem: isDesktop,
  }
}

/**
 * Hook to get a specific shortcut
 */
export function useShortcutInfo(key: ShortcutKey): ShortcutInfo {
  const { getShortcut } = usePlatform()
  return getShortcut(key)
}

/**
 * Hook to check if running on desktop
 */
export function useIsDesktop(): boolean {
  const { isDesktop } = usePlatform()
  return isDesktop
}

/**
 * Hook to check if mobile viewport
 */
export function useIsMobileViewport(): boolean {
  const { isMobile } = usePlatform()
  return isMobile
}

// Re-export types and constants for convenience
export { SHORTCUTS, type ShortcutKey }
