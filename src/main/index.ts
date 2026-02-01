import * as Sentry from "@sentry/electron/main"
import { validateEnv, getEnv } from "./lib/env"
import { app, BrowserWindow, Menu, protocol, session } from "electron"

// Validate environment variables early (before app logic starts)
// This will throw if required env vars are missing
validateEnv()
import { createReadStream, existsSync, readFileSync, readlinkSync, statSync, unlinkSync } from "fs"
import { createServer } from "http"
import { join } from "path"
import { Readable } from "stream"
import { AuthManager, initAuthManager, getAuthManager as getAuthManagerFromModule } from "./auth-manager"
import {
  identify,
  initAnalytics,
  setSubscriptionPlan,
  shutdown as shutdownAnalytics,
  trackAppOpened,
  trackAuthCompleted,
} from "./lib/analytics"
import {
  checkForUpdates,
  downloadUpdate,
  initAutoUpdater,
  setupFocusUpdateCheck,
} from "./lib/auto-updater"
import { closeDatabase, initDatabase } from "./lib/db"
import {
  getLaunchDirectory,
  isCliInstalled,
  installCli,
  uninstallCli,
  parseLaunchDirectory,
} from "./lib/cli"
import { cleanupGitWatchers } from "./lib/git/watcher"
import { cancelAllPendingOAuth, handleMcpOAuthCallback } from "./lib/mcp-auth"
import {
  createMainWindow,
  createWindow,
  getWindow,
  getAllWindows,
} from "./windows/main"
import { windowManager } from "./windows/window-manager"

import { IS_DEV, AUTH_SERVER_PORT } from "./constants"

// Deep link protocol (must match package.json build.protocols.schemes)
// Use different protocol in dev to avoid conflicts with production app
const PROTOCOL = IS_DEV ? "hong-dev" : "hong"

// Set dev mode userData path BEFORE requestSingleInstanceLock()
// This ensures dev and prod have separate instance locks
if (IS_DEV) {
  const { join } = require("path")
  const devUserData = join(app.getPath("userData"), "..", "Agents Dev")
  app.setPath("userData", devUserData)
  console.log("[Dev] Using separate userData path:", devUserData)
}

// Initialize Sentry before app is ready (production only)
if (app.isPackaged && !IS_DEV) {
  const env = getEnv()
  if (env.MAIN_VITE_SENTRY_DSN) {
    try {
      Sentry.init({
        dsn: env.MAIN_VITE_SENTRY_DSN,
      })
      console.log("[App] Sentry initialized")
    } catch (error) {
      console.warn("[App] Failed to initialize Sentry:", error)
    }
  } else {
    console.log("[App] Skipping Sentry initialization (no DSN configured)")
  }
} else {
  console.log("[App] Skipping Sentry initialization (dev mode)")
}

// URL configuration (exported for use in other modules)
export function getBaseUrl(): string {
  return getEnv().MAIN_VITE_API_URL
}

export function getAppUrl(): string {
  return process.env.ELECTRON_RENDERER_URL || "https://cowork.hongshan.com"
}

// Auth manager singleton (use the one from auth-manager module)
let authManager: AuthManager

export function getAuthManager(): AuthManager {
  // First try to get from module, fallback to local variable for backwards compat
  return getAuthManagerFromModule() || authManager
}

