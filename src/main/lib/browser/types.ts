/**
 * Browser automation types
 * Clean, minimal type definitions following Linus-style simplicity
 */

/** Element reference from accessibility snapshot */
export type ElementRef = `@e${number}`

/** Browser operation request from MCP server to renderer */
export interface BrowserOperation {
  id: string
  type: BrowserOperationType
  params: Record<string, unknown>
}

/** Supported browser operations */
export type BrowserOperationType =
  | "navigate"
  | "snapshot"
  | "click"
  | "fill"
  | "type"
  | "screenshot"
  | "back"
  | "forward"
  | "reload"
  | "close"
  | "getText"
  | "getUrl"
  | "getTitle"
  | "wait"
  | "scroll"
  | "press"
  | "select"
  | "check"
  | "hover"
  | "drag"
  | "downloadImage"
  | "downloadFile"
  | "emulate"
  | "evaluate"

/** Browser operation result */
export interface BrowserResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** Pending operation tracker */
export interface PendingOperation {
  resolve: (result: BrowserResult) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Screenshot options */
export interface ScreenshotOptions {
  ref?: ElementRef
  fullPage?: boolean
  filePath?: string
  format?: "png" | "jpeg" | "webp"
  quality?: number
}

/** Screenshot result */
export interface ScreenshotResult {
  base64?: string
  filePath?: string
  width: number
  height: number
}

/** Snapshot options */
export interface SnapshotOptions {
  interactiveOnly?: boolean
}

/** Snapshot result */
export interface SnapshotResult {
  snapshot: string
  elementCount: number
}

/** Navigate options */
export interface NavigateOptions {
  url: string
  waitUntil?: "load" | "domcontentloaded" | "networkidle"
}

/** Click options */
export interface ClickOptions {
  ref?: ElementRef
  selector?: string
  dblClick?: boolean
}

/** Fill options */
export interface FillOptions {
  ref?: ElementRef
  selector?: string
  value: string
}

/** Wait options */
export interface WaitOptions {
  selector?: string
  text?: string
  url?: string
  timeout?: number
}

/** Scroll options */
export interface ScrollOptions {
  direction?: "up" | "down" | "left" | "right"
  amount?: number
  ref?: ElementRef
  selector?: string
}

/** Emulate options */
export interface EmulateOptions {
  viewport?: {
    width: number
    height: number
    isMobile?: boolean
    hasTouch?: boolean
    deviceScaleFactor?: number
  }
  userAgent?: string
  colorScheme?: "light" | "dark" | "auto"
  geolocation?: {
    latitude: number
    longitude: number
  }
}

/** Download options */
export interface DownloadOptions {
  ref?: ElementRef
  url?: string
  filePath: string
}

/** Browser state for UI */
export interface BrowserState {
  isReady: boolean
  isOperating: boolean
  currentUrl: string | null
  currentAction: string | null
  recentActions: RecentAction[]
}

/** Recent action for status bar */
export interface RecentAction {
  id: string
  type: BrowserOperationType
  summary: string
  timestamp: number
}

/** Cursor position for AI cursor animation */
export interface CursorPosition {
  x: number
  y: number
}

/** Element bounding rect from webview */
export interface ElementRect {
  x: number
  y: number
  width: number
  height: number
}
