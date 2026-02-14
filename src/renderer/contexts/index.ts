/**
 * Global Contexts for Agents Desktop
 *
 * These contexts are application-level and mounted at the App root.
 * They provide:
 * - WindowContext: Window ID isolation for multi-window support
 * - PlatformContext: Platform detection and capabilities
 * - TRPCProvider: Backend communication
 */

// Window isolation
export {
  WindowProvider,
  useWindowId,
  getWindowId,
  getInitialWindowParams,
} from "./WindowContext"

// Platform detection
export {
  PlatformProvider,
  usePlatform,
  usePlatformSafe,
  useIsDesktop,
  useIsMobileViewport,
  useShortcutInfo,
  SHORTCUTS,
  type Platform,
  type PlatformContextValue,
  type ShortcutKey,
  type ShortcutInfo,
} from "./PlatformContext"

// tRPC
export { TRPCProvider } from "./TRPCProvider"
