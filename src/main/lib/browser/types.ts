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
  | "getElementRect"
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
  | "downloadBatch"
  | "uploadFile"
  | "cookies"
  | "storage"
  | "emulate"
  | "evaluate"
  | "querySelector"
  | "getAttribute"
  | "extractContent"
  | "fullPageScreenshot"
  | "startNetworkCapture"
  | "stopNetworkCapture"
  | "getNetworkRequests"
  | "clearNetworkCapture"
  | "consoleQuery"
  | "consoleCollect"
  | "consoleClear"

/** Captured network request */
/** Captured network request */
export interface CapturedNetworkRequest {
  id: string | number
  method: string
  url: string
  status: number
  statusText: string
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  requestBody?: string     // POST body (truncated)
  responseBody?: string    // Response body (truncated)
  contentType?: string
  startTime: number
  duration: number
  size: number
  type: "fetch" | "xhr" | "other"
  error?: string
}

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

/** Screenshot options (v2: always saves to file) */
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

/** Snapshot options (v2: with CSS query support) */
export interface SnapshotOptions {
  interactiveOnly?: boolean
  query?: string
  includeImages?: boolean
  includeLinks?: boolean
}

/** Snapshot result */
export interface SnapshotResult {
  snapshot: string
  elementCount: number
}

/** Navigate options (v2: with action and show) */
export interface NavigateOptions {
  url?: string
  action?: "back" | "forward" | "reload"
  show?: boolean
  waitUntil?: "load" | "domcontentloaded" | "networkidle"
}

/** Click action item for batch operations */
export interface ClickAction {
  ref?: string
  selector?: string
  mode?: "click" | "dblclick" | "hover" | "drag"
  dragTo?: string
}

/** Click options (v2: batch support) */
export interface ClickOptions {
  ref?: ElementRef
  selector?: string
  dblClick?: boolean
  mode?: "click" | "dblclick" | "hover" | "drag"
  dragTo?: string
  actions?: ClickAction[]
}

/** Input field item for batch operations */
export interface InputField {
  ref?: string
  selector?: string
  value?: string
  checked?: boolean
}

/** Fill/Input options (v2: batch support) */
export interface FillOptions {
  ref?: ElementRef
  selector?: string
  value?: string
  checked?: boolean
  append?: boolean
  fields?: InputField[]
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

/** Capture options (v2: unified screenshot + download, always file) */
export interface CaptureOptions {
  mode?: "screenshot" | "download"
  ref?: ElementRef
  fullPage?: boolean
  url?: string
  filePath?: string
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

/** Query result from CSS selector */
export interface QueryResult {
  ref: string
  role: string
  name: string
  tag: string
  attrs?: Record<string, string>
}

/** Browser state for UI */
export interface BrowserState {
  isReady: boolean
  isOperating: boolean
  isLocked: boolean
  currentUrl: string | null
  currentTitle: string | null
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
