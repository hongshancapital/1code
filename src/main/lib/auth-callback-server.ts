import { appendFileSync } from "fs"
import { createServer, Server } from "http"
import { join } from "path"
import { app, session } from "electron"
import { getAuthManager } from "../auth-manager"
import { handleMcpOAuthCallback } from "./mcp-auth"
import { login as sensorsLogin, track as sensorsTrack } from "./sensors-analytics"
import { AUTH_SERVER_PORT, OKTA_CALLBACK_PORT } from "../constants"
import { getEnv } from "./env"

// 嵌入 Tinker 时跳过 Hong 的 analytics（Tinker 有自己的 analytics）
const isEmbeddedInTinker = process.env.HONG_EMBEDDED_IN_TINKER === "true"

// Auth data returned after successful token exchange
export interface AuthSuccessData {
  user: { id: string; email: string; name?: string | null }
  token: string
  expiresAt: string
}

// Callback handlers for auth events (window notification delegated to caller)
export interface AuthCallbackHandlers {
  onAuthSuccess: (data: AuthSuccessData) => void
  onAuthError: (error: Error) => void
}

// Keep FAVICON for browser tab icon
const FAVICON_SVG = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="32" height="32" rx="6.4" fill="url(#paint0_linear_19166_6969)"/>
<path d="M22.5333 20.4C22.2388 20.4 22 20.1612 22 19.8667V12.1333C22 11.8388 22.2388 11.6 22.5333 11.6H27.8667C28.1612 11.6 28.4 11.8388 28.4 12.1333L28.4 12.7167C28.4 13.0112 28.1612 13.25 27.8667 13.25H23.6162L23.6162 15.1954H27.3333C27.6279 15.1954 27.8667 15.4342 27.8667 15.7288V16.2587C27.8667 16.5532 27.6279 16.792 27.3333 16.792H23.6162V18.75H27.8667C28.1612 18.75 28.4 18.9888 28.4 19.2833V19.8667C28.4 20.1612 28.1612 20.4 27.8667 20.4H22.5333Z" fill="white"/>
<path d="M15.1735 13.25C14.8789 13.25 14.6401 13.0112 14.6401 12.7167V12.1333C14.6401 11.8388 14.8789 11.6 15.1735 11.6H20.9068C21.2014 11.6 21.4401 11.8388 21.4401 12.1333V12.7167C21.4401 13.0112 21.2014 13.25 20.9068 13.25H18.8709V19.8667C18.8709 20.1612 18.6321 20.4 18.3376 20.4H17.7427C17.4481 20.4 17.2094 20.1612 17.2094 19.8667V13.25H15.1735Z" fill="white"/>
<path d="M3.59998 12.1333C3.59998 11.8388 3.83876 11.6 4.13331 11.6H4.6828C4.97736 11.6 5.21614 11.8388 5.21614 12.1333V18.75H9.46664C9.76119 18.75 9.99997 18.9888 9.99997 19.2833V19.8667C9.99997 20.1612 9.76119 20.4 9.46664 20.4H4.68609C4.54272 20.4 4.40539 20.3423 4.30508 20.2399L4.03095 19.96L3.7523 19.6755C3.65466 19.5758 3.59998 19.4419 3.59998 19.3023V12.1333Z" fill="white"/>
<path d="M13.0657 11.2L10.3999 13.9172L11.4665 15.0043L14.1323 12.2871L13.0657 11.2Z" fill="white"/>
<path d="M13.0667 14.0986L10.4009 16.8158L11.4674 17.9029L14.1332 15.1857L13.0667 14.0986Z" fill="white"/>
<path d="M13.0664 16.9957L10.4006 19.7129L11.4672 20.8L14.133 18.0828L13.0664 16.9957Z" fill="white"/>
<defs>
<linearGradient id="paint0_linear_19166_6969" x1="29.0667" y1="32.5333" x2="1.86667" y2="1.06667" gradientUnits="userSpaceOnUse">
<stop stop-color="#00A23A"/>
<stop offset="1" stop-color="#00B669"/>
</linearGradient>
</defs>
</svg>`
const FAVICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}`

