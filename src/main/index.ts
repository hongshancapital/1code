import { app, BrowserWindow, session, Menu, protocol, net } from "electron"
import { join } from "path"
import { readFileSync, existsSync, unlinkSync, readlinkSync, createReadStream, statSync } from "fs"
import { Readable } from "stream"
import { pathToFileURL } from "url"
import * as Sentry from "@sentry/electron/main"
import { initDatabase, closeDatabase } from "./lib/db"
import { createMainWindow, getWindow } from "./windows/main"
import { getDeviceId } from "./lib/device-id"
import {
  initAnalytics,
  trackAppOpened,
  shutdown as shutdownAnalytics,
} from "./lib/analytics"
import {
  initAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  setupFocusUpdateCheck,
} from "./lib/auto-updater"
import { cleanupGitWatchers } from "./lib/git/watcher"

// Dev mode detection
const IS_DEV = !!process.env.ELECTRON_RENDERER_URL

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
  const sentryDsn = import.meta.env.MAIN_VITE_SENTRY_DSN
  if (sentryDsn) {
    try {
      Sentry.init({
        dsn: sentryDsn,
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
// In packaged app, ALWAYS use production URL to prevent localhost leaking into releases
// In dev mode, allow override via MAIN_VITE_API_URL env variable
export function getBaseUrl(): string {
  if (app.isPackaged) {
    return "https://cowork.hongshan.com"
  }
  return import.meta.env.MAIN_VITE_API_URL || "https://cowork.hongshan.com"
}

export function getAppUrl(): string {
  return process.env.ELECTRON_RENDERER_URL || "https://cowork.hongshan.com/agents"
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
  // Handle second instance launch
  app.on("second-instance", (_event, _commandLine) => {
    const window = getWindow()
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  // App ready
  app.whenReady().then(async () => {
    // Set dev mode app name (userData path was already set before requestSingleInstanceLock)
    if (IS_DEV) {
      app.name = "Agents Dev"
    }

    // Initialize device ID early
    const deviceId = getDeviceId()
    console.log("[App] Device ID:", deviceId.slice(0, 8) + "...")

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

    // Set app user model ID for Windows (different in dev to avoid taskbar conflicts)
    if (process.platform === "win32") {
      app.setAppUserModelId(IS_DEV ? "dev.21st.1code.dev" : "dev.21st.1code")
    }

    console.log(`[App] Starting Hóng${IS_DEV ? " (DEV)" : ""}...`)

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
      applicationName: "Hóng",
      applicationVersion: app.getVersion(),
      version: `Claude Code ${claudeCodeVersion}`,
      copyright: "Copyright © 2026 HongShan",
    })

    // Track update availability for menu
    let updateAvailable = false
    let availableVersion: string | null = null

    // Function to build and set application menu
    const buildMenu = () => {
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: app.name,
          submenu: [
            { role: "about", label: "About Hóng" },
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
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
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
                await shell.openExternal("https://cowork.hongshan.com")
              },
            },
          ],
        },
      ]
      Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }

    // Set update state and rebuild menu
    const setUpdateAvailable = (available: boolean, version?: string) => {
      updateAvailable = available
      availableVersion = version || null
      buildMenu()
    }

    // Expose setUpdateAvailable globally for auto-updater
    ;(global as any).__setUpdateAvailable = setUpdateAvailable

    // Build initial menu
    buildMenu()

    // Initialize analytics
    initAnalytics()

    // Track app opened
    trackAppOpened()

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
      await initAutoUpdater(getWindow)
      // Setup update check on window focus (instead of periodic interval)
      setupFocusUpdateCheck(getWindow)
      // Check for updates 5 seconds after startup (force to bypass interval check)
      setTimeout(() => {
        checkForUpdates(true)
      }, 5000)
    }

    // Warm up MCP cache 3 seconds after startup (background, non-blocking)
    // This populates the cache so all future sessions can use filtered MCP servers
    setTimeout(async () => {
      try {
        const { warmupMcpCache } = await import("./lib/trpc/routers/claude")
        await warmupMcpCache()
      } catch (error) {
        console.error("[App] MCP warmup failed:", error)
      }
    }, 3000)

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
