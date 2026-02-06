import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { z } from "zod"
import { router, publicProcedure } from "../index"

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json")

// Cache for enabled plugins to avoid repeated filesystem reads
let enabledPluginsCache: { plugins: string[]; timestamp: number } | null = null
const ENABLED_PLUGINS_CACHE_TTL_MS = 5000 // 5 seconds

// Cache for approved plugin MCP servers
let approvedMcpCache: { servers: string[]; timestamp: number } | null = null
const APPROVED_MCP_CACHE_TTL_MS = 5000 // 5 seconds

/**
 * Invalidate the enabled plugins cache
 * Call this when enabledPlugins setting changes
 */
export function invalidateEnabledPluginsCache(): void {
  enabledPluginsCache = null
}

/**
 * Invalidate the approved MCP servers cache
 * Call this when approvedPluginMcpServers setting changes
 */
export function invalidateApprovedMcpCache(): void {
  approvedMcpCache = null
}

/**
 * Claude settings structure
 */
export interface ClaudeSettings {
  env?: Record<string, string>
  enabledPlugins?: Record<string, boolean>
  enabledSkills?: Record<string, boolean>
  alwaysThinkingEnabled?: boolean
  permissions?: Record<string, unknown>
  includeCoAuthoredBy?: boolean
  approvedPluginMcpServers?: string[]
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
  } catch {
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
 * Write project-level settings.json file
 * Creates the .claude directory if it doesn't exist
 */
async function writeProjectSettings(cwd: string, settings: Record<string, unknown>): Promise<void> {
  const projectClaudeDir = path.join(cwd, ".claude")
  const projectSettingsPath = path.join(projectClaudeDir, "settings.json")
  await fs.mkdir(projectClaudeDir, { recursive: true })
  await fs.writeFile(projectSettingsPath, JSON.stringify(settings, null, 2), "utf-8")
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
    enabledSkills: {
      ...user.enabledSkills,
      ...project.enabledSkills,
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
 * Get list of enabled plugin identifiers from settings.json
 * Plugins are DISABLED by default — only plugins explicitly in this list are active.
 * Returns empty array if no plugins have been enabled.
 * Results are cached for 5 seconds to reduce filesystem reads.
 */
export async function getEnabledPlugins(): Promise<string[]> {
  // Return cached result if still valid
  if (enabledPluginsCache && Date.now() - enabledPluginsCache.timestamp < ENABLED_PLUGINS_CACHE_TTL_MS) {
    return enabledPluginsCache.plugins
  }

  const settings = await readClaudeSettings()

  // Support both array format ["plugin1", "plugin2"] and object format { "plugin1": true, "plugin2": true }
  let plugins: string[] = []
  if (Array.isArray(settings.enabledPlugins)) {
    plugins = settings.enabledPlugins as string[]
  } else if (settings.enabledPlugins && typeof settings.enabledPlugins === 'object') {
    // Object format: filter for enabled plugins (value is true)
    plugins = Object.entries(settings.enabledPlugins)
      .filter(([, enabled]) => enabled === true)
      .map(([pluginSource]) => pluginSource)
  }

  enabledPluginsCache = { plugins, timestamp: Date.now() }
  return plugins
}

/**
 * Get list of approved plugin MCP server identifiers from settings.json
 * Format: "{pluginSource}:{serverName}" e.g., "ccsetup:ccsetup:context7"
 * Returns empty array if no approved servers
 * Results are cached for 5 seconds to reduce filesystem reads
 */
export async function getApprovedPluginMcpServers(): Promise<string[]> {
  // Return cached result if still valid
  if (approvedMcpCache && Date.now() - approvedMcpCache.timestamp < APPROVED_MCP_CACHE_TTL_MS) {
    return approvedMcpCache.servers
  }

  const settings = await readClaudeSettings()
  const servers = Array.isArray(settings.approvedPluginMcpServers)
    ? settings.approvedPluginMcpServers as string[]
    : []

  approvedMcpCache = { servers, timestamp: Date.now() }
  return servers
}

/**
 * Check if a plugin MCP server is approved
 */
export async function isPluginMcpApproved(pluginSource: string, serverName: string): Promise<boolean> {
  const approved = await getApprovedPluginMcpServers()
  const identifier = `${pluginSource}:${serverName}`
  return approved.includes(identifier)
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
   * Get list of enabled plugins (array format from main)
   * Plugins are disabled by default — only explicitly enabled ones are active.
   */
  getEnabledPlugins: publicProcedure.query(async () => {
    return await getEnabledPlugins()
  }),

  /**
   * Get enabled plugins from merged user + project settings (Record format from cowork-sync)
   */
  getEnabledPluginsRecord: publicProcedure
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

  /**
   * Set a plugin's enabled state
   * Plugins are disabled by default — adding to enabledPlugins activates them.
   */
  setPluginEnabled: publicProcedure
    .input(
      z.object({
        pluginSource: z.string(),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const enabledPlugins = Array.isArray(settings.enabledPlugins)
        ? (settings.enabledPlugins as string[])
        : []

      if (input.enabled && !enabledPlugins.includes(input.pluginSource)) {
        enabledPlugins.push(input.pluginSource)
      } else if (!input.enabled) {
        const index = enabledPlugins.indexOf(input.pluginSource)
        if (index > -1) enabledPlugins.splice(index, 1)
      }

      settings.enabledPlugins = enabledPlugins as unknown as Record<string, boolean>
      await writeClaudeSettings(settings)
      invalidateEnabledPluginsCache()
      return { success: true }
    }),

  /**
   * Get list of approved plugin MCP servers
   */
  getApprovedPluginMcpServers: publicProcedure.query(async () => {
    return await getApprovedPluginMcpServers()
  }),

  /**
   * Approve a plugin MCP server
   * Identifier format: "{pluginSource}:{serverName}"
   */
  approvePluginMcpServer: publicProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const approved = Array.isArray(settings.approvedPluginMcpServers)
        ? (settings.approvedPluginMcpServers as string[])
        : []

      if (!approved.includes(input.identifier)) {
        approved.push(input.identifier)
      }

      settings.approvedPluginMcpServers = approved
      await writeClaudeSettings(settings)
      invalidateApprovedMcpCache()
      return { success: true }
    }),

  /**
   * Revoke approval for a plugin MCP server
   * Identifier format: "{pluginSource}:{serverName}"
   */
  revokePluginMcpServer: publicProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const approved = Array.isArray(settings.approvedPluginMcpServers)
        ? (settings.approvedPluginMcpServers as string[])
        : []

      const index = approved.indexOf(input.identifier)
      if (index > -1) {
        approved.splice(index, 1)
      }

      settings.approvedPluginMcpServers = approved
      await writeClaudeSettings(settings)
      invalidateApprovedMcpCache()
      return { success: true }
    }),

  /**
   * Approve all MCP servers from a plugin
   * Takes the pluginSource (e.g., "ccsetup:ccsetup") and list of server names
   */
  approveAllPluginMcpServers: publicProcedure
    .input(z.object({
      pluginSource: z.string(),
      serverNames: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const approved = Array.isArray(settings.approvedPluginMcpServers)
        ? (settings.approvedPluginMcpServers as string[])
        : []

      for (const serverName of input.serverNames) {
        const identifier = `${input.pluginSource}:${serverName}`
        if (!approved.includes(identifier)) {
          approved.push(identifier)
        }
      }

      settings.approvedPluginMcpServers = approved
      await writeClaudeSettings(settings)
      invalidateApprovedMcpCache()
      return { success: true }
    }),

  /**
   * Revoke all MCP servers from a plugin
   * Removes all identifiers matching "{pluginSource}:*"
   */
  revokeAllPluginMcpServers: publicProcedure
    .input(z.object({
      pluginSource: z.string(),
    }))
    .mutation(async ({ input }) => {
      const settings = await readClaudeSettings()
      const approved = Array.isArray(settings.approvedPluginMcpServers)
        ? (settings.approvedPluginMcpServers as string[])
        : []

      const prefix = `${input.pluginSource}:`
      settings.approvedPluginMcpServers = approved.filter((id) => !id.startsWith(prefix))
      await writeClaudeSettings(settings)
      invalidateApprovedMcpCache()
      return { success: true }
    }),

  /**
   * Get enabled skills record
   */
  getEnabledSkills: publicProcedure
    .input(z.object({ cwd: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const mergedSettings = await getMergedSettings(input?.cwd)
      return mergedSettings.enabledSkills || {}
    }),

  /**
   * Set a skill's enabled state
   * If cwd is provided, writes to project-level settings, otherwise writes to user settings
   */
  setSkillEnabled: publicProcedure
    .input(z.object({
      skillName: z.string(),
      enabled: z.boolean(),
      cwd: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      if (input.cwd) {
        // Write to project-level settings
        const projectSettings = await readProjectSettings(input.cwd)
        const enabledSkills = projectSettings.enabledSkills || {}
        enabledSkills[input.skillName] = input.enabled
        projectSettings.enabledSkills = enabledSkills
        await writeProjectSettings(input.cwd, projectSettings)
      } else {
        // Write to user-level settings
        const settings = await readClaudeSettings()
        const enabledSkills = settings.enabledSkills || {}
        enabledSkills[input.skillName] = input.enabled
        settings.enabledSkills = enabledSkills
        await writeClaudeSettings(settings)

        // Sync builtin skills to ~/.claude/skills/ for SDK discovery
        const { syncBuiltinSkillEnabled } = await import("./skills")
        await syncBuiltinSkillEnabled(input.skillName, input.enabled)
      }

      return { success: true }
    }),
})
