import { router, publicProcedure } from "../index"
import { getDatabase, closeDatabase, initDatabase, projects, chats, subChats } from "../../db"
import { app, shell, BrowserWindow, session } from "electron"
import { z } from "zod"
import { clearNetworkCache } from "../../ollama/network-detector"
import { getAuthManager } from "../../../auth-manager"
import { join } from "path"
import { existsSync, copyFileSync, mkdirSync, rmSync, readdirSync, unlinkSync, rmdirSync, statSync } from "fs"
import { spawn } from "child_process"
import { EventEmitter } from "events"

// Simulated runtime installation state
interface SimulatedInstallState {
  isRunning: boolean
  logs: string[]
  currentStep: string
  progress: number
  error: string | null
  emitter: EventEmitter
}

const simulatedInstallState: SimulatedInstallState = {
  isRunning: false,
  logs: [],
  currentStep: "",
  progress: 0,
  error: null,
  emitter: new EventEmitter(),
}

// Protocol constant (must match main/index.ts)
const IS_DEV = !app.isPackaged
const PROTOCOL = IS_DEV ? "hong-dev" : "hong"

// Helper function for delays
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Execute command with timeout
async function execWithTimeout(command: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32"
    const shell = isWindows ? "cmd.exe" : "/bin/bash"
    const shellArgs = isWindows ? ["/c", command] : ["-c", command]

    const child = spawn(shell, shellArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    })

    let output = ""
    let resolved = false

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        try {
          child.kill("SIGKILL")
        } catch {
          // Ignore
        }
        resolve(null)
      }
    }, timeoutMs)

    child.stdout?.on("data", (data) => {
      output += data.toString()
    })

    child.on("close", () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(output.trim() || null)
      }
    })

    child.on("error", () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(null)
      }
    })
  })
}

// Global flag for simulating offline mode (for testing)
let simulateOfflineMode = false

/**
 * Check if offline mode is being simulated (for testing)
 * Used by network-detector.ts
 */
export function isOfflineSimulated(): boolean {
  return simulateOfflineMode
}

// Store for last user message debug data
interface UserMessageDebugData {
  subChatId: string
  timestamp: string
  requestPayload: Record<string, unknown>
}
const lastUserMessageDebugData = new Map<string, UserMessageDebugData>()

/**
 * Store user message debug data for display
 * This is called from claude router when a user sends a message
 */
export function setLastUserMessageDebug(subChatId: string, data: Record<string, unknown>) {
  console.log('[Debug] Saving debug data for subChat:', subChatId, 'keys:', Object.keys(data), 'data:', data)
  lastUserMessageDebugData.set(subChatId, {
    subChatId,
    timestamp: new Date().toISOString(),
    requestPayload: data,
  })
}

