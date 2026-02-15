import { z } from "zod"
import { router, publicProcedure } from "../../../lib/trpc/index"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import matter from "gray-matter"
import { discoverInstalledPlugins, getPluginComponentPaths } from "../lib"
import { getEnabledPlugins } from "../../../lib/trpc/routers/claude-settings"
import { createLogger } from "../../../lib/logger"

const commandsLog = createLogger("commands")


/** Format plugin name: "review_by_blair" → "Review By Blair" */
function formatPluginName(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export interface FileCommand {
  name: string // Command name (may include namespace prefix)
  displayName: string // Original name without namespace prefix (for display)
  description: string
  argumentHint?: string
  source: "user" | "project" | "plugin"
  pluginName?: string // Plugin source ID (e.g., "review_by_blair@hs-dev-marketplace")
  pluginDisplayName?: string // Human-readable plugin name (e.g., "Review By Blair")
  path: string
}

/**
 * Parse command .md frontmatter to extract description and argument-hint
 */
function parseCommandMd(content: string): {
  description?: string
  argumentHint?: string
  name?: string
} {
  try {
    const { data } = matter(content)
    return {
      description:
        typeof data.description === "string" ? data.description : undefined,
      argumentHint:
        typeof data["argument-hint"] === "string"
          ? data["argument-hint"]
          : undefined,
      name: typeof data.name === "string" ? data.name : undefined,
    }
  } catch (err) {
    commandsLog.error("Failed to parse frontmatter:", err)
    return {}
  }
}

/**
 * Validate entry name for security (prevent path traversal)
 */
function isValidEntryName(name: string): boolean {
  return !name.includes("..") && !name.includes("/") && !name.includes("\\")
}

/**
 * Recursively scan a directory for .md command files
 * Supports namespaces via nested folders: git/commit.md → git:commit
 */
async function scanCommandsDirectory(
  dir: string,
  source: "user" | "project" | "plugin",
  prefix = "",
): Promise<FileCommand[]> {
  const commands: FileCommand[] = []

  try {
    // Check if directory exists
    try {
      await fs.access(dir)
      commandsLog.info("Directory exists:", dir)
    } catch {
      commandsLog.info("Directory does not exist:", dir)
      return commands
    }

    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      if (!isValidEntryName(entry.name)) {
        commandsLog.warn(`Skipping invalid entry name: ${entry.name}`)
        continue
      }

      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Recursively scan nested directories
        const nestedCommands = await scanCommandsDirectory(
          fullPath,
          source,
          prefix ? `${prefix}:${entry.name}` : entry.name,
        )
        commands.push(...nestedCommands)
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const baseName = entry.name.replace(/\.md$/, "")
        const fallbackName = prefix ? `${prefix}:${baseName}` : baseName

        try {
          const content = await fs.readFile(fullPath, "utf-8")
          const parsed = parseCommandMd(content)
          const commandName = parsed.name || fallbackName

          commandsLog.info("Found command:", commandName, "at", fullPath)
          commands.push({
            name: commandName,
            displayName: commandName, // Will be overridden for plugin commands
            description: parsed.description || "",
            argumentHint: parsed.argumentHint,
            source,
            path: fullPath,
          })
        } catch (err) {
          commandsLog.warn(`Failed to read ${fullPath}:`, err)
        }
      }
    }
  } catch (err) {
    commandsLog.error(`Failed to scan directory ${dir}:`, err)
  }

  return commands
}

export const commandsRouter = router({
  /**
   * List all commands from filesystem
   * - User commands: ~/.claude/commands/
   * - Project commands: .claude/commands/ (relative to projectPath)
   */
  list: publicProcedure
    .input(
      z
        .object({
          projectPath: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const userCommandsDir = path.join(os.homedir(), ".claude", "commands")
      commandsLog.info("[commands.list] Scanning user commands dir:", userCommandsDir)
      const userCommandsPromise = scanCommandsDirectory(userCommandsDir, "user")

      let projectCommandsPromise = Promise.resolve<FileCommand[]>([])
      if (input?.projectPath) {
        const projectCommandsDir = path.join(
          input.projectPath,
          ".claude",
          "commands",
        )
        projectCommandsPromise = scanCommandsDirectory(
          projectCommandsDir,
          "project",
        )
      }

      // Discover plugin commands
      const [enabledPluginSources, installedPlugins] = await Promise.all([
        getEnabledPlugins(),
        discoverInstalledPlugins(),
      ])
      const enabledPlugins = installedPlugins.filter(
        (p) => enabledPluginSources.includes(p.source),
      )
      const pluginCommandsPromises = enabledPlugins.map(async (plugin) => {
        const paths = getPluginComponentPaths(plugin)
        try {
          const commands = await scanCommandsDirectory(paths.commands, "plugin")
          // Add namespace prefix for plugin commands: "pluginName:commandName"
          // This helps distinguish commands with the same name from different plugins
          return commands.map((cmd) => (Object.assign(cmd, {displayName:cmd.name,name:`${plugin.name}:${cmd.name}`,pluginName:plugin.source,pluginDisplayName:formatPluginName(plugin.name)})))
        } catch {
          return []
        }
      })

      // Scan all directories in parallel
      const [userCommands, projectCommands, ...pluginCommandsArrays] =
        await Promise.all([
          userCommandsPromise,
          projectCommandsPromise,
          ...pluginCommandsPromises,
        ])
      const pluginCommands = pluginCommandsArrays.flat()

      // Project commands first (more specific), then user commands, then plugin commands
      const result = [...projectCommands, ...userCommands, ...pluginCommands]
      commandsLog.info("[commands.list] Found commands:", result.length, result.map(c => c.name))
      return result
    }),

  /**
   * Get content of a specific command file (without frontmatter)
   */
  getContent: publicProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      // Security: prevent path traversal
      if (input.path.includes("..")) {
        throw new Error("Invalid path")
      }

      try {
        const content = await fs.readFile(input.path, "utf-8")
        const { content: body } = matter(content)
        return { content: body.trim() }
      } catch (err) {
        commandsLog.error(`Failed to read command content:`, err)
        return { content: "" }
      }
    }),
})
