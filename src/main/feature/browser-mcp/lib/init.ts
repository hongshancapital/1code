/**
 * Browser initialization utilities
 *
 * Extracted from index.ts so that both standalone Hong (1code)
 * and embedded Hong (Tinker) can reuse the same setup logic
 * without importing the full app lifecycle from index.ts.
 */
import { session, app, shell, BrowserWindow } from "electron"
import { BROWSER_USER_AGENT } from "../../../lib/constants"

/**
 * Configure the "persist:browser" session with a proper User-Agent.
 * This prevents sites like Google from blocking the embedded browser
 * (Electron's default UA contains "Electron" which triggers bot detection).
 *
 * Must be called after app.whenReady().
 * Safe to call multiple times (idempotent).
 */
export function initBrowserSession(): void {
  const browserSes = session.fromPartition("persist:browser")
  browserSes.setUserAgent(BROWSER_USER_AGENT)
}

/**
 * Register a global handler for webview popup / navigation events.
 *
 * Handles:
 * - target="_blank" links → same-page navigation
 * - OAuth/SSO URLs → open in external browser
 * - Redirect loop detection → break the loop
 *
 * Safe to call multiple times (each call adds another listener,
 * but the guard on `contents.getType() === "webview"` keeps it benign).
 */
export function registerWebviewHandlers(): void {
  app.on("web-contents-created", (_event, contents) => {
    // Only handle webview contents (type is "webview")
    if (contents.getType() === "webview") {
      // Track recent navigations to detect redirect loops
      const recentNavigations: { url: string; time: number }[] = []
      const LOOP_DETECTION_WINDOW = 3000 // 3 seconds
      const LOOP_THRESHOLD = 3 // 3 navigations to same URL pattern = loop

      // Helper: Check if URL is part of OAuth/SSO flow
      const isOAuthUrl = (url: string): boolean => {
        try {
          const parsed = new URL(url)
          const hostname = parsed.hostname.toLowerCase()
          const pathname = parsed.pathname.toLowerCase()

          // Known OAuth/SSO providers
          const oauthProviders = [
            "okta.com",
            "oktapreview.com",
            "auth0.com",
            "login.microsoftonline.com",
            "accounts.google.com",
            "github.com/login",
            "cognito",
          ]
          if (oauthProviders.some((p) => hostname.includes(p))) {
            return true
          }

          // OAuth-related paths
          const oauthPaths = [
            "/oauth",
            "/authorize",
            "/callback",
            "/saml",
            "/sso",
            "/login/oauth",
            "/v1/authorize",
            "/oauth2",
          ]
          if (oauthPaths.some((p) => pathname.includes(p))) {
            return true
          }

          // OAuth-related query params
          const oauthParams = ["code", "state", "id_token", "access_token", "SAMLResponse"]
          if (oauthParams.some((p) => parsed.searchParams.has(p))) {
            return true
          }

          return false
        } catch {
          return false
        }
      }

      // Helper: Detect redirect loop
      const detectRedirectLoop = (url: string): boolean => {
        const now = Date.now()
        // Clean old entries
        while (recentNavigations.length > 0 && now - recentNavigations[0].time > LOOP_DETECTION_WINDOW) {
          recentNavigations.shift()
        }

        // Extract URL pattern (without query string for comparison)
        let urlPattern: string
        try {
          const parsed = new URL(url)
          urlPattern = `${parsed.origin}${parsed.pathname}`
        } catch {
          urlPattern = url
        }

        // Count recent navigations to similar URLs
        const similarCount = recentNavigations.filter((n) => {
          try {
            const parsed = new URL(n.url)
            return `${parsed.origin}${parsed.pathname}` === urlPattern
          } catch {
            return n.url === url
          }
        }).length

        // Add current navigation
        recentNavigations.push({ url, time: now })

        return similarCount >= LOOP_THRESHOLD
      }

      contents.setWindowOpenHandler(({ url }) => {
        // Check for redirect loop
        if (detectRedirectLoop(url)) {
          console.warn("[Webview] Redirect loop detected, opening in external browser:", url)
          shell.openExternal(url)
          return { action: "deny" }
        }

        // For OAuth/SSO URLs, open in external browser to avoid breaking auth flow
        if (isOAuthUrl(url)) {
          console.log("[Webview] OAuth URL detected, opening in external browser:", url)
          shell.openExternal(url)
          return { action: "deny" }
        }

        // Navigate in the same webview instead of opening new window
        // loadURL adds to history stack, allowing back/forward navigation
        if (url) {
          contents.loadURL(url)
        }
        return { action: "deny" }
      })

      // Handle will-navigate to detect auth redirects
      contents.on("will-navigate", (event, url) => {
        // Check for redirect loop on regular navigation too
        if (detectRedirectLoop(url)) {
          console.warn("[Webview] Redirect loop detected during navigation:", url)
          event.preventDefault()
          // Notify user or take action
          const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
          if (mainWindow) {
            mainWindow.webContents.send("browser:auth-loop-detected", url)
          }
        }
      })
    }
  })
}