// Handle auth code from deep link (exported for IPC handlers)
export async function handleAuthCode(code: string): Promise<void> {
  console.log("[Auth] Handling auth code:", code.slice(0, 8) + "...")

  try {
    const authData = await authManager.exchangeCode(code)
    console.log("[Auth] Success for user:", authData.user.email)

    // Track successful authentication
    trackAuthCompleted(authData.user.id, authData.user.email)

    // Fetch and set subscription plan for analytics
    try {
      const planData = await authManager.fetchUserPlan()
      if (planData) {
        setSubscriptionPlan(planData.plan)
      }
    } catch (e) {
      console.warn("[Auth] Failed to fetch user plan for analytics:", e)
    }

    // Set desktop token cookie using persist:main partition
    const ses = session.fromPartition("persist:main")
    try {
      // First remove any existing cookie to avoid HttpOnly conflict
      await ses.cookies.remove(getBaseUrl(), "x-desktop-token")
      await ses.cookies.set({
        url: getBaseUrl(),
        name: "x-desktop-token",
        value: authData.token,
        expirationDate: Math.floor(
          new Date(authData.expiresAt).getTime() / 1000,
        ),
        httpOnly: false,
        secure: getBaseUrl().startsWith("https"),
        sameSite: "lax" as const,
      })
      console.log("[Auth] Desktop token cookie set")
    } catch (cookieError) {
      // Cookie setting is optional - auth data is already saved to disk
      console.warn("[Auth] Cookie set failed (non-critical):", cookieError)
    }

    // Notify all windows and reload them to show app
    const windows = getAllWindows()
    for (const win of windows) {
      try {
        if (win.isDestroyed()) continue
        win.webContents.send("auth:success", authData.user)

        // Use stable window ID (main, window-2, etc.) instead of Electron's numeric ID
        const stableId = windowManager.getStableId(win)

        if (process.env.ELECTRON_RENDERER_URL) {
          // Pass window ID via query param for dev mode
          const url = new URL(process.env.ELECTRON_RENDERER_URL)
          url.searchParams.set("windowId", stableId)
          win.loadURL(url.toString())
        } else {
          // Pass window ID via hash for production
          win.loadFile(join(__dirname, "../renderer/index.html"), {
            hash: `windowId=${stableId}`,
          })
        }
      } catch (error) {
        // Window may have been destroyed during iteration
        console.warn("[Auth] Failed to reload window:", error)
      }
    }
    // Focus the first window
    windows[0]?.focus()
  } catch (error) {
    console.error("[Auth] Exchange failed:", error)
    // Broadcast auth error to all windows (not just focused)
    for (const win of getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send("auth:error", (error as Error).message)
        }
      } catch {
        // Window destroyed during iteration
      }
    }
  }
}

// Handle deep link
function handleDeepLink(url: string): void {
  console.log("[DeepLink] Received:", url)

  try {
    const parsed = new URL(url)

    // Handle auth callback: hong://auth?code=xxx
    if (parsed.pathname === "/auth" || parsed.host === "auth") {
      const code = parsed.searchParams.get("code")
      if (code) {
        handleAuthCode(code)
        return
      }
    }

    // Handle MCP OAuth callback: hong://mcp-oauth?code=xxx&state=yyy
    if (parsed.pathname === "/mcp-oauth" || parsed.host === "mcp-oauth") {
      const code = parsed.searchParams.get("code")
      const state = parsed.searchParams.get("state")
      if (code && state) {
        handleMcpOAuthCallback(code, state)
        return
      }
    }
  } catch (e) {
    console.error("[DeepLink] Failed to parse:", e)
  }
}

// Register custom scheme for local file access BEFORE app is ready
// This must be called before app.whenReady()
// CRITICAL: This registration happens at module load time, before any async code
console.log("[local-file] Registering scheme as privileged (before app ready)...")
try {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "local-file",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
        corsEnabled: true, // 允许跨域请求
      },
    },
  ])
  console.log("[local-file] Scheme registered successfully")
} catch (err) {
  console.error("[local-file] Failed to register scheme:", err)
}

// Register protocol BEFORE app is ready
console.log("[Protocol] ========== PROTOCOL REGISTRATION ==========")
console.log("[Protocol] Protocol:", PROTOCOL)
console.log("[Protocol] Is dev mode (process.defaultApp):", process.defaultApp)
console.log("[Protocol] process.execPath:", process.execPath)
console.log("[Protocol] process.argv:", process.argv)

/**
 * Register the app as the handler for our custom protocol.
 * On macOS, this may not take effect immediately on first install -
 * Launch Services caches protocol handlers and may need time to update.
 */
function registerProtocol(): boolean {
  let success = false

  if (process.defaultApp) {
    // Dev mode: need to pass execPath and script path
    if (process.argv.length >= 2) {
      success = app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
        process.argv[1]!,
      ])
      console.log(
        `[Protocol] Dev mode registration:`,
        success ? "success" : "failed",
      )
    } else {
      console.warn("[Protocol] Dev mode: insufficient argv for registration")
    }
  } else {
    // Production mode
    success = app.setAsDefaultProtocolClient(PROTOCOL)
    console.log(
      `[Protocol] Production registration:`,
      success ? "success" : "failed",
    )
  }

  return success
}

