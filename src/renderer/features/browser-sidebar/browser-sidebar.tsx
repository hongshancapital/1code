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

  // Device emulation
  const [devicePresetId] = useAtom(browserDevicePresetAtomFamily(chatId))
  const currentDevice = DEVICE_PRESETS.find(d => d.id === devicePresetId) || DEVICE_PRESETS[0]
  const isEmulatingDevice = currentDevice.id !== "responsive" && currentDevice.width > 0
  const prevDeviceRef = useRef<string | null>(null)
  // Ref for callbacks in event handlers
  const onElementSelectRef = useRef(onElementSelect)
  onElementSelectRef.current = onElementSelect
  const setSelectorActiveRef = useRef(setSelectorActive)
  setSelectorActiveRef.current = setSelectorActive
  const setReactGrabAvailableRef = useRef(setReactGrabAvailable)
  setReactGrabAvailableRef.current = setReactGrabAvailable

  // Navigate to URL
  const navigate = useCallback((newUrl: string) => {
    const webview = webviewRef.current
    if (!webview) return

    // Add protocol if missing
    let normalizedUrl = newUrl
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
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
          const result = await webview.executeJavaScript(
            `window.__browserGenerateSnapshot(${params.interactiveOnly ?? true})`
          ) as SnapshotResult
          return { success: true, data: result }
        }

        case "navigate": {
          navigate(params.url as string)
          // Wait for load
          await new Promise<void>((resolve) => {
            const handler = () => {
              webview.removeEventListener("did-finish-load", handler)
              resolve()
            }
            webview.addEventListener("did-finish-load", handler)
          })
          return { success: true }
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
          const image = await webview.capturePage()
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
            // Get href from link element
            const href = await webview.executeJavaScript(
              `(function() { const el = window.__browserRefMap.get("${fileRef}"); return el ? (el.href || el.getAttribute("href")) : null; })()`
            )
            if (href) downloadUrl = href
          }
          if (!downloadUrl) return { success: false, error: "No URL to download" }
          return { success: true, data: { url: downloadUrl, filePath: params.filePath } }
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
          const result = await webview.executeJavaScript(params.script as string)
          return { success: true, data: { result } }
        }

        case "querySelector": {
          const selector = params.selector as string
          if (!selector) return { success: false, error: "No selector provided" }
          const result = await webview.executeJavaScript(
            `window.__browserQuerySelector(${JSON.stringify(selector)})`
          )
          return result
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

  // Listen for browser:show-panel from main process (AI requesting panel visibility)
  useEffect(() => {
    if (!window.desktopApi.onBrowserShowPanel) return
    const cleanup = window.desktopApi.onBrowserShowPanel(() => {
      setBrowserActive(true)
    })
    return cleanup
  }, [setBrowserActive])

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
      // Inject our scripts
      webview.executeJavaScript(getWebviewScript())
      setWebviewReady(true)
      setReady(true)
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

    // Handle console messages from webview (for React Grab element selection and status)
    const handleConsoleMessage = (event: Electron.ConsoleMessageEvent) => {
      const message = event.message

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
    webview.addEventListener("page-favicon-updated", handleFaviconUpdated as any)
    webview.addEventListener("console-message", handleConsoleMessage)

    return () => {
      webview.removeEventListener("dom-ready", handleDomReady)
      webview.removeEventListener("did-finish-load", handleDidFinishLoad)
      webview.removeEventListener("did-start-loading", handleDidStartLoading)
      webview.removeEventListener("did-navigate", handleDidNavigate)
      webview.removeEventListener("did-navigate-in-page", handleDidNavigate)
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
            src={url || "about:blank"}
            partition="persist:browser"
            // @ts-expect-error - allowpopups is a valid webview attribute
            allowpopups="true"
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
