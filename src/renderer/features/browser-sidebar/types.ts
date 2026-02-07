/**
 * Browser Sidebar Types
 * Matches the main process browser module types
 */

/** Element reference from accessibility snapshot */
export type ElementRef = `@e${number}`

/** Browser operation types */
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

/** Browser operation from main process */
export interface BrowserOperation {
  id: string
  type: BrowserOperationType
  params: Record<string, unknown>
}

/** Browser operation result */
export interface BrowserResult<T = unknown> {
  success: boolean
  data?: T
  error?: string
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
