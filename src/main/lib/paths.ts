/**
 * Centralized path configuration for all component directories
 *
 * This module provides a single source of truth for all paths used in the application.
 * It supports multiple sources for each component type (user, project, plugin, builtin).
 *
 * Usage:
 *   import { PATHS, getProjectPaths } from './paths'
 *   const skillsDir = PATHS.USER_SKILLS
 *   const projectSkills = getProjectPaths(projectRoot).SKILLS
 */

import * as path from "path"
import * as os from "os"
import { app } from "electron"

// ============================================================================
// User-level paths (~/.claude/)
// ============================================================================

export const CLAUDE_HOME = path.join(os.homedir(), ".claude")

export const PATHS = {
  // Root directories
  CLAUDE_HOME,
  HONG_HOME: path.join(os.homedir(), ".hong"),

  // Claude configuration
  CLAUDE_CONFIG: path.join(os.homedir(), ".claude.json"),
  CLAUDE_SETTINGS: path.join(CLAUDE_HOME, "settings.json"),
  CLAUDE_CREDENTIALS: path.join(CLAUDE_HOME, ".credentials.json"),

  // Plugins (two sources!)
  PLUGINS_DIR: path.join(CLAUDE_HOME, "plugins"),
  PLUGINS_CACHE: path.join(CLAUDE_HOME, "plugins", "cache"),
  PLUGINS_MARKETPLACES: path.join(CLAUDE_HOME, "plugins", "marketplaces"),
  INSTALLED_PLUGINS_JSON: path.join(CLAUDE_HOME, "plugins", "installed_plugins.json"),

  // User components
  USER_SKILLS: path.join(CLAUDE_HOME, "skills"),
  USER_COMMANDS: path.join(CLAUDE_HOME, "commands"),
  USER_AGENTS: path.join(CLAUDE_HOME, "agents"),

  // Hong working directories
  HONG_WORKTREES: path.join(os.homedir(), ".hong", "worktrees"),
  HONG_PLAYGROUND: path.join(os.homedir(), ".hong", ".playground"),
  HONG_REPOS: path.join(os.homedir(), ".hong", "repos"),

  // Future expansion (planned)
  AGENTS_HOME: path.join(os.homedir(), ".agents"),
} as const

// ============================================================================
// App data paths ({userData}/)
// ============================================================================

/**
 * Get app data paths (requires Electron app to be ready)
 * Call this after app.whenReady()
 */
export function getAppDataPaths() {
  const userData = app.getPath("userData")
  return {
    // Database
    DATABASE: path.join(userData, "data", "agents.db"),
    MIGRATIONS: path.join(userData, "data", "migrations"),

    // Auth
    AUTH_DATA: path.join(userData, "auth.dat"),
    DEVICE_ID: path.join(userData, "device-id"),

    // Session data
    CLAUDE_SESSIONS: path.join(userData, "claude-sessions"),
    INSIGHTS: path.join(userData, "insights"),
    TERMINAL_HISTORY: path.join(userData, "terminal-history"),

    // Assets
    PROJECT_ICONS: path.join(userData, "project-icons"),

    // Artifacts (per subChat)
    ARTIFACTS: path.join(userData, "artifacts"),
  } as const
}

// ============================================================================
// Project-level paths (.claude/ in project root)
// ============================================================================

/**
 * Get project-level paths for a specific project directory
 */
export function getProjectPaths(projectRoot: string) {
  const claudeDir = path.join(projectRoot, ".claude")
  return {
    CLAUDE_DIR: claudeDir,
    SETTINGS: path.join(claudeDir, "settings.json"),
    SKILLS: path.join(claudeDir, "skills"),
    COMMANDS: path.join(claudeDir, "commands"),
    AGENTS: path.join(claudeDir, "agents"),
    KEYBINDINGS: path.join(claudeDir, "keybindings.json"),
  } as const
}

// ============================================================================
// Resource paths (bundled with app)
// ============================================================================

/**
 * Get resource paths based on dev/production mode
 */
export function getResourcePaths() {
  const isDev = !app.isPackaged
  const resourcesPath = isDev ? path.join(__dirname, "..", "..", "resources") : process.resourcesPath

  return {
    // CLI binaries
    CLAUDE_BIN: (platform: string, arch: string) =>
      path.join(resourcesPath, "bin", `${platform}-${arch}`, "claude"),

    // LSP
    TSSERVER: path.join(resourcesPath, "typescript", "tsserver.js"),
    TSGO: path.join(resourcesPath, "typescript", "tsgo"),

    // Database migrations
    MIGRATIONS: path.join(resourcesPath, "migrations"),

    // Built-in skills
    BUILTIN_SKILLS: path.join(resourcesPath, "skills"),
  } as const
}

// ============================================================================
// Plugin paths
// ============================================================================

/**
 * Get component paths for a plugin directory
 */
export function getPluginComponentPaths(pluginPath: string) {
  return {
    COMMANDS: path.join(pluginPath, "commands"),
    SKILLS: path.join(pluginPath, "skills"),
    AGENTS: path.join(pluginPath, "agents"),
    MCP_CONFIG: path.join(pluginPath, ".mcp.json"),
    PLUGIN_JSON: path.join(pluginPath, ".claude-plugin", "plugin.json"),
  } as const
}

// ============================================================================
// Path utilities
// ============================================================================

/**
 * Check if a path is within a safe directory (prevents path traversal)
 */
export function isPathWithin(targetPath: string, basePath: string): boolean {
  const resolved = path.resolve(targetPath)
  const base = path.resolve(basePath)
  return resolved.startsWith(base + path.sep) || resolved === base
}

/**
 * Normalize a plugin source identifier
 * Converts between formats:
 * - "marketplace:plugin" (old format)
 * - "plugin@marketplace" (CLI format)
 */
export function normalizePluginSource(source: string): {
  pluginName: string
  marketplace: string
  normalized: string // Always "plugin@marketplace" format
} {
  // Try "plugin@marketplace" format first
  const atIndex = source.lastIndexOf("@")
  if (atIndex > 0) {
    return {
      pluginName: source.slice(0, atIndex),
      marketplace: source.slice(atIndex + 1),
      normalized: source,
    }
  }

  // Try "marketplace:plugin" format
  const colonIndex = source.indexOf(":")
  if (colonIndex > 0) {
    const marketplace = source.slice(0, colonIndex)
    const pluginName = source.slice(colonIndex + 1)
    return {
      pluginName,
      marketplace,
      normalized: `${pluginName}@${marketplace}`,
    }
  }

  // Invalid format
  return {
    pluginName: source,
    marketplace: "unknown",
    normalized: `${source}@unknown`,
  }
}
