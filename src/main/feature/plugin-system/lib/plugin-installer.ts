/**
 * Plugin Installer
 *
 * Handles installing and uninstalling plugins from marketplaces.
 * Writes to ~/.claude/plugins/installed_plugins.json for CLI compatibility.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { PATHS } from "../../../lib/paths"
import {
  readMarketplaceManifest,
  getMarketplaceLocalPath,
} from "./marketplace-config"
import type { InstallPluginResult, UninstallPluginResult } from "./marketplace-types"
import { clearPluginCache } from "./index"
import { createLogger } from "../../../lib/logger"
import { invalidateEnabledPluginsCache } from "../../../lib/trpc/routers/claude-settings"

const pluginInstallerLog = createLogger("PluginInstaller")


/**
 * CLI installed_plugins.json format (version 2)
 */
interface InstalledPluginsJson {
  version: number
  plugins: Record<
    string, // e.g., "figma@claude-plugins-official"
    Array<{
      scope: string
      installPath: string
      version: string
      installedAt: string
      lastUpdated: string
      gitCommitSha?: string
    }>
  >
}

/**
 * Read the installed_plugins.json file
 */
async function readInstalledPluginsJson(): Promise<InstalledPluginsJson> {
  try {
    const content = await fs.readFile(PATHS.INSTALLED_PLUGINS_JSON, "utf-8")
    const data = JSON.parse(content) as InstalledPluginsJson

    if (data.version !== 2) {
      pluginInstallerLog.warn("Unsupported version, creating new")
      return { version: 2, plugins: {} }
    }

    return data
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 2, plugins: {} }
    }
    pluginInstallerLog.error("Error reading installed_plugins.json:", error)
    return { version: 2, plugins: {} }
  }
}

/**
 * Write the installed_plugins.json file
 */
async function writeInstalledPluginsJson(
  data: InstalledPluginsJson
): Promise<void> {
  await fs.mkdir(PATHS.PLUGINS_DIR, { recursive: true })
  await fs.writeFile(
    PATHS.INSTALLED_PLUGINS_JSON,
    JSON.stringify(data, null, 2),
    "utf-8"
  )
}

/**
 * Ensure the installed plugins directory exists
 */
async function ensureInstalledDir(): Promise<void> {
  await fs.mkdir(PATHS.PLUGINS_INSTALLED, { recursive: true })
}

/**
 * Install a plugin from a marketplace
 */
