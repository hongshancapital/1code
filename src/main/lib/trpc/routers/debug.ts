import { router, publicProcedure } from "../index"
import { getDatabase, closeDatabase, initDatabase, projects, chats, subChats } from "../../db"
import { app, shell, BrowserWindow, session } from "electron"
import { z } from "zod"
import { clearNetworkCache } from "../../../feature/ollama/lib/network-detector"
import { getAuthManager } from "../../../auth-manager"
import { join } from "path"
import { existsSync, mkdirSync, rmSync, unlinkSync } from "fs"
import { createLogger } from "../../logger"

const debugLog = createLogger("Debug")
const copyProductionDbLog = createLogger("copyProductionDb")

// Protocol constant (must match main/index.ts)
const IS_DEV = !app.isPackaged
const PROTOCOL = IS_DEV ? "hong-dev" : "hong"

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
  debugLog.info('Saving debug data for subChat:', subChatId, 'keys:', Object.keys(data), 'data:', data)
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
    debugLog.info("Cleared all chats and sub-chats")
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
    debugLog.info("Cleared all database data")
    return { success: true }
  }),

  /**
   * Reset onboarding state
   * Clears localStorage flags to restart onboarding flow
   */
  resetOnboarding: publicProcedure.mutation(() => {
    debugLog.info("Reset onboarding - this clears localStorage on renderer side")
    return { success: true, message: "Clear localStorage:billing-method, localStorage:anthropic-onboarding-completed, localStorage:api-key-onboarding-completed in renderer" }
  }),

  /**
   * Open userData folder in system file manager
   */
  openUserDataFolder: publicProcedure.mutation(() => {
    const userDataPath = app.getPath("userData")
    shell.openPath(userDataPath)
    debugLog.info("Opened userData folder:", userDataPath)
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
      debugLog.info(`Offline simulation ${input.enabled ? "enabled" : "disabled"}`)
      return { success: true, enabled: simulateOfflineMode }
    }),

  /**
   * Factory reset - clear ALL data and return to login page
   * This resets the app to its initial state as if freshly installed
   */
  factoryReset: publicProcedure.mutation(async () => {
    debugLog.info("Starting factory reset...")

    const userDataPath = app.getPath("userData")
    debugLog.info("userData path:", userDataPath)

    // 1. Close all database connections
    try {
      closeDatabase()
      debugLog.info("Database connection closed")
    } catch (error) {
      debugLog.warn("Failed to close database:", error)
    }

    // 2. Clear authentication data before deleting userData
    const authManager = getAuthManager()
    if (authManager) {
      authManager.logout("manual")
      debugLog.info("Auth data cleared")
    }

    // 3. Clear session cookies before deleting userData
    try {
      const ses = session.fromPartition("persist:main")
      await ses.clearStorageData()
      debugLog.info("Session storage cleared")
    } catch (error) {
      debugLog.warn("Failed to clear session storage:", error)
    }

    // 4. Recursively delete userData directory
    // This clears: database, artifacts, insights, terminal history,
    // claude-sessions, project icons, and any other app data
    if (existsSync(userDataPath)) {
      try {
        rmSync(userDataPath, { recursive: true, force: true })
        debugLog.info("userData directory deleted")
      } catch (error) {
        debugLog.error("Failed to delete userData directory:", error)
        // If full delete fails, try to at least delete data folder
        const dataPath = join(userDataPath, "data")
        if (existsSync(dataPath)) {
          try {
            rmSync(dataPath, { recursive: true, force: true })
            debugLog.info("data folder deleted as fallback")
          } catch (err) {
            debugLog.error("Failed to delete data folder:", err)
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
        debugLog.info("Window navigated to login page")
      } catch (error) {
        debugLog.warn("Failed to navigate window:", error)
      }
    }

    // 7. Database will be re-initialized automatically on next access
    debugLog.info("Factory reset complete - database will reinitialize on demand")
    return { success: true }
  }),

  /**
   * Copy production database to development environment
   * Only available in dev builds (packaged or unpackaged)
   */
  copyProductionDb: publicProcedure.mutation(async () => {
    // Only allow in dev builds (bun run dev or packaged dev build)
    // Check userData path instead of app name (more reliable when embedded in Tinker)
    const userDataPath = app.getPath("userData")
    const isPackaged = app.isPackaged
    const isDevBuild = !isPackaged ||
                       userDataPath.includes("开发版") ||
                       userDataPath.includes("Dev") ||
                       userDataPath.includes("Agents Dev")

    copyProductionDbLog.info("App name:", app.getName())
    copyProductionDbLog.info("userData:", userDataPath)
    copyProductionDbLog.info("isPackaged:", isPackaged)
    copyProductionDbLog.info("isDevBuild:", isDevBuild)

    if (!isDevBuild) {
      throw new Error(`This operation is only available in development builds (userData: ${userDataPath}, packaged: ${isPackaged})`)
    }

    // userDataPath already declared above at line 506
    const appSupportPath = join(userDataPath, "..") // ~/Library/Application Support

    // Production database path - try multiple possible locations
    // Current userData paths:
    // - "hong-desktop" (local production for testing, highest priority)
    // - "Hong Cowork" (production, embedded in Tinker)
    // - "Hong Cowork-开发版" (dev build, embedded in Tinker)
    // - "Hong" (standalone production, no Tinker)
    const possibleProductionPaths = [
      join(appSupportPath, "hong-desktop", "data", "agents.db"),        // Local production (highest priority)
      join(appSupportPath, "Hong Cowork", "data", "agents.db"),         // Production (Tinker)
      join(appSupportPath, "Hong Cowork-开发版", "data", "agents.db"), // Dev build (Tinker)
      join(appSupportPath, "Hong", "data", "agents.db"),                // Standalone production
    ].filter(p => p !== join(userDataPath, "data", "agents.db")) // Exclude self

    const productionDbPath = possibleProductionPaths.find(p => existsSync(p))

    if (!productionDbPath) {
      throw new Error(`Source database not found. Searched paths:\n${possibleProductionPaths.join("\n")}`)
    }

    // Target path (current app's database)
    const targetDataDir = join(userDataPath, "data")
    const targetDbPath = join(targetDataDir, "agents.db")

    // Ensure data directory exists
    if (!existsSync(targetDataDir)) {
      mkdirSync(targetDataDir, { recursive: true })
    }

    // Close current database connection
    closeDatabase()

    // Remove old target db and WAL/SHM files (VACUUM INTO requires target not exist)
    try {
      if (existsSync(targetDbPath)) unlinkSync(targetDbPath)
      if (existsSync(targetDbPath + "-wal")) unlinkSync(targetDbPath + "-wal")
      if (existsSync(targetDbPath + "-shm")) unlinkSync(targetDbPath + "-shm")
    } catch { /* ignore */ }

    // Use VACUUM INTO to create a consistent snapshot of the source db.
    // This merges any WAL data into the output file without affecting
    // the running source app or needing its lock.
    try {
      const Database = require("better-sqlite3")
      const sourceDb = new Database(productionDbPath, { readonly: true })
      try {
        sourceDb.exec(`VACUUM INTO '${targetDbPath.replace(/'/g, "''")}'`)
        debugLog.info(`VACUUM INTO from ${productionDbPath} to ${targetDbPath}`)
      } finally {
        sourceDb.close()
      }
    } catch (error) {
      // Re-initialize database even on error
      initDatabase()
      throw error
    }

    // Re-initialize database with the new file
    initDatabase()

    debugLog.info("Database copied successfully")
    return { success: true, sourcePath: productionDbPath, targetPath: targetDbPath }
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
