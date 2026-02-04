import { router, publicProcedure } from "../index"
import { getDatabase, projects, chats, subChats } from "../../db"
import { app, shell, BrowserWindow, session } from "electron"
import { z } from "zod"
import { clearNetworkCache } from "../../ollama/network-detector"
import { getAuthManager } from "../../../auth-manager"
import { join } from "path"

// Protocol constant (must match main/index.ts)
const IS_DEV = !!process.env.ELECTRON_RENDERER_URL
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

    // 1. Clear database (projects, chats, sub-chats)
    const db = getDatabase()
    db.delete(subChats).run()
    db.delete(chats).run()
    db.delete(projects).run()
    console.log("[Debug] Database cleared")

    // 2. Clear authentication data
    const authManager = getAuthManager()
    if (authManager) {
      authManager.logout("manual")
      console.log("[Debug] Auth data cleared")
    }

    // 3. Clear session cookies
    try {
      const ses = session.fromPartition("persist:main")
      await ses.clearStorageData()
      console.log("[Debug] Session storage cleared")
    } catch (error) {
      console.warn("[Debug] Failed to clear session storage:", error)
    }

    // 4. Navigate all windows to login page
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

    console.log("[Debug] Factory reset complete")
    return { success: true }
  }),
})
