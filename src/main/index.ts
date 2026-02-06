import * as Sentry from "@sentry/electron/main"
import { validateEnv, getEnv } from "./lib/env"
import { app, BrowserWindow, Menu, protocol, session } from "electron"

// Increase V8 heap memory limit to prevent OOM with large chat histories
// Default is ~2GB, increase to 8GB for safety
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=8192")

// Validate environment variables early (before app logic starts)
// This will throw if required env vars are missing
validateEnv()
import { createReadStream, existsSync, readFileSync, readlinkSync, statSync, unlinkSync } from "fs"
import { join } from "path"
import { startAuthCallbackServers,  handleAuthCode, type AuthCallbackHandlers } from "./lib/auth-callback-server"
import { Readable } from "stream"
import { AuthManager, initAuthManager, getAuthManager as getAuthManagerFromModule } from "./auth-manager"
import {
  initSensors,
  login as sensorsLogin,
  shutdown as shutdownSensors,
  track as sensorsTrack,
} from "./lib/sensors-analytics"
import {
  checkForUpdates,
  downloadUpdate,
  initAutoUpdater,
  setupFocusUpdateCheck,
} from "./lib/auto-updater"
import { closeDatabase, initDatabase } from "./lib/db"
import {
  isCliInstalled,
  installCli,
  uninstallCli,
  parseLaunchDirectory,
} from "./lib/cli"
import { cleanupGitWatchers } from "./lib/git/watcher"
import { AutomationEngine } from "./lib/automation/engine"
import { ensureInboxProject } from "./lib/automation/inbox-project"
import { migrateOldPlaygroundSubChats } from "./lib/playground/migrate-playground"
import { cancelAllPendingOAuth, handleMcpOAuthCallback } from "./lib/mcp-auth"
import {
  createMainWindow,
  createWindow,
  getWindow,
  getAllWindows,
} from "./windows/main"
import { windowManager } from "./windows/window-manager"

import { IS_DEV } from "./constants"

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
// Skip if embedded in Tinker (Tinker manages Sentry, @sentry/electron is singleton)
const isEmbeddedInTinker = process.env.HONG_EMBEDDED_IN_TINKER === 'true'

if (isEmbeddedInTinker) {
  console.log("[App] Skipping Sentry init (embedded in Tinker)")
} else if (app.isPackaged && !IS_DEV) {
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
    console.log("[App] Skipping Sentry init (no DSN configured)")
  }
} else {
  console.log("[App] Skipping Sentry init (dev mode)")
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

// Auth callback handlers for window notification (used by auth-callback-server)
export const authCallbackHandlers: AuthCallbackHandlers = {
  onAuthSuccess: (authData) => {
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
  },
  onAuthError: (error) => {
    // Broadcast auth error to all windows (not just focused)
    for (const win of getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send("auth:error", error.message)
        }
      } catch {
        // Window destroyed during iteration
      }
    }
  },
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
        handleAuthCode(code, authCallbackHandlers)
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

// Start auth callback server for MCP OAuth (Okta auth uses on-demand server)
startAuthCallbackServers()


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

    // Set auth callback handlers to AuthManager for on-demand Okta server startup
    authManager.setAuthCallbackHandlers(authCallbackHandlers)

    // Initialize Sensors Analytics (skip if embedded in Tinker)
    if (isEmbeddedInTinker) {
      console.log("[App] Skipping Sensors init (embedded in Tinker)")
    } else {
      initSensors()
      console.log("[App] Sensors Analytics initialized")

      // 测试神策埋点 - 发送应用启动事件
      sensorsTrack("cowork_app_started", {
        timestamp: new Date().toISOString(),
      })
      console.log("[Sensors] Test event sent: cowork_app_started")
    }

    // If user already authenticated from previous session, validate token and refresh user info
    if (authManager.isAuthenticated()) {
      console.log("[App] Validating saved authentication...")
      const validatedUser = await authManager.validateAndRefreshUser()

      if (validatedUser) {
        // Token is valid, login user for Sensors Analytics (use email as distinctId)
        sensorsLogin(validatedUser.email)
        console.log("[Sensors] User logged in from validated session:", validatedUser.email)
      } else {
        // Token expired (401), try to refresh first
        console.log("[App] Token expired, attempting refresh...")
        const refreshed = await authManager.refresh()

        if (refreshed) {
          // Refresh successful, validate again to get fresh user info
          const refreshedUser = await authManager.validateAndRefreshUser()
          if (refreshedUser) {
            sensorsLogin(refreshedUser.email)
            console.log("[Sensors] User logged in after token refresh:", refreshedUser.email)
          }
        } else {
          // Refresh failed, auto-start OAuth for returning users
          console.log("[App] Token refresh failed, auto-starting OAuth for returning user...")
          const windows = getAllWindows()
          if (windows.length > 0) {
            // Notify renderer that we're re-authenticating
            windows[0]!.webContents.send("auth:reauthenticating")
            authManager.startAuthFlow(windows[0]!)
          }
          // Don't logout - keep the saved auth data for provider info
        }
      }
    }

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

    // Migrate old playground format to new independent format
    try {
      const { migrated, skipped } = await migrateOldPlaygroundSubChats()
      if (migrated > 0 || skipped > 0) {
        console.log(`[App] Playground migration: ${migrated} migrated, ${skipped} skipped`)
      }
    } catch (error) {
      console.error("[App] Playground migration failed:", error)
    }

    // Initialize AutomationEngine
    try {
      await ensureInboxProject()
      await AutomationEngine.getInstance().initialize()
      console.log("[App] AutomationEngine initialized")
    } catch (error) {
      console.error("[App] AutomationEngine init failed:", error)
    }

    // Sync builtin skills to user directory (for Claude SDK discovery)
    try {
      const { syncBuiltinSkillsToUserDir } = await import("./lib/trpc/routers/skills")
      await syncBuiltinSkillsToUserDir()
      console.log("[App] Builtin skills synced")
    } catch (error) {
      console.warn("[App] Failed to sync builtin skills:", error)
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
    AutomationEngine.getInstance().cleanup()
    await cleanupGitWatchers()
    await shutdownSensors()
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