export const debugRouter = router({
  /**
   * Get system information for debug display
   */
  getSystemInfo: publicProcedure.query(() => {
    // Check protocol registration
    let protocolRegistered = false
    try {
      protocolRegistered = process.defaultApp
        ? app.isDefaultProtocolClient(
            PROTOCOL,
            process.execPath,
            [process.argv[1]!],
          )
        : app.isDefaultProtocolClient(PROTOCOL)
    } catch {
      protocolRegistered = false
    }

    return {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      isDev: IS_DEV,
      userDataPath: app.getPath("userData"),
      protocolRegistered,
    }
  }),

  /**
   * Get database statistics
   */
  getDbStats: publicProcedure.query(() => {
    const db = getDatabase()
    const projectCount = db.select().from(projects).all().length
    const chatCount = db.select().from(chats).all().length
    const subChatCount = db.select().from(subChats).all().length

    return {
      projects: projectCount,
      chats: chatCount,
      subChats: subChatCount,
    }
  }),

  /**
   * Clear all chats and sub-chats (keeps projects)
   */
  clearChats: publicProcedure.mutation(() => {
    const db = getDatabase()
    // Delete sub_chats first (foreign key constraint)
    db.delete(subChats).run()
    db.delete(chats).run()
    console.log("[Debug] Cleared all chats and sub-chats")
    return { success: true }
  }),

  /**
   * Clear all data (projects, chats, sub-chats)
   */
  clearAllData: publicProcedure.mutation(() => {
    const db = getDatabase()
    // Delete in order due to foreign key constraints
    db.delete(subChats).run()
    db.delete(chats).run()
    db.delete(projects).run()
    console.log("[Debug] Cleared all database data")
    return { success: true }
  }),

  /**
   * Reset onboarding state
   * Clears localStorage flags to restart onboarding flow
   */
  resetOnboarding: publicProcedure.mutation(() => {
    console.log("[Debug] Reset onboarding - this clears localStorage on renderer side")
    return { success: true, message: "Clear localStorage:billing-method, localStorage:anthropic-onboarding-completed, localStorage:api-key-onboarding-completed in renderer" }
  }),

  /**
   * Open userData folder in system file manager
   */
  openUserDataFolder: publicProcedure.mutation(() => {
    const userDataPath = app.getPath("userData")
    shell.openPath(userDataPath)
    console.log("[Debug] Opened userData folder:", userDataPath)
    return { success: true }
  }),

  /**
   * Get offline simulation status
   */
  getOfflineSimulation: publicProcedure.query(() => {
    return { enabled: simulateOfflineMode }
  }),

  /**
   * Set offline simulation status (for testing)
   */
  setOfflineSimulation: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(({ input }) => {
      simulateOfflineMode = input.enabled
      // Clear network cache to force immediate re-check
      clearNetworkCache()
      console.log(`[Debug] Offline simulation ${input.enabled ? "enabled" : "disabled"}`)
      return { success: true, enabled: simulateOfflineMode }
    }),

  /**
   * Factory reset - clear ALL data and return to login page
   * This resets the app to its initial state as if freshly installed
   */
  factoryReset: publicProcedure.mutation(async () => {
    console.log("[Debug] Starting factory reset...")

    const userDataPath = app.getPath("userData")
    console.log("[Debug] userData path:", userDataPath)

    // 1. Close all database connections
    try {
      closeDatabase()
      console.log("[Debug] Database connection closed")
    } catch (error) {
      console.warn("[Debug] Failed to close database:", error)
    }

    // 2. Clear authentication data before deleting userData
    const authManager = getAuthManager()
    if (authManager) {
      authManager.logout("manual")
      console.log("[Debug] Auth data cleared")
    }

    // 3. Clear session cookies before deleting userData
    try {
      const ses = session.fromPartition("persist:main")
      await ses.clearStorageData()
      console.log("[Debug] Session storage cleared")
    } catch (error) {
      console.warn("[Debug] Failed to clear session storage:", error)
    }

    // 4. Recursively delete userData directory
    // This clears: database, artifacts, insights, terminal history,
    // claude-sessions, project icons, and any other app data
    if (existsSync(userDataPath)) {
      try {
        rmSync(userDataPath, { recursive: true, force: true })
        console.log("[Debug] userData directory deleted")
      } catch (error) {
        console.error("[Debug] Failed to delete userData directory:", error)
        // If full delete fails, try to at least delete data folder
        const dataPath = join(userDataPath, "data")
        if (existsSync(dataPath)) {
          try {
            rmSync(dataPath, { recursive: true, force: true })
            console.log("[Debug] data folder deleted as fallback")
          } catch (err) {
            console.error("[Debug] Failed to delete data folder:", err)
          }
        }
      }
    }

    // 5. Navigate all windows to login page
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      try {
        if (win.isDestroyed()) continue

        // In dev mode, login.html is in src/renderer
        if (process.env.ELECTRON_RENDERER_URL) {
          const loginPath = join(app.getAppPath(), "src/renderer/login.html")
          win.loadFile(loginPath)
        } else {
          // Production: load from built output
          win.loadFile(join(__dirname, "../../renderer/login.html"))
        }
        console.log("[Debug] Window navigated to login page")
      } catch (error) {
        console.warn("[Debug] Failed to navigate window:", error)
      }
    }

    // 7. Database will be re-initialized automatically on next access
    console.log("[Debug] Factory reset complete - database will reinitialize on demand")
    return { success: true }
  }),

  /**
   * Start simulated runtime installation for debugging
   * This mimics the initial runtime detection and installation flow
   */
  startSimulatedInstall: publicProcedure
    .input(z.object({
      injectError: z.enum(["none", "detection", "download", "install", "timeout"]).default("none"),
      skipTools: z.array(z.string()).default([]),
    }))
    .mutation(async ({ input }) => {
      if (simulatedInstallState.isRunning) {
        return { success: false, error: "Installation already running" }
      }

      // Reset state
      simulatedInstallState.isRunning = true
      simulatedInstallState.logs = []
      simulatedInstallState.currentStep = "initializing"
      simulatedInstallState.progress = 0
      simulatedInstallState.error = null

      const addLog = (message: string, level: "info" | "error" | "success" | "warn" = "info") => {
        const timestamp = new Date().toISOString().split("T")[1].split(".")[0]
        const prefix = level === "error" ? "❌" : level === "success" ? "✅" : level === "warn" ? "⚠️" : "ℹ️"
        const log = `[${timestamp}] ${prefix} ${message}`
        simulatedInstallState.logs.push(log)
        simulatedInstallState.emitter.emit("log", log)
      }

      // Run the simulation asynchronously
      ;(async () => {
        try {
          // Step 1: Initialize
          addLog("Starting runtime installation simulation...")
          addLog(`Injection mode: ${input.injectError}`)
          if (input.skipTools.length > 0) {
            addLog(`Skipping tools: ${input.skipTools.join(", ")}`)
          }
          await sleep(500)
          simulatedInstallState.progress = 5

          // Step 2: System detection
          simulatedInstallState.currentStep = "detecting"
          addLog("Detecting system environment...")
          await sleep(300)
          addLog(`Platform: ${process.platform}`)
          addLog(`Architecture: ${process.arch}`)
          addLog(`Node version: ${process.version}`)
          simulatedInstallState.progress = 15

          if (input.injectError === "detection") {
            throw new Error("Simulated detection error: Unable to determine system capabilities")
          }

          // Step 3: Check existing tools
          simulatedInstallState.currentStep = "checking"
          addLog("Checking existing tools...")
          await sleep(400)

          const toolsToCheck = [
            { name: "git", displayName: "Git", required: true },
            { name: "rg", displayName: "ripgrep", required: true },
            { name: "jq", displayName: "jq", required: false },
            { name: "curl", displayName: "curl", required: false },
            { name: "bun", displayName: "Bun", required: true },
            { name: "node", displayName: "Node.js", required: false },
            { name: "python3", displayName: "Python", required: false },
          ]

          for (const tool of toolsToCheck) {
            if (input.skipTools.includes(tool.name)) {
              addLog(`Skipping ${tool.displayName}...`, "warn")
              continue
            }

            await sleep(200)
            const whichCmd = process.platform === "win32" ? "where" : "which"
            try {
              const result = await execWithTimeout(`${whichCmd} ${tool.name}`, 3000)
              if (result) {
                addLog(`Found ${tool.displayName} at ${result.trim().split("\n")[0]}`, "success")
              } else {
                if (tool.required) {
                  addLog(`${tool.displayName} not found (required)`, "warn")
                } else {
                  addLog(`${tool.displayName} not found (optional)`, "info")
                }
              }
            } catch {
              addLog(`${tool.displayName} check failed`, "warn")
            }
          }
          simulatedInstallState.progress = 40

          // Step 4: Download phase
          simulatedInstallState.currentStep = "downloading"
          addLog("Simulating tool download phase...")
          await sleep(500)

          if (input.injectError === "download") {
            throw new Error("Simulated download error: Network connection failed")
          }

          addLog("Downloading tool manifests...", "info")
          await sleep(300)
          addLog("Verifying checksums...", "info")
          await sleep(200)
          simulatedInstallState.progress = 60

          // Step 5: Install phase
          simulatedInstallState.currentStep = "installing"
          addLog("Simulating installation phase...")
          await sleep(400)

          if (input.injectError === "install") {
            throw new Error("Simulated install error: Permission denied during installation")
          }

          const installSteps = [
            "Preparing installation environment...",
            "Extracting binaries...",
            "Setting up PATH entries...",
            "Configuring shell integration...",
            "Validating installation...",
          ]

          for (let i = 0; i < installSteps.length; i++) {
            await sleep(300)
            addLog(installSteps[i])
            simulatedInstallState.progress = 60 + ((i + 1) / installSteps.length) * 30
          }

          if (input.injectError === "timeout") {
            addLog("Installation taking longer than expected...", "warn")
            await sleep(2000)
            throw new Error("Simulated timeout error: Installation timed out after 30 seconds")
          }

          // Step 6: Verification
          simulatedInstallState.currentStep = "verifying"
          addLog("Verifying installation...")
          await sleep(400)
          addLog("All tools verified successfully", "success")
          simulatedInstallState.progress = 95

          // Step 7: Complete
          simulatedInstallState.currentStep = "complete"
          await sleep(200)
          addLog("Runtime installation simulation completed!", "success")
          simulatedInstallState.progress = 100

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error"
          addLog(errorMessage, "error")
          simulatedInstallState.error = errorMessage
          simulatedInstallState.currentStep = "error"
        } finally {
          simulatedInstallState.isRunning = false
          simulatedInstallState.emitter.emit("complete")
        }
      })()

      return { success: true }
    }),

  /**
   * Get current state of simulated installation
   */
  getSimulatedInstallState: publicProcedure.query(() => {
    return {
      isRunning: simulatedInstallState.isRunning,
      logs: simulatedInstallState.logs,
      currentStep: simulatedInstallState.currentStep,
      progress: simulatedInstallState.progress,
      error: simulatedInstallState.error,
    }
  }),

  /**
   * Reset simulated installation state
   */
  resetSimulatedInstall: publicProcedure.mutation(() => {
    simulatedInstallState.isRunning = false
    simulatedInstallState.logs = []
    simulatedInstallState.currentStep = ""
    simulatedInstallState.progress = 0
    simulatedInstallState.error = null
    return { success: true }
  }),

  /**
   * Copy production database to development environment (dev only)
   * This allows testing with real data from the release version
   */
  copyProductionDb: publicProcedure.mutation(async () => {
    // Only allow in dev mode
    if (!IS_DEV) {
      throw new Error("This operation is only available in development mode")
    }

    // Determine production app data path
    // Production app name is "hong-desktop", dev is "Agents Dev"
    const userDataPath = app.getPath("userData") // e.g., ~/Library/Application Support/Agents Dev
    const appSupportPath = join(userDataPath, "..") // ~/Library/Application Support

    // Production database path - try multiple possible locations
    const possibleProductionPaths = [
      join(appSupportPath, "Hong Cowork", "data", "agents.db"),         // Current production (Tinker)
      join(appSupportPath, "hong-desktop", "data", "agents.db"),        // Legacy standalone
      join(appSupportPath, "Hong", "data", "agents.db"),                // Alternative name
    ]

    const productionDbPath = possibleProductionPaths.find(p => existsSync(p))

    if (!productionDbPath) {
      throw new Error(`Production database not found. Searched paths:\n${possibleProductionPaths.join("\n")}`)
    }

    // Target path (dev database)
    const devDataDir = join(userDataPath, "data")
    const devDbPath = join(devDataDir, "agents.db")

    // Ensure data directory exists
    if (!existsSync(devDataDir)) {
      mkdirSync(devDataDir, { recursive: true })
    }

    // Close current dev database connection
    closeDatabase()

    // Remove old dev db and WAL/SHM files (VACUUM INTO requires target not exist)
    try {
      if (existsSync(devDbPath)) unlinkSync(devDbPath)
      if (existsSync(devDbPath + "-wal")) unlinkSync(devDbPath + "-wal")
      if (existsSync(devDbPath + "-shm")) unlinkSync(devDbPath + "-shm")
    } catch { /* ignore */ }

    // Use VACUUM INTO to create a consistent snapshot of the production db.
    // This merges any WAL data into the output file without affecting
    // the running production app or needing its lock.
    try {
      const Database = require("better-sqlite3")
      const prodDb = new Database(productionDbPath, { readonly: true })
      try {
        prodDb.exec(`VACUUM INTO '${devDbPath.replace(/'/g, "''")}'`)
        console.log(`[Debug] VACUUM INTO from ${productionDbPath} to ${devDbPath}`)
      } finally {
        prodDb.close()
      }
    } catch (error) {
      // Re-initialize database even on error
      initDatabase()
      throw error
    }

    // Re-initialize database with the new file
    initDatabase()

    console.log("[Debug] Production database copied to dev environment")
    return { success: true, sourcePath: productionDbPath, targetPath: devDbPath }
  }),

  /**
   * Get last user message debug data
   */
  getLastUserMessage: publicProcedure
    .input(z.object({ subChatId: z.string().optional() }))
    .query(({ input }) => {
      const { subChatId, timestamp, requestPayload } = lastUserMessageDebugData.get(input.subChatId || "latest") || {
        subChatId: "none",
        timestamp: "",
        requestPayload: {},
      }
      return {
        subChatId,
        timestamp,
        requestPayload,
      }
    }),

  /**
   * Clear debug data for a specific subChat
   */
  clearUserMessageDebug: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(({ input }) => {
      lastUserMessageDebugData.delete(input.subChatId)
      return { success: true }
    }),
})
