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
import type { Readable } from "stream"
import type { AuthManager} from "./auth-manager";
import { initAuthManager, getAuthManager as getAuthManagerFromModule } from "./auth-manager"
import {
  initSensors,
  login as sensorsLogin,
  shutdown as shutdownSensors,
} from "./lib/sensors-analytics"
import { buildHongMenuTemplate } from "./lib/menu"
import { closeDatabase, initDatabase } from "./lib/db"
import { parseLaunchDirectory } from "./lib/cli"
import { cleanupGitWatchers } from "./lib/git/watcher"
// AutomationEngine 初始化已迁入 feature/automation Extension lifecycle
import { migrateOldPlaygroundSubChats } from "./lib/playground/migrate-playground"
import { cleanupStaleDraftAttachmentDirs } from "./lib/trpc/routers/files"
import { cancelAllPendingOAuth, handleMcpOAuthCallback } from "./lib/mcp-auth"
import {
  createMainWindow,
  createWindow,
  getWindow,
  getAllWindows,
} from "./windows/main"
import { windowManager } from "./windows/window-manager"
import { initBrowserSession, registerWebviewHandlers } from "./feature/browser-mcp/lib/init"
import { IS_DEV } from "./constants"
import { initializeLogger, createLogger } from "./lib/logger"

// Deep link protocol (must match package.json build.protocols.schemes)
// Use different protocol in dev to avoid conflicts with production app
const PROTOCOL = IS_DEV ? "hong-dev" : "hong"

// Check if Hong is embedded in Tinker
const isEmbeddedInTinker = process.env.HONG_EMBEDDED_IN_TINKER === 'true'

// Set dev mode userData path BEFORE requestSingleInstanceLock()
// This ensures dev and prod have separate instance locks
// Skip if embedded in Tinker (Tinker manages its own userData path)
if (IS_DEV && !isEmbeddedInTinker) {
  const { join } = require("path")
  const devUserData = join(app.getPath("userData"), "..", "Agents Dev")
  app.setPath("userData", devUserData)
  console.log("[Dev] Using separate userData path:", devUserData)
}

// Initialize Sentry before app is ready (production only)
// Skip if embedded in Tinker (Tinker manages Sentry, @sentry/electron is singleton)

