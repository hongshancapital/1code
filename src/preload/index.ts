import { contextBridge, ipcRenderer, webUtils } from "electron"
import { exposeElectronTRPC } from "trpc-electron/main"

// Skip Sentry init if embedded in Tinker (env var inherited from main process)
const isEmbeddedInTinker = process.env['HONG_EMBEDDED_IN_TINKER'] === 'true'

// Use @sentry/electron/preload (NOT /renderer) to set up the IPC bridge
// between renderer and main process. The renderer module is initialized
// separately in src/renderer/main.tsx. Using /renderer here caused
// double-initialization which broke the sentry-ipc:// transport.
// IMPORTANT: Must use synchronous require() instead of async import() to ensure
// window.__SENTRY_IPC__ is set up before the renderer's Sentry.init() runs.
// Async import() caused a race condition where the renderer fell back to
// fetch-based sentry-ipc:// transport, resulting in ERR_UNKNOWN_URL_SCHEME.
if (!isEmbeddedInTinker && process.env['NODE_ENV'] === "production") {
  require("@sentry/electron/preload")
}

// Expose tRPC IPC bridge for type-safe communication
exposeElectronTRPC()

// Expose webUtils for file path access in drag and drop
contextBridge.exposeInMainWorld("webUtils", {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})

// Expose analytics force flag for testing
if (process.env.FORCE_ANALYTICS === "true") {
  contextBridge.exposeInMainWorld("__FORCE_ANALYTICS__", true)
}