// Store initial registration result (set in app.whenReady())
let initialRegistration = false

// Verify registration (this checks if OS recognizes us as the handler)
function verifyProtocolRegistration(): void {
  const isDefault = process.defaultApp
    ? app.isDefaultProtocolClient(PROTOCOL, process.execPath, [
        process.argv[1]!,
      ])
    : app.isDefaultProtocolClient(PROTOCOL)

  console.log(`[Protocol] Verification - isDefaultProtocolClient: ${isDefault}`)

  if (!isDefault && initialRegistration) {
    console.warn(
      "[Protocol] Registration returned success but verification failed.",
    )
    console.warn(
      "[Protocol] This is common on first install - macOS Launch Services may need time to update.",
    )
    console.warn("[Protocol] The protocol should work after app restart.")
  }
}

console.log("[Protocol] =============================================")

// Note: app.on("open-url") will be registered in app.whenReady()

// App icon as base64 data URI for auth callback pages (64x64 PNG)
const ICON_BASE64 = "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"
const ICON_DATA_URI = `data:image/png;base64,${ICON_BASE64}`
// Keep FAVICON for browser tab icon
const FAVICON_SVG = `<svg width="32" height="32" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="1024" height="1024" fill="#0033FF"/><path fill-rule="evenodd" clip-rule="evenodd" d="M800.165 148C842.048 148 876 181.952 876 223.835V686.415C876 690.606 872.606 694 868.415 694H640.915C636.729 694 633.335 697.394 633.335 701.585V868.415C633.335 872.606 629.936 876 625.75 876H223.835C181.952 876 148 842.048 148 800.165V702.59C148 697.262 150.807 692.326 155.376 689.586L427.843 526.1C434.031 522.388 431.956 513.238 425.327 512.118L423.962 512H155.585C151.394 512 148 508.606 148 504.415V337.585C148 333.394 151.394 330 155.585 330H443.75C447.936 330 451.335 326.606 451.335 322.415V155.585C451.335 151.394 454.729 148 458.915 148H800.165ZM458.915 330C454.729 330 451.335 333.394 451.335 337.585V686.415C451.335 690.606 454.729 694 458.915 694H625.75C629.936 694 633.335 690.606 633.335 686.415V337.585C633.335 333.394 629.936 330 625.75 330H458.915Z" fill="#F4F4F4"/></svg>`
const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

// Start local HTTP server for auth callbacks
// This catches http://localhost:{AUTH_SERVER_PORT}/auth/callback?code=xxx and /callback (for MCP OAuth)
const server = createServer((req, res) => {
    const url = new URL(req.url || "", `http://localhost:${AUTH_SERVER_PORT}`)

    // Serve favicon
    if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
      res.writeHead(200, { "Content-Type": "image/svg+xml" })
      res.end(FAVICON_SVG)
      return
    }

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      console.log(
        "[Auth Server] Received Okta callback with code:",
        code?.slice(0, 8) + "...",
        "state:",
        state?.slice(0, 8) + "...",
      )

      // Verify state parameter to prevent CSRF attacks
      const pkceState = authManager?.getPkceState()
      if (!pkceState) {
        console.error("[Auth Server] No PKCE state found - auth flow not started")
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Authentication flow not started. Please try again.")
        return
      }

      if (state !== pkceState.state) {
        console.error("[Auth Server] State mismatch - possible CSRF attack")
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Invalid state parameter. Please try again.")
        return
      }

      if (code) {
        // Handle the auth code (exchange for tokens)
        handleAuthCode(code)

        // Send success response and close the browser tab
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
  <title>Hong - Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --text: #fafafa;
      --text-muted: #71717a;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --text: #09090b;
        --text-muted: #71717a;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .brand {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    a {
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline;
      transition: opacity 0.15s;
    }
    a:hover {
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="container">
    <span class="brand">Hóng</span>
    <h1>Authentication successful</h1>
    <a onclick="window.close()">Close this tab</a>
  </div>
</body>
</html>`)
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Missing code parameter")
      }
    } else if (url.pathname === "/callback") {
      // Handle MCP OAuth callback
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      console.log(
        "[Auth Server] Received MCP OAuth callback with code:",
        code?.slice(0, 8) + "...",
        "state:",
        state?.slice(0, 8) + "...",
      )

      if (code && state) {
        // Handle the MCP OAuth callback
        handleMcpOAuthCallback(code, state)

        // Send success response and close the browser tab
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
  <title>Hong - MCP Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --text: #fafafa;
      --text-muted: #71717a;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --text: #09090b;
        --text-muted: #71717a;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .logo {
      width: 24px;
      height: 24px;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    p {
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <img class="logo" src="${ICON_DATA_URI}" alt="Hong" />
    <h1>MCP Server authenticated</h1>
    <p>You can close this tab</p>
  </div>
  <script>setTimeout(() => window.close(), 1000)</script>
</body>
</html>`)
      } else {
        res.writeHead(400, { "Content-Type": "text/plain" })
        res.end("Missing code or state parameter")
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" })
      res.end("Not found")
    }
  })