function getBaseUrl(): string {
  return getEnv().MAIN_VITE_API_URL
}

// DEBUG: Log to file for production debugging (temporary - remove after debugging)
function logAuthDebug(message: string): void {
  try {
    const logPath = join(app.getPath("userData"), "auth-debug.log")
    const timestamp = new Date().toISOString()
    appendFileSync(logPath, `[${timestamp}] ${message}\n`)
  } catch {
    // Ignore logging errors
  }
}

// Handle auth code: exchange for tokens, set cookie, track analytics
// Window notification is delegated to handlers
export async function handleAuthCode(
  code: string,
  handlers: AuthCallbackHandlers
): Promise<void> {
  const authManager = getAuthManager()

  console.log("[Auth] Handling auth code:", code.slice(0, 8) + "...")
  logAuthDebug(`Handling auth code: ${code.slice(0, 8)}...`)
  logAuthDebug(`PKCE state provider: ${authManager?.getPkceState()?.provider || "none"}`)

  try {
    const authData = await authManager!.exchangeCode(code)
    console.log("[Auth] Success for user:", authData.user.email)
    logAuthDebug(`Success for user: ${authData.user.email}`)

    // Track successful authentication with Sensors (skip when embedded in Tinker)
    // Use email as distinctId to match Web SDK's sensors.login(email)
    if (!isEmbeddedInTinker) {
      sensorsLogin(authData.user.email)
      sensorsTrack("auth_completed", { user_id: authData.user.id })
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

    // Notify caller to handle window updates
    handlers.onAuthSuccess(authData)
  } catch (error) {
    console.error("[Auth] Exchange failed:", error)
    logAuthDebug(`Exchange failed: ${(error as Error).message}`)
    logAuthDebug(`Error stack: ${(error as Error).stack}`)

    handlers.onAuthError(error as Error)
  }
}

// Okta server state management
let oktaServer: Server | null = null
let oktaServerListening = false

// Start Okta callback server on-demand (before auth flow)
export function startOktaServer(handlers: AuthCallbackHandlers): void {
  if (oktaServer && oktaServerListening) {
    console.log("[Okta Callback] Server already running")
    return
  }

  // Create Okta OAuth callback server
  oktaServer = createServer((req, res) => {
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
        handleAuthCode(code, handlers).finally(() => {
          // Close Okta server after auth completes (success or error)
          stopOktaServer()
        })

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

  oktaServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[Okta Callback] Port ${OKTA_CALLBACK_PORT} is in use - another app may be using it`)
      console.warn(`[Okta Callback] Okta login may not work until port ${OKTA_CALLBACK_PORT} is available`)
      oktaServerListening = false
    } else {
      console.error("[Okta Callback] Server error:", err)
    }
  })

  oktaServer.listen(OKTA_CALLBACK_PORT, () => {
    oktaServerListening = true
    console.log(`[Okta Callback] Server started on http://localhost:${OKTA_CALLBACK_PORT}/implicit/callback`)
  })
}

// Stop Okta callback server (after auth completes)
export function stopOktaServer(): void {
  if (oktaServer && oktaServerListening) {
    oktaServer.close(() => {
      console.log("[Okta Callback] Server stopped")
      oktaServerListening = false
      oktaServer = null
    })
  }
}

// Start local HTTP server for MCP OAuth callbacks
// This server only handles MCP OAuth (/callback route)
// Okta/Azure auth uses a separate on-demand server (see startOktaServer)
export function startAuthCallbackServers(): { authServer: Server } {
  const authServer = createServer((req, res) => {
    const url = new URL(req.url || "", `http://localhost:${AUTH_SERVER_PORT}`)

    // Serve favicon
    if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
      res.writeHead(200, { "Content-Type": "image/svg+xml" })
      res.end(FAVICON_SVG)
      return
    }

    if (url.pathname === "/callback") {
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

  authServer.listen(AUTH_SERVER_PORT, () => {
    console.log(`[Auth Server] Listening on http://localhost:${AUTH_SERVER_PORT}`)
  })

  return { authServer }
}