// Expose desktop-specific APIs
contextBridge.exposeInMainWorld("desktopApi", {
  // Platform info
  platform: process.platform,
  arch: process.arch,
  getVersion: () => ipcRenderer.invoke("app:version"),
  isPackaged: () => ipcRenderer.invoke("app:isPackaged"),

  // Auto-update methods
  checkForUpdates: (force?: boolean) => ipcRenderer.invoke("update:check", force),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  setUpdateChannel: (channel: "latest" | "beta") => ipcRenderer.invoke("update:set-channel", channel),
  getUpdateChannel: () => ipcRenderer.invoke("update:get-channel") as Promise<"latest" | "beta">,

  // Auto-update event listeners
  onUpdateChecking: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on("update:checking", handler)
    return () => ipcRenderer.removeListener("update:checking", handler)
  },
  onUpdateAvailable: (callback: (info: { version: string; releaseDate?: string }) => void) => {
    const handler = (_event: unknown, info: { version: string; releaseDate?: string }) => callback(info)
    ipcRenderer.on("update:available", handler)
    return () => ipcRenderer.removeListener("update:available", handler)
  },
  onUpdateNotAvailable: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on("update:not-available", handler)
    return () => ipcRenderer.removeListener("update:not-available", handler)
  },
  onUpdateProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void) => {
    const handler = (_event: unknown, progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => callback(progress)
    ipcRenderer.on("update:progress", handler)
    return () => ipcRenderer.removeListener("update:progress", handler)
  },
  onUpdateDownloaded: (callback: (info: { version: string }) => void) => {
    const handler = (_event: unknown, info: { version: string }) => callback(info)
    ipcRenderer.on("update:downloaded", handler)
    return () => ipcRenderer.removeListener("update:downloaded", handler)
  },
  onUpdateError: (callback: (error: string) => void) => {
    const handler = (_event: unknown, error: string) => callback(error)
    ipcRenderer.on("update:error", handler)
    return () => ipcRenderer.removeListener("update:error", handler)
  },
  onUpdateManualCheck: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on("update:manual-check", handler)
    return () => ipcRenderer.removeListener("update:manual-check", handler)
  },

  // Window controls
  windowMinimize: () => ipcRenderer.invoke("window:minimize"),
  windowMaximize: () => ipcRenderer.invoke("window:maximize"),
  windowClose: () => ipcRenderer.invoke("window:close"),
  windowIsMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  windowToggleFullscreen: () => ipcRenderer.invoke("window:toggle-fullscreen"),
  windowIsFullscreen: () => ipcRenderer.invoke("window:is-fullscreen"),
  setTrafficLightVisibility: (visible: boolean) =>
    ipcRenderer.invoke("window:set-traffic-light-visibility", visible),

  // Windows-specific: Frame preference (native vs frameless)
  setWindowFramePreference: (useNativeFrame: boolean) =>
    ipcRenderer.invoke("window:set-frame-preference", useNativeFrame),
  getWindowFrameState: () => ipcRenderer.invoke("window:get-frame-state"),

  // Window events
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => {
    const handler = (_event: unknown, isFullscreen: boolean) => callback(isFullscreen)
    ipcRenderer.on("window:fullscreen-change", handler)
    return () => ipcRenderer.removeListener("window:fullscreen-change", handler)
  },
  onFocusChange: (callback: (isFocused: boolean) => void) => {
    const handler = (_event: unknown, isFocused: boolean) => callback(isFocused)
    ipcRenderer.on("window:focus-change", handler)
    return () => ipcRenderer.removeListener("window:focus-change", handler)
  },

  // Memory router: deep link navigation
  onNavigateRoute: (callback: (route: { chatId: string; subChatId?: string; messageId?: string; highlight?: string; timestamp: number }) => void) => {
    const handler = (_event: unknown, route: { chatId: string; subChatId?: string; messageId?: string; highlight?: string; timestamp: number }) => callback(route)
    ipcRenderer.on("navigate:route", handler)
    return () => ipcRenderer.removeListener("navigate:route", handler)
  },

  // Zoom controls
  zoomIn: () => ipcRenderer.invoke("window:zoom-in"),
  zoomOut: () => ipcRenderer.invoke("window:zoom-out"),
  zoomReset: () => ipcRenderer.invoke("window:zoom-reset"),
  getZoom: () => ipcRenderer.invoke("window:get-zoom"),

  // Multi-window
  newWindow: (options?: { chatId?: string; subChatId?: string }) => ipcRenderer.invoke("window:new", options),
  setWindowTitle: (title: string) => ipcRenderer.invoke("window:set-title", title),

  // DevTools
  toggleDevTools: () => ipcRenderer.invoke("window:toggle-devtools"),
  unlockDevTools: () => ipcRenderer.invoke("window:unlock-devtools"),

  // Native features
  setBadge: (count: number | null) => ipcRenderer.invoke("app:set-badge", count),
  setBadgeIcon: (imageData: string | null) => ipcRenderer.invoke("app:set-badge-icon", imageData),
  showNotification: (options: { title: string; body: string }) =>
    ipcRenderer.invoke("app:show-notification", options),
  openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url),
  openInternalBrowser: (url: string) => ipcRenderer.send("browser:open-url", url),
  selectAudioFile: (): Promise<string | null> => ipcRenderer.invoke("dialog:select-audio-file"),
  saveFile: (options: { base64Data: string; filename: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke("dialog:save-file", options) as Promise<{ success: boolean; filePath?: string }>,

  // API base URL (for fetch requests to server)
  getApiBaseUrl: () => ipcRenderer.invoke("app:get-api-base-url"),

  // Clipboard
  clipboardWrite: (text: string) => ipcRenderer.invoke("clipboard:write", text),
  clipboardRead: () => ipcRenderer.invoke("clipboard:read"),

  // Device ID (for identifying this device to backend APIs)
  getDeviceId: () => ipcRenderer.invoke("device:get-id"),

  // Auth methods
  getUser: () => ipcRenderer.invoke("auth:get-user"),
  refreshUser: () => ipcRenderer.invoke("auth:refresh-user"),
  isAuthenticated: () => ipcRenderer.invoke("auth:is-authenticated"),
  isSkipped: () => ipcRenderer.invoke("auth:is-skipped"),
  skipAuth: () => ipcRenderer.invoke("auth:skip"),
  logout: () => ipcRenderer.invoke("auth:logout"),
  startAuthFlow: () => ipcRenderer.invoke("auth:start-flow"),
  submitAuthCode: (code: string) => ipcRenderer.invoke("auth:submit-code", code),
  updateUser: (updates: { name?: string }) => ipcRenderer.invoke("auth:update-user", updates),
  getAuthToken: () => ipcRenderer.invoke("auth:get-token"),

  // Signed fetch - proxies through main process (no CORS issues)
  signedFetch: (
    url: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> },
  ) =>
    ipcRenderer.invoke("api:signed-fetch", url, options) as Promise<{
      ok: boolean
      status: number
      data: unknown
      error: string | null
    }>,

  // Streaming fetch - for SSE responses (chat streaming)
  streamFetch: (
    streamId: string,
    url: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> },
  ) =>
    ipcRenderer.invoke("api:stream-fetch", streamId, url, options) as Promise<{
      ok: boolean
      status: number
      error?: string
    }>,

  // Stream event listeners
  onStreamChunk: (streamId: string, callback: (chunk: Uint8Array) => void) => {
    const handler = (_event: unknown, chunk: Uint8Array) => callback(chunk)
    ipcRenderer.on(`stream:${streamId}:chunk`, handler)
    return () => ipcRenderer.removeListener(`stream:${streamId}:chunk`, handler)
  },
  onStreamDone: (streamId: string, callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(`stream:${streamId}:done`, handler)
    return () => ipcRenderer.removeListener(`stream:${streamId}:done`, handler)
  },
  onStreamError: (streamId: string, callback: (error: string) => void) => {
    const handler = (_event: unknown, error: string) => callback(error)
    ipcRenderer.on(`stream:${streamId}:error`, handler)
    return () => ipcRenderer.removeListener(`stream:${streamId}:error`, handler)
  },

  // Auth events
  onAuthSuccess: (callback: (user: any) => void) => {
    const handler = (_event: unknown, user: any) => callback(user)
    ipcRenderer.on("auth:success", handler)
    return () => ipcRenderer.removeListener("auth:success", handler)
  },
  onAuthError: (callback: (error: string) => void) => {
    const handler = (_event: unknown, error: string) => callback(error)
    ipcRenderer.on("auth:error", handler)
    return () => ipcRenderer.removeListener("auth:error", handler)
  },
  onSessionExpired: (callback: (data: { reason: string }) => void) => {
    const handler = (_event: unknown, data: { reason: string }) => callback(data)
    ipcRenderer.on("auth:session-expired", handler)
    return () => ipcRenderer.removeListener("auth:session-expired", handler)
  },
  onReauthenticating: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on("auth:reauthenticating", handler)
    return () => ipcRenderer.removeListener("auth:reauthenticating", handler)
  },

  // Shortcut events (from main process menu accelerators)
  onShortcutNewAgent: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on("shortcut:new-agent", handler)
    return () => ipcRenderer.removeListener("shortcut:new-agent", handler)
  },

  // File change events (from Claude Write/Edit tools)
  onFileChanged: (callback: (data: {
    filePath: string
    type: string
    subChatId: string
    contexts?: Array<{
      type: "file" | "url"
      filePath?: string
      toolType?: "Read" | "Glob" | "Grep"
      url?: string
      title?: string
    }>
  }) => void) => {
    const handler = (_event: unknown, data: {
      filePath: string
      type: string
      subChatId: string
      contexts?: Array<{
        type: "file" | "url"
        filePath?: string
        toolType?: "Read" | "Glob" | "Grep"
        url?: string
        title?: string
      }>
    }) => callback(data)
    ipcRenderer.on("file-changed", handler)
    return () => ipcRenderer.removeListener("file-changed", handler)
  },

  // Git status change events (from file watcher)
  onGitStatusChanged: (callback: (data: { worktreePath: string; changes: Array<{ path: string; type: "add" | "change" | "unlink" }> }) => void) => {
    const handler = (_event: unknown, data: { worktreePath: string; changes: Array<{ path: string; type: "add" | "change" | "unlink" }> }) => callback(data)
    ipcRenderer.on("git:status-changed", handler)
    return () => ipcRenderer.removeListener("git:status-changed", handler)
  },

  // Git commit success events (from claude.ts Bash output detection)
  onGitCommitSuccess: (callback: (data: { subChatId: string; commitHash: string; branchInfo: string }) => void) => {
    const handler = (_event: unknown, data: { subChatId: string; commitHash: string; branchInfo: string }) => callback(data)
    ipcRenderer.on("git-commit-success", handler)
    return () => ipcRenderer.removeListener("git-commit-success", handler)
  },

  // Subscribe to git watcher for a worktree (from renderer)
  subscribeToGitWatcher: (worktreePath: string) => ipcRenderer.invoke("git:subscribe-watcher", worktreePath),
  unsubscribeFromGitWatcher: (worktreePath: string) => ipcRenderer.invoke("git:unsubscribe-watcher", worktreePath),

  // VS Code theme scanning
  scanVSCodeThemes: () => ipcRenderer.invoke("vscode:scan-themes"),
  loadVSCodeTheme: (themePath: string) => ipcRenderer.invoke("vscode:load-theme", themePath),

  // Task idle notification (for update blocking)
  notifyTasksIdle: (idle: boolean) => ipcRenderer.send("hong:tasks-idle-changed", idle),

  // Browser automation (for AI agent browser control)
  browserReady: (ready: boolean) => ipcRenderer.send("browser:ready", ready),
  browserResult: (id: string, result: { success: boolean; data?: unknown; error?: string }) =>
    ipcRenderer.send("browser:result", { id, result }),
  browserUrlChanged: (url: string) => ipcRenderer.send("browser:url-changed", url),
  browserTitleChanged: (title: string) => ipcRenderer.send("browser:title-changed", title),
  browserUnlock: () => ipcRenderer.send("browser:manual-unlock"),
  browserCursorPosition: (x: number, y: number) =>
    ipcRenderer.send("browser:cursor-position", { x, y }),
  browserGetCertificate: (url: string) => ipcRenderer.invoke("browser:get-certificate", url) as Promise<CertificateInfo | null>,
  browserSetDeviceEmulation: (params: DeviceEmulationParams | null) =>
    ipcRenderer.invoke("browser:set-device-emulation", params),
  browserClearCache: () => ipcRenderer.invoke("browser:clear-cache") as Promise<boolean>,
  onBrowserExecute: (callback: (operation: { id: string; type: string; params: Record<string, unknown> }) => void) => {
    const handler = (_event: unknown, operation: { id: string; type: string; params: Record<string, unknown> }) => callback(operation)
    ipcRenderer.on("browser:execute", handler)
    return () => ipcRenderer.removeListener("browser:execute", handler)
  },
  onBrowserNavigate: (callback: (url: string) => void) => {
    const handler = (_event: unknown, url: string) => callback(url)
    ipcRenderer.on("browser:navigate", handler)
    return () => ipcRenderer.removeListener("browser:navigate", handler)
  },
  onBrowserLockStateChanged: (callback: (locked: boolean) => void) => {
    const handler = (_event: unknown, locked: boolean) => callback(locked)
    ipcRenderer.on("browser:lock-state-changed", handler)
    return () => ipcRenderer.removeListener("browser:lock-state-changed", handler)
  },
  onBrowserShowPanel: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on("browser:show-panel", handler)
    return () => ipcRenderer.removeListener("browser:show-panel", handler)
  },
  onBrowserAuthLoopDetected: (callback: (url: string) => void) => {
    const handler = (_event: unknown, url: string) => callback(url)
    ipcRenderer.on("browser:auth-loop-detected", handler)
    return () => ipcRenderer.removeListener("browser:auth-loop-detected", handler)
  },
})