server.listen(AUTH_SERVER_PORT, () => {
  console.log(`[Auth Server] Listening on http://localhost:${AUTH_SERVER_PORT}`)
})

// Okta OAuth callback server on port 3000 (matches Okta app configuration)
// This is separate from the main auth server because Okta requires a specific callback URL
const OKTA_CALLBACK_PORT = 3000
const oktaCallbackServer = createServer((req, res) => {
  const url = new URL(req.url || "", `http://localhost:${OKTA_CALLBACK_PORT}`)

  // Serve favicon
  if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml" })
    res.end(FAVICON_SVG)
    return
  }

  // Handle Okta OAuth callback: /implicit/callback
  if (url.pathname === "/implicit/callback") {
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    console.log(
      "[Okta Callback] Received callback with code:",
      code?.slice(0, 8) + "...",
      "state:",
      state?.slice(0, 8) + "...",
    )

    // Verify state parameter to prevent CSRF attacks
    // Use getAuthManager() instead of authManager variable since server starts before app.whenReady()
    const currentAuthManager = getAuthManager()
    const pkceState = currentAuthManager?.getPkceState()
    if (!pkceState) {
      console.error("[Okta Callback] No PKCE state found - auth flow not started")
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Hong - Authentication Error</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #09090b; color: #fafafa; }
    .error { text-align: center; }
    h1 { font-size: 16px; margin-bottom: 8px; }
    p { font-size: 14px; color: #71717a; }
  </style>
</head>
<body>
  <div class="error">
    <h1>Authentication flow not started</h1>
    <p>Please click "Sign in" in the app first, then try again.</p>
  </div>
</body>
</html>`)
      return
    }

    if (state !== pkceState.state) {
      console.error("[Okta Callback] State mismatch - possible CSRF attack")
      res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Hong - Authentication Error</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #09090b; color: #fafafa; }
    .error { text-align: center; }
    h1 { font-size: 16px; margin-bottom: 8px; }
    p { font-size: 14px; color: #71717a; }
  </style>
</head>
<body>
  <div class="error">
    <h1>Invalid state parameter</h1>
    <p>Security check failed. Please try again.</p>
  </div>
</body>
</html>`)
      return
    }

    if (code) {
      // Handle the auth code (exchange for tokens)
      handleAuthCode(code)

      // Send success response and close the browser tab
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
  <title>Hong - Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --text: #fafafa;
      --text-muted: #71717a;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --text: #09090b;
        --text-muted: #71717a;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .brand {
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    a {
      font-size: 12px;
      color: var(--text-muted);
      cursor: pointer;
      text-decoration: underline;
      transition: opacity 0.15s;
    }
    a:hover {
      opacity: 0.7;
    }
  </style>
</head>
<body>
  <div class="container">
    <span class="brand">Hóng</span>
    <h1>Authentication successful</h1>
    <a onclick="window.close()">Close this tab</a>
  </div>
</body>
</html>`)
    } else {
      res.writeHead(400, { "Content-Type": "text/plain" })
      res.end("Missing code parameter")
    }
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not found")
  }
})

oktaCallbackServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`[Okta Callback] Port ${OKTA_CALLBACK_PORT} is in use - another app may be using it`)
    console.warn("[Okta Callback] Okta login may not work until port 3000 is available")
  } else {
    console.error("[Okta Callback] Server error:", err)
  }
})

oktaCallbackServer.listen(OKTA_CALLBACK_PORT, () => {
  console.log(`[Okta Callback] Listening on http://localhost:${OKTA_CALLBACK_PORT}/implicit/callback`)
})

// Clean up stale lock files from crashed instances
// Returns true if locks were cleaned, false otherwise
function cleanupStaleLocks(): boolean {
  const userDataPath = app.getPath("userData")
  const lockPath = join(userDataPath, "SingletonLock")

  if (!existsSync(lockPath)) return false

  try {
    // SingletonLock is a symlink like "hostname-pid"
    const lockTarget = readlinkSync(lockPath)
    const match = lockTarget.match(/-(\d+)$/)
    if (match) {
      const pid = parseInt(match[1], 10)
      try {
        // Check if process is running (signal 0 doesn't kill, just checks)
        process.kill(pid, 0)
        // Process exists, lock is valid
        console.log("[App] Lock held by running process:", pid)
        return false
      } catch {
        // Process doesn't exist, clean up stale locks
        console.log("[App] Cleaning stale locks (pid", pid, "not running)")
        const filesToRemove = ["SingletonLock", "SingletonSocket", "SingletonCookie"]
        for (const file of filesToRemove) {
          const filePath = join(userDataPath, file)
          if (existsSync(filePath)) {
            try {
              unlinkSync(filePath)
            } catch (e) {
              console.warn("[App] Failed to remove", file, e)
            }
          }
        }
        return true
      }
    }
  } catch (e) {
    console.warn("[App] Failed to check lock file:", e)
  }
  return false
}

// Prevent multiple instances
let gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Maybe stale lock - try cleanup and retry once
  const cleaned = cleanupStaleLocks()
  if (cleaned) {
    gotTheLock = app.requestSingleInstanceLock()
  }
  if (!gotTheLock) {
    app.quit()
  }
}

