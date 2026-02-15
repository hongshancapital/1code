/**
 * Browser Manager
 * Manages communication between MCP server and renderer webview
 *
 * Design: Single-responsibility, event-driven, no callbacks in state
 */

import { EventEmitter } from "node:events"
import * as fs from "node:fs/promises"
import * as https from "node:https"
import type * as tls from "node:tls"
import { BrowserWindow, ipcMain, webContents, session } from "electron"
import type {
  BrowserOperation,
  BrowserOperationType,
  BrowserResult,
  BrowserState,
  CapturedNetworkRequest,
  CursorPosition,
  PendingOperation,
  RecentAction,
} from "./types"
import { createLogger } from "../../../lib/logger"

const browserManagerLog = createLogger("BrowserManager")


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
const LOCK_AUTO_RELEASE_MS = 5 * 60 * 1000 // 5 minutes

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
  private lockTimeout: NodeJS.Timeout | null = null
  private _workingDirectory: string | null = null

  // Network monitoring state
  private capturedRequests = new Map<string, CapturedNetworkRequest>()
  private isCapturingNetwork = false
  private networkOptions: { maxBodySize?: number; captureTypes?: string[] } = {}

  private state: BrowserState = {
    isReady: false,
    isOperating: false,
    isLocked: false,
    currentUrl: null,
    currentTitle: null,
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
      browserManagerLog.info("IPC browser:ready received from renderer:", ready)
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

    // Renderer reports title change
    ipcMain.on("browser:title-changed", (_, title: string) => {
      this.state.currentTitle = title
      this.emit("titleChanged", title)
    })

    // Renderer requests manual unlock (user clicked "Take Control")
    ipcMain.on("browser:manual-unlock", () => {
      this.unlock()
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
      browserManagerLog.warn("No browser webview found for device emulation")
      return
    }

    if (params === null) {
      // Disable emulation - restore defaults
      browserWebview.disableDeviceEmulation()
      // Reset to default user agent using actual Chrome version
      const chromeVersion = process.versions.chrome
      const defaultUA = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
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
        scale:1,
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
      browserManagerLog.error("Failed to clear cache:", error)
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

  get isLocked(): boolean {
    return this.state.isLocked
  }

  /**
   * Capture screenshot directly in main process via webContents.capturePage().
   * Writes raw PNG Buffer to file — no base64 IPC, no data corruption.
   */
  async captureScreenshot(filePath: string, rect?: Electron.Rectangle): Promise<{ success: boolean; width: number; height: number; error?: string }> {
    const allContents = webContents.getAllWebContents()
    const browserWebview = allContents.find(wc => {
      if (wc.getType() !== "webview") return false
      try {
        return wc.session === session.fromPartition("persist:browser")
      } catch {
        return false
      }
    })

    if (!browserWebview) {
      return { success: false, width: 0, height: 0, error: "No browser webview found" }
    }

    try {
      const image = rect ? await browserWebview.capturePage(rect) : await browserWebview.capturePage()
      if (image.isEmpty()) {
        return { success: false, width: 0, height: 0, error: "Captured image is empty (element may be off-screen or have zero size)" }
      }
      const pngBuffer = image.toPNG()
      await fs.writeFile(filePath, pngBuffer)
      const size = image.getSize()
      return { success: true, width: size.width, height: size.height }
    } catch (e) {
      return { success: false, width: 0, height: 0, error: `Screenshot failed: ${e}` }
    }
  }

  /**
   * Capture full page segments directly in main process to avoid IPC data transfer limits.
   * Returns buffers for stitching.
   */
  async captureFullPageSegments(): Promise<BrowserResult<{
    segments: Buffer[]
    width: number
    height: number
    viewportHeight: number
    totalHeight: number
  }>> {
    const wc = this.getWebContents()
    if (!wc) return { success: false, error: "No browser webview found" }

    try {
      // Get dimensions
      const dims = await wc.executeJavaScript(`(() => {
        const body = document.body;
        const html = document.documentElement;
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          totalHeight: Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight),
          scrollX: window.scrollX,
          scrollY: window.scrollY
        };
      })()`)

      const { viewportWidth, viewportHeight, totalHeight, scrollX, scrollY } = dims
      const maxSegments = 50
      const segmentCount = Math.min(Math.ceil(totalHeight / viewportHeight), maxSegments)
      const segments: Buffer[] = []

      // Hide scrollbars
      const cssKey = await wc.insertCSS(`::-webkit-scrollbar { display: none !important; }`)

      try {
        for (let i = 0; i < segmentCount; i++) {
          await wc.executeJavaScript(`window.scrollTo(0, ${i * viewportHeight})`)
          // Wait for scroll/render
          await new Promise(r => setTimeout(r, 200))

          // Capture viewport
          const image = await wc.capturePage()
          if (!image.isEmpty()) {
            segments.push(image.toPNG())
          }
        }
      } finally {
        // Restore state
        await wc.removeInsertedCSS(cssKey)
        await wc.executeJavaScript(`window.scrollTo(${scrollX}, ${scrollY})`)
      }

      return {
        success: true,
        data: {
          segments,
          width: viewportWidth,
          height: totalHeight,
          viewportHeight,
          totalHeight
        }
      }
    } catch (e) {
      return { success: false, error: `Full page capture failed: ${e}` }
    }
  }

  /**
   * Start network monitoring via CDP (Chrome DevTools Protocol)
   */
  async startNetworkCapture(options: { maxBodySize?: number; captureTypes?: string[] } = {}): Promise<BrowserResult> {
    const wc = this.getWebContents()
    if (!wc) return { success: false, error: "No browser webview found" }

    try {
      if (!wc.debugger.isAttached()) {
        wc.debugger.attach("1.3")
      }

      await wc.debugger.sendCommand("Network.enable", {
        maxResourceBufferSize: 1024 * 1024 * 10, // 10MB
        maxTotalBufferSize: 1024 * 1024 * 100,   // 100MB
      })

      this.isCapturingNetwork = true
      this.networkOptions = options
      this.setupNetworkListeners(wc)

      return { success: true }
    } catch (e) {
      return { success: false, error: `Failed to start network capture: ${e}` }
    }
  }

  /**
   * Stop network monitoring
   */
  async stopNetworkCapture(): Promise<BrowserResult<number>> {
    const wc = this.getWebContents()
    if (!wc) return { success: false, error: "No browser webview found" }

    try {
      this.isCapturingNetwork = false
      await wc.debugger.sendCommand("Network.disable")
      if (wc.debugger.isAttached()) {
        wc.debugger.detach()
      }
      return { success: true, data: this.capturedRequests.size }
    } catch (e) {
      return { success: false, error: `Failed to stop network capture: ${e}` }
    }
  }

  /**
   * Clear captured requests
   */
  async clearNetworkCapture(): Promise<BrowserResult> {
    this.capturedRequests.clear()
    return { success: true }
  }

  /**
   * Get captured network requests with filtering
   */
  async getNetworkRequests(filter: {
    urlPattern?: string
    method?: string
    hasError?: boolean
    limit?: number
    offset?: number
  } = {}): Promise<BrowserResult<{ requests: CapturedNetworkRequest[]; total: number; capturing: boolean }>> {
    let requests = Array.from(this.capturedRequests.values())

    // Apply filters
    if (filter.urlPattern) {
      try {
        const re = new RegExp(filter.urlPattern, "i")
        requests = requests.filter(r => re.test(r.url))
      } catch {}
    }

    if (filter.method) {
      requests = requests.filter(r => r.method === filter.method)
    }

    if (filter.hasError) {
      requests = requests.filter(r => !!r.error || r.status >= 400)
    }

    // Sort by start time desc
    requests.sort((a, b) => b.startTime - a.startTime)

    const total = requests.length
    const limit = filter.limit || 50
    const offset = filter.offset || 0
    const sliced = requests.slice(offset, offset + limit)

    return {
      success: true,
      data: {
        requests: sliced,
        total,
        capturing: this.isCapturingNetwork
      }
    }
  }

  /**
   * Wait for network requests matching the filter
   */
  async waitForNetworkRequests(filter: {
    urlPattern?: string
    method?: string
    count?: number
    timeout?: number
  }): Promise<BrowserResult<{ requests: CapturedNetworkRequest[] }>> {
    if (!this.isCapturingNetwork) {
      return { success: false, error: "Network monitoring is not active. Call browser_network with action='start' first." }
    }

    const count = filter.count || 1
    const timeoutMs = filter.timeout || DEFAULT_TIMEOUT_MS
    const collected: CapturedNetworkRequest[] = []

    return new Promise((resolve) => {
      let timer: NodeJS.Timeout

      const listener = (req: CapturedNetworkRequest) => {
        // Check filters
        if (filter.method && req.method !== filter.method) return
        if (filter.urlPattern) {
          try {
            if (!new RegExp(filter.urlPattern, "i").test(req.url)) return
          } catch {
            return
          }
        }

        collected.push(req)

        if (collected.length >= count) {
          cleanup()
          resolve({ success: true, data: { requests: collected } })
        }
      }

      const cleanup = () => {
        this.removeListener("network-request-completed", listener)
        if (timer) clearTimeout(timer)
      }

      this.on("network-request-completed", listener)

      timer = setTimeout(() => {
        cleanup()
        resolve({ success: true, data: { requests: collected } })
      }, timeoutMs)
    })
  }

  private setupNetworkListeners(wc: Electron.WebContents) {
    // Remove existing listeners to avoid duplicates
    wc.debugger.removeAllListeners("message")

    wc.debugger.on("message", async (event, method, params) => {
      if (!this.isCapturingNetwork) return

      if (method === "Network.requestWillBeSent") {
        const { requestId, request, timestamp, type } = params
        // Filter by captureTypes if specified
        if (this.networkOptions.captureTypes && !this.networkOptions.captureTypes.includes(type)) {
          return
        }

        this.capturedRequests.set(requestId, {
          id: requestId,
          method: request.method,
          url: request.url,
          status: 0,
          statusText: "",
          requestHeaders: request.headers,
          startTime: timestamp, // Monotonic time
          duration: 0,
          size: 0,
          type: type === "XHR" || type === "Fetch" ? "fetch" : "other",
          requestBody: request.postData
        })
      } else if (method === "Network.responseReceived") {
        const { requestId, response } = params
        const req = this.capturedRequests.get(requestId)
        if (req) {
          req.status = response.status
          req.statusText = response.statusText
          req.responseHeaders = response.headers
          req.contentType = response.mimeType
        }
      } else if (method === "Network.loadingFinished") {
        const { requestId, timestamp, encodedDataLength } = params
        const req = this.capturedRequests.get(requestId)
        if (req) {
          req.duration = (timestamp - req.startTime) * 1000 // s to ms
          req.size = encodedDataLength

          // Try to get response body for XHR/Fetch/Document
          // We only fetch body for text-based content to avoid performance issues
          if (["fetch", "xhr", "document", "script", "stylesheet"].includes(req.type) ||
              (req.contentType && (req.contentType.includes("json") || req.contentType.includes("text") || req.contentType.includes("xml")))) {
            try {
              const { body, base64Encoded: _base64Encoded } = await wc.debugger.sendCommand("Network.getResponseBody", { requestId })
              if (body) {
                const maxBodySize = this.networkOptions.maxBodySize || 1024 * 1024 // Default 1MB
                if (body.length > maxBodySize) {
                  req.responseBody = body.slice(0, maxBodySize) + "... (truncated)"
                } else {
                  req.responseBody = body
                }
              }
            } catch  {
              // Ignore body fetch errors (e.g. for redirects or empty bodies)
            }
          }
          this.emit("network-request-completed", req)
        }
      } else if (method === "Network.loadingFailed") {
        const { requestId, errorText, timestamp } = params
        const req = this.capturedRequests.get(requestId)
        if (req) {
          req.error = errorText
          req.duration = (timestamp - req.startTime) * 1000
          this.emit("network-request-completed", req)
        }
      }
    })
  }

  /**
   * Lock the browser for AI operation session.
   * Idempotent — returns status message indicating current state.
   * Auto-releases after 5 minutes as safety net.
   */
  lock(): { alreadyLocked: boolean } {
    if (this.state.isLocked) {
      // Reset the auto-release timer on re-lock
      this.resetLockTimeout()
      return { alreadyLocked: true }
    }
    this.state.isLocked = true
    this.resetLockTimeout()
    this.getWindow()?.webContents.send("browser:lock-state-changed", true)
    this.emit("lockStateChanged", true)
    return { alreadyLocked: false }
  }

  /**
   * Unlock the browser after AI operation session.
   * Idempotent — returns status message indicating current state.
   */
  unlock(): { wasLocked: boolean } {
    if (!this.state.isLocked) {
      return { wasLocked: false }
    }
    this.state.isLocked = false
    this.clearLockTimeout()
    this.getWindow()?.webContents.send("browser:lock-state-changed", false)
    this.emit("lockStateChanged", false)
    return { wasLocked: true }
  }

  /**
   * Renew the lock timeout to prevent auto-release during active use.
   * Called by MCP tools when they are executed.
   */
  renewLock(): void {
    if (this.state.isLocked) {
      this.resetLockTimeout()
    }
  }

  /**
   * Show the browser panel in the renderer.
   * Sends IPC to renderer to set browserVisible = true.
   */
  showPanel(): void {
    const win = this.getWindow()
    browserManagerLog.info("showPanel called, window exists:", !!win, "allWindows:", BrowserWindow.getAllWindows().length)
    if (win) {
      win.webContents.send("browser:show-panel")
      browserManagerLog.info("browser:show-panel IPC sent")
    } else {
      browserManagerLog.error("No window available to send browser:show-panel")
    }
  }

  /**
   * Ensure browser is ready — show panel if needed and wait for ready state.
   * Returns true if ready, false if timed out.
   */
  async ensureReady(timeoutMs = 15_000): Promise<boolean> {
    browserManagerLog.info("ensureReady called, current isReady:", this.state.isReady)
    if (this.state.isReady) {
      browserManagerLog.info("Already ready, returning true immediately")
      return true
    }

    // Show the panel to trigger webview creation
    this.showPanel()

    // Wait for ready event
    return new Promise<boolean>((resolve) => {
      browserManagerLog.info("Waiting for ready event (timeout:", timeoutMs, "ms)")
      const timer = setTimeout(() => {
        browserManagerLog.error("TIMEOUT! No ready event received after", timeoutMs, "ms")
        this.removeListener("ready", onReady)
        resolve(false)
      }, timeoutMs)

      const onReady = (ready: boolean) => {
        browserManagerLog.info("Received ready event:", ready)
        if (ready) {
          clearTimeout(timer)
          this.removeListener("ready", onReady)
          browserManagerLog.info("Browser is now ready, resolving true")
          resolve(true)
        }
      }

      this.on("ready", onReady)
    })
  }

  private resetLockTimeout(): void {
    this.clearLockTimeout()
    this.lockTimeout = setTimeout(() => {
      browserManagerLog.warn("Lock auto-released after 5 minutes timeout")
      this.unlock()
    }, LOCK_AUTO_RELEASE_MS)
  }

  private clearLockTimeout(): void {
    if (this.lockTimeout) {
      clearTimeout(this.lockTimeout)
      this.lockTimeout = null
    }
  }

  get currentUrl(): string | null {
    return this.state.currentUrl
  }

  get currentTitle(): string | null {
    return this.state.currentTitle
  }

  get workingDirectory(): string | null {
    return this._workingDirectory
  }

  set workingDirectory(dir: string | null) {
    this._workingDirectory = dir
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

    // Handle main-process-only operations
    if (type === "cookies") {
      this.state.isOperating = true
      this.state.currentAction = this.formatAction(type, params)
      this.emit("operationStart", { type, params })

      try {
        const ses = session.fromPartition("persist:browser")
        const { action, cookie, url } = params as any
        let result: BrowserResult = { success: false, error: "Unknown action" }

        if (action === 'get') {
          const filter: any = {}
          if (url) filter.url = url
          if (cookie?.domain) filter.domain = cookie.domain
          if (cookie?.name) filter.name = cookie.name
          const cookies = await ses.cookies.get(filter)
          result = { success: true, data: { cookies } }
        } else if (action === 'set') {
          if (!url && !cookie?.url) throw new Error("URL required for setting cookie")
          const details = { ...cookie, url: url || cookie.url }
          await ses.cookies.set(details)
          result = { success: true }
        } else if (action === 'delete') {
          if (!url) throw new Error("URL required for deleting cookie")
          if (!cookie?.name) throw new Error("Cookie name required")
          await ses.cookies.remove(url, cookie.name)
          result = { success: true }
        } else if (action === 'clear') {
          await ses.clearStorageData({ storages: ['cookies'] })
          result = { success: true }
        }

        this.finishOperation(type, params, result.success)
        return result as BrowserResult<T>
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        this.finishOperation(type, params, false)
        return { success: false, error } as BrowserResult<T>
      }
    }

    if (type === "uploadFile") {
      this.state.isOperating = true
      this.state.currentAction = this.formatAction(type, params)
      this.emit("operationStart", { type, params })

      try {
        const { selector, ref, filePath } = params as any
        let cssSelector = selector

        // Resolve ref to selector if needed
        if (ref && !cssSelector) {
          // Temporarily use renderer to get selector
          // Note: recursively calling execute() might be risky if not careful,
          // but here we are calling a renderer operation from a main operation.
          // We need to use the renderer execution path.
          // Since this block intercepts 'uploadFile', we can still use the standard
          // IPC path for 'getSelector'.
          const opId = crypto.randomUUID()
          const op: BrowserOperation = { id: opId, type: "getSelector", params: { ref } }

          const selResult = await new Promise<BrowserResult<any>>((resolve) => {
             const timer = setTimeout(() => {
               this.pending.delete(opId)
               resolve({ success: false, error: "Timeout getting selector" })
             }, 5000)

             this.pending.set(opId, {
               resolve: (r) => {
                 clearTimeout(timer)
                 resolve(r)
               },
               reject: (e) => {
                 clearTimeout(timer)
                 resolve({ success: false, error: e.message })
               },
               timer
             })

             this.getWindow()?.webContents.send("browser:execute", op)
          })

          if (selResult.success && selResult.data?.selector) {
            cssSelector = selResult.data.selector
          }
        }

        if (!cssSelector) throw new Error("Selector required for file upload (could not resolve ref)")

        const wc = this.getWebContents()
        if (!wc) throw new Error("No browser webview found")

        if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
        await wc.debugger.sendCommand('DOM.enable')
        const { root } = await wc.debugger.sendCommand('DOM.getDocument')
        const { nodeId } = await wc.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: cssSelector })

        if (!nodeId) throw new Error(`Node not found for selector: ${cssSelector}`)

        await wc.debugger.sendCommand('DOM.setFileInputFiles', {
          files: [filePath],
          nodeId
        })

        await wc.debugger.sendCommand('DOM.disable')
        wc.debugger.detach()

        const result = { success: true }
        this.finishOperation(type, params, true)
        return result as BrowserResult<T>
      } catch (e) {
        // Cleanup debugger
        try {
          const wc = this.getWebContents()
          if (wc?.debugger.isAttached()) wc.debugger.detach()
        } catch {}

        const error = e instanceof Error ? e.message : String(e)
        this.finishOperation(type, params, false)
        return { success: false, error } as BrowserResult<T>
      }
    }

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
      case "querySelector":
        return `Querying ${params.selector || "elements"}`
      case "getAttribute":
        return `Getting attribute ${params.attribute || "all"} of ${params.ref || params.selector || "element"}`
      case "extractContent":
        return `Extracting content (${params.mode || "article"})`
      case "fullPageScreenshot":
        return "Taking full page screenshot"
      case "startNetworkCapture":
        return "Starting network monitoring"
      case "stopNetworkCapture":
        return "Stopping network monitoring"
      case "getNetworkRequests":
        return "Querying network requests"
      case "clearNetworkCapture":
        return "Clearing network capture"
      case "cookies":
        return `Managing cookies (${params.action})`
      case "storage":
        return `Managing storage (${params.action})`
      case "uploadFile":
        return "Uploading file"
      default:
        return type
    }
  }

  private getWindow(): BrowserWindow | null {
    return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
  }

  private getWebContents(): Electron.WebContents | null {
    const allContents = webContents.getAllWebContents()
    return allContents.find(wc => {
      if (wc.getType() !== "webview") return false
      try {
        return wc.session === session.fromPartition("persist:browser")
      } catch {
        return false
      }
    }) || null
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Clear lock timeout
    this.clearLockTimeout()

    // Clear all pending operations
    for (const [_id, op] of this.pending) {
      clearTimeout(op.timer)
      op.reject(new Error("Browser manager shutting down"))
    }
    this.pending.clear()

    // Reset state
    this.state = {
      isReady: false,
      isOperating: false,
      isLocked: false,
      currentUrl: null,
      currentTitle: null,
      currentAction: null,
      recentActions: [],
    }

    this.removeAllListeners()
  }
}

/** Singleton instance */
export const browserManager = new BrowserManager()