// Type definitions
export interface UpdateInfo {
  version: string
  releaseDate?: string
}

export interface CertificateInfo {
  subject: {
    commonName: string
    organization?: string
    organizationalUnit?: string
  }
  issuer: {
    commonName: string
    organization?: string
    organizationalUnit?: string
  }
  validFrom: string
  validTo: string
  fingerprint: string
  serialNumber: string
}

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export type EditorSource = "vscode" | "vscode-insiders" | "cursor" | "windsurf"

/** Device emulation parameters for browser webview */
export interface DeviceEmulationParams {
  /** Screen width in CSS pixels */
  screenWidth: number
  /** Screen height in CSS pixels */
  screenHeight: number
  /** Viewport width in CSS pixels */
  viewWidth: number
  /** Viewport height in CSS pixels */
  viewHeight: number
  /** Device scale factor (DPR) */
  deviceScaleFactor: number
  /** Whether to emulate mobile device */
  isMobile: boolean
  /** Whether device supports touch events */
  hasTouch: boolean
  /** User agent string to use */
  userAgent: string
}

export interface DiscoveredTheme {
  id: string
  name: string
  type: "light" | "dark"
  extensionId: string
  extensionName: string
  path: string
  source: EditorSource
}

export interface VSCodeThemeData {
  id: string
  name: string
  type: "light" | "dark"
  colors: Record<string, string>
  tokenColors?: any[]
  semanticHighlighting?: boolean
  semanticTokenColors?: Record<string, any>
  source: "imported"
  path: string
}