if (gotTheLock) {
  // Handle second instance launch (also handles deep links on Windows/Linux)
  app.on("second-instance", (_event, commandLine) => {
    // Check for deep link in command line args
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url) {
      handleDeepLink(url)
    }

    // Focus on the first available window
    const windows = getAllWindows()
    if (windows.length > 0) {
      const window = windows[0]!
      if (window.isMinimized()) window.restore()
      window.focus()
    } else {
      // No windows open, create a new one
      createMainWindow()
    }
  })

  // App ready
  app.whenReady().then(async () => {
    // Set dev mode app name (userData path was already set before requestSingleInstanceLock)
    if (IS_DEV) {
      app.name = "Agents Dev"
    }

    // Register protocol handler (must be after app is ready)
    initialRegistration = registerProtocol()

    // Register local-file protocol for secure file access from renderer
    // IMPORTANT: Must register to the specific session used by BrowserWindow (persist:main)
    const ses = session.fromPartition("persist:main")

    // Helper: Get MIME type from file extension
    const getMimeType = (filePath: string): string => {
      const ext = filePath.toLowerCase().split(".").pop() || ""
      const mimeTypes: Record<string, string> = {
        // Video
        mp4: "video/mp4",
        webm: "video/webm",
        mov: "video/quicktime",
        mkv: "video/x-matroska",
        m4v: "video/x-m4v",
        ogv: "video/ogg",
        avi: "video/x-msvideo",
        "3gp": "video/3gpp",
        // Audio
        mp3: "audio/mpeg",
        wav: "audio/wav",
        ogg: "audio/ogg",
        flac: "audio/flac",
        m4a: "audio/mp4",
        aac: "audio/aac",
        wma: "audio/x-ms-wma",
        opus: "audio/opus",
        aiff: "audio/aiff",
        // Image
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        svg: "image/svg+xml",
        bmp: "image/bmp",
        ico: "image/x-icon",
        avif: "image/avif",
        tiff: "image/tiff",
        heic: "image/heic",
        heif: "image/heif",
        // Document
        pdf: "application/pdf",
        // Text
        txt: "text/plain",
        html: "text/html",
        htm: "text/html",
        css: "text/css",
        js: "text/javascript",
        json: "application/json",
        xml: "application/xml",
      }
      return mimeTypes[ext] || "application/octet-stream"
    }

    // Helper: Convert Node.js Readable stream to Web ReadableStream
    const convertNodeStreamToWeb = (nodeStream: Readable): ReadableStream<Uint8Array> => {
      return new ReadableStream({
        start(controller) {
          nodeStream.on("data", (chunk: Buffer) => {
            controller.enqueue(new Uint8Array(chunk))
          })
          nodeStream.on("end", () => {
            controller.close()
          })
          nodeStream.on("error", (err) => {
            controller.error(err)
          })
        },
        cancel() {
          nodeStream.destroy()
        },
      })
    }

    ses.protocol.handle("local-file", async (request) => {
      // URL format: local-file://localhost/absolute/path/to/file
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)

      // On Windows, pathname might start with /C:/ - remove leading slash
      if (process.platform === "win32" && filePath.match(/^\/[A-Za-z]:\//)) {
        filePath = filePath.slice(1)
      }

      // Security: only allow reading files, no directory traversal
      if (filePath.includes("..")) {
        console.warn("[local-file] Blocked path traversal:", filePath)
        return new Response("Forbidden", { status: 403 })
      }

      if (!existsSync(filePath)) {
        console.warn("[local-file] File not found:", filePath)
        return new Response("Not Found", { status: 404 })
      }

      try {
        const stat = statSync(filePath)
        const fileSize = stat.size
        const mimeType = getMimeType(filePath)
        const rangeHeader = request.headers.get("range")

        // Handle Range request for video/audio seeking
        if (rangeHeader) {
          const rangeMatch = rangeHeader.match(/bytes=(\d*)-(\d*)/)
          if (rangeMatch) {
            const start = rangeMatch[1] ? parseInt(rangeMatch[1], 10) : 0
            const end = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : fileSize - 1

            // Validate range
            if (start >= fileSize || start > end) {
              return new Response("Range Not Satisfiable", {
                status: 416,
                headers: { "Content-Range": `bytes */${fileSize}` },
              })
            }

            const chunkSize = end - start + 1
            const stream = createReadStream(filePath, { start, end })
            const readableStream = convertNodeStreamToWeb(stream)

            console.log("[local-file] 206 Partial Content:", filePath, `${start}-${end}/${fileSize}`)

            return new Response(readableStream, {
              status: 206,
              headers: {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": String(chunkSize),
                "Content-Type": mimeType,
              },
            })
          }
        }

        // No Range request - return full file with Accept-Ranges header
        const stream = createReadStream(filePath)
        const readableStream = convertNodeStreamToWeb(stream)

        console.log("[local-file] 200 OK:", filePath, `${fileSize} bytes`)

        return new Response(readableStream, {
          status: 200,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(fileSize),
            "Content-Type": mimeType,
          },
        })
      } catch (error) {
        console.error("[local-file] Error reading file:", filePath, error)
        return new Response("Internal Server Error", { status: 500 })
      }
    })
    console.log("[local-file] Protocol handler registered with Range request support")

    // Handle deep link on macOS (app already running)
    app.on("open-url", (event, url) => {
      console.log("[Protocol] open-url event received:", url)
      event.preventDefault()
      handleDeepLink(url)
    })

    // Set app user model ID for Windows (different in dev to avoid taskbar conflicts)
    if (process.platform === "win32") {
      app.setAppUserModelId(IS_DEV ? "com.hongshan.hong.dev" : "com.hongshan.hong")
    }

    console.log(`[App] Starting Hong${IS_DEV ? " (DEV)" : ""}...`)

    // Verify protocol registration after app is ready
    // This helps diagnose first-install issues where the protocol isn't recognized yet
    verifyProtocolRegistration()

    // Get Claude Code version for About panel
    let claudeCodeVersion = "unknown"
    try {
      const isDev = !app.isPackaged
      const versionPath = isDev
        ? join(app.getAppPath(), "resources/bin/VERSION")
        : join(process.resourcesPath, "bin/VERSION")

      if (existsSync(versionPath)) {
        const versionContent = readFileSync(versionPath, "utf-8")
        claudeCodeVersion = versionContent.split("\n")[0]?.trim() || "unknown"
      }
    } catch (error) {
      console.warn("[App] Failed to read Claude Code version:", error)
    }

    // Set About panel options with Claude Code version
    app.setAboutPanelOptions({
      applicationName: "Hong",
      applicationVersion: app.getVersion(),
      version: `Claude Code ${claudeCodeVersion}`,
      copyright: "Copyright © 2026 Hóng",
    })

    // Track update availability for menu
    let updateAvailable = false
    let availableVersion: string | null = null
    // Track devtools unlock state (hidden feature - 5 clicks on Beta tab)
    let devToolsUnlocked = false

    // Function to build and set application menu
    const buildMenu = () => {
      // Show devtools menu item only in dev mode or when unlocked
      const showDevTools = !app.isPackaged || devToolsUnlocked
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: app.name,
          submenu: [
            { role: "about", label: "About Hong" },
            {
              label: updateAvailable
                ? `Update to v${availableVersion}...`
                : "Check for Updates...",
              click: () => {
                // Send event to renderer to clear dismiss state
                const win = getWindow()
                if (win) {
                  win.webContents.send("update:manual-check")
                }
                // If update is already available, start downloading immediately
                if (updateAvailable) {
                  downloadUpdate()
                } else {
                  checkForUpdates(true)
                }
              },
            },
            { type: "separator" },
            {
              label: isCliInstalled()
                ? "Uninstall 'hong' Command..."
                : "Install 'hong' Command in PATH...",
              click: async () => {
                const { dialog } = await import("electron")
                if (isCliInstalled()) {
                  const result = await uninstallCli()
                  if (result.success) {
                    dialog.showMessageBox({
                      type: "info",
                      message: "CLI command uninstalled",
                      detail: "The 'hong' command has been removed from your PATH.",
                    })
                    buildMenu()
                  } else {
                    dialog.showErrorBox("Uninstallation Failed", result.error || "Unknown error")
                  }
                } else {
                  const result = await installCli()
                  if (result.success) {
                    dialog.showMessageBox({
                      type: "info",
                      message: "CLI command installed",
                      detail:
                        "You can now use 'hong .' in any terminal to open Hong in that directory.",
                    })
                    buildMenu()
                  } else {
                    dialog.showErrorBox("Installation Failed", result.error || "Unknown error")
                  }
                }
              },
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "File",
          submenu: [
            {
              label: "New Chat",
              accelerator: "CmdOrCtrl+N",
              click: () => {
                console.log("[Menu] New Chat clicked (Cmd+N)")
                const win = getWindow()
                if (win) {
                  console.log("[Menu] Sending shortcut:new-agent to renderer")
                  win.webContents.send("shortcut:new-agent")
                } else {
                  console.log("[Menu] No window found!")
                }
              },
            },
            {
              label: "New Window",
              accelerator: "CmdOrCtrl+Shift+N",
              click: () => {
                console.log("[Menu] New Window clicked (Cmd+Shift+N)")
                createWindow()
              },
            },
            { type: "separator" },
            {
              label: "Close Window",
              accelerator: "CmdOrCtrl+W",
              click: () => {
                const win = getWindow()
                if (win) {
                  win.close()
                }
              },
            },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            // Cmd+R is disabled to prevent accidental page refresh
            // Use Cmd+Shift+R (Force Reload) for intentional reloads
            { role: "forceReload" },
            // Only show DevTools in dev mode or when unlocked via hidden feature
            ...(showDevTools ? [{ role: "toggleDevTools" as const }] : []),
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Window",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ],
        },
        {
          role: "help",
          submenu: [
            {
              label: "Learn More",
              click: async () => {
                const { shell } = await import("electron")
                await shell.openExternal("https://hongshan.com")
              },
            },
          ],
        },
      ]
      Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }

    // macOS: Set dock menu (right-click on dock icon)
    if (process.platform === "darwin") {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: "New Window",
          click: () => {
            console.log("[Dock] New Window clicked")
            createWindow()
          },
        },
      ])
      app.dock?.setMenu(dockMenu)
    }

    // Set update state and rebuild menu
    const setUpdateAvailable = (available: boolean, version?: string) => {
      updateAvailable = available
      availableVersion = version || null
      buildMenu()
    }

    // Unlock devtools and rebuild menu (called from renderer via IPC)
    const unlockDevTools = () => {
      if (!devToolsUnlocked) {
        devToolsUnlocked = true
        console.log("[App] DevTools unlocked via hidden feature")
        buildMenu()
      }
    }

    // Expose setUpdateAvailable globally for auto-updater
    globalThis.__setUpdateAvailable = setUpdateAvailable
    // Expose unlockDevTools globally for IPC handler
    globalThis.__unlockDevTools = unlockDevTools

    // Build initial menu
    buildMenu()

    // Initialize auth manager (uses singleton from auth-manager module)
    authManager = initAuthManager(!!process.env.ELECTRON_RENDERER_URL)
    console.log("[App] Auth manager initialized")

    // Initialize analytics after auth manager so we can identify user
    initAnalytics()

    // If user already authenticated from previous session, validate token and refresh user info
    if (authManager.isAuthenticated()) {
      console.log("[App] Validating saved authentication...")
      const validatedUser = await authManager.validateAndRefreshUser()

      if (validatedUser) {
        // Token is valid, identify user for analytics
        identify(validatedUser.id, { email: validatedUser.email })
        console.log("[Analytics] User identified from validated session:", validatedUser.id)
      } else {
        // Token expired (401), try to refresh first
        console.log("[App] Token expired, attempting refresh...")
        const refreshed = await authManager.refresh()

        if (refreshed) {
          // Refresh successful, validate again to get fresh user info
          const refreshedUser = await authManager.validateAndRefreshUser()
          if (refreshedUser) {
            identify(refreshedUser.id, { email: refreshedUser.email })
            console.log("[Analytics] User identified after token refresh:", refreshedUser.id)
          }
        } else {
          // Refresh failed, need to re-authenticate
          console.log("[App] Token refresh failed, user needs to re-authenticate")
          // Clear invalid session
          authManager.logout()
        }
      }
    }

    // Track app opened (now with correct user ID if authenticated)
    trackAppOpened()

    // Set up callback to update cookie when token is refreshed
    authManager.setOnTokenRefresh(async (authData) => {
      console.log("[Auth] Token refreshed, updating cookie...")
      const ses = session.fromPartition("persist:main")
      try {
        await ses.cookies.set({
          url: getBaseUrl(),
          name: "x-desktop-token",
          value: authData.token,
          expirationDate: Math.floor(
            new Date(authData.expiresAt).getTime() / 1000,
          ),
          httpOnly: false,
          secure: getBaseUrl().startsWith("https"),
          sameSite: "lax" as const,
        })
        console.log("[Auth] Desktop token cookie updated after refresh")
      } catch (err) {
        console.error("[Auth] Failed to update cookie:", err)
      }
    })

    // Initialize database
    try {
      initDatabase()
      console.log("[App] Database initialized")
    } catch (error) {
      console.error("[App] Failed to initialize database:", error)
    }

    // Create main window
    createMainWindow()

    // Initialize auto-updater (production only)
    if (app.isPackaged) {
      await initAutoUpdater(getAllWindows)
      // Setup update check on window focus (instead of periodic interval)
      setupFocusUpdateCheck(getAllWindows)
      // Check for updates 5 seconds after startup (force to bypass interval check)
      setTimeout(() => {
        checkForUpdates(true)
      }, 5000)
    }

    // Warm up MCP cache 3 seconds after startup (background, non-blocking)
    // This populates the cache so all future sessions can use filtered MCP servers
    setTimeout(async () => {
      try {
        const { getAllMcpConfigHandler } = await import("./lib/trpc/routers/claude")
        await getAllMcpConfigHandler()
      } catch (error) {
        console.error("[App] MCP warmup failed:", error)
      }
    }, 3000)

    // Handle directory argument from CLI (e.g., `hong /path/to/project`)
    parseLaunchDirectory()

    // Handle deep link from app launch (Windows/Linux)
    const deepLinkUrl = process.argv.find((arg) =>
      arg.startsWith(`${PROTOCOL}://`),
    )
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl)
    }

    // macOS: Re-create window when dock icon is clicked
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  // Quit when all windows are closed (except on macOS)
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Cleanup before quit
  app.on("before-quit", async () => {
    console.log("[App] Shutting down...")
    cancelAllPendingOAuth()
    await cleanupGitWatchers()
    await shutdownAnalytics()
    await closeDatabase()
  })

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("[App] Uncaught exception:", error)
  })

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[App] Unhandled rejection at:", promise, "reason:", reason)
  })
}
