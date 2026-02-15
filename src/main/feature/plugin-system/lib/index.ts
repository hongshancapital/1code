import * as fs from "fs/promises"
import type { Dirent } from "fs"
import * as path from "path"
import * as os from "os"
import type { McpServerConfig } from "../claude-config"

export interface PluginInfo {
  name: string
  version: string
  description?: string
  path: string
  source: string // e.g., "marketplace:plugin-name" or "figma@claude-plugins-official"
  marketplace: string // e.g., "claude-plugins-official"
  category?: string
  homepage?: string
  tags?: string[]
  installSource?: "marketplace" | "cli" // Track where the plugin came from
}

// CLI installed_plugins.json format (version 2)
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

interface MarketplacePlugin {
  name: string
  version?: string
  description?: string
  source: string | { source: string; url: string }
  category?: string
  homepage?: string
  tags?: string[]
}

interface MarketplaceJson {
  name: string
  plugins: MarketplacePlugin[]
}

export interface PluginMcpConfig {
  pluginSource: string // e.g., "ccsetup:ccsetup"
  mcpServers: Record<string, McpServerConfig>
}

// Cache for plugin discovery results
let pluginCache: { plugins: PluginInfo[]; timestamp: number } | null = null
let mcpCache: { configs: PluginMcpConfig[]; timestamp: number } | null = null
const CACHE_TTL_MS = 30000 // 30 seconds - plugins don't change often during a session

/**
 * Clear plugin caches (for testing/manual invalidation)
 */
export function clearPluginCache() {
  pluginCache = null
  mcpCache = null
}

/**
 * Discover plugins from ~/.claude/plugins/marketplaces/
 * Internal function - use discoverInstalledPlugins() instead
 */