export interface DesktopApi {
  platform: NodeJS.Platform
  arch: string
  getVersion: () => Promise<string>
  isPackaged: () => Promise<boolean>
  // Auto-update
  checkForUpdates: (force?: boolean) => Promise<UpdateInfo | null>
  downloadUpdate: () => Promise<boolean>
  installUpdate: () => void
  setUpdateChannel: (channel: "latest" | "beta") => Promise<boolean>
  getUpdateChannel: () => Promise<"latest" | "beta">
  onUpdateChecking: (callback: () => void) => () => void
  onUpdateAvailable: (callback: (info: UpdateInfo) => void) => () => void
  onUpdateNotAvailable: (callback: () => void) => () => void
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void
  onUpdateDownloaded: (callback: (info: UpdateInfo) => void) => () => void
  onUpdateError: (callback: (error: string) => void) => () => void
  onUpdateManualCheck: (callback: () => void) => () => void
  // Window controls
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  windowToggleFullscreen: () => Promise<void>
  windowIsFullscreen: () => Promise<boolean>
  setTrafficLightVisibility: (visible: boolean) => Promise<void>
  // Windows-specific frame preference
  setWindowFramePreference: (useNativeFrame: boolean) => Promise<boolean>
  getWindowFrameState: () => Promise<boolean>
  onFullscreenChange: (callback: (isFullscreen: boolean) => void) => () => void
  onFocusChange: (callback: (isFocused: boolean) => void) => () => void
  zoomIn: () => Promise<void>
  zoomOut: () => Promise<void>
  zoomReset: () => Promise<void>
  getZoom: () => Promise<number>
  // Multi-window
  newWindow: (options?: { chatId?: string; subChatId?: string }) => Promise<void>
  setWindowTitle: (title: string) => Promise<void>
  toggleDevTools: () => Promise<void>
  unlockDevTools: () => Promise<void>
  setBadge: (count: number | null) => Promise<void>
  setBadgeIcon: (imageData: string | null) => Promise<void>
  showNotification: (options: { title: string; body: string }) => Promise<void>
  openExternal: (url: string) => Promise<void>
  openInternalBrowser: (url: string) => void
  getApiBaseUrl: () => Promise<string>
  clipboardWrite: (text: string) => Promise<void>
  clipboardRead: () => Promise<string>
  // Device ID
  getDeviceId: () => Promise<string>
  // Auth
  getUser: () => Promise<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>
  refreshUser: () => Promise<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>
  isAuthenticated: () => Promise<boolean>
  isSkipped: () => Promise<boolean>
  skipAuth: () => Promise<void>
  logout: () => Promise<void>
  startAuthFlow: () => Promise<void>
  submitAuthCode: (code: string) => Promise<void>
  updateUser: (updates: { name?: string }) => Promise<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>
  getAuthToken: () => Promise<string | null>
  signedFetch: (
    url: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => Promise<{ ok: boolean; status: number; data: unknown; error: string | null }>
  // Streaming fetch
  streamFetch: (
    streamId: string,
    url: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> },
  ) => Promise<{ ok: boolean; status: number; error?: string }>
  onStreamChunk: (streamId: string, callback: (chunk: Uint8Array) => void) => () => void
  onStreamDone: (streamId: string, callback: () => void) => () => void
  onStreamError: (streamId: string, callback: (error: string) => void) => () => void
  onAuthSuccess: (callback: (user: any) => void) => () => void
  onAuthError: (callback: (error: string) => void) => () => void
  onSessionExpired: (callback: (data: { reason: string }) => void) => () => void
  onReauthenticating: (callback: () => void) => () => void
  // Shortcuts
  onShortcutNewAgent: (callback: () => void) => () => void
  // File changes
  onFileChanged: (callback: (data: { filePath: string; type: string; subChatId: string }) => void) => () => void
  // Git status changes (from file watcher)
  onGitStatusChanged: (callback: (data: { worktreePath: string; changes: Array<{ path: string; type: "add" | "change" | "unlink" }> }) => void) => () => void
  // Git commit success (from claude.ts Bash output detection)
  onGitCommitSuccess: (callback: (data: { subChatId: string; commitHash: string; branchInfo: string }) => void) => () => void
  subscribeToGitWatcher: (worktreePath: string) => Promise<void>
  unsubscribeFromGitWatcher: (worktreePath: string) => Promise<void>
  // VS Code theme scanning
  scanVSCodeThemes: () => Promise<DiscoveredTheme[]>
  loadVSCodeTheme: (themePath: string) => Promise<VSCodeThemeData>
  // File dialogs
  selectAudioFile: () => Promise<string | null>
  saveFile: (options: { base64Data: string; filename: string; filters?: { name: string; extensions: string[] }[] }) => Promise<{ success: boolean; filePath?: string }>
  // Memory router: deep link navigation
  onNavigateRoute: (callback: (route: { chatId: string; subChatId?: string; messageId?: string; highlight?: string; timestamp: number }) => void) => () => void
  // Task idle notification
  notifyTasksIdle: (idle: boolean) => void
  // Browser automation
  browserReady: (ready: boolean) => void
  browserResult: (id: string, result: { success: boolean; data?: unknown; error?: string }) => void
  browserUrlChanged: (url: string) => void
  browserTitleChanged: (title: string) => void
  browserUnlock: () => void
  browserCursorPosition: (x: number, y: number) => void
  browserGetCertificate: (url: string) => Promise<CertificateInfo | null>
  browserSetDeviceEmulation: (params: DeviceEmulationParams | null) => Promise<void>
  browserClearCache: () => Promise<boolean>
  onBrowserExecute: (callback: (operation: { id: string; type: string; params: Record<string, unknown> }) => void) => () => void
  onBrowserNavigate: (callback: (url: string) => void) => () => void
  onBrowserLockStateChanged: (callback: (locked: boolean) => void) => () => void
  onBrowserShowPanel: (callback: () => void) => () => void
  onBrowserAuthLoopDetected: (callback: (url: string) => void) => () => void
}

// Expose embedded flag for renderer process
contextBridge.exposeInMainWorld("__HONG_EMBEDDED__", isEmbeddedInTinker)

declare global {
  interface Window {
    desktopApi: DesktopApi
    webUtils?: {
      getPathForFile(file: File): string
    }
    __HONG_EMBEDDED__?: boolean
  }
}
