import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { z } from "zod"
import { router, publicProcedure } from "../index"

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json")

/**
 * Claude settings structure
 */
interface ClaudeSettings {
  env?: Record<string, string>
  enabledPlugins?: Record<string, boolean>
  alwaysThinkingEnabled?: boolean
  permissions?: Record<string, unknown>
  includeCoAuthoredBy?: boolean
  [key: string]: unknown
}

/**
 * Read Claude settings.json file
 * Returns empty object if file doesn't exist
 */
async function readClaudeSettings(): Promise<ClaudeSettings> {
  try {
    const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8")
    return JSON.parse(content)
  } catch (error) {
    // File doesn't exist or is invalid JSON
    return {}
  }
}

/**
 * Read project-level settings.json file
 */
async function readProjectSettings(cwd: string): Promise<ClaudeSettings> {
  const projectSettingsPath = path.join(cwd, ".claude", "settings.json")
  try {
    const content = await fs.readFile(projectSettingsPath, "utf-8")
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Merge user and project settings (project overrides user)
 */
function mergeSettings(user: ClaudeSettings, project: ClaudeSettings): ClaudeSettings {
  return {
    ...user,
    ...project,
    enabledPlugins: {
      ...user.enabledPlugins,
      ...project.enabledPlugins,
    },
    env: {
      ...user.env,
      ...project.env,
    },
  }
}

/**
 * Get merged settings from user and project levels
 */
export async function getMergedSettings(cwd?: string): Promise<ClaudeSettings> {
  const userSettings = await readClaudeSettings()
  if (!cwd) {
    return userSettings
  }
  const projectSettings = await readProjectSettings(cwd)
  return mergeSettings(userSettings, projectSettings)
}

/**
 * Write Claude settings.json file
 * Creates the .claude directory if it doesn't exist
 */
async function writeClaudeSettings(settings: Record<string, unknown>): Promise<void> {
  const dir = path.dirname(CLAUDE_SETTINGS_PATH)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8")
}

export const claudeSettingsRouter = router({
  /**
   * Get the includeCoAuthoredBy setting
   * Returns true if setting is not explicitly set to false
   */
  getIncludeCoAuthoredBy: publicProcedure.query(async () => {
    const settings = await readClaudeSettings()
    // Default is true (include co-authored-by)
    // Only return false if explicitly set to false
    return settings.includeCoAuthoredBy !== false
  }),

  /**
   * Set the includeCoAuthoredBy setting
   */
  setIncludeCoAuthoredBy: publicProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()

      if (input.enabled) {
        // Remove the setting to use default (true)
        delete settings.includeCoAuthoredBy
      } else {
        // Explicitly set to false to disable
        settings.includeCoAuthoredBy = false
      }

      await writeClaudeSettings(settings)
      return { success: true }
    }),

  /**
   * Get enabled plugins from merged user + project settings
   */
  getEnabledPlugins: publicProcedure
    .input(z.object({ cwd: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const mergedSettings = await getMergedSettings(input?.cwd)
      return mergedSettings.enabledPlugins || {}
    }),

  /**
   * Get merged settings from user + project levels
   */
  getMergedSettings: publicProcedure
    .input(z.object({ cwd: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return getMergedSettings(input?.cwd)
    }),
})