async function discoverMarketplacePlugins(): Promise<PluginInfo[]> {
  const pluginMap = new Map<string, PluginInfo>()
  const marketplacesDir = path.join(os.homedir(), ".claude", "plugins", "marketplaces")

  try {
    await fs.access(marketplacesDir)
  } catch {
    return []
  }

  let marketplaces: Dirent[]
  try {
    marketplaces = await fs.readdir(marketplacesDir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const marketplace of marketplaces) {
    if (!marketplace.isDirectory() || marketplace.name.startsWith(".")) continue

    const marketplacePath = path.join(marketplacesDir, marketplace.name)
    const marketplaceJsonPath = path.join(marketplacePath, ".claude-plugin", "marketplace.json")

    try {
      const content = await fs.readFile(marketplaceJsonPath, "utf-8")

      let marketplaceJson: MarketplaceJson
      try {
        marketplaceJson = JSON.parse(content)
      } catch {
        continue
      }

      if (!Array.isArray(marketplaceJson.plugins)) {
        continue
      }

      for (const plugin of marketplaceJson.plugins) {
        if (!plugin.source) continue

        const sourcePath = typeof plugin.source === "string" ? plugin.source : null
        if (!sourcePath) continue

        const pluginPath = path.resolve(marketplacePath, sourcePath)
        const source = `${marketplaceJson.name}:${plugin.name}`

        if (pluginMap.has(source)) continue

        try {
          await fs.access(pluginPath)
          pluginMap.set(source, {
            name: plugin.name,
            version: plugin.version || "0.0.0",
            description: plugin.description,
            path: pluginPath,
            source,
            marketplace: marketplaceJson.name,
            category: plugin.category,
            homepage: plugin.homepage,
            tags: plugin.tags,
            installSource: "marketplace",
          })
        } catch {
          // Plugin directory not found, skip
        }
      }
    } catch {
      // No marketplace.json, skip silently
    }
  }

  return Array.from(pluginMap.values())
}

/**
 * Discover CLI-installed plugins from ~/.claude/plugins/installed_plugins.json
 * CLI uses format: { version: 2, plugins: { "name@marketplace": [{ installPath, ... }] } }
 */
async function discoverCliInstalledPlugins(): Promise<PluginInfo[]> {
  const installedPluginsPath = path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json")

  try {
    const content = await fs.readFile(installedPluginsPath, "utf-8")
    const data: InstalledPluginsJson = JSON.parse(content)

    if (data.version !== 2 || !data.plugins) {
      console.log("[Plugins] installed_plugins.json: unsupported version or missing plugins")
      return []
    }

    const plugins: PluginInfo[] = []

    for (const [pluginId, installations] of Object.entries(data.plugins)) {
      // pluginId format: "figma@claude-plugins-official"
      const atIndex = pluginId.lastIndexOf("@")
      if (atIndex === -1) {
        console.log(`[Plugins] Skipping invalid plugin ID (no @): ${pluginId}`)
        continue
      }

      const pluginName = pluginId.slice(0, atIndex)
      const marketplace = pluginId.slice(atIndex + 1)

      // Sort by lastUpdated to get the most recent installation
      const sorted = [...installations].sort(
        (a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime()
      )

      for (const install of sorted) {
        if (!install.installPath) continue

        try {
          await fs.access(install.installPath)

          // Try to read plugin metadata for description
          let description: string | undefined
          try {
            const pluginJsonPath = path.join(install.installPath, ".claude-plugin", "plugin.json")
            const pluginJson = JSON.parse(await fs.readFile(pluginJsonPath, "utf-8"))
            description = pluginJson.description
          } catch {
            // Optional, ignore
          }

          // Use pluginId as source for consistency with enabledPlugins format
          plugins.push({
            name: pluginName,
            version: install.version || "unknown",
            description,
            path: install.installPath,
            source: pluginId, // "figma@claude-plugins-official"
            marketplace,
            installSource: "cli",
          })

          console.log(`[Plugins] Found CLI plugin: ${pluginId} at ${install.installPath}`)
          break // Only take the most recent installation
        } catch {
          // Directory doesn't exist, try next installation
        }
      }
    }

    return plugins
  } catch (error) {
    // File doesn't exist or parse error - normal case
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.log("[Plugins] Error reading installed_plugins.json:", error)
    }
    return []
  }
}

/**
 * Discover all installed plugins from both sources:
 * 1. ~/.claude/plugins/marketplaces/ (marketplace.json format)
 * 2. ~/.claude/plugins/installed_plugins.json (CLI install format)
 *
 * Results are cached for 30 seconds to avoid repeated filesystem scans.
 * CLI-installed plugins take priority over marketplace plugins.
 */
export async function discoverInstalledPlugins(): Promise<PluginInfo[]> {
  // Return cached result if still valid
  if (pluginCache && Date.now() - pluginCache.timestamp < CACHE_TTL_MS) {
    return pluginCache.plugins
  }

  // Discover from both sources in parallel
  const [marketplacePlugins, cliPlugins] = await Promise.all([
    discoverMarketplacePlugins(),
    discoverCliInstalledPlugins(),
  ])

  console.log(
    `[Plugins] Found ${marketplacePlugins.length} marketplace plugins, ${cliPlugins.length} CLI plugins`
  )

  // Merge with CLI plugins taking priority (they're usually more up-to-date)
  // Need to normalize source format for comparison:
  // - Marketplace uses "marketplace:plugin" format
  // - CLI uses "plugin@marketplace" format
  const pluginMap = new Map<string, PluginInfo>()

  // Add marketplace plugins first
  for (const plugin of marketplacePlugins) {
    // Normalize to "plugin@marketplace" format for consistent keying
    const normalizedKey = `${plugin.name}@${plugin.marketplace}`
    pluginMap.set(normalizedKey, plugin)
  }

  // CLI plugins override marketplace plugins
  for (const plugin of cliPlugins) {
    // CLI already uses "plugin@marketplace" format
    pluginMap.set(plugin.source, plugin)
  }

  const plugins = Array.from(pluginMap.values())
  pluginCache = { plugins, timestamp: Date.now() }
  return plugins
}

/**
 * Get component paths for a plugin (commands, skills, agents directories)
 */
export function getPluginComponentPaths(plugin: PluginInfo) {
  return {
    commands: path.join(plugin.path, "commands"),
    skills: path.join(plugin.path, "skills"),
    agents: path.join(plugin.path, "agents"),
  }
}

/**
 * Discover MCP server configs from all installed plugins
 * Reads .mcp.json from each plugin directory
 * Results are cached for 30 seconds to avoid repeated filesystem scans
 */
export async function discoverPluginMcpServers(): Promise<PluginMcpConfig[]> {
  // Return cached result if still valid
  if (mcpCache && Date.now() - mcpCache.timestamp < CACHE_TTL_MS) {
    return mcpCache.configs
  }

  const plugins = await discoverInstalledPlugins()
  const configs: PluginMcpConfig[] = []

  for (const plugin of plugins) {
    const mcpJsonPath = path.join(plugin.path, ".mcp.json")
    try {
      const content = await fs.readFile(mcpJsonPath, "utf-8")
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(content)
      } catch {
        continue
      }

      // Support two formats:
      // Format A (flat): { "server-name": { "command": "...", ... } }
      // Format B (nested): { "mcpServers": { "server-name": { ... } } }
      const serversObj =
        parsed.mcpServers &&
        typeof parsed.mcpServers === "object" &&
        !Array.isArray(parsed.mcpServers)
          ? (parsed.mcpServers as Record<string, unknown>)
          : parsed

      const validServers: Record<string, McpServerConfig> = {}
      for (const [name, config] of Object.entries(serversObj)) {
        if (config && typeof config === "object" && !Array.isArray(config)) {
          validServers[name] = config as McpServerConfig
        }
      }

      if (Object.keys(validServers).length > 0) {
        configs.push({
          pluginSource: plugin.source,
          mcpServers: validServers,
        })
      }
    } catch {
      // No .mcp.json file, skip silently (this is expected for most plugins)
    }
  }

  // Cache the result
  mcpCache = { configs, timestamp: Date.now() }
  return configs
}