if (isEmbeddedInTinker) {
  console.log("[App] Skipping Sentry init (embedded in Tinker)")
} else if (app.isPackaged && !IS_DEV) {
  const env = getEnv()
  if (env.MAIN_VITE_SENTRY_DSN) {
    try {
      Sentry.init({
        dsn: env.MAIN_VITE_SENTRY_DSN,
        // Register sentry-ipc:// protocol handler on our custom session
        // (partition: "persist:main") in addition to the default session.
        // Without this, the handler only registers on defaultSession and
        // renderers using the custom session fall back to fetch, causing
        // ERR_UNKNOWN_URL_SCHEME errors.
        getSessions: () => {
          const sessions = [session.defaultSession]
          const custom = session.fromPartition("persist:main")
          if (custom !== session.defaultSession) {
            sessions.push(custom)
          }
          return sessions
        },
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

// Initialize unified logger (must be after Sentry, before everything else)
initializeLogger()
const log = createLogger("App")
const authLog = createLogger("Auth")
const deepLinkLog = createLogger("DeepLink")
const localFileLog = createLogger("LocalFile")
const protocolLog = createLogger("Protocol")

// URL configuration (exported for use in other modules)
// Returns undefined in no-auth mode
export function getBaseUrl(): string | undefined {
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
        authLog.warn("Failed to reload window:", error)
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
  deepLinkLog.info("Received:", url)

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

    // Handle navigation deep link: hong://navigate/{chatId}/{subChatId}/{messageId}?highlight=xxx
    if (parsed.pathname.startsWith("/navigate") || parsed.host === "navigate") {
      const pathParts = (parsed.host === "navigate" ? parsed.pathname : parsed.pathname.replace(/^\/navigate/, ""))
        .split("/")
        .filter(Boolean)
      const chatId = pathParts[0]
      if (chatId) {
        const route = {
          chatId,
          subChatId: pathParts[1] || undefined,
          messageId: pathParts[2] || undefined,
          highlight: parsed.searchParams.get("highlight") || undefined,
          timestamp: Date.now(),
        }
        deepLinkLog.info("Navigate route:", route)
        const windows = getAllWindows()
        for (const win of windows) {
          if (!win.isDestroyed()) {
            win.webContents.send("navigate:route", route)
            win.focus()
            break
          }
        }
        return
      }
    }
  } catch (e) {
    deepLinkLog.error("Failed to parse:", e)
  }
}

// ============================================================================
// STANDALONE APP LIFECYCLE
// Skip everything below when embedded in Tinker (Tinker manages its own lifecycle)
// ============================================================================
if (!isEmbeddedInTinker) {

// Register custom scheme for local file access BEFORE app is ready
// This must be called before app.whenReady()
// CRITICAL: This registration happens at module load time, before any async code
localFileLog.info("Registering scheme as privileged (before app ready)...")
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
  localFileLog.info("Scheme registered successfully")
} catch (err) {
  localFileLog.error("Failed to register scheme:", err)
}

// Register protocol BEFORE app is ready
protocolLog.info("========== PROTOCOL REGISTRATION ==========")
protocolLog.info("Protocol:", PROTOCOL)
protocolLog.info("Is dev mode (process.defaultApp):", process.defaultApp)
protocolLog.info("process.execPath:", process.execPath)
protocolLog.info("process.argv:", process.argv)

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
      protocolLog.info(
        "Dev mode registration:",
        success ? "success" : "failed",
      )
    } else {
      protocolLog.warn("Dev mode: insufficient argv for registration")
    }
  } else {
    // Production mode
    success = app.setAsDefaultProtocolClient(PROTOCOL)
    protocolLog.info(
      "Production registration:",
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

  protocolLog.info(`Verification - isDefaultProtocolClient: ${isDefault}`)

  if (!isDefault && initialRegistration) {
    protocolLog.warn(
      "Registration returned success but verification failed.",
    )
    protocolLog.warn(
      "This is common on first install - macOS Launch Services may need time to update.",
    )
    protocolLog.warn("The protocol should work after app restart.")
  }
}

protocolLog.info("=============================================")

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
        log.info("Lock held by running process:", pid)
        return false
      } catch {
        // Process doesn't exist, clean up stale locks
        log.info("Cleaning stale locks (pid", pid, "not running)")
        const filesToRemove = ["SingletonLock", "SingletonSocket", "SingletonCookie"]
        for (const file of filesToRemove) {
          const filePath = join(userDataPath, file)
          if (existsSync(filePath)) {
            try {
              unlinkSync(filePath)
            } catch (e) {
              log.warn("Failed to remove", file, e)
            }
          }
        }
        return true
      }
    }
  } catch (e) {
    log.warn("Failed to check lock file:", e)
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
    // Skip if embedded in Tinker (Tinker manages its own app name)
    if (IS_DEV && !isEmbeddedInTinker) {
      app.name = "Agents Dev"
    }

    // Register protocol handler (must be after app is ready)
    initialRegistration = registerProtocol()

    // Configure browser webview session (User-Agent etc.)
    initBrowserSession()

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
        localFileLog.warn("Blocked path traversal:", filePath)
        return new Response("Forbidden", { status: 403 })
      }

      if (!existsSync(filePath)) {
        localFileLog.warn("File not found:", filePath)
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

            localFileLog.info("206 Partial Content:", filePath, `${start}-${end}/${fileSize}`)

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

        localFileLog.info("200 OK:", filePath, `${fileSize} bytes`)

        return new Response(readableStream, {
          status: 200,
          headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(fileSize),
            "Content-Type": mimeType,
          },
        })
      } catch (error) {
        localFileLog.error("Error reading file:", filePath, error)
        return new Response("Internal Server Error", { status: 500 })
      }
    })
    localFileLog.info("Protocol handler registered with Range request support")

    // Handle webview new-window events - convert popups to same-page navigation
    registerWebviewHandlers()

    // Handle deep link on macOS (app already running)
    app.on("open-url", (event, url) => {
      protocolLog.info("open-url event received:", url)
      event.preventDefault()
      handleDeepLink(url)
    })

    // Set app user model ID for Windows (different in dev to avoid taskbar conflicts)
    if (process.platform === "win32") {
      app.setAppUserModelId(IS_DEV ? "com.hongshan.hong.dev" : "com.hongshan.hong")
    }

    log.info(`Starting Hong${IS_DEV ? " (DEV)" : ""}...`)

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
      log.warn("Failed to read Claude Code version:", error)
    }

    // Set About panel options with Claude Code version
    app.setAboutPanelOptions({
      applicationName: "Hong",
      applicationVersion: app.getVersion(),
      version: `Claude Code ${claudeCodeVersion}`,
      copyright: "Copyright © 2026 Hóng",
    })

    // Track devtools unlock state (hidden feature - 5 clicks on Beta tab)
    let devToolsUnlocked = false

    // Function to build and set application menu (uses shared template from lib/menu.ts)
    const buildMenu = () => {
      const template = buildHongMenuTemplate({
        getWindow,
        showDevTools: !app.isPackaged || devToolsUnlocked,
        onMenuChanged: () => buildMenu(),
      })
      Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }

    // macOS: Set dock menu (right-click on dock icon)
    if (process.platform === "darwin") {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: "New Window",
          click: () => {
            log.info("New Window clicked")
            createWindow()
          },
        },
      ])
      app.dock?.setMenu(dockMenu)
    }

    // Unlock devtools and rebuild menu (called from renderer via IPC)
    const unlockDevTools = () => {
      if (!devToolsUnlocked) {
        devToolsUnlocked = true
        log.info("DevTools unlocked via hidden feature")
        buildMenu()
      }
    }

    // Expose unlockDevTools globally for IPC handler
    globalThis.__unlockDevTools = unlockDevTools

    // Build initial menu
    buildMenu()

    // Initialize auth manager (uses singleton from auth-manager module)
    authManager = initAuthManager(!!process.env.ELECTRON_RENDERER_URL)
    log.info("Auth manager initialized")

    // Set auth callback handlers to AuthManager for on-demand Okta server startup
    authManager.setAuthCallbackHandlers(authCallbackHandlers)

    // Initialize Sensors Analytics (skip if embedded in Tinker)
    if (!isEmbeddedInTinker) {
      initSensors()
    }

    // If user already authenticated from previous session, validate token and refresh user info
    if (authManager.isAuthenticated()) {
      log.info("Validating saved authentication...")
      const validatedUser = await authManager.validateAndRefreshUser()

      if (validatedUser) {
        // Token is valid, login user for Sensors Analytics (use email as distinctId)
        sensorsLogin(validatedUser.email)
      } else {
        // Token expired (401), try to refresh first
        log.info("Token expired, attempting refresh...")
        const refreshed = await authManager.refresh()

        if (refreshed) {
          // Refresh successful, validate again to get fresh user info
          const refreshedUser = await authManager.validateAndRefreshUser()
          if (refreshedUser) {
            sensorsLogin(refreshedUser.email)
          }
        } else {
          // Refresh failed, auto-start OAuth for returning users
          log.info("Token refresh failed, auto-starting OAuth for returning user...")
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
      authLog.info("Token refreshed, updating cookie...")
      const baseUrl = getBaseUrl()
      if (!baseUrl) {
        authLog.info("API URL not configured, skipping cookie update")
        return
      }
      const ses = session.fromPartition("persist:main")
      try {
        await ses.cookies.set({
          url: baseUrl,
          name: "x-desktop-token",
          value: authData.token,
          expirationDate: Math.floor(
            new Date(authData.expiresAt).getTime() / 1000,
          ),
          httpOnly: false,
          secure: baseUrl.startsWith("https"),
          sameSite: "lax" as const,
        })
        authLog.info("Desktop token cookie updated after refresh")
      } catch (err) {
        authLog.error("Failed to update cookie:", err)
      }
    })

    // Initialize database
    try {
      initDatabase()
      log.info("Database initialized")
    } catch (error) {
      log.error("Failed to initialize database:", error)
    }

    // Cleanup stale draft attachment files (older than 7 days)
    cleanupStaleDraftAttachmentDirs().catch((err) => {
      log.warn("Failed to cleanup stale draft attachments:", err)
    })

    // Migrate old playground format to new independent format
    try {
      const { migrated, skipped } = await migrateOldPlaygroundSubChats()
      if (migrated > 0 || skipped > 0) {
        log.info(`Playground migration: ${migrated} migrated, ${skipped} skipped`)
      }
    } catch (error) {
      log.error("Playground migration failed:", error)
    }

    // Initialize ExtensionManager（AutomationEngine 由其 Extension lifecycle 初始化）
    try {
      const { getExtensionManager } = await import("./lib/extension")
      // 加载 chat lifecycle hooks（运行时模式注册副作用）
      await import("./lib/extension/hooks/chat-lifecycle")
      const { liteExtension } = await import("./feature/lite")
      const { memoryExtension } = await import("./feature/memory")
      const { browserMcpExtension } = await import("./feature/browser-mcp")
      const { imageMcpExtension } = await import("./feature/image-mcp")
      const { chatTitleMcpExtension } = await import("./feature/chat-title-mcp")
      const { usageTrackingExtension } = await import(
        "./feature/usage-tracking"
      )
      const { automationExtension } = await import("./feature/automation")
      const { voiceExtension } = await import("./feature/voice")
      const { insightsExtension } = await import("./feature/insights")
      const { terminalExtension } = await import("./feature/terminal")
      const { runnerExtension } = await import("./feature/runner")
      const { lspExtension } = await import("./feature/lsp")
      const { ollamaExtension } = await import("./feature/ollama")
      const { pluginSystemExtension } = await import("./feature/plugin-system")
      const em = getExtensionManager()
      em.register(liteExtension)
      em.register(memoryExtension)
      em.register(browserMcpExtension)
      em.register(imageMcpExtension)
      em.register(chatTitleMcpExtension)
      em.register(usageTrackingExtension)
      em.register(automationExtension)
      em.register(voiceExtension)
      em.register(insightsExtension)
      em.register(terminalExtension)
      em.register(runnerExtension)
      em.register(lspExtension)
      em.register(ollamaExtension)
      em.register(pluginSystemExtension)
      await em.initializeAll()
      log.info("ExtensionManager initialized")
    } catch (error) {
      log.error("ExtensionManager init failed:", error)
    }

    // Sync all skills (builtin + enabled plugins) via SkillManager
    try {
      const { getSkillManager } = await import("./lib/skills")
      const sm = getSkillManager()
      await sm.syncAllBuiltinSkills()

      // Also sync skills from enabled plugins
      const { getEnabledPlugins } = await import("./lib/trpc/routers/claude-settings")
      const { discoverInstalledPlugins } = await import("./feature/plugin-system/lib")
      const [enabledSources, allPlugins] = await Promise.all([
        getEnabledPlugins(),
        discoverInstalledPlugins(),
      ])
      for (const plugin of allPlugins) {
        if (enabledSources.includes(plugin.source)) {
          await sm.syncPluginSkills(plugin.source, plugin.path)
        }
      }
      log.info("Skills synced (builtin + enabled plugins)")
    } catch (error) {
      log.warn("Failed to sync skills:", error)
    }

    // Create main window
    createMainWindow()

    // 异步预加载 shell 环境 → 然后启动 MCP 预热
    // 整体不 await，不阻塞窗口显示和后续逻辑
    ;(async () => {
      // 先异步加载 shell 环境到缓存，避免 warmup 中 execSync 阻塞主线程
      const { preloadShellEnvironment } = await import("./lib/claude/env")
      await preloadShellEnvironment()

      // MCP 预热(返回 Promise 供首次 query 等待)
      const { getMcpWarmupManager } = await import("./lib/claude/mcp-warmup-manager")
      const warmupManager = getMcpWarmupManager()
      warmupManager.startWarmup().catch((error) => {
        log.error("MCP warmup failed:", error)
      })
      log.info("MCP warmup started immediately after app ready")
    })().catch((error) => {
      log.error("Shell env preload / MCP warmup init failed:", error)
    })

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
    log.info("Shutting down...")
    cancelAllPendingOAuth()
    // AutomationEngine cleanup 由 ExtensionManager.cleanupAll() 统一处理
    try {
      const { getExtensionManager } = await import("./lib/extension")
      await getExtensionManager().cleanupAll()
    } catch {
      // extension cleanup 错误不阻塞退出
    }
    await cleanupGitWatchers()
    // App duration is now tracked in renderer via beacon (survives page unload)
    await shutdownSensors()
    await closeDatabase()
  })

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception:", error)
  })

  process.on("unhandledRejection", (reason, promise) => {
    log.error("Unhandled rejection at:", promise, "reason:", reason)
  })
}

} // end if (!isEmbeddedInTinker)
