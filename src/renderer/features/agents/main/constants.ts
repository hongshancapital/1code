/**
 * Chat layout constants for header and sticky messages positioning
 */
export const CHAT_LAYOUT = {
  // Padding top for chat content
  paddingTopSidebarOpen: "pt-12", // When sidebar open (absolute header overlay)
  paddingTopSidebarClosed: "pt-4", // When sidebar closed (regular header)
  paddingTopMobile: "pt-14", // Mobile has header

  // Sticky message top position (title is now in flex above scroll, so top-0)
  stickyTopSidebarOpen: "top-0", // When sidebar open (desktop, absolute header)
  stickyTopSidebarClosed: "top-0", // When sidebar closed (desktop, flex header)
  stickyTopMobile: "top-0", // Mobile (flex header, so top-0)

  // Header padding when absolute
  headerPaddingSidebarOpen: "pt-1.5 pb-12 px-3 pl-2",
  headerPaddingSidebarClosed: "p-2 pt-1.5",
} as const

/**
 * Scroll behavior constants
 */
export const SCROLL_CONFIG = {
  // Pixels from bottom to consider "at bottom"
  threshold: 50,
  // Animation duration for smooth scroll (ms)
  animationDuration: 300,
} as const

/**
 * Streaming timeout constants
 */
export const STREAMING_CONFIG = {
  // Safety timeout for waiting for streaming to be ready (ms)
  readyTimeout: 30_000,
} as const

/**
 * Cache cleanup constants
 */
export const CACHE_CONFIG = {
  // Delay before cleaning up cache on unmount (ms)
  cleanupDelay: 100,
} as const

/**
 * Diff sidebar layout threshold
 */
export const DIFF_SIDEBAR_CONFIG = {
  // Width threshold for switching between vertical and horizontal layout
  narrowThreshold: 500,
  // Min/max width for changes panel resize
  changesPanelMinWidth: 200,
  changesPanelMaxWidth: 450,
} as const

/**
 * TTS playback speed options
 */
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]