export async function installPlugin(
  pluginName: string,
  marketplaceName: string
): Promise<InstallPluginResult> {
  const pluginSource = `${pluginName}@${marketplaceName}`
  const marketplacePath = getMarketplaceLocalPath(marketplaceName)

  // Read marketplace manifest
  const manifest = await readMarketplaceManifest(marketplacePath)
  if (!manifest) {
    return {
      success: false,
      pluginSource,
      installPath: "",
      error: `Cannot read marketplace manifest for "${marketplaceName}"`,
    }
  }

  // Find the plugin
  const pluginDef = manifest.plugins.find((p) => p.name === pluginName)
  if (!pluginDef) {
    return {
      success: false,
      pluginSource,
      installPath: "",
      error: `Plugin "${pluginName}" not found in marketplace "${marketplaceName}"`,
    }
  }

  // Get source path
  const sourcePath =
    typeof pluginDef.source === "string"
      ? pluginDef.source
      : pluginDef.source?.source

  if (!sourcePath) {
    return {
      success: false,
      pluginSource,
      installPath: "",
      error: `Invalid source path for plugin "${pluginName}"`,
    }
  }

  const pluginSourcePath = path.resolve(marketplacePath, sourcePath)
  const installPath = path.join(PATHS.PLUGINS_INSTALLED, pluginSource)

  try {
    // Check if source exists
    await fs.access(pluginSourcePath)

    // Ensure installed directory exists
    await ensureInstalledDir()

    // Remove existing installation if any
    try {
      await fs.rm(installPath, { recursive: true, force: true })
    } catch {
      // Ignore if doesn't exist
    }

    // Copy plugin directory
    pluginInstallerLog.info(
      `[PluginInstaller] Installing ${pluginSource} from ${pluginSourcePath} to ${installPath}`
    )
    await fs.cp(pluginSourcePath, installPath, { recursive: true })

    // Read plugin version from plugin.json if exists
    let version = pluginDef.version || "0.0.0"
    try {
      const pluginJsonPath = path.join(
        installPath,
        ".claude-plugin",
        "plugin.json"
      )
      const pluginJson = JSON.parse(await fs.readFile(pluginJsonPath, "utf-8"))
      if (pluginJson.version) {
        version = pluginJson.version
      }
    } catch {
      // Optional, use manifest version
    }

    // Update installed_plugins.json
    const installedPlugins = await readInstalledPluginsJson()
    const now = new Date().toISOString()

    installedPlugins.plugins[pluginSource] = [
      {
        scope: "user",
        installPath,
        version,
        installedAt: now,
        lastUpdated: now,
      },
    ]

    await writeInstalledPluginsJson(installedPlugins)

    // Auto-enable the plugin after installation
    await addToEnabledPlugins(pluginSource)

    // Clear plugin cache
    clearPluginCache()

    pluginInstallerLog.info(`Successfully installed ${pluginSource}`)
    return {
      success: true,
      pluginSource,
      installPath,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    // Clean up on failure
    try {
      await fs.rm(installPath, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }

    return {
      success: false,
      pluginSource,
      installPath: "",
      error: errorMessage,
    }
  }
}

/**
 * Uninstall a plugin
 */
export async function uninstallPlugin(
  pluginSource: string
): Promise<UninstallPluginResult> {
  const installedPlugins = await readInstalledPluginsJson()
  const installations = installedPlugins.plugins[pluginSource]

  if (!installations || installations.length === 0) {
    return {
      success: false,
      error: `Plugin "${pluginSource}" is not installed`,
    }
  }

  try {
    // Delete all installation directories
    for (const install of installations) {
      if (install.installPath) {
        pluginInstallerLog.info(
          `[PluginInstaller] Removing ${pluginSource} from ${install.installPath}`
        )
        await fs.rm(install.installPath, { recursive: true, force: true })
      }
    }

    // Remove from installed_plugins.json
    delete installedPlugins.plugins[pluginSource]
    await writeInstalledPluginsJson(installedPlugins)

    // Also remove from settings.json enabledPlugins if present
    await removeFromEnabledPlugins(pluginSource)

    // Clear plugin cache
    clearPluginCache()

    pluginInstallerLog.info(`Successfully uninstalled ${pluginSource}`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, error: errorMessage }
  }
}

/**
 * Add a plugin to the enabledPlugins list in settings.json
 */
async function addToEnabledPlugins(pluginSource: string): Promise<void> {
  try {
    // Ensure settings directory exists
    await fs.mkdir(PATHS.CLAUDE_DIR, { recursive: true })

    // Read or create settings
    let settings: any = {}
    try {
      const content = await fs.readFile(PATHS.CLAUDE_SETTINGS, "utf-8")
      settings = JSON.parse(content)
    } catch (error) {
      // File doesn't exist, start with empty settings
      pluginInstallerLog.info("[PluginInstaller] Creating new settings.json")
    }

    // Initialize enabledPlugins if it doesn't exist
    if (!settings.enabledPlugins) {
      settings.enabledPlugins = []
    }

    // Handle both array and object formats
    if (Array.isArray(settings.enabledPlugins)) {
      // Add plugin if not already in the list
      if (!settings.enabledPlugins.includes(pluginSource)) {
        settings.enabledPlugins.push(pluginSource)
        pluginInstallerLog.info(`[PluginInstaller] Auto-enabled plugin: ${pluginSource}`)
      }
    } else if (typeof settings.enabledPlugins === "object") {
      // Object format: set to true
      settings.enabledPlugins[pluginSource] = true
      pluginInstallerLog.info(`[PluginInstaller] Auto-enabled plugin: ${pluginSource}`)
    }

    await fs.writeFile(
      PATHS.CLAUDE_SETTINGS,
      JSON.stringify(settings, null, 2),
      "utf-8"
    )

    // Invalidate cache so frontend sees the change immediately
    invalidateEnabledPluginsCache()
  } catch (error) {
    // Log but don't fail the installation if we can't enable the plugin
    pluginInstallerLog.warn(
      "[PluginInstaller] Could not auto-enable plugin:",
      error instanceof Error ? error.message : error
    )
  }
}

/**
 * Remove a plugin from the enabledPlugins list in settings.json
 */
async function removeFromEnabledPlugins(pluginSource: string): Promise<void> {
  try {
    const content = await fs.readFile(PATHS.CLAUDE_SETTINGS, "utf-8")
    const settings = JSON.parse(content)

    if (settings.enabledPlugins) {
      // Handle both array and object formats
      if (Array.isArray(settings.enabledPlugins)) {
        settings.enabledPlugins = settings.enabledPlugins.filter(
          (p: string) => p !== pluginSource
        )
      } else if (typeof settings.enabledPlugins === "object") {
        delete settings.enabledPlugins[pluginSource]
      }

      await fs.writeFile(
        PATHS.CLAUDE_SETTINGS,
        JSON.stringify(settings, null, 2),
        "utf-8"
      )
    }

    // Also remove approved MCP servers for this plugin
    if (settings.approvedPluginMcpServers) {
      settings.approvedPluginMcpServers =
        settings.approvedPluginMcpServers.filter(
          (s: string) => !s.startsWith(`${pluginSource}:`)
        )
      await fs.writeFile(
        PATHS.CLAUDE_SETTINGS,
        JSON.stringify(settings, null, 2),
        "utf-8"
      )
    }
  } catch (error) {
    // Ignore if settings.json doesn't exist or has issues
    pluginInstallerLog.info(
      "[PluginInstaller] Could not update settings.json:",
      error instanceof Error ? error.message : error
    )
  }
}

/**
 * Check if a plugin is installed
 */
export async function isPluginInstalled(pluginSource: string): Promise<boolean> {
  const installedPlugins = await readInstalledPluginsJson()
  const installations = installedPlugins.plugins[pluginSource]
  return installations && installations.length > 0
}

/**
 * Get installed version of a plugin
 */
export async function getInstalledVersion(
  pluginSource: string
): Promise<string | null> {
  const installedPlugins = await readInstalledPluginsJson()
  const installations = installedPlugins.plugins[pluginSource]

  if (!installations || installations.length === 0) {
    return null
  }

  // Return the most recently updated version
  const sorted = [...installations].sort(
    (a, b) =>
      new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
  )

  return sorted[0]?.version || null
}

/**
 * Get all installed plugin sources
 */
export async function getInstalledPluginSources(): Promise<string[]> {
  const installedPlugins = await readInstalledPluginsJson()
  return Object.keys(installedPlugins.plugins)
}
