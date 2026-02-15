/**
 * Plugin Marketplace Types
 *
 * Types for managing plugin marketplaces and available plugins.
 */

/**
 * Configuration for a marketplace stored in ~/.hong/plugin-marketplaces.json
 */
export interface MarketplaceConfig {
  /** Marketplace name (unique identifier) */
  name: string
  /** Git repository URL */
  gitUrl: string
  /** Git branch, defaults to 'main' */
  branch?: string
  /** ISO timestamp when the marketplace was added */
  addedAt: string
  /** ISO timestamp of last update (git pull) */
  lastUpdatedAt?: string
  /** Whether this is the official Claude marketplace */
  isOfficial?: boolean
}

/**
 * Root structure of ~/.hong/plugin-marketplaces.json
 */
export interface PluginMarketplacesConfig {
  version: 1
  marketplaces: MarketplaceConfig[]
}

/**
 * Plugin definition from marketplace.json
 */
export interface MarketplacePluginDef {
  name: string
  version?: string
  description?: string
  /** Relative path to plugin directory, e.g., "plugins/figma" */
  source: string | { source: string; url: string }
  category?: string
  homepage?: string
  tags?: string[]
}

/**
 * Marketplace manifest structure (.claude-plugin/marketplace.json)
 */
export interface MarketplaceManifest {
  name: string
  description?: string
  plugins: MarketplacePluginDef[]
}

/**
 * An available plugin from a marketplace (for UI display)
 */
export interface MarketplaceAvailablePlugin {
  name: string
  version?: string
  description?: string
  category?: string
  homepage?: string
  tags?: string[]
  /** Source path relative to marketplace root */
  sourcePath: string
  /** Name of the marketplace this plugin belongs to */
  marketplaceName: string
  /** Whether this plugin is already installed */
  isInstalled: boolean
  /** Version of the installed plugin (if installed) */
  installedVersion?: string
}

/**
 * Detailed marketplace information including plugins
 */
export interface MarketplaceDetail {
  name: string
  description?: string
  gitUrl: string
  branch?: string
  /** Local filesystem path */
  localPath: string
  /** Number of available plugins */
  pluginCount: number
  /** ISO timestamp of last update */
  lastUpdatedAt?: string
  /** Whether this is the official marketplace */
  isOfficial?: boolean
  /** List of available plugins */
  plugins: MarketplaceAvailablePlugin[]
}

/**
 * Result of adding a marketplace
 */
export interface AddMarketplaceResult {
  success: boolean
  marketplace: MarketplaceConfig
  error?: string
}

/**
 * Result of updating a marketplace
 */
export interface UpdateMarketplaceResult {
  success: boolean
  updatedAt: string
  error?: string
}

/**
 * Result of installing a plugin
 */
export interface InstallPluginResult {
  success: boolean
  /** Plugin source identifier, e.g., "figma@claude-plugins-official" */
  pluginSource: string
  /** Installation path */
  installPath: string
  error?: string
}

/**
 * Result of uninstalling a plugin
 */
export interface UninstallPluginResult {
  success: boolean
  error?: string
}

/**
 * Official marketplace configuration
 */
export const OFFICIAL_MARKETPLACE: MarketplaceConfig = {
  name: "claude-plugins-official",
  gitUrl: "https://github.com/anthropics/claude-plugins-official.git",
  branch: "main",
  addedAt: new Date().toISOString(),
  isOfficial: true,
}

/**
 * Knowledge Work Plugins marketplace configuration
 */
export const KNOWLEDGE_WORK_MARKETPLACE: MarketplaceConfig = {
  name: "knowledge-work-plugins",
  gitUrl: "https://github.com/anthropics/knowledge-work-plugins.git",
  branch: "main",
  addedAt: new Date().toISOString(),
  isOfficial: true,
}
