/**
 * Browser Manager
 * Manages communication between MCP server and renderer webview
 *
 * Design: Single-responsibility, event-driven, no callbacks in state
 */

import { EventEmitter } from "node:events"
import * as https from "node:https"
import * as tls from "node:tls"
import { BrowserWindow, ipcMain, webContents, session } from "electron"
import type {
  BrowserOperation,
  BrowserOperationType,
  BrowserResult,
  BrowserState,
  CursorPosition,
  PendingOperation,
  RecentAction,
} from "./types"

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

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_RECENT_ACTIONS = 5

/** Device emulation parameters */
export interface DeviceEmulationParams {
  screenWidth: number
  screenHeight: number
  viewWidth: number
  viewHeight: number
  deviceScaleFactor: number
  isMobile: boolean
  hasTouch: boolean
  userAgent: string
}

export class BrowserManager extends EventEmitter {
  private pending = new Map<string, PendingOperation>()
  private state: BrowserState = {
    isReady: false,
    isOperating: false,
    currentUrl: null,
    currentAction: null,
    recentActions: [],
  }

  constructor() {
    super()
    this.setupIpcHandlers()
  }

  private setupIpcHandlers(): void {
    // Renderer reports browser ready state
    ipcMain.on("browser:ready", (_, ready: boolean) => {
      this.state.isReady = ready
      this.emit("ready", ready)
    })

    // Renderer reports operation result
    ipcMain.on("browser:result", (_, payload: {
      id: string
      result: BrowserResult
    }) => {
      this.handleResult(payload.id, payload.result)
    })

    // Renderer reports URL change
    ipcMain.on("browser:url-changed", (_, url: string) => {
      this.state.currentUrl = url
      this.emit("urlChanged", url)
    })

    // Renderer reports cursor position (for AI cursor animation)
    ipcMain.on("browser:cursor-position", (_, position: CursorPosition) => {
      this.emit("cursorPosition", position)
    })

    // Get certificate info for a URL
    ipcMain.handle("browser:get-certificate", async (_, url: string): Promise<CertificateInfo | null> => {
      return this.getCertificate(url)
    })

    // Set device emulation for browser webview
    ipcMain.handle("browser:set-device-emulation", async (_, params: DeviceEmulationParams | null): Promise<void> => {
      await this.setDeviceEmulation(params)
    })

    // Clear browser cache and storage data
    ipcMain.handle("browser:clear-cache", async (): Promise<boolean> => {
      return this.clearCache()
    })
  }

  /**
   * Set device emulation on the browser webview
   * Finds the webview in the persist:browser partition and applies emulation settings
   */
  async setDeviceEmulation(params: DeviceEmulationParams | null): Promise<void> {
    // Find the webview webContents (uses persist:browser partition)
    const allContents = webContents.getAllWebContents()
    const browserWebview = allContents.find(wc => {
      // Webview type is 'webview'
      if (wc.getType() !== "webview") return false
      // Check if it's using the browser partition by checking session
      try {
        const ses = wc.session
        // The browser webview uses persist:browser partition
        return ses === session.fromPartition("persist:browser")
      } catch {
        return false
      }
    })

    if (!browserWebview) {
      console.warn("[BrowserManager] No browser webview found for device emulation")
      return
    }

    if (params === null) {
      // Disable emulation - restore defaults
      browserWebview.disableDeviceEmulation()
      // Reset to default user agent
      const defaultUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
      browserWebview.setUserAgent(defaultUA)
      this.emit("deviceEmulationChanged", null)
    } else {
      // Enable device emulation
      browserWebview.enableDeviceEmulation({
        screenPosition: params.isMobile ? "mobile" : "desktop",
        screenSize: {
          width: params.screenWidth,
          height: params.screenHeight,
        },
        viewPosition: { x: 0, y: 0 },
        viewSize: {
          width: params.viewWidth,
          height: params.viewHeight,
        },
        deviceScaleFactor: params.deviceScaleFactor,
      })
      // Set user agent
      browserWebview.setUserAgent(params.userAgent)
      this.emit("deviceEmulationChanged", params)
    }
  }

  /**
   * Clear browser cache and storage data for the persist:browser partition
   */
  async clearCache(): Promise<boolean> {
    try {
      const browserSession = session.fromPartition("persist:browser")
      await browserSession.clearCache()
      await browserSession.clearStorageData()
      return true
    } catch (error) {
      console.error("[BrowserManager] Failed to clear cache:", error)
      return false
    }
  }

