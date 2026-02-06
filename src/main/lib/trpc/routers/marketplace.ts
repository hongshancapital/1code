/**
 * Marketplace tRPC Router
 *
 * Handles marketplace management and plugin installation/uninstallation.
 */

import { z } from "zod"
import { router, publicProcedure } from "../index"
import {
  readMarketplacesConfig,
  readMarketplaceManifest,
  getMarketplaceLocalPath,
  marketplaceExistsLocally,
} from "../../plugins/marketplace-config"
import {
  cloneMarketplace,
  pullMarketplace,
  deleteMarketplace,
  initializeOfficialMarketplace,
  syncExistingMarketplaces,
} from "../../plugins/marketplace-operations"
import {
  installPlugin,
  uninstallPlugin,
  isPluginInstalled,
  getInstalledVersion,
} from "../../plugins/plugin-installer"
import type {
  MarketplaceConfig,
  MarketplaceDetail,
  MarketplaceAvailablePlugin,
} from "../../plugins/marketplace-types"

// Track if we've synced existing marketplaces
let hasSyncedExisting = false

export const marketplaceRouter = router({
  /**
   * List all configured marketplaces
   * Also syncs any existing local marketplaces to config on first call
   */
  listMarketplaces: publicProcedure.query(
    async (): Promise<MarketplaceConfig[]> => {
      // Sync existing marketplaces on first call only
      if (!hasSyncedExisting) {
        await syncExistingMarketplaces()
        hasSyncedExisting = true
      }
      const config = await readMarketplacesConfig()
      return config.marketplaces
    }
  ),

  /**
   * Add a new marketplace by cloning from Git URL
   */
  addMarketplace: publicProcedure
    .input(
      z.object({
        gitUrl: z.string().url(),
        name: z.string().optional(),
        branch: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await cloneMarketplace(input.gitUrl, input.name, input.branch)
      if (!result.success) {
        throw new Error(result.error || "Failed to add marketplace")
      }
      return result
    }),

  /**
   * Update a marketplace by pulling latest changes
   */
  updateMarketplace: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const result = await pullMarketplace(input.name)
      if (!result.success) {
        throw new Error(result.error || "Failed to update marketplace")
      }
      return result
    }),

  /**
   * Remove a marketplace
   */
  removeMarketplace: publicProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const result = await deleteMarketplace(input.name)
      if (!result.success) {
        throw new Error(result.error || "Failed to remove marketplace")
      }
      return result
    }),

  /**
   * Initialize official marketplace (clone if not present)
   */
  initializeOfficial: publicProcedure.mutation(async () => {
    const result = await initializeOfficialMarketplace()
    if (!result.success) {
      throw new Error(result.error || "Failed to initialize official marketplace")
    }
    return result
  }),

  /**
   * Get detailed information about a marketplace including its plugins
   */
  getMarketplaceDetail: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ input }): Promise<MarketplaceDetail> => {
      const config = await readMarketplacesConfig()
      const marketplaceConfig = config.marketplaces.find(
        (m) => m.name === input.name
      )

      if (!marketplaceConfig) {
        throw new Error(`Marketplace "${input.name}" not found in config`)
      }

      const localPath = getMarketplaceLocalPath(input.name)
      const exists = await marketplaceExistsLocally(input.name)

      if (!exists) {
        throw new Error(`Marketplace "${input.name}" not found locally`)
      }

      const manifest = await readMarketplaceManifest(localPath)
      if (!manifest) {
        throw new Error(`Cannot read manifest for marketplace "${input.name}"`)
      }

      // Convert manifest plugins to available plugins with install status
      const plugins: MarketplaceAvailablePlugin[] = await Promise.all(
        manifest.plugins.map(async (p) => {
          const pluginSource = `${p.name}@${input.name}`
          const installed = await isPluginInstalled(pluginSource)
          const installedVersion = installed
            ? await getInstalledVersion(pluginSource)
            : undefined

          return {
            name: p.name,
            version: p.version,
            description: p.description,
            category: p.category,
            homepage: p.homepage,
            tags: p.tags,
            sourcePath:
              typeof p.source === "string" ? p.source : p.source?.source || "",
            marketplaceName: input.name,
            isInstalled: installed,
            installedVersion: installedVersion || undefined,
          }
        })
      )

      return {
        name: input.name,
        description: manifest.description,
        gitUrl: marketplaceConfig.gitUrl,
        branch: marketplaceConfig.branch,
        localPath,
        pluginCount: plugins.length,
        lastUpdatedAt: marketplaceConfig.lastUpdatedAt,
        isOfficial: marketplaceConfig.isOfficial,
        plugins,
      }
    }),

  /**
   * Search for plugins across all marketplaces
   */
  searchPlugins: publicProcedure
    .input(
      z.object({
        query: z.string(),
        marketplace: z.string().optional(),
      })
    )
    .query(async ({ input }): Promise<MarketplaceAvailablePlugin[]> => {
      const config = await readMarketplacesConfig()
      const results: MarketplaceAvailablePlugin[] = []

      const marketplacesToSearch = input.marketplace
        ? config.marketplaces.filter((m) => m.name === input.marketplace)
        : config.marketplaces

      for (const m of marketplacesToSearch) {
        const localPath = getMarketplaceLocalPath(m.name)
        if (!(await marketplaceExistsLocally(m.name))) {
          continue
        }

        const manifest = await readMarketplaceManifest(localPath)
        if (!manifest) {
          continue
        }

        const queryLower = input.query.toLowerCase()

        for (const p of manifest.plugins) {
          // Search in name, description, and tags
          const matchesName = p.name.toLowerCase().includes(queryLower)
          const matchesDescription =
            p.description?.toLowerCase().includes(queryLower) || false
          const matchesTags =
            p.tags?.some((t) => t.toLowerCase().includes(queryLower)) || false
          const matchesCategory =
            p.category?.toLowerCase().includes(queryLower) || false

          if (matchesName || matchesDescription || matchesTags || matchesCategory) {
            const pluginSource = `${p.name}@${m.name}`
            const installed = await isPluginInstalled(pluginSource)
            const installedVersion = installed
              ? await getInstalledVersion(pluginSource)
              : undefined

            results.push({
              name: p.name,
              version: p.version,
              description: p.description,
              category: p.category,
              homepage: p.homepage,
              tags: p.tags,
              sourcePath:
                typeof p.source === "string" ? p.source : p.source?.source || "",
              marketplaceName: m.name,
              isInstalled: installed,
              installedVersion: installedVersion || undefined,
            })
          }
        }
      }

      return results
    }),

  /**
   * Get all available plugins from all marketplaces
   */
  listAvailablePlugins: publicProcedure
    .input(
      z
        .object({
          marketplace: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }): Promise<MarketplaceAvailablePlugin[]> => {
      const config = await readMarketplacesConfig()
      const results: MarketplaceAvailablePlugin[] = []

      const marketplacesToList = input?.marketplace
        ? config.marketplaces.filter((m) => m.name === input.marketplace)
        : config.marketplaces

      for (const m of marketplacesToList) {
        const localPath = getMarketplaceLocalPath(m.name)
        if (!(await marketplaceExistsLocally(m.name))) {
          continue
        }

        const manifest = await readMarketplaceManifest(localPath)
        if (!manifest) {
          continue
        }

        for (const p of manifest.plugins) {
          const pluginSource = `${p.name}@${m.name}`
          const installed = await isPluginInstalled(pluginSource)
          const installedVersion = installed
            ? await getInstalledVersion(pluginSource)
            : undefined

          results.push({
            name: p.name,
            version: p.version,
            description: p.description,
            category: p.category,
            homepage: p.homepage,
            tags: p.tags,
            sourcePath:
              typeof p.source === "string" ? p.source : p.source?.source || "",
            marketplaceName: m.name,
            isInstalled: installed,
            installedVersion: installedVersion || undefined,
          })
        }
      }

      return results
    }),

  /**
   * Install a plugin from a marketplace
   */
  installPlugin: publicProcedure
    .input(
      z.object({
        pluginName: z.string(),
        marketplaceName: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await installPlugin(input.pluginName, input.marketplaceName)
      if (!result.success) {
        throw new Error(result.error || "Failed to install plugin")
      }
      return result
    }),

  /**
   * Uninstall a plugin
   */
  uninstallPlugin: publicProcedure
    .input(z.object({ pluginSource: z.string() }))
    .mutation(async ({ input }) => {
      const result = await uninstallPlugin(input.pluginSource)
      if (!result.success) {
        throw new Error(result.error || "Failed to uninstall plugin")
      }
      return result
    }),
})
