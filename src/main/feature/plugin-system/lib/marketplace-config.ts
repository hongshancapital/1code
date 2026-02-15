/**
 * Marketplace Configuration Management
 *
 * Reads and writes the marketplace configuration stored in ~/.hong/plugin-marketplaces.json
 */

import * as fs from "fs/promises"
import * as path from "path"
import { PATHS } from "../../../lib/paths"
import type {
  MarketplaceConfig,
  PluginMarketplacesConfig,
  MarketplaceManifest,
} from "./marketplace-types"
import { OFFICIAL_MARKETPLACE, KNOWLEDGE_WORK_MARKETPLACE } from "./marketplace-types"
import { createLogger } from "../../../lib/logger"

const marketplaceLog = createLogger("Marketplace")


const CONFIG_PATH = PATHS.HONG_MARKETPLACES_CONFIG

/**
 * Ensure the ~/.hong directory exists
 */
async function ensureHongDir(): Promise<void> {
  await fs.mkdir(PATHS.HONG_HOME, { recursive: true })
}

/**
 * Read the marketplace configuration
 * Returns default config with official marketplace if file doesn't exist
 */
export async function readMarketplacesConfig(): Promise<PluginMarketplacesConfig> {
  try {
    const content = await fs.readFile(CONFIG_PATH, "utf-8")
    const config = JSON.parse(content) as PluginMarketplacesConfig

    if (config.version !== 1) {
      marketplaceLog.warn("Unsupported config version, using defaults")
      return getDefaultConfig()
    }

    return config
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist, return default config
      return getDefaultConfig()
    }
    marketplaceLog.error("Error reading config:", error)
    return getDefaultConfig()
  }
}

/**
 * Save the marketplace configuration
 */
export async function saveMarketplacesConfig(
  config: PluginMarketplacesConfig
): Promise<void> {
  await ensureHongDir()
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8")
}

/**
 * Get default configuration with official marketplace
 */
function getDefaultConfig(): PluginMarketplacesConfig {
  return {
    version: 1,
    marketplaces: [],
  }
}

/**
 * Add a marketplace to the configuration
 */
export async function addMarketplaceConfig(
  marketplace: MarketplaceConfig
): Promise<void> {
  const config = await readMarketplacesConfig()

  // Check if marketplace already exists
  const existingIndex = config.marketplaces.findIndex(
    (m) => m.name === marketplace.name
  )

  if (existingIndex >= 0) {
    // Update existing
    config.marketplaces[existingIndex] = marketplace
  } else {
    // Add new
    config.marketplaces.push(marketplace)
  }

  await saveMarketplacesConfig(config)
}

/**
 * Remove a marketplace from the configuration
 */
export async function removeMarketplaceConfig(name: string): Promise<boolean> {
  const config = await readMarketplacesConfig()
  const initialLength = config.marketplaces.length

  config.marketplaces = config.marketplaces.filter((m) => m.name !== name)

  if (config.marketplaces.length !== initialLength) {
    await saveMarketplacesConfig(config)
    return true
  }

  return false
}

/**
 * Update a marketplace's lastUpdatedAt timestamp
 */
export async function updateMarketplaceTimestamp(name: string): Promise<void> {
  const config = await readMarketplacesConfig()
  const marketplace = config.marketplaces.find((m) => m.name === name)

  if (marketplace) {
    marketplace.lastUpdatedAt = new Date().toISOString()
    await saveMarketplacesConfig(config)
  }
}

/**
 * Get a specific marketplace configuration
 */
export async function getMarketplaceConfig(
  name: string
): Promise<MarketplaceConfig | null> {
  const config = await readMarketplacesConfig()
  return config.marketplaces.find((m) => m.name === name) || null
}

/**
 * Check if the official marketplace is configured
 */
export async function hasOfficialMarketplace(): Promise<boolean> {
  const config = await readMarketplacesConfig()
  return config.marketplaces.some((m) => m.isOfficial)
}

/**
 * Read marketplace manifest from a marketplace directory
 */
export async function readMarketplaceManifest(
  marketplacePath: string
): Promise<MarketplaceManifest | null> {
  const manifestPath = path.join(
    marketplacePath,
    ".claude-plugin",
    "marketplace.json"
  )

  try {
    const content = await fs.readFile(manifestPath, "utf-8")
    return JSON.parse(content) as MarketplaceManifest
  } catch (error) {
    marketplaceLog.error(
      `[Marketplace] Error reading manifest from ${marketplacePath}:`,
      error
    )
    return null
  }
}

/**
 * Get the local path for a marketplace
 */
export function getMarketplaceLocalPath(marketplaceName: string): string {
  return path.join(PATHS.PLUGINS_MARKETPLACES, marketplaceName)
}

/**
 * Check if a marketplace exists locally
 */
export async function marketplaceExistsLocally(
  marketplaceName: string
): Promise<boolean> {
  const localPath = getMarketplaceLocalPath(marketplaceName)
  try {
    await fs.access(localPath)
    return true
  } catch {
    return false
  }
}

/**
 * Get official marketplace info
 */
export function getOfficialMarketplaceInfo(): MarketplaceConfig {
  return { ...OFFICIAL_MARKETPLACE, addedAt: new Date().toISOString() }
}

/**
 * Get Knowledge Work Plugins marketplace info
 */
export function getKnowledgeWorkMarketplaceInfo(): MarketplaceConfig {
  return { ...KNOWLEDGE_WORK_MARKETPLACE, addedAt: new Date().toISOString() }
}