  /**
   * Get SSL certificate info for a URL
   */
  async getCertificate(url: string): Promise<CertificateInfo | null> {
    try {
      const urlObj = new URL(url)
      if (urlObj.protocol !== "https:") {
        return null
      }

      return new Promise((resolve) => {
        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port || 443,
          method: "HEAD",
          rejectUnauthorized: false, // Allow self-signed certs
          timeout: 5000,
        }

        const req = https.request(options, (res) => {
          const socket = res.socket as tls.TLSSocket
          const cert = socket.getPeerCertificate()

          if (!cert || Object.keys(cert).length === 0) {
            resolve(null)
            return
          }

          const certInfo: CertificateInfo = {
            subject: {
              commonName: cert.subject?.CN || "",
              organization: cert.subject?.O || undefined,
              organizationalUnit: cert.subject?.OU || undefined,
            },
            issuer: {
              commonName: cert.issuer?.CN || "",
              organization: cert.issuer?.O || undefined,
              organizationalUnit: cert.issuer?.OU || undefined,
            },
            validFrom: cert.valid_from || "",
            validTo: cert.valid_to || "",
            fingerprint: cert.fingerprint256 || cert.fingerprint || "",
            serialNumber: cert.serialNumber || "",
          }

          resolve(certInfo)
        })

        req.on("error", () => {
          resolve(null)
        })

        req.on("timeout", () => {
          req.destroy()
          resolve(null)
        })

        req.end()
      })
    } catch {
      return null
    }
  }

  get isReady(): boolean {
    return this.state.isReady
  }

  get isOperating(): boolean {
    return this.state.isOperating
  }

  get currentUrl(): string | null {
    return this.state.currentUrl
  }

  get recentActions(): readonly RecentAction[] {
    return this.state.recentActions
  }

  /**
   * Execute a browser operation
   * Returns a promise that resolves when the operation completes
   */
  async execute<T = unknown>(
    type: BrowserOperationType,
    params: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<BrowserResult<T>> {
    if (!this.state.isReady) {
      return { success: false, error: "Browser not ready" }
    }

    const id = crypto.randomUUID()
    const operation: BrowserOperation = { id, type, params }

    // Update state
    this.state.isOperating = true
    this.state.currentAction = this.formatAction(type, params)
    this.emit("operationStart", { type, params })

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.finishOperation(type, params, false)
        resolve({ success: false, error: `Operation ${type} timed out` })
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer)
          this.pending.delete(id)
          this.finishOperation(type, params, result.success)
          resolve(result as BrowserResult<T>)
        },
        reject: (error) => {
          clearTimeout(timer)
          this.pending.delete(id)
          this.finishOperation(type, params, false)
          resolve({ success: false, error: error.message })
        },
        timer,
      })

      // Send to renderer
      this.getWindow()?.webContents.send("browser:execute", operation)
    })
  }

  private handleResult(id: string, result: BrowserResult): void {
    const op = this.pending.get(id)
    if (!op) return

    clearTimeout(op.timer)
    this.pending.delete(id)
    op.resolve(result)
  }

  private finishOperation(
    type: BrowserOperationType,
    params: Record<string, unknown>,
    success: boolean,
  ): void {
    this.state.isOperating = false
    this.state.currentAction = null

    // Add to recent actions
    const action: RecentAction = {
      id: crypto.randomUUID(),
      type,
      summary: this.formatAction(type, params),
      timestamp: Date.now(),
    }

    this.state.recentActions = [
      action,
      ...this.state.recentActions.slice(0, MAX_RECENT_ACTIONS - 1),
    ]

    this.emit("operationEnd", { type, params, success })
  }

  private formatAction(
    type: BrowserOperationType,
    params: Record<string, unknown>,
  ): string {
    switch (type) {
      case "navigate":
        return `Navigating to ${params.url}`
      case "click":
        return `Clicking ${params.ref || params.selector || "element"}`
      case "fill":
        return `Filling ${params.ref || params.selector || "input"}`
      case "type":
        return "Typing text"
      case "screenshot":
        return "Taking screenshot"
      case "snapshot":
        return "Taking snapshot"
      case "scroll":
        return `Scrolling ${params.direction || "page"}`
      case "press":
        return `Pressing ${params.key}`
      case "wait":
        return "Waiting for element"
      case "hover":
        return `Hovering ${params.ref || params.selector || "element"}`
      case "drag":
        return "Dragging element"
      case "select":
        return `Selecting ${params.value}`
      case "check":
        return `${params.checked ? "Checking" : "Unchecking"} ${params.ref || "element"}`
      case "evaluate":
        return "Executing script"
      case "emulate":
        return "Applying emulation"
      case "downloadImage":
        return "Downloading image"
      case "downloadFile":
        return "Downloading file"
      default:
        return type
    }
  }

  private getWindow(): BrowserWindow | null {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Clear all pending operations
    for (const [id, op] of this.pending) {
      clearTimeout(op.timer)
      op.reject(new Error("Browser manager shutting down"))
    }
    this.pending.clear()

    // Reset state
    this.state = {
      isReady: false,
      isOperating: false,
      currentUrl: null,
      currentAction: null,
      recentActions: [],
    }

    this.removeAllListeners()
  }
}

/** Singleton instance */
export const browserManager = new BrowserManager()