/**
 * Remove a specific MCP server entry from a plugin's .mcp.json file.
 * If the file becomes empty after removal, deletes the file.
 * Also invalidates the MCP cache so the server disappears immediately.
 *
 * @param pluginSource - Plugin source identifier (e.g., "claude-plugins-official:test-fake-plugin")
 * @param serverName - The MCP server name to remove (e.g., "test-plugin-delete-me")
 */
export async function removePluginMcpServer(pluginSource: string, serverName: string): Promise<void> {
  const plugins = await discoverInstalledPlugins()
  const plugin = plugins.find((p) => p.source === pluginSource)
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginSource}`)
  }

  const mcpJsonPath = path.join(plugin.path, ".mcp.json")
  let content: string
  try {
    content = await fs.readFile(mcpJsonPath, "utf-8")
  } catch {
    throw new Error(`No .mcp.json found for plugin: ${pluginSource}`)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`Invalid JSON in .mcp.json for plugin: ${pluginSource}`)
  }

  // Detect format: nested (mcpServers) or flat
  const isNested =
    parsed.mcpServers &&
    typeof parsed.mcpServers === "object" &&
    !Array.isArray(parsed.mcpServers)

  if (isNested) {
    const servers = parsed.mcpServers as Record<string, unknown>
    if (!(serverName in servers)) {
      throw new Error(`Server "${serverName}" not found in plugin ${pluginSource}`)
    }
    delete servers[serverName]

    // If no servers left, delete the file
    if (Object.keys(servers).length === 0) {
      await fs.unlink(mcpJsonPath)
    } else {
      await fs.writeFile(mcpJsonPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8")
    }
  } else {
    // Flat format
    if (!(serverName in parsed)) {
      throw new Error(`Server "${serverName}" not found in plugin ${pluginSource}`)
    }
    delete parsed[serverName]

    if (Object.keys(parsed).length === 0) {
      await fs.unlink(mcpJsonPath)
    } else {
      await fs.writeFile(mcpJsonPath, JSON.stringify(parsed, null, 2) + "\n", "utf-8")
    }
  }

  // Invalidate cache so changes take effect immediately
  mcpCache = null
}
