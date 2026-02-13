/**
 * Browser Sidebar Component
 * Webview-based browser for AI automation
 */

import { useEffect, useRef, useCallback, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { cn } from "@/lib/utils"
import {
  browserUrlAtomFamily,
  browserTitleAtomFamily,
  browserFaviconAtomFamily,
  browserReadyAtom,
  browserOperatingAtom,
  browserCurrentActionAtom,
  browserRecentActionsAtom,
  browserCursorPositionAtom,
  browserOverlayActiveAtom,
  browserLockedAtom,
  browserLoadingAtomFamily,
  browserActiveAtomFamily,
  browserHistoryAtomFamily,
  browserCanGoBackAtomFamily,
  browserCanGoForwardAtomFamily,
  browserSelectorActiveAtomFamily,
  browserReactGrabAvailableAtomFamily,
  browserDevToolsOpenAtomFamily,
  browserDevicePresetAtomFamily,
  browserZoomAtomFamily,
  browserPendingNavigationAtomFamily,
  ZOOM_QUICK_LEVELS,
  zoomIn as zoomInLevel,
  zoomOut as zoomOutLevel,
  DEVICE_PRESETS,
} from "./atoms"
import {
  REACT_GRAB_INJECT_SCRIPT,
  REACT_GRAB_DEACTIVATE_SCRIPT,
  REACT_GRAB_MARKERS,
  type ElementSelectionData,
} from "./react-grab-scripts"
import type { BrowserOperation, BrowserResult, SnapshotResult, CursorPosition } from "./types"
import { getWebviewScript } from "./scripts"
import { BrowserToolbar, useAddToProjectHistory } from "./browser-toolbar"
import { BrowserOverlay } from "./browser-overlay"
import { BrowserTerminalPanel } from "./browser-terminal-panel"
import { DotGrid } from "./dot-grid"

interface BrowserSidebarProps {
  chatId: string
  projectId: string
  className?: string
  /** Callback when screenshot is taken - receives base64 image data */
  onScreenshot?: (imageData: string) => void
  /** Callback when element is selected via React Grab */
  onElementSelect?: (html: string, componentName: string | null, filePath: string | null) => void
}

export function BrowserSidebar({ chatId, projectId, className, onScreenshot, onElementSelect }: BrowserSidebarProps) {
  // Debug: log mount/unmount
  useEffect(() => {
    console.log("[BrowserSidebar] Component MOUNTED, chatId:", chatId)
    return () => {
      console.log("[BrowserSidebar] Component UNMOUNTED, chatId:", chatId)
    }
  }, [chatId])

  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const [url, setUrl] = useAtom(browserUrlAtomFamily(chatId))
  const [title, setTitle] = useAtom(browserTitleAtomFamily(chatId))
  const [favicon, setFavicon] = useAtom(browserFaviconAtomFamily(chatId))
  const setReady = useSetAtom(browserReadyAtom)
  const setOperating = useSetAtom(browserOperatingAtom)
  const setCurrentAction = useSetAtom(browserCurrentActionAtom)
  const setRecentActions = useSetAtom(browserRecentActionsAtom)
  const setCursorPosition = useSetAtom(browserCursorPositionAtom)
  const [overlayActive, setOverlayActive] = useAtom(browserOverlayActiveAtom)
  const [locked, setLocked] = useAtom(browserLockedAtom)
  const [isLoading, setIsLoading] = useState(true)
  const [webviewReady, setWebviewReady] = useState(false)
  // Initial URL ref - only used for first render, prevents React from resetting webview src during navigation
  // This is critical for OAuth flows where the webview navigates through multiple URLs
  const initialUrlRef = useRef(url || "about:blank")
  // Sync loading state to atom for Globe icon indicator
  const setLoadingAtom = useSetAtom(browserLoadingAtomFamily(chatId))
  // Mark as active when URL is visited
  const setBrowserActive = useSetAtom(browserActiveAtomFamily(chatId))
  // Navigation history - persisted via atom
  const [history, setHistory] = useAtom(browserHistoryAtomFamily(chatId))
  const canGoBack = useAtomValue(browserCanGoBackAtomFamily(chatId))
  const canGoForward = useAtomValue(browserCanGoForwardAtomFamily(chatId))
  // Flag to indicate we're navigating via back/forward (don't add to history)
  const isHistoryNavigation = useRef(false)
  // Project-level history
  const addToProjectHistory = useAddToProjectHistory(projectId)
  // Ref to track current favicon for use in event handlers
  const faviconRef = useRef(favicon)
  faviconRef.current = favicon

  // React Grab state
  const [selectorActive, setSelectorActive] = useAtom(browserSelectorActiveAtomFamily(chatId))
  const setReactGrabAvailable = useSetAtom(browserReactGrabAvailableAtomFamily(chatId))

  // DevTools state
  const [devToolsOpen, setDevToolsOpen] = useAtom(browserDevToolsOpenAtomFamily(chatId))

  // Pending navigation (for external components to trigger navigation)
  const [pendingNavigation, setPendingNavigation] = useAtom(browserPendingNavigationAtomFamily(chatId))

  // Device emulation
  const [devicePresetId] = useAtom(browserDevicePresetAtomFamily(chatId))
  const currentDevice = DEVICE_PRESETS.find(d => d.id === devicePresetId) || DEVICE_PRESETS[0]
  const isEmulatingDevice = currentDevice.id !== "responsive" && currentDevice.width > 0
  const prevDeviceRef = useRef<string | null>(null)

  // Zoom level
  const [zoomLevel, setZoomLevel] = useAtom(browserZoomAtomFamily(chatId))
  const zoomLevelRef = useRef(zoomLevel)
  zoomLevelRef.current = zoomLevel

  // Track fit mode - whether we're in auto-fit mode
  const [fitMode, setFitMode] = useState(false)
  const fitModeRef = useRef(false)
  fitModeRef.current = fitMode
  // Ref for callbacks in event handlers
  const onElementSelectRef = useRef(onElementSelect)
  onElementSelectRef.current = onElementSelect
  const setSelectorActiveRef = useRef(setSelectorActive)
  setSelectorActiveRef.current = setSelectorActive
  const setReactGrabAvailableRef = useRef(setReactGrabAvailable)
  setReactGrabAvailableRef.current = setReactGrabAvailable

  // Console log buffer for MCP tool access (separate from terminal panel UI)
  interface ConsoleLogEntry {
    id: number
    level: "log" | "info" | "warn" | "error" | "debug"
    message: string
    timestamp: number
    source: string
  }
  const consoleLogsRef = useRef<ConsoleLogEntry[]>([])
  const consoleLogIdRef = useRef(0)
  // Listeners for collect mode (waiting for matching logs)
  const consoleCollectListenersRef = useRef<Array<(entry: ConsoleLogEntry) => void>>([])

  const addConsoleLog = useCallback((level: number, message: string, source: string) => {
    const levelMap: Record<number, ConsoleLogEntry["level"]> = {
      0: "debug", 1: "log", 2: "warn", 3: "error",
    }
    const entry: ConsoleLogEntry = {
      id: consoleLogIdRef.current++,
      level: levelMap[level] || "log",
      message,
      timestamp: Date.now(),
      source: source || "",
    }
    consoleLogsRef.current.push(entry)
    // Keep max 1000 entries
    if (consoleLogsRef.current.length > 1000) {
      consoleLogsRef.current = consoleLogsRef.current.slice(-1000)
    }
    // Notify collect listeners
    for (const listener of consoleCollectListenersRef.current) {
      listener(entry)
    }
  }, [])

  // Navigate to URL
  const navigate = useCallback((newUrl: string) => {
    const webview = webviewRef.current
    if (!webview) return

    // Add protocol if missing (allow file:// for local files)
    let normalizedUrl = newUrl
    // Auto-detect absolute file paths and convert to file:// URL
    if (normalizedUrl.startsWith("/") || /^[A-Z]:\\/i.test(normalizedUrl)) {
      normalizedUrl = `file://${normalizedUrl}`
    } else if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://") && !normalizedUrl.startsWith("file://")) {
      normalizedUrl = `https://${normalizedUrl}`
    }

    setUrl(normalizedUrl)
    webview.src = normalizedUrl
    setIsLoading(true)
  }, [setUrl])

  // Execute operation in webview
  /**
   * Convert webview-internal coordinates to screen (viewport/client) coordinates.
   * The overlay then uses DOMMatrix inverse to convert screen → local space,
   * which correctly handles any CSS transforms, status bar offsets, etc.
   */
  const webviewToScreenCoords = useCallback(async (x: number, y: number): Promise<{ x: number; y: number }> => {
    const webview = webviewRef.current
    if (!webview) return { x, y }

    // Get webview's DOM rect (actual rendered size on screen)
    const webviewRect = webview.getBoundingClientRect()

    // Get internal viewport size (may differ from DOM size during device emulation)
    let innerW: number, innerH: number
    try {
      const vp = await webview.executeJavaScript(`({ w: window.innerWidth, h: window.innerHeight })`)
      innerW = vp.w
      innerH = vp.h
    } catch {
      // Fallback: assume 1:1
      innerW = webviewRect.width
      innerH = webviewRect.height
    }

    // Scale: DOM pixels per internal CSS pixel
    const scaleX = webviewRect.width / innerW
    const scaleY = webviewRect.height / innerH

    // Return screen (client) coordinates — overlay will convert to local via DOMMatrix
    return {
      x: webviewRect.left + x * scaleX,
      y: webviewRect.top + y * scaleY,
    }
  }, [])

  const executeOperation = useCallback(async (
    operation: BrowserOperation
  ): Promise<BrowserResult> => {
    const webview = webviewRef.current
    if (!webview) {
      return { success: false, error: "Browser not ready" }
    }

    try {
      const { type, params } = operation

      switch (type) {
        case "snapshot": {
          const maxEl = params.maxElements as number | undefined
          const incImg = params.includeImages ?? false
          const incLink = params.includeLinks ?? false
          const result = await webview.executeJavaScript(
            `window.__browserGenerateSnapshot(${params.interactiveOnly ?? true}, ${maxEl || 0}, ${incImg}, ${incLink})`
          ) as SnapshotResult
          return { success: true, data: result }
        }

        case "navigate": {
          const waitUntil = (params.waitUntil as string) || "load"
          const timeout = (params.timeout as number) || 30000
          const startTime = Date.now()

          navigate(params.url as string)

          // "none" — return immediately
          if (waitUntil === "none") {
            return {
              success: true,
              data: {
                url: params.url as string,
                title: "",
                loadState: "complete",
                loadTime: Date.now() - startTime,
              },
            }
          }

          // Wait with timeout and strategy
          let loadState: "complete" | "timeout" | "error" = "complete"

          try {
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                cleanup()
                loadState = "timeout"
                resolve()
              }, timeout)

              const cleanup = () => {
                clearTimeout(timer)
                webview.removeEventListener("did-finish-load", onLoad)
                webview.removeEventListener("dom-ready", onDomReady)
                webview.removeEventListener("did-fail-load", onFail)
              }

              const onLoad = () => {
                if (waitUntil === "load") {
                  cleanup()
                  resolve()
                }
                // For networkidle, load fires first, then we wait for idle
                if (waitUntil === "networkidle") {
                  cleanup()
                  // Wait for network idle: no new requests for 500ms
                  let idleTimer: ReturnType<typeof setTimeout>
                  const checkIdle = () => {
                    clearTimeout(idleTimer)
                    idleTimer = setTimeout(() => resolve(), 500)
                  }
                  checkIdle()
                  // Poll for pending requests
                  const pollInterval = setInterval(async () => {
                    try {
                      const pending = await webview.executeJavaScript(
                        `performance.getEntriesByType('resource').filter(e => e.responseEnd === 0).length`
                      )
                      if (pending === 0) checkIdle()
                    } catch {
                      // ignore
                    }
                  }, 200)
                  // Safety: clear poll after remaining timeout
                  const remaining = timeout - (Date.now() - startTime)
                  setTimeout(() => {
                    clearInterval(pollInterval)
                    clearTimeout(idleTimer)
                    loadState = "timeout"
                    resolve()
                  }, Math.max(remaining, 1000))
                }
              }

              const onDomReady = () => {
                if (waitUntil === "domcontentloaded") {
                  cleanup()
                  resolve()
                }
              }

              const onFail = (event: any) => {
                // Ignore aborted loads (e.g. redirect)
                if (event?.errorCode === -3) return
                cleanup()
                loadState = "error"
                resolve()
              }

              webview.addEventListener("did-finish-load", onLoad)
              webview.addEventListener("dom-ready", onDomReady)
              webview.addEventListener("did-fail-load", onFail)
            })
          } catch {
            loadState = "error"
          }

          const loadTime = Date.now() - startTime
          let title = ""
          let finalUrl = params.url as string
          try {
            title = webview.getTitle() || ""
            finalUrl = webview.getURL() || finalUrl
          } catch {
            // ignore
          }

          return {
            success: true,
            data: {
              url: finalUrl,
              title,
              loadState,
              loadTime,
            },
          }
        }

        case "click": {
          const ref = params.ref as string
          if (ref) {
            // Get element position for cursor animation
            const rect = await webview.executeJavaScript(
              `window.__browserGetElementRect("${ref}")`
            )
            if (rect) {
              // Animate cursor to element center (converted to container space)
              const pos = await webviewToScreenCoords(rect.x + rect.width / 2, rect.y + rect.height / 2)
              setCursorPosition(pos)
              // Wait for animation
              await new Promise(r => setTimeout(r, 300))
            }
            const result = await webview.executeJavaScript(
              `window.__browserClickElement("${ref}", ${params.dblClick ?? false})`
            )
            return result
          }
          if (params.selector) {
            await webview.executeJavaScript(
              `document.querySelector("${params.selector}")?.click()`
            )
            return { success: true }
          }
          return { success: false, error: "No ref or selector provided" }
        }

        case "fill": {
          const ref = params.ref as string
          if (ref) {
            const rect = await webview.executeJavaScript(
              `window.__browserGetElementRect("${ref}")`
            )
            if (rect) {
              const pos = await webviewToScreenCoords(rect.x + rect.width / 2, rect.y + rect.height / 2)
              setCursorPosition(pos)
              await new Promise(r => setTimeout(r, 200))
            }
            const result = await webview.executeJavaScript(
              `window.__browserFillElement("${ref}", "${params.value}")`
            )
            return result
          }
          return { success: false, error: "No ref provided" }
        }

        case "type": {
          const result = await webview.executeJavaScript(
            `window.__browserTypeText("${params.text}")`
          )
          return result
        }

        case "screenshot": {
          const ref = params.ref as string
          const selector = params.selector as string
          let rect: Electron.Rectangle | undefined = undefined

          if (ref || selector) {
            const elRect = await webview.executeJavaScript(
              `window.__browserGetElementRect(${ref ? `"${ref}"` : "null"}, ${selector ? JSON.stringify(selector) : "null"})`
            )
            if (!elRect) return { success: false, error: "Element not found" }
            rect = {
              x: Math.round(elRect.x),
              y: Math.round(elRect.y),
              width: Math.round(elRect.width),
              height: Math.round(elRect.height),
            }
          }

          const image = await webview.capturePage(rect)
          const base64 = image.toPNG().toString("base64")
          return {
            success: true,
            data: {
              base64,
              width: image.getSize().width,
              height: image.getSize().height,
            },
          }
        }

        case "getElementRect": {
          const ref = params.ref as string
          const selector = params.selector as string
          const elRect = await webview.executeJavaScript(
            `window.__browserGetElementRect(${ref ? `"${ref}"` : "null"}, ${selector ? JSON.stringify(selector) : "null"})`
          )
          if (!elRect) return { success: false, error: "Element not found" }
          return {
            success: true,
            data: {
              x: Math.round(elRect.x),
              y: Math.round(elRect.y),
              width: Math.round(elRect.width),
              height: Math.round(elRect.height),
            },
          }
        }

        case "back":
          webview.goBack()
          return { success: true }

        case "forward":
          webview.goForward()
          return { success: true }

        case "reload":
          webview.reload()
          return { success: true }

        case "getUrl":
          return { success: true, data: { url: webview.getURL() } }

        case "getTitle":
          return { success: true, data: { title: webview.getTitle() } }

        case "getText": {
          const ref = params.ref as string
          const selector = params.selector as string
          if (ref || selector) {
            const result = await webview.executeJavaScript(
              `window.__browserGetText(${ref ? `"${ref}"` : "null"}, ${selector ? `"${selector}"` : "null"})`
            )
            return result
          }
          return { success: false, error: "No ref or selector provided" }
        }

        case "scroll": {
          const result = await webview.executeJavaScript(
            `window.__browserScroll(${JSON.stringify(params)})`
          )
          return result
        }

        case "wait": {
          const result = await webview.executeJavaScript(
            `window.__browserWait(${JSON.stringify(params)})`
          )
          return result
        }

        case "press": {
          const key = params.key as string
          // Parse modifier+key combinations (e.g., "Control+A", "Shift+Tab")
          const parts = key.split("+")
          const mainKey = parts.pop() || key
          const modifiers = parts.map(m => m.toLowerCase())

          const inputModifiers = {
            shift: modifiers.includes("shift"),
            control: modifiers.includes("control") || modifiers.includes("ctrl"),
            alt: modifiers.includes("alt"),
            meta: modifiers.includes("meta") || modifiers.includes("cmd") || modifiers.includes("command"),
          }

          // Send modifier key downs first
          for (const mod of modifiers) {
            const modKey = mod === "ctrl" ? "Control" : mod === "cmd" || mod === "command" ? "Meta" : mod.charAt(0).toUpperCase() + mod.slice(1)
            webview.sendInputEvent({ type: "keyDown", keyCode: modKey, ...inputModifiers })
          }

          webview.sendInputEvent({ type: "keyDown", keyCode: mainKey, ...inputModifiers })
          webview.sendInputEvent({ type: "keyUp", keyCode: mainKey, ...inputModifiers })

          // Release modifiers in reverse
          for (const mod of [...modifiers].reverse()) {
            const modKey = mod === "ctrl" ? "Control" : mod === "cmd" || mod === "command" ? "Meta" : mod.charAt(0).toUpperCase() + mod.slice(1)
            webview.sendInputEvent({ type: "keyUp", keyCode: modKey })
          }

          return { success: true }
        }

        case "select": {
          const ref = params.ref as string
          if (ref) {
            const result = await webview.executeJavaScript(
              `window.__browserSelectOption("${ref}", "${params.value}")`
            )
            return result
          }
          return { success: false, error: "No ref provided" }
        }

        case "check": {
          const ref = params.ref as string
          if (ref) {
            const result = await webview.executeJavaScript(
              `window.__browserCheck("${ref}", ${params.checked})`
            )
            return result
          }
          return { success: false, error: "No ref provided" }
        }

        case "hover": {
          const ref = params.ref as string
          if (ref) {
            const rect = await webview.executeJavaScript(
              `window.__browserGetElementRect("${ref}")`
            )
            if (rect) {
              // 1. Animate cursor to element center (converted to container space)
              const cx = rect.x + rect.width / 2
              const cy = rect.y + rect.height / 2
              const pos = await webviewToScreenCoords(cx, cy)
              setCursorPosition(pos)
              await new Promise(r => setTimeout(r, 300))
              // 2. Send real mouseMove event to trigger CSS :hover
              webview.sendInputEvent({
                type: "mouseMove",
                x: Math.round(cx),
                y: Math.round(cy),
              })
            }
            // 3. Also dispatch JS mouse events via injected script
            const result = await webview.executeJavaScript(
              `window.__browserHover("${ref}")`
            )
            return result
          }
          return { success: false, error: "No ref provided" }
        }

        case "drag": {
          const result = await webview.executeJavaScript(
            `window.__browserDrag(${JSON.stringify({
              fromRef: params.fromRef,
              fromSelector: params.fromSelector,
              toRef: params.toRef,
              toSelector: params.toSelector,
            })})`
          )
          return result
        }

        case "downloadImage": {
          const imgRef = params.ref as string | undefined
          const imgSelector = params.selector as string | undefined
          // Get image source URL from webview
          const imgResult = await webview.executeJavaScript(
            `window.__browserDownloadImage(${imgRef ? `"${imgRef}"` : "null"}, ${imgSelector ? `"${imgSelector}"` : "null"})`
          )
          if (!imgResult.success) return imgResult
          // Download via main process
          const imgSrc = imgResult.data?.src
          if (!imgSrc) return { success: false, error: "No image source found" }
          return { success: true, data: { src: imgSrc, filePath: params.filePath } }
        }

        case "downloadFile": {
          const fileUrl = params.url as string
          const fileRef = params.ref as string | undefined
          let downloadUrl = fileUrl
          if (!downloadUrl && fileRef) {
            // Get href/src from element
            const href = await webview.executeJavaScript(
              `(function() { const el = window.__browserRefMap.get("${fileRef}"); return el ? (el.href || el.src || el.getAttribute("href") || el.getAttribute("src")) : null; })()`
            )
            if (href) downloadUrl = href
          }
          if (!downloadUrl) return { success: false, error: "No URL to download" }
          // Fetch in webview context (carries cookies/session)
          const fetchResult = await webview.executeJavaScript(
            `window.__browserFetchResource(${JSON.stringify(downloadUrl)}, 50)`
          )
          if (!fetchResult.success) return fetchResult
          return {
            success: true,
            data: {
              base64: fetchResult.data.base64,
              contentType: fetchResult.data.contentType,
              filename: fetchResult.data.filename,
              size: fetchResult.data.size,
            },
          }
        }

        case "emulate": {
          // Device emulation is handled via the device preset system
          // The MCP tool can set viewport, userAgent, colorScheme, geolocation
          const viewport = params.viewport as { width: number; height: number; isMobile?: boolean; hasTouch?: boolean; deviceScaleFactor?: number } | undefined
          if (viewport) {
            await window.desktopApi.browserSetDeviceEmulation({
              screenWidth: viewport.width,
              screenHeight: viewport.height,
              viewWidth: viewport.width,
              viewHeight: viewport.height,
              deviceScaleFactor: viewport.deviceScaleFactor || 1,
              isMobile: viewport.isMobile || false,
              hasTouch: viewport.hasTouch || false,
              userAgent: (params.userAgent as string) || "",
            })
          }
          // Color scheme emulation via CSS media
          const colorScheme = params.colorScheme as string | undefined
          if (colorScheme && colorScheme !== "auto") {
            await webview.executeJavaScript(
              `document.documentElement.style.colorScheme = "${colorScheme}"`
            )
          }
          return { success: true }
        }

        case "evaluate": {
          // Safe JS executor that handles all input forms:
          //   1. Expression:       "document.title"
          //   2. Function literal:  "() => { return x; }" or "(el) => el.src"
          //   3. Multi-statement:   "const x = 1; x + 2"
          //   4. Statements w/return: "const x = 1; return x;"
          // Also ensures the return value is structured-clone-safe and catches errors.
          const userScript = (params.script as string).trim()

          // Strategy: inject a helper `__evalSafe` into the page and call it with the raw script.
          // This avoids any template-level syntax issues from embedding user code in a template string.
          const wrappedScript = `(async () => {
            const __src = ${JSON.stringify(userScript)};
            try {
              let __result;
              // Step 1: Detect function literal and invoke it
              if (/^(?:async\\s+)?(?:function\\b|\\(|[a-zA-Z_$]\\w*\\s*=>)/.test(__src)) {
                __result = await eval('(' + __src + ')()');
              } else {
                // Step 2: Try as expression first (handles "document.title", "1+2", etc.)
                try {
                  __result = await eval('(' + __src + ')');
                } catch(_) {
                  // Step 3: Fall back to statements (handles "const x=1; x+2" or "return x")
                  // Wrap in async function to support return statements
                  try {
                    __result = await eval('(async function(){ ' + __src + ' })()');
                  } catch(_2) {
                    // Step 4: If no explicit return, wrap last expression
                    __result = await eval(__src);
                  }
                }
              }
              // Ensure result is serializable (no DOM nodes, functions, etc.)
              try {
                if (__result === undefined) return { __ok: true, value: undefined };
                if (__result === null) return { __ok: true, value: null };
                const s = JSON.parse(JSON.stringify(__result));
                return { __ok: true, value: s };
              } catch(e) {
                return { __ok: true, value: String(__result) };
              }
            } catch (e) {
              return {
                __ok: false,
                name: e.name || 'Error',
                message: e.message || String(e),
                stack: e.stack || ''
              };
            }
          })()`
          try {
            const wrapped = await webview.executeJavaScript(wrappedScript)
            if (wrapped && wrapped.__ok === false) {
              const details = [
                `${wrapped.name}: ${wrapped.message}`,
                wrapped.stack ? `\nStack:\n${wrapped.stack}` : "",
              ].join("")
              return { success: false, error: details }
            }
            return { success: true, data: { result: wrapped?.value } }
          } catch (err) {
            // Fallback for wrapper-level failures
            const e = err instanceof Error ? err : new Error(String(err))
            return { success: false, error: `${e.name}: ${e.message}` }
          }
        }

        case "querySelector": {
          const selector = params.selector as string
          if (!selector) return { success: false, error: "No selector provided" }
          const result = await webview.executeJavaScript(
            `window.__browserQuerySelector(${JSON.stringify(selector)})`
          )
          return result
        }

        case "getAttribute": {
          const attrRef = params.ref as string | undefined
          const attrSelector = params.selector as string | undefined
          const attribute = params.attribute as string | undefined
          if (!attrRef && !attrSelector) return { success: false, error: "ref or selector required" }
          const result = await webview.executeJavaScript(
            `window.__browserGetAttribute(${attrRef ? `"${attrRef}"` : "null"}, ${attrSelector ? JSON.stringify(attrSelector) : "null"}, ${attribute ? JSON.stringify(attribute) : "null"})`
          )
          return result
        }

        case "extractContent": {
          const ecRef = params.ref as string | undefined
          const ecSelector = params.selector as string | undefined
          const ecMode = (params.mode as string) || "article"
          const result = await webview.executeJavaScript(
            `window.__browserExtractHTML(${ecRef ? `"${ecRef}"` : "null"}, ${ecSelector ? JSON.stringify(ecSelector) : "null"}, ${JSON.stringify(ecMode)})`
          )
          return result
        }

        case "fullPageScreenshot": {
          // Get page dimensions
          const dims = await webview.executeJavaScript(
            `window.__browserGetPageDimensions()`
          ) as { scrollWidth: number; scrollHeight: number; viewportWidth: number; viewportHeight: number; scrollX: number; scrollY: number }

          const originalScrollX = dims.scrollX
          const originalScrollY = dims.scrollY
          const vpHeight = dims.viewportHeight
          const totalHeight = dims.scrollHeight
          const maxSegments = 30

          const segmentCount = Math.min(Math.ceil(totalHeight / vpHeight), maxSegments)
          const segments: string[] = []

          // Hide fixed/sticky elements to prevent duplication
          await webview.executeJavaScript(`window.__browserHideFixedElements()`)

          try {
            for (let i = 0; i < segmentCount; i++) {
              await webview.executeJavaScript(`window.__browserScrollTo(0, ${i * vpHeight})`)
              // Wait for rendering
              await new Promise(r => setTimeout(r, 150))
              const image = await webview.capturePage()
              segments.push(image.toPNG().toString("base64"))
            }
          } finally {
            // Restore fixed elements and scroll position
            await webview.executeJavaScript(`window.__browserRestoreFixedElements()`)
            await webview.executeJavaScript(`window.__browserScrollTo(${originalScrollX}, ${originalScrollY})`)
          }

          return {
            success: true,
            data: {
              segments,
              viewportWidth: dims.viewportWidth,
              viewportHeight: vpHeight,
              totalHeight,
              segmentCount,
            },
          }
        }

        case "downloadBatch": {
          const items = params.items as Array<{
            ref?: string; url?: string; selector?: string;
            filePath: string; attribute?: string;
          }>
          const options = (params.options || {}) as {
            retry?: number; timeout?: number;
            continueOnError?: boolean; concurrent?: number;
          }
          const concurrent = options.concurrent || 3
          const maxRetry = options.retry || 0
          const timeout = options.timeout || 30000
          const continueOnError = options.continueOnError !== false

          const startTime = Date.now()
          const results: Array<{
            input: { ref?: string; url?: string; selector?: string };
            status: "success" | "failed";
            filePath?: string; size?: number; url?: string;
            mimeType?: string; error?: string; retries?: number;
          }> = []

          // Worker function for a single item
          const downloadOne = async (item: typeof items[0]) => {
            const input = { ref: item.ref, url: item.url, selector: item.selector }
            let downloadUrl = item.url

            // Resolve URL from element if not provided directly
            if (!downloadUrl) {
              const urlResult = await webview.executeJavaScript(
                `window.__browserGetDownloadUrl(${item.ref ? `"${item.ref}"` : "null"}, ${item.selector ? JSON.stringify(item.selector) : "null"}, ${item.attribute ? JSON.stringify(item.attribute) : "null"})`
              )
              if (!urlResult.success) {
                return { input, status: "failed" as const, error: urlResult.error, retries: 0 }
              }
              downloadUrl = urlResult.data.url
            }

            // Retry loop
            let lastError = ""
            for (let attempt = 0; attempt <= maxRetry; attempt++) {
              try {
                const fetchResult = await Promise.race([
                  webview.executeJavaScript(
                    `window.__browserFetchResource(${JSON.stringify(downloadUrl)}, 50)`
                  ),
                  new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Download timeout after ${timeout}ms`)), timeout)
                  ),
                ]) as { success: boolean; data?: { base64: string; contentType: string; filename: string; size: number }; error?: string }

                if (fetchResult.success && fetchResult.data) {
                  return {
                    input,
                    status: "success" as const,
                    base64: fetchResult.data.base64,
                    size: fetchResult.data.size,
                    url: downloadUrl,
                    mimeType: fetchResult.data.contentType,
                    filePath: item.filePath,
                  }
                }
                lastError = fetchResult.error || "Unknown fetch error"
              } catch (err) {
                lastError = err instanceof Error ? err.message : String(err)
              }
            }
            return { input, status: "failed" as const, error: lastError, retries: maxRetry }
          }

          // Concurrent download with pool
          const queue = [...items]
          const allResults: Array<Awaited<ReturnType<typeof downloadOne>>> = []

          const worker = async () => {
            while (queue.length > 0) {
              const item = queue.shift()!
              const result = await downloadOne(item)
              allResults.push(result)
              if (result.status === "failed" && !continueOnError) {
                queue.length = 0 // drain queue
              }
            }
          }

          await Promise.all(
            Array(Math.min(concurrent, items.length)).fill(null).map(() => worker())
          )

          // Build results (strip base64 from final output)
          let totalSize = 0
          for (const r of allResults) {
            if (r.status === "success") {
              totalSize += r.size || 0
              results.push({
                input: r.input,
                status: "success",
                filePath: r.filePath,
                size: r.size,
                url: r.url,
                mimeType: r.mimeType,
              })
            } else {
              results.push({
                input: r.input,
                status: "failed",
                error: r.error,
                retries: r.retries,
              })
            }
          }

          const duration = Date.now() - startTime
          const successful = results.filter(r => r.status === "success").length

          return {
            success: true,
            data: {
              summary: {
                total: items.length,
                successful,
                failed: items.length - successful,
                totalSize,
                duration,
              },
              results,
              // Pass base64 data for main process to write files
              _writeQueue: allResults
                .filter(r => r.status === "success" && (r as any).base64)
                .map(r => ({
                  filePath: (r as any).filePath,
                  base64: (r as any).base64,
                })),
            },
          }
        }

        case "storage": {
          const { type, action, key, value } = params as any
          const result = await webview.executeJavaScript(
            `window.__browserStorage("${type}", "${action}", ${key ? JSON.stringify(key) : "null"}, ${value ? JSON.stringify(value) : "null"})`
          )
          return result
        }

        case "getSelector": {
          const { ref } = params as any
          const result = await webview.executeJavaScript(
            `window.__browserGetSelector("${ref}")`
          )
          return result
        }

        case "consoleQuery": {
          const filters = (params.filters || {}) as {
            levels?: string[]; textPattern?: string;
            sourcePattern?: string; minTimestamp?: number;
          }
          const limit = (params.limit as number) || 50
          const offset = (params.offset as number) || 0

          let logs = [...consoleLogsRef.current]

          // Apply filters
          if (filters.levels && filters.levels.length > 0) {
            logs = logs.filter(l => filters.levels!.includes(l.level))
          }
          if (filters.textPattern) {
            try {
              const re = new RegExp(filters.textPattern, "i")
              logs = logs.filter(l => re.test(l.message))
            } catch { /* invalid regex, skip */ }
          }
          if (filters.sourcePattern) {
            try {
              const re = new RegExp(filters.sourcePattern, "i")
              logs = logs.filter(l => re.test(l.source))
            } catch { /* invalid regex, skip */ }
          }
          if (filters.minTimestamp) {
            logs = logs.filter(l => l.timestamp >= filters.minTimestamp!)
          }

          const total = logs.length
          const sliced = logs.slice(offset, offset + limit)

          return {
            success: true,
            data: {
              action: "query",
              logs: sliced,
              total,
              returned: sliced.length,
              hasMore: offset + limit < total,
            },
          }
        }

        case "consoleCollect": {
          const filters = (params.filters || {}) as {
            levels?: string[]; textPattern?: string;
            sourcePattern?: string;
          }
          const count = (params.count as number) || 1
          const timeout = (params.timeout as number) || 30000

          const matchesFilter = (entry: typeof consoleLogsRef.current[0]) => {
            if (filters.levels && filters.levels.length > 0 && !filters.levels.includes(entry.level)) return false
            if (filters.textPattern) {
              try { if (!new RegExp(filters.textPattern, "i").test(entry.message)) return false } catch { return false }
            }
            if (filters.sourcePattern) {
              try { if (!new RegExp(filters.sourcePattern, "i").test(entry.source)) return false } catch { return false }
            }
            return true
          }

          const startTime = Date.now()
          const collected: typeof consoleLogsRef.current = []

          const result = await new Promise<{
            collected: typeof consoleLogsRef.current; timedOut: boolean;
          }>((resolve) => {
            const timer = setTimeout(() => {
              cleanup()
              resolve({ collected, timedOut: true })
            }, timeout)

            const listener = (entry: typeof consoleLogsRef.current[0]) => {
              if (matchesFilter(entry)) {
                collected.push(entry)
                if (collected.length >= count) {
                  cleanup()
                  resolve({ collected, timedOut: false })
                }
              }
            }

            const cleanup = () => {
              clearTimeout(timer)
              const idx = consoleCollectListenersRef.current.indexOf(listener)
              if (idx >= 0) consoleCollectListenersRef.current.splice(idx, 1)
            }

            consoleCollectListenersRef.current.push(listener)
          })

          return {
            success: true,
            data: {
              action: "collect",
              logs: result.collected,
              collected: result.collected.length,
              requested: count,
              timedOut: result.timedOut,
              waitTime: Date.now() - startTime,
            },
          }
        }

        case "consoleClear": {
          const filters = (params.filters || {}) as { levels?: string[] }

          if (filters.levels && filters.levels.length > 0) {
            const before = consoleLogsRef.current.length
            consoleLogsRef.current = consoleLogsRef.current.filter(
              l => !filters.levels!.includes(l.level)
            )
            const cleared = before - consoleLogsRef.current.length
            return {
              success: true,
              data: { action: "clear", cleared, remaining: consoleLogsRef.current.length },
            }
          }

          const cleared = consoleLogsRef.current.length
          consoleLogsRef.current = []
          return {
            success: true,
            data: { action: "clear", cleared, remaining: 0 },
          }
        }

        default:
          return { success: false, error: `Unknown operation: ${type}` }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }, [navigate, setCursorPosition, webviewToScreenCoords])

  // Listen for browser lock state changes from main process
  useEffect(() => {
    if (!window.desktopApi.onBrowserLockStateChanged) return
    const cleanup = window.desktopApi.onBrowserLockStateChanged((isLocked: boolean) => {
      setLocked(isLocked)
      setOverlayActive(isLocked)
    })
    return cleanup
  }, [setLocked, setOverlayActive])

  // Listen for auth loop detection from main process
  useEffect(() => {
    if (!window.desktopApi.onBrowserAuthLoopDetected) return
    const cleanup = window.desktopApi.onBrowserAuthLoopDetected((loopUrl: string) => {
      console.warn("[BrowserSidebar] Auth loop detected:", loopUrl)
      // Import toast dynamically to avoid adding to component imports
      import("sonner").then(({ toast }) => {
        toast.error("检测到认证循环，请在外部浏览器中完成登录", {
          description: "该网站的认证流程需要在系统浏览器中完成",
          duration: 8000,
          action: {
            label: "在浏览器中打开",
            onClick: () => window.desktopApi.openExternal(loopUrl),
          },
        })
      })
    })
    return cleanup
  }, [])

  // Listen for operations from main process
  useEffect(() => {
    const cleanup = window.desktopApi.onBrowserExecute(async (operation) => {
      setOperating(true)
      setCurrentAction(formatAction(operation.type, operation.params))
      // Only activate overlay per-operation if not in locked mode
      if (!locked) {
        setOverlayActive(true)
      }

      const result = await executeOperation(operation)

      // Send result back to main process
      window.desktopApi.browserResult(operation.id, result)

      setOperating(false)
      setCurrentAction(null)

      // Add to recent actions
      setRecentActions((prev) => [
        {
          id: operation.id,
          type: operation.type,
          summary: formatAction(operation.type, operation.params),
          timestamp: Date.now(),
        },
        ...prev.slice(0, 4),
      ])

      // Only hide overlay per-operation if not in locked mode
      if (!locked) {
        setTimeout(() => setOverlayActive(false), 500)
      }
    })

    return cleanup
  }, [executeOperation, setOperating, setCurrentAction, setOverlayActive, setRecentActions, locked])

  // Add URL to navigation history (called after navigation completes)
  const addToHistory = useCallback((newUrl: string) => {
    // Skip if this is a back/forward navigation
    if (isHistoryNavigation.current) {
      isHistoryNavigation.current = false
      return
    }
    // Skip about:blank
    if (!newUrl || newUrl === "about:blank") return

    setHistory(prev => {
      // If this URL is the same as current, skip
      if (prev.urls[prev.index] === newUrl) return prev
      // Truncate forward history and add new URL
      const newUrls = [...prev.urls.slice(0, prev.index + 1), newUrl]
      return { urls: newUrls, index: newUrls.length - 1 }
    })
  }, [setHistory])

  // Setup webview event handlers
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleDomReady = () => {
      console.log("[BrowserSidebar] dom-ready event fired")
      // Inject our scripts
      webview.executeJavaScript(getWebviewScript())
      setWebviewReady(true)
      setReady(true)
      console.log("[BrowserSidebar] Sending browserReady(true) to main process")
      window.desktopApi.browserReady(true)
    }

    const handleDidFinishLoad = async () => {
      setIsLoading(false)
      setLoadingAtom(false)  // Sync to atom for Globe icon
      // Update URL from webview (but don't overwrite with about:blank)
      const currentUrl = webview.getURL()
      if (currentUrl && currentUrl !== "about:blank") {
        setUrl(currentUrl)
        window.desktopApi.browserUrlChanged(currentUrl)
        // Add to navigation history
        addToHistory(currentUrl)
        // Mark browser as active (has visited a URL)
        setBrowserActive(true)
      }

      // Re-apply zoom on page load (especially for auto-fit mode)
      if (fitModeRef.current) {
        try {
          const container = webview.parentElement
          if (container) {
            const containerWidth = container.clientWidth
            const pageWidth = await webview.executeJavaScript("document.documentElement.scrollWidth") as number

            if (pageWidth > 0 && containerWidth > 0) {
              const newZoom = (containerWidth / pageWidth) * 0.95
              const clamped = Math.max(0.25, Math.min(5.0, newZoom))
              setZoomLevel(clamped)
            }
          }
        } catch (error) {
          console.error("[BrowserSidebar] Failed to re-apply fit width:", error)
        }
      }

      // Update page title
      let pageTitle = ""
      try {
        pageTitle = webview.getTitle() || ""
        setTitle(pageTitle)
        window.desktopApi.browserTitleChanged(pageTitle)
      } catch {
        setTitle("")
      }

      // Update favicon - extract from page as fallback (page-favicon-updated event is primary)
      // Only extract if favicon wasn't already set by the event
      let faviconUrl = faviconRef.current // Use existing favicon from ref (may have been set by event)
      if (!faviconUrl) {
        try {
          faviconUrl = await webview.executeJavaScript(`
            (function() {
              // Try multiple favicon selectors in order of preference
              const selectors = [
                'link[rel="icon"][type="image/png"]',
                'link[rel="icon"][type="image/x-icon"]',
                'link[rel="icon"][type="image/svg+xml"]',
                'link[rel="icon"]',
                'link[rel="shortcut icon"]',
                'link[rel="apple-touch-icon"]',
                'link[rel="apple-touch-icon-precomposed"]',
                'link[rel*="icon"]'
              ];

              for (const selector of selectors) {
                const link = document.querySelector(selector);
                if (link && link.href) {
                  return link.href;
                }
              }

              // Fallback to /favicon.ico
              return new URL('/favicon.ico', window.location.origin).href;
            })()
          `) || ""
          if (faviconUrl) {
            setFavicon(faviconUrl)
          }
        } catch {
          // Keep existing favicon if extraction fails
        }
      }

      // Add to project-level history (for history dropdown)
      if (currentUrl && currentUrl !== "about:blank") {
        addToProjectHistory({
          url: currentUrl,
          title: pageTitle,
          favicon: faviconUrl,
        })
      }
    }

    const handleDidStartLoading = () => {
      setIsLoading(true)
      setLoadingAtom(true)  // Sync to atom for Globe icon
    }

    const handleDidNavigate = () => {
      const currentUrl = webview.getURL()
      // Don't overwrite URL state with about:blank
      if (currentUrl && currentUrl !== "about:blank") {
        setUrl(currentUrl)
        window.desktopApi.browserUrlChanged(currentUrl)
      }
    }

    // Handle load failures (e.g., ERR_ABORTED during OAuth redirects)
    const handleDidFailLoad = (event: Electron.DidFailLoadEvent) => {
      const { errorCode, errorDescription, validatedURL } = event
      // ERR_ABORTED (-3) is common during rapid redirects (OAuth flows)
      // Don't show error for these as they're usually not user-visible issues
      if (errorCode === -3) {
        console.log("[BrowserSidebar] Navigation aborted (likely redirect):", validatedURL)
        // Still stop loading indicator
        setIsLoading(false)
        setLoadingAtom(false)
        return
      }
      console.error("[BrowserSidebar] Page load failed:", errorCode, errorDescription, validatedURL)
      setIsLoading(false)
      setLoadingAtom(false)
    }

    // Note: new-window events are handled by main process setWindowOpenHandler
    // which intercepts and redirects to same-page navigation via loadURL

    // Handle favicon changes via Electron's page-favicon-updated event
    const handleFaviconUpdated = (event: Electron.Event & { favicons: string[] }) => {
      const favicons = event.favicons
      if (favicons && favicons.length > 0) {
        // Use the first (usually best) favicon
        setFavicon(favicons[0])
      }
    }

    // Handle console messages from webview (for React Grab element selection, status, and MCP log buffer)
    const handleConsoleMessage = (event: Electron.ConsoleMessageEvent) => {
      const message = event.message

      // Buffer all console messages for MCP tool access
      addConsoleLog(event.level, message, (event as any).sourceId || "")

      // React Grab ready signal
      if (message === REACT_GRAB_MARKERS.READY) {
        console.log("[BrowserSidebar] React Grab is ready")
        setReactGrabAvailableRef.current?.(true)
        return
      }

      // React Grab unavailable signal
      if (message === REACT_GRAB_MARKERS.UNAVAILABLE) {
        console.log("[BrowserSidebar] React Grab is unavailable")
        setReactGrabAvailableRef.current?.(false)
        // Deactivate selector if it was active
        setSelectorActiveRef.current?.(false)
        return
      }

      // Element selection
      if (message.startsWith(REACT_GRAB_MARKERS.ELEMENT_SELECTED)) {
        console.log("[BrowserSidebar] Element selected, parsing...")
        try {
          const jsonStr = message.slice(REACT_GRAB_MARKERS.ELEMENT_SELECTED.length)
          const data = JSON.parse(jsonStr) as ElementSelectionData
          console.log("[BrowserSidebar] Parsed element:", {
            componentName: data.componentName,
            filePath: data.filePath,
            htmlLength: data.html?.length,
            hasCallback: !!onElementSelectRef.current,
          })

          // Call the element select callback
          const callback = onElementSelectRef.current
          if (callback) {
            console.log("[BrowserSidebar] Calling onElementSelect callback")
            callback(data.html, data.componentName, data.filePath)
          }

          // Deactivate selector mode after selection
          setSelectorActiveRef.current?.(false)
          webview.executeJavaScript(REACT_GRAB_DEACTIVATE_SCRIPT).catch(() => {
            // Ignore errors
          })
        } catch (err) {
          console.error("[BrowserSidebar] Failed to parse element selection:", err)
        }
      }
    }

    webview.addEventListener("dom-ready", handleDomReady)
    webview.addEventListener("did-finish-load", handleDidFinishLoad)
    webview.addEventListener("did-start-loading", handleDidStartLoading)
    webview.addEventListener("did-navigate", handleDidNavigate)
    webview.addEventListener("did-navigate-in-page", handleDidNavigate)
    webview.addEventListener("did-fail-load", handleDidFailLoad as any)
    webview.addEventListener("page-favicon-updated", handleFaviconUpdated as any)
    webview.addEventListener("console-message", handleConsoleMessage)

    return () => {
      webview.removeEventListener("dom-ready", handleDomReady)
      webview.removeEventListener("did-finish-load", handleDidFinishLoad)
      webview.removeEventListener("did-start-loading", handleDidStartLoading)
      webview.removeEventListener("did-navigate", handleDidNavigate)
      webview.removeEventListener("did-navigate-in-page", handleDidNavigate)
      webview.removeEventListener("did-fail-load", handleDidFailLoad as any)
      webview.removeEventListener("page-favicon-updated", handleFaviconUpdated as any)
      webview.removeEventListener("console-message", handleConsoleMessage)
      setWebviewReady(false)
      setReady(false)
      window.desktopApi.browserReady(false)
    }
  }, [setReady, setUrl, setTitle, setFavicon, addToHistory, setLoadingAtom, setBrowserActive])

  // Restore persisted URL when webview is ready
  // This handles the case where atomWithStorage hydrates after mount
  const hasRestoredUrl = useRef(false)
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !webviewReady) return
    // Only restore once, and only if we have a persisted URL
    if (hasRestoredUrl.current) return
    if (!url || url === "about:blank") return

    // Check if webview is on about:blank and we have a URL to restore
    const currentSrc = webview.getURL?.() || webview.src
    if (currentSrc === "about:blank" || !currentSrc) {
      hasRestoredUrl.current = true
      webview.src = url
    }
  }, [webviewReady, url])

  // Handle pending navigation from external components (e.g., file preview opening HTML files)
  useEffect(() => {
    if (!pendingNavigation || !webviewReady) return

    // Navigate to the pending URL
    navigate(pendingNavigation)

    // Clear the pending navigation
    setPendingNavigation(null)
  }, [pendingNavigation, webviewReady, navigate, setPendingNavigation])

  // Update project history when favicon changes (may arrive after did-finish-load)
  useEffect(() => {
    if (!favicon || !url || url === "about:blank") return
    // Update the favicon in project history for this URL
    addToProjectHistory({
      url,
      title: title || "",
      favicon,
    })
  }, [favicon]) // Only re-run when favicon changes

  // Apply device emulation when device preset changes
  useEffect(() => {
    if (!webviewReady) return
    const webview = webviewRef.current
    if (!webview) return

    // Skip if device hasn't changed (but always apply on first ready)
    const isFirstApply = prevDeviceRef.current === null
    if (!isFirstApply && prevDeviceRef.current === devicePresetId) return
    prevDeviceRef.current = devicePresetId

    // Check if we have a valid URL to reload after emulation change
    const currentUrl = webview.getURL?.() || ""
    const shouldReload = !isFirstApply && currentUrl && currentUrl !== "about:blank"

    if (currentDevice.id === "responsive" || currentDevice.width === 0) {
      // Disable device emulation (only if not first apply with responsive - nothing to disable)
      if (!isFirstApply) {
        window.desktopApi.browserSetDeviceEmulation(null)
          .then(() => {
            // Reload to apply new user agent
            if (shouldReload && webview.reload) {
              webview.reload()
            }
          })
          .catch((err) => {
            console.error("[BrowserSidebar] Failed to disable device emulation:", err)
          })
      }
    } else {
      // Enable device emulation with device-specific settings
      const defaultUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
      window.desktopApi.browserSetDeviceEmulation({
        screenWidth: currentDevice.width,
        screenHeight: currentDevice.height,
        viewWidth: currentDevice.width,
        viewHeight: currentDevice.height,
        deviceScaleFactor: currentDevice.deviceScaleFactor || 1,
        isMobile: currentDevice.isMobile || false,
        hasTouch: currentDevice.hasTouch || false,
        userAgent: currentDevice.userAgent || defaultUA,
      })
        .then(() => {
          // Reload to apply new user agent and viewport settings
          if (shouldReload && webview.reload) {
            webview.reload()
          }
        })
        .catch((err) => {
          console.error("[BrowserSidebar] Failed to enable device emulation:", err)
        })
    }
  }, [webviewReady, devicePresetId, currentDevice])

  // Handle toolbar actions - use manual history for back/forward
  const handleBack = useCallback(() => {
    if (!canGoBack) return
    const webview = webviewRef.current
    if (!webview || !webviewReady) return

    const prevUrl = history.urls[history.index - 1]
    if (prevUrl) {
      isHistoryNavigation.current = true
      setHistory(prev => ({ ...prev, index: prev.index - 1 }))
      webview.src = prevUrl
    }
  }, [canGoBack, history, setHistory, webviewReady])

  const handleForward = useCallback(() => {
    if (!canGoForward) return
    const webview = webviewRef.current
    if (!webview || !webviewReady) return

    const nextUrl = history.urls[history.index + 1]
    if (nextUrl) {
      isHistoryNavigation.current = true
      setHistory(prev => ({ ...prev, index: prev.index + 1 }))
      webview.src = nextUrl
    }
  }, [canGoForward, history, setHistory, webviewReady])

  const handleReload = useCallback(() => {
    const webview = webviewRef.current
    if (webview && webviewReady && typeof webview.reload === "function") {
      webview.reload()
    }
  }, [webviewReady])

  const handleStop = useCallback(() => {
    const webview = webviewRef.current
    if (webview && webviewReady && typeof webview.stop === "function") {
      webview.stop()
      setIsLoading(false)
    }
  }, [webviewReady])

  const handleNavigate = useCallback((newUrl: string) => {
    navigate(newUrl)
  }, [navigate])

  // Open current URL in external browser
  const handleOpenExternal = useCallback(() => {
    if (url && url !== "about:blank") {
      window.desktopApi.openExternal(url)
    }
  }, [url])

  // Take screenshot and send to chat
  const handleScreenshot = useCallback(async () => {
    const webview = webviewRef.current
    if (!webview || !webviewReady) return

    try {
      // Use webview's capturePage API
      const image = await webview.capturePage()
      const dataUrl = image.toDataURL()
      onScreenshot?.(dataUrl)
    } catch (error) {
      console.error("Failed to take screenshot:", error)
    }
  }, [webviewReady, onScreenshot])

  // Clear browser cache and cookies via main process IPC
  const handleClearCache = useCallback(async () => {
    try {
      const success = await window.desktopApi.browserClearCache()
      if (!success) {
        console.error("Failed to clear cache: main process returned false")
        return
      }

      // Reload to apply changes
      const webview = webviewRef.current
      if (webview && webviewReady && typeof webview.reload === "function") {
        webview.reload()
      }
    } catch (error) {
      console.error("Failed to clear cache:", error)
    }
  }, [webviewReady])

  // Toggle DevTools for webview
  const handleToggleDevTools = useCallback(() => {
    const webview = webviewRef.current
    if (!webview || !webviewReady) return
    try {
      if (devToolsOpen) {
        ;(webview as any).closeDevTools()
        setDevToolsOpen(false)
      } else {
        ;(webview as any).openDevTools()
        setDevToolsOpen(true)
      }
    } catch (error) {
      console.error("Failed to toggle DevTools:", error)
    }
  }, [webviewReady, devToolsOpen, setDevToolsOpen])

  // Toggle React Grab element selector
  const handleToggleReactGrab = useCallback(() => {
    const webview = webviewRef.current
    if (!webview || !webviewReady) return

    if (selectorActive) {
      setSelectorActive(false)
      webview.executeJavaScript(REACT_GRAB_DEACTIVATE_SCRIPT).catch(() => {
        // Ignore errors
      })
    } else {
      setSelectorActive(true)
      webview.executeJavaScript(REACT_GRAB_INJECT_SCRIPT).catch((err) => {
        console.error("[BrowserSidebar] Failed to inject selector script:", err)
        setSelectorActive(false)
      })
    }
  }, [selectorActive, setSelectorActive, webviewReady])

  // Handle zoom controls - apply actual page zoom via CSS transform on body
  const handleZoomIn = useCallback(() => {
    const nextZoom = zoomInLevel(zoomLevelRef.current)
    setZoomLevel(nextZoom)
  }, [setZoomLevel])

  const handleZoomOut = useCallback(() => {
    const prevZoom = zoomOutLevel(zoomLevelRef.current)
    setZoomLevel(prevZoom)
  }, [setZoomLevel])

  const handleZoomReset = useCallback(() => {
    setZoomLevel(1.0)
  }, [setZoomLevel])

  // Fit to width - toggle auto-fit mode or reset to 100%
  const handleFitWidth = useCallback(async () => {
    const webview = webviewRef.current
    if (!webview || !webviewReady) return

    if (fitModeRef.current) {
      // If already in fit mode, reset to 100%
      setFitMode(false)
      setZoomLevel(1.0)
      return
    }

    try {
      // Get webview container's available width
      const container = webview.parentElement
      if (!container) return

      const containerWidth = container.clientWidth

      // Get actual page width (scrollWidth represents full content width)
      const pageWidth = await webview.executeJavaScript("document.documentElement.scrollWidth") as number

      if (pageWidth > 0 && containerWidth > 0) {
        // Calculate zoom to fit width (use 95% for some margin)
        const newZoom = (containerWidth / pageWidth) * 0.95
        // Clamp to reasonable range
        const clamped = Math.max(0.25, Math.min(5.0, newZoom))
        setFitMode(true)
        setZoomLevel(clamped)
      }
    } catch (error) {
      console.error("[BrowserSidebar] Failed to fit width:", error)
    }
  }, [webviewReady, setFitMode, setZoomLevel])

  // Recalculate fit zoom on resize when in auto-fit mode
  useEffect(() => {
    if (!fitMode || !webviewReady) return

    const webview = webviewRef.current
    if (!webview) return

    let resizeTimeout: NodeJS.Timeout | null = null

    const handleResize = () => {
      // Debounce resize events
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      resizeTimeout = setTimeout(async () => {
        try {
          const container = webview.parentElement
          if (!container) return

          const containerWidth = container.clientWidth
          const pageWidth = await webview.executeJavaScript("document.documentElement.scrollWidth") as number

          if (pageWidth > 0 && containerWidth > 0) {
            const newZoom = (containerWidth / pageWidth) * 0.95
            const clamped = Math.max(0.25, Math.min(5.0, newZoom))
            setZoomLevel(clamped)
          }
        } catch (error) {
          console.error("[BrowserSidebar] Failed to recalculate fit width on resize:", error)
        }
      }, 150) // 150ms debounce
    }

    window.addEventListener("resize", handleResize)
    return () => {
      window.removeEventListener("resize", handleResize)
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
    }
  }, [fitMode, webviewReady, setZoomLevel])

  // Apply zoom when zoom level changes - use CSS transform on body inside webview
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !webviewReady) return

    // Apply CSS transform to body element inside webview
    webview.executeJavaScript(`
      (function() {
        const zoom = ${zoomLevel};
        document.body.style.transform = 'scale(' + zoom + ')';
        document.body.style.transformOrigin = 'left top';
        document.body.style.width = (100 / zoom) + '%';
      })()
    `).catch((err) => {
      console.error("[BrowserSidebar] Failed to apply zoom:", err)
    })
  }, [zoomLevel, webviewReady])

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      <BrowserToolbar
        url={url}
        isLoading={isLoading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        projectId={projectId}
        chatId={chatId}
        title={title}
        favicon={favicon}
        devToolsOpen={devToolsOpen}
        zoomLevel={zoomLevel}
        fitMode={fitMode}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onStop={handleStop}
        onNavigate={handleNavigate}
        onOpenExternal={handleOpenExternal}
        onScreenshot={handleScreenshot}
        onClearCache={handleClearCache}
        onToggleDevTools={handleToggleDevTools}
        onToggleReactGrab={handleToggleReactGrab}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onFitWidth={handleFitWidth}
        onZoomSet={setZoomLevel}
      />

      <div className="relative flex-1 flex flex-col min-h-0">
        {/* Webview container with device emulation */}
        <div className={cn(
          "relative flex-1 min-h-0",
          isEmulatingDevice && "flex items-center justify-center overflow-auto"
        )}>
          {/* DotGrid background - Easter egg for device emulation */}
          {isEmulatingDevice && (
            <DotGrid
              dotSize={2}
              gap={20}
              proximity={80}
              shockRadius={60}
              shockStrength={2}
              resistance={0.85}
              returnDuration={0.6}
            />
          )}
          {/* Device frame for emulation mode */}
          {/* Device frame wrapper for emulation mode */}
          {isEmulatingDevice && (
            <div
              className="relative bg-background border border-border rounded-lg shadow-lg overflow-hidden shrink-0 z-10"
              style={{
                width: currentDevice.width,
                height: currentDevice.height,
                maxWidth: "100%",
                maxHeight: "100%",
              }}
            >
              {/* Device info bar */}
              <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-center gap-2 py-0.5 bg-muted/80 text-[10px] text-muted-foreground">
                <span>{currentDevice.name}</span>
                <span>·</span>
                <span>{currentDevice.width} × {currentDevice.height}</span>
              </div>
            </div>
          )}
          {/* Single webview instance - positioned absolutely to avoid re-creation */}
          {/* IMPORTANT: src uses initialUrlRef instead of url state to prevent React from
              resetting the webview during navigation (which breaks OAuth flows).
              Subsequent navigations are handled via webview.src = newUrl in navigate() */}
          <webview
            ref={webviewRef as any}
            className={cn(
              isEmulatingDevice ? "absolute z-20 rounded-lg overflow-hidden" : "w-full h-full"
            )}
            style={isEmulatingDevice ? {
              width: currentDevice.width,
              height: currentDevice.height - 20, // Account for device info bar
              maxWidth: "100%",
              maxHeight: "calc(100% - 20px)",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              marginTop: 10, // Half of info bar height offset
            } : undefined}
            src={initialUrlRef.current}
            partition="persist:browser"
            // @ts-expect-error - allowpopups is a valid webview attribute
            allowpopups="true"
            // @ts-expect-error - disablewebsecurity is a valid webview attribute
            disablewebsecurity="true"
          />
          {/* AI Overlay */}
          <BrowserOverlay
            active={overlayActive}
            locked={locked}
            onUnlock={() => {
              window.desktopApi.browserUnlock()
            }}
            webviewRef={webviewRef}
          />
        </div>

        {/* Browser Console Panel */}
        <BrowserTerminalPanel
          chatId={chatId}
          webviewRef={webviewRef}
        />
      </div>
    </div>
  )
}

/** Format action for display - concise, professional descriptions */
function formatAction(type: string, params: Record<string, unknown>): string {
  switch (type) {
    case "navigate": {
      try {
        const u = new URL(params.url as string)
        return `Navigate → ${u.hostname}`
      } catch {
        return `Navigate → ${params.url}`
      }
    }
    case "click":
      return `Click → ${params.ref || params.selector || "element"}`
    case "fill":
      return `Input → ${params.ref || params.selector || "field"}`
    case "type":
      return "Typing"
    case "screenshot":
      return "Capture screenshot"
    case "snapshot":
      return "Read page content"
    case "scroll":
      return `Scroll ${params.direction || "page"}`
    case "press":
      return `Key → ${params.key}`
    case "wait":
      return "Waiting for content"
    case "hover":
      return `Hover → ${params.ref || params.selector || "element"}`
    case "drag":
      return "Drag element"
    case "select":
      return `Select → ${params.value}`
    case "check":
      return `${params.checked ? "Check" : "Uncheck"} → ${params.ref || "element"}`
    case "evaluate":
      return "Run script"
    case "emulate":
      return "Set device emulation"
    case "downloadImage":
      return "Download image"
    case "downloadFile":
      return "Download file"
    default:
      return type
  }
}
