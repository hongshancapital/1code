/**
 * Marketplace Git Operations
 *
 * Handles cloning, updating, and removing plugin marketplaces via Git.
 */

import * as fs from "fs/promises"
import * as path from "path"
import { PATHS } from "../../../lib/paths"
import {
  createGitForLongOperation,
  createGitForNetwork,
  withGitLock,
} from "../../../lib/git/git-factory"
import {
  addMarketplaceConfig,
  removeMarketplaceConfig,
  updateMarketplaceTimestamp,
  readMarketplaceManifest,
  getMarketplaceLocalPath,
  marketplaceExistsLocally,
  getOfficialMarketplaceInfo,
  getKnowledgeWorkMarketplaceInfo,
} from "./marketplace-config"
import type {
  MarketplaceConfig,
  AddMarketplaceResult,
  UpdateMarketplaceResult,
} from "./marketplace-types"
import { clearPluginCache } from "./index"
import { createLogger } from "../../../lib/logger"

const marketplaceLog = createLogger("Marketplace")


/**
 * Ensure the marketplaces directory exists
 */
async function ensureMarketplacesDir(): Promise<void> {
  await fs.mkdir(PATHS.PLUGINS_MARKETPLACES, { recursive: true })
}

/**
 * Extract repository name from Git URL
 * e.g., "https://github.com/anthropics/claude-plugins-official.git" -> "claude-plugins-official"
 */
export function extractRepoName(gitUrl: string): string {
  // Remove trailing .git if present
  const url = gitUrl.replace(/\.git$/, "")

  // Extract the last path segment
  const lastSlash = url.lastIndexOf("/")
  if (lastSlash >= 0) {
    return url.slice(lastSlash + 1)
  }

  return url
}

/**
 * Validate that a directory is a valid marketplace (has marketplace.json)
 */
async function validateMarketplace(localPath: string): Promise<boolean> {
  const manifest = await readMarketplaceManifest(localPath)
  return manifest !== null && Array.isArray(manifest.plugins)
}

/**
 * Clone a marketplace repository
 */
export async function cloneMarketplace(
  gitUrl: string,
  name?: string,
  branch?: string
): Promise<AddMarketplaceResult> {
  const marketplaceName = name || extractRepoName(gitUrl)
  const localPath = getMarketplaceLocalPath(marketplaceName)

  // Check if already exists
  if (await marketplaceExistsLocally(marketplaceName)) {
    return {
      success: false,
      marketplace: {
        name: marketplaceName,
        gitUrl,
        branch,
        addedAt: new Date().toISOString(),
      },
      error: `Marketplace "${marketplaceName}" already exists`,
    }
  }

  await ensureMarketplacesDir()

  try {
    // Clone using simple-git
    const git = createGitForLongOperation(PATHS.PLUGINS_MARKETPLACES)

    const cloneArgs: string[] = []
    if (branch) {
      cloneArgs.push("--branch", branch)
    }
    cloneArgs.push("--depth", "1") // Shallow clone for faster download

    marketplaceLog.info(`Cloning ${gitUrl} to ${localPath}...`)
    await git.clone(gitUrl, marketplaceName, cloneArgs)

    // Validate the cloned repo
    if (!(await validateMarketplace(localPath))) {
      // Clean up invalid repo
      await fs.rm(localPath, { recursive: true, force: true })
      return {
        success: false,
        marketplace: {
          name: marketplaceName,
          gitUrl,
          branch,
          addedAt: new Date().toISOString(),
        },
        error: "Invalid marketplace: missing .claude-plugin/marketplace.json",
      }
    }

    // Save to config
    const config: MarketplaceConfig = {
      name: marketplaceName,
      gitUrl,
      branch,
      addedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    }
    await addMarketplaceConfig(config)

    // Clear plugin cache to pick up new plugins
    clearPluginCache()

    marketplaceLog.info(`Successfully cloned ${marketplaceName}`)
    return { success: true, marketplace: config }
  } catch (error) {
    // Clean up on failure
    try {
      await fs.rm(localPath, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }

    const errorMessage = error instanceof Error ? error.message : String(error)

    // Provide user-friendly error messages
    if (errorMessage.includes("Could not resolve host")) {
      return {
        success: false,
        marketplace: {
          name: marketplaceName,
          gitUrl,
          branch,
          addedAt: new Date().toISOString(),
        },
        error: "Network error: Cannot reach Git server",
      }
    }

    if (
      errorMessage.includes("Repository not found") ||
      errorMessage.includes("not found")
    ) {
      return {
        success: false,
        marketplace: {
          name: marketplaceName,
          gitUrl,
          branch,
          addedAt: new Date().toISOString(),
        },
        error: "Repository not found or access denied",
      }
    }

    return {
      success: false,
      marketplace: {
        name: marketplaceName,
        gitUrl,
        branch,
        addedAt: new Date().toISOString(),
      },
      error: errorMessage,
    }
  }
}

/**
 * Update a marketplace by pulling latest changes
 */
export async function pullMarketplace(
  name: string
): Promise<UpdateMarketplaceResult> {
  const localPath = getMarketplaceLocalPath(name)

  if (!(await marketplaceExistsLocally(name))) {
    return {
      success: false,
      updatedAt: "",
      error: `Marketplace "${name}" does not exist locally`,
    }
  }

  try {
    const git = createGitForNetwork(localPath)

    await withGitLock(localPath, async () => {
      marketplaceLog.info(`Pulling updates for ${name}...`)
      await git.pull()
    })

    // Update timestamp
    await updateMarketplaceTimestamp(name)
    const updatedAt = new Date().toISOString()

    // Clear plugin cache
    clearPluginCache()

    marketplaceLog.info(`Successfully updated ${name}`)
    return { success: true, updatedAt }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)

    return {
      success: false,
      updatedAt: "",
      error: errorMessage,
    }
  }
}

/**
 * Remove a marketplace
 */
export async function deleteMarketplace(
  name: string
): Promise<{ success: boolean; error?: string }> {
  const localPath = getMarketplaceLocalPath(name)

  try {
    // Remove from config first
    const removed = await removeMarketplaceConfig(name)
    if (!removed) {
      marketplaceLog.info(`${name} not found in config`)
    }

    // Remove local directory
    if (await marketplaceExistsLocally(name)) {
      marketplaceLog.info(`Removing ${localPath}...`)
      await fs.rm(localPath, { recursive: true, force: true })
    }

    // Clear plugin cache
    clearPluginCache()

    marketplaceLog.info(`Successfully removed ${name}`)
    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, error: errorMessage }
  }
}

/**
 * Initialize the official marketplace if not present
 * This should be called on app startup or when user requests it
 */
export async function initializeOfficialMarketplace(): Promise<AddMarketplaceResult> {
  const official = getOfficialMarketplaceInfo()

  // Check if directory already exists locally
  if (await marketplaceExistsLocally(official.name)) {
    // Directory exists, just ensure it's in the config
    const config: MarketplaceConfig = {
      ...official,
      lastUpdatedAt: new Date().toISOString(),
    }
    await addMarketplaceConfig(config)
    marketplaceLog.info(`Official marketplace already exists, added to config`)
    return {
      success: true,
      marketplace: config,
    }
  }

  // Clone official marketplace
  const result = await cloneMarketplace(official.gitUrl, official.name, official.branch)

  if (result.success) {
    // Mark as official
    result.marketplace.isOfficial = true
    await addMarketplaceConfig(result.marketplace)
  }

  return result
}

/**
 * Sync existing marketplace directories to config
 * Scans ~/.claude/plugins/marketplaces/ and adds any directories with valid marketplace.json to config
 */
export async function syncExistingMarketplaces(): Promise<void> {
  try {
    const marketplacesDir = PATHS.PLUGINS_MARKETPLACES
    await fs.access(marketplacesDir)

    const entries = await fs.readdir(marketplacesDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("temp_")) {
        continue
      }

      const localPath = path.join(marketplacesDir, entry.name)

      // Check if it's a valid marketplace
      if (!(await validateMarketplace(localPath))) {
        continue
      }

      // Try to get git remote URL
      let gitUrl = ""
      try {
        const git = createGitForNetwork(localPath)
        const remotes = await git.getRemotes(true)
        const origin = remotes.find((r) => r.name === "origin")
        gitUrl = origin?.refs?.fetch || ""
      } catch {
        // Not a git repo or no remote
      }

      // Add to config if we have a URL
      if (gitUrl) {
        const isOfficial = entry.name === "claude-plugins-official"
        const config: MarketplaceConfig = {
          name: entry.name,
          gitUrl,
          addedAt: new Date().toISOString(),
          lastUpdatedAt: new Date().toISOString(),
          isOfficial,
        }
        await addMarketplaceConfig(config)
        marketplaceLog.info(`Synced existing marketplace: ${entry.name}`)
      }
    }
  } catch {
    // Directory doesn't exist, nothing to sync
  }
}

/**
 * Initialize the Knowledge Work Plugins marketplace if not present
 */
export async function initializeKnowledgeWorkMarketplace(): Promise<AddMarketplaceResult> {
  const knowledgeWork = getKnowledgeWorkMarketplaceInfo()

  // Check if directory already exists locally
  if (await marketplaceExistsLocally(knowledgeWork.name)) {
    // Directory exists, just ensure it's in the config
    const config: MarketplaceConfig = {
      ...knowledgeWork,
      lastUpdatedAt: new Date().toISOString(),
    }
    await addMarketplaceConfig(config)
    marketplaceLog.info(`Knowledge Work marketplace already exists, added to config`)
    return {
      success: true,
      marketplace: config,
    }
  }

  // Clone Knowledge Work marketplace
  const result = await cloneMarketplace(knowledgeWork.gitUrl, knowledgeWork.name, knowledgeWork.branch)

  if (result.success) {
    // Mark as official
    result.marketplace.isOfficial = true
    await addMarketplaceConfig(result.marketplace)
  }

  return result
}

/**
 * Get Git status for a marketplace (for showing update availability)
 */
export async function getMarketplaceGitStatus(
  name: string
): Promise<{ hasUpdates: boolean; currentCommit?: string; error?: string }> {
  const localPath = getMarketplaceLocalPath(name)

  if (!(await marketplaceExistsLocally(name))) {
    return { hasUpdates: false, error: "Marketplace not found" }
  }

  try {
    const git = createGitForNetwork(localPath)

    // Fetch without merging
    await git.fetch()

    // Get current and remote HEAD
    const local = await git.revparse(["HEAD"])
    const remote = await git.revparse(["@{u}"])

    return {
      hasUpdates: local !== remote,
      currentCommit: local,
    }
  } catch (error) {
    return {
      hasUpdates: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
