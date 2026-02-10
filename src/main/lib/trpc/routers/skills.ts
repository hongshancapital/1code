import { z } from "zod"
import { router, publicProcedure } from "../index"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import matter from "gray-matter"
import YAML from "yaml"
import { app } from "electron"
import { getMergedSettings, getEnabledPlugins } from "./claude-settings"
import { discoverInstalledPlugins, getPluginComponentPaths } from "../../plugins"

// Interface configuration from hong.yaml
export interface SkillInterfaceConfig {
  display_name?: string
  short_description?: string
  icon_small?: string    // Relative path, e.g., "./assets/icon-small.svg"
  icon_large?: string
  default_prompt?: string
  hidden?: boolean       // If true, skill is hidden from UI and cannot be enabled
}

// File info for skill contents
export interface SkillFile {
  name: string
  path: string           // Relative to skill directory
  type: "markdown" | "image" | "code" | "yaml" | "other"
  size: string           // Formatted file size
}

// Directory containing files
export interface SkillDirectory {
  name: string           // Directory name, e.g., "guides", "assets"
  files: SkillFile[]
}

export interface FileSkill {
  name: string
  description: string
  source: "user" | "project" | "plugin" | "builtin"
  pluginName?: string
  path: string
  content: string
  // New fields from hong.yaml
  interface?: SkillInterfaceConfig
  iconSmallPath?: string   // Resolved absolute path
  iconLargePath?: string
  skillDir?: string        // Absolute path to skill directory (for file operations)
  contents?: SkillDirectory[]  // Sub-directory contents
  hidden?: boolean         // If true, skill is hidden from UI and cannot be enabled
}

/**
 * Parse SKILL.md frontmatter to extract name and description
 */
function parseSkillMd(rawContent: string): { name?: string; description?: string; content: string } {
  try {
    const { data, content } = matter(rawContent)
    return {
      name: typeof data.name === "string" ? data.name : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      content: content.trim(),
    }
  } catch (err) {
    console.error("[skills] Failed to parse frontmatter:", err)
    return { content: rawContent.trim() }
  }
}

/**
 * Parse hong.yaml to extract interface configuration
 */
async function parseHongYaml(skillDir: string): Promise<SkillInterfaceConfig | undefined> {
  const hongYamlPath = path.join(skillDir, "agents", "hong.yaml")
  try {
    const content = await fs.readFile(hongYamlPath, "utf-8")
    const parsed = YAML.parse(content)
    return parsed?.interface as SkillInterfaceConfig | undefined
  } catch {
    // hong.yaml doesn't exist or parse failed - ignore
    return undefined
  }
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Determine file type from extension
 */
function getFileType(filename: string): SkillFile["type"] {
  const ext = path.extname(filename).toLowerCase()
  const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]
  const codeExts = [".js", ".ts", ".py", ".sh", ".bash", ".json", ".tsx", ".jsx", ".css", ".html"]
  const yamlExts = [".yaml", ".yml"]

  if (ext === ".md" || ext === ".markdown") return "markdown"
  if (imageExts.includes(ext)) return "image"
  if (codeExts.includes(ext)) return "code"
  if (yamlExts.includes(ext)) return "yaml"
  return "other"
}

/**
 * Recursively walk a directory and collect all files
 * Returns files with their relative paths using forward slashes
 */
async function walkDirectory(
  dirPath: string,
  baseDir: string,
  relativePath: string = ""
): Promise<SkillFile[]> {
  const files: SkillFile[] = []

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue

      const fullPath = path.join(dirPath, entry.name)
      // Use forward slash for display, regardless of OS
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name

      if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath)
          files.push({
            name: entryRelativePath,
            // Use path.join for actual file path (OS-specific)
            path: [baseDir, ...entryRelativePath.split("/")].join(path.sep),
            type: getFileType(entry.name),
            size: formatFileSize(stat.size),
          })
        } catch {
          // Skip files we can't stat
        }
      } else if (entry.isDirectory()) {
        // Recursively walk subdirectory
        const subFiles = await walkDirectory(fullPath, baseDir, entryRelativePath)
        files.push(...subFiles)
      }
    }
  } catch (err) {
    console.error(`[skills] Failed to walk directory ${dirPath}:`, err)
  }

  return files
}

/**
 * Scan skill directory for sub-directories and their files
 * Excludes SKILL.md and agents/ directory (handled separately)
 * Recursively walks all subdirectories
 */
async function scanSkillContents(skillDir: string): Promise<SkillDirectory[]> {
  const directories: SkillDirectory[] = []

  try {
    const entries = await fs.readdir(skillDir, { withFileTypes: true })

    for (const entry of entries) {
      // Skip non-directories, agents/ (handled separately), and hidden files
      if (!entry.isDirectory()) continue
      if (entry.name === "agents" || entry.name.startsWith(".")) continue

      const dirPath = path.join(skillDir, entry.name)

      // Recursively walk the entire directory tree
      const files = await walkDirectory(dirPath, entry.name)

      if (files.length > 0) {
        directories.push({
          name: entry.name,
          files: files.sort((a, b) => a.name.localeCompare(b.name)),
        })
      }
    }
  } catch (err) {
    console.error(`[skills] Failed to scan skill contents ${skillDir}:`, err)
  }

  return directories.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get the builtin skills directory path
 * Handles both development and production (packaged) environments
 */
export function getBuiltinSkillsPath(): string {
  if (app.isPackaged) {
    // Production: skills bundled in resources
    return path.join(process.resourcesPath, "skills")
  }
  // Development: __dirname is out/main, go up 2 levels to project root
  return path.join(__dirname, "../../resources/skills")
}

// NOTE: Skill sync functions (syncBuiltinSkillsToUserDir, syncBuiltinSkillEnabled, copyDirectoryRecursive)
// have been migrated to the unified SkillManager at src/main/lib/skills/index.ts

/**
 * Scan a directory for SKILL.md files
 */
async function scanSkillsDirectory(
  dir: string,
  source: "user" | "project" | "plugin" | "builtin",
  basePath?: string, // For project skills, the cwd to make paths relative to
): Promise<FileSkill[]> {
  const skills: FileSkill[] = []

  try {
    // Check if directory exists
    try {
      await fs.access(dir)
    } catch {
      return skills
    }

    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      // Check if entry is a directory or a symlink pointing to a directory
      let isDir = entry.isDirectory()
      if (!isDir && entry.isSymbolicLink()) {
        try {
          const targetPath = path.join(dir, entry.name)
          const stat = await fs.stat(targetPath) // stat() follows symlinks
          isDir = stat.isDirectory()
        } catch {
          // Symlink target doesn't exist or is inaccessible - skip it
          continue
        }
      }
      if (!isDir) continue

      // Validate entry name for security (prevent path traversal)
      if (entry.name.includes("..") || entry.name.includes("/") || entry.name.includes("\\")) {
        console.warn(`[skills] Skipping invalid directory name: ${entry.name}`)
        continue
      }

      const skillDir = path.join(dir, entry.name)
      const skillMdPath = path.join(skillDir, "SKILL.md")

      try {
        // Skip managed skills synced by Hong when scanning user skills
        // These are prefixed with "builtin-" or "plugin-" and should be listed from their respective sources
        if (source === "user" && (entry.name.startsWith("builtin-") || entry.name.startsWith("plugin-"))) {
          continue
        }

        await fs.access(skillMdPath)
        const content = await fs.readFile(skillMdPath, "utf-8")
        const parsed = parseSkillMd(content)

        // Parse hong.yaml for interface configuration
        const interfaceConfig = await parseHongYaml(skillDir)

        // Resolve icon paths
        let iconSmallPath: string | undefined
        let iconLargePath: string | undefined
        if (interfaceConfig?.icon_small) {
          iconSmallPath = path.resolve(skillDir, interfaceConfig.icon_small)
        }
        if (interfaceConfig?.icon_large) {
          iconLargePath = path.resolve(skillDir, interfaceConfig.icon_large)
        }

        // Scan sub-directories for contents
        const contents = await scanSkillContents(skillDir)

        // For project skills, show relative path; for user skills, show ~/.claude/... path
        let displayPath: string
        if (source === "project" && basePath) {
          displayPath = path.relative(basePath, skillMdPath)
        } else {
          // For user skills, show ~/.claude/skills/... format
          const homeDir = os.homedir()
          displayPath = skillMdPath.startsWith(homeDir)
            ? "~" + skillMdPath.slice(homeDir.length)
            : skillMdPath
        }

        // For builtin skills, prefix name with "builtin-" to match synced directory name
        const skillName = source === "builtin"
          ? `builtin-${parsed.name || entry.name}`
          : (parsed.name || entry.name)

        // Use interface short_description if available, fall back to SKILL.md description
        const description = interfaceConfig?.short_description || parsed.description || ""

        skills.push({
          name: skillName,
          description,
          source,
          path: displayPath,
          content: parsed.content,
          interface: interfaceConfig,
          iconSmallPath,
          iconLargePath,
          skillDir,
          contents,
          hidden: interfaceConfig?.hidden,
        })
      } catch {
        // Skill directory doesn't have SKILL.md or read failed - skip it
      }
    }
  } catch (err) {
    console.error(`[skills] Failed to scan directory ${dir}:`, err)
  }

  return skills
}

// Shared procedure for listing skills
const listSkillsProcedure = publicProcedure
  .input(
    z
      .object({
        cwd: z.string().optional(),
      })
      .optional(),
  )
  .query(async ({ input }) => {
    const userSkillsDir = path.join(os.homedir(), ".claude", "skills")
    const userSkillsPromise = scanSkillsDirectory(userSkillsDir, "user")

    // Builtin skills from app resources
    const builtinSkillsDir = getBuiltinSkillsPath()
    const builtinSkillsPromise = scanSkillsDirectory(builtinSkillsDir, "builtin")

    let projectSkillsPromise = Promise.resolve<FileSkill[]>([])
    if (input?.cwd) {
      const projectSkillsDir = path.join(input.cwd, ".claude", "skills")
      projectSkillsPromise = scanSkillsDirectory(projectSkillsDir, "project", input.cwd)
    }

    // Discover plugin skills
    const [enabledPluginSources, installedPlugins] = await Promise.all([
      getEnabledPlugins(),
      discoverInstalledPlugins(),
    ])
    const enabledPlugins = installedPlugins.filter(
      (p) => enabledPluginSources.includes(p.source),
    )
    const pluginSkillsPromises = enabledPlugins.map(async (plugin) => {
      const paths = getPluginComponentPaths(plugin)
      try {
        const skills = await scanSkillsDirectory(paths.skills, "plugin")
        return skills.map((skill) => ({ ...skill, pluginName: plugin.source }))
      } catch {
        return []
      }
    })

    // Scan all directories in parallel
    const [userSkills, projectSkills, builtinSkills, ...pluginSkillsArrays] =
      await Promise.all([
        userSkillsPromise,
        projectSkillsPromise,
        builtinSkillsPromise,
        ...pluginSkillsPromises,
      ])
    const pluginSkills = pluginSkillsArrays.flat()

    // Priority: project > user > plugin > builtin (later sources can be overridden by earlier ones)
    // Filter out hidden skills (they cannot be enabled and shouldn't appear in UI)
    return [...projectSkills, ...userSkills, ...pluginSkills, ...builtinSkills]
      .filter((skill) => !skill.hidden)
  })

// Procedure for listing enabled skills (filtered by enabledSkills)
const listEnabledProcedure = publicProcedure
  .input(
    z
      .object({
        cwd: z.string().optional(),
      })
      .optional(),
  )
  .query(async ({ input }) => {
    const userSkillsDir = path.join(os.homedir(), ".claude", "skills")
    const userSkillsPromise = scanSkillsDirectory(userSkillsDir, "user")

    // Builtin skills from app resources
    const builtinSkillsDir = getBuiltinSkillsPath()
    const builtinSkillsPromise = scanSkillsDirectory(builtinSkillsDir, "builtin")

    let projectSkillsPromise = Promise.resolve<FileSkill[]>([])
    if (input?.cwd) {
      const projectSkillsDir = path.join(input.cwd, ".claude", "skills")
      projectSkillsPromise = scanSkillsDirectory(projectSkillsDir, "project", input.cwd)
    }

    // Discover plugin skills (same logic as listSkillsProcedure)
    const [enabledPluginSources, installedPlugins] = await Promise.all([
      getEnabledPlugins(),
      discoverInstalledPlugins(),
    ])
    const enabledPlugins = installedPlugins.filter(
      (p) => enabledPluginSources.includes(p.source),
    )
    const pluginSkillsPromises = enabledPlugins.map(async (plugin) => {
      const paths = getPluginComponentPaths(plugin)
      try {
        const skills = await scanSkillsDirectory(paths.skills, "plugin")
        return skills.map((skill) => ({ ...skill, pluginName: plugin.source }))
      } catch {
        return []
      }
    })

    // Scan all directories in parallel and get settings
    const [userSkills, projectSkills, builtinSkills, mergedSettings, ...pluginSkillsArrays] =
      await Promise.all([
        userSkillsPromise,
        projectSkillsPromise,
        builtinSkillsPromise,
        getMergedSettings(input?.cwd),
        ...pluginSkillsPromises,
      ])
    const pluginSkills = pluginSkillsArrays.flat()

    // Priority: project > user > plugin > builtin
    // Filter out hidden skills first (they cannot be enabled)
    const allSkills = [...projectSkills, ...userSkills, ...pluginSkills, ...builtinSkills]
      .filter((skill) => !skill.hidden)
    const enabledSkills = mergedSettings.enabledSkills || {}

    // If no enabledSkills configured, return all skills (all enabled by default)
    if (Object.keys(enabledSkills).length === 0) {
      return allSkills
    }

    // Filter: exclude skills explicitly disabled (false), include all others
    return allSkills.filter((skill) => {
      return enabledSkills[skill.name] !== false
    })
  })

/**
 * Generate SKILL.md content from name, description, and body
 */
function generateSkillMd(skill: { name: string; description: string; content: string }): string {
  const frontmatter: string[] = []
  frontmatter.push(`name: ${skill.name}`)
  if (skill.description) {
    frontmatter.push(`description: ${skill.description}`)
  }
  return `---\n${frontmatter.join("\n")}\n---\n\n${skill.content}`
}

/**
 * Resolve the absolute filesystem path of a skill given its display path
 */
function resolveSkillPath(displayPath: string): string {
  if (displayPath.startsWith("~")) {
    return path.join(os.homedir(), displayPath.slice(1))
  }
  return displayPath
}

export const skillsRouter = router({
  /**
   * List all skills from filesystem (unfiltered)
   * - User skills: ~/.claude/skills/
   * - Project skills: .claude/skills/ (relative to cwd)
   */
  list: listSkillsProcedure,

  /**
   * List enabled skills - filtered by enabledPlugins in settings.json
   * Reads from both ~/.claude/settings.json and .claude/settings.json (project level)
   * Project settings override user settings
   */
  listEnabled: listEnabledProcedure,

  /**
   * Create a new skill
   */
  create: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string(),
        content: z.string(),
        source: z.enum(["user", "project"]),
        cwd: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const safeName = input.name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
      if (!safeName) {
        throw new Error("Skill name must contain at least one alphanumeric character")
      }

      let targetDir: string
      if (input.source === "project") {
        if (!input.cwd) {
          throw new Error("Project path (cwd) required for project skills")
        }
        targetDir = path.join(input.cwd, ".claude", "skills")
      } else {
        targetDir = path.join(os.homedir(), ".claude", "skills")
      }

      const skillDir = path.join(targetDir, safeName)
      const skillMdPath = path.join(skillDir, "SKILL.md")

      // Check if already exists
      try {
        await fs.access(skillMdPath)
        throw new Error(`Skill "${safeName}" already exists`)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
          throw err
        }
      }

      // Create directory and write SKILL.md
      await fs.mkdir(skillDir, { recursive: true })

      const fileContent = generateSkillMd({
        name: safeName,
        description: input.description,
        content: input.content,
      })

      await fs.writeFile(skillMdPath, fileContent, "utf-8")

      return {
        name: safeName,
        path: skillMdPath,
        source: input.source,
      }
    }),

  /**
   * Update a skill's SKILL.md content
   */
  update: publicProcedure
    .input(
      z.object({
        path: z.string(),
        name: z.string(),
        description: z.string(),
        content: z.string(),
        cwd: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const absolutePath = input.cwd && !input.path.startsWith("~") && !input.path.startsWith("/")
        ? path.join(input.cwd, input.path)
        : resolveSkillPath(input.path)

      // Verify file exists before writing
      await fs.access(absolutePath)

      const fileContent = generateSkillMd({
        name: input.name,
        description: input.description,
        content: input.content,
      })

      await fs.writeFile(absolutePath, fileContent, "utf-8")

      return { success: true }
    }),

  /**
   * Get skill icon as data URL
   */
  getIcon: publicProcedure
    .input(
      z.object({
        skillName: z.string(),
        iconType: z.enum(["small", "large"]),
        cwd: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      // Find the skill to get its icon path
      const userSkillsDir = path.join(os.homedir(), ".claude", "skills")
      const builtinSkillsDir = getBuiltinSkillsPath()

      const allSkillDirs: { dir: string; source: "user" | "builtin" | "project" }[] = [
        { dir: userSkillsDir, source: "user" },
        { dir: builtinSkillsDir, source: "builtin" },
      ]

      if (input.cwd) {
        allSkillDirs.unshift({ dir: path.join(input.cwd, ".claude", "skills"), source: "project" })
      }

      for (const { dir, source } of allSkillDirs) {
        // For builtin skills, strip the "builtin-" prefix
        const dirName = source === "builtin" && input.skillName.startsWith("builtin-")
          ? input.skillName.replace("builtin-", "")
          : input.skillName

        const skillDir = path.join(dir, dirName)
        const interfaceConfig = await parseHongYaml(skillDir)

        const iconPath = input.iconType === "small"
          ? interfaceConfig?.icon_small
          : interfaceConfig?.icon_large

        if (!iconPath) continue

        const absoluteIconPath = path.resolve(skillDir, iconPath)

        try {
          await fs.access(absoluteIconPath)
          const ext = path.extname(absoluteIconPath).toLowerCase()
          const content = await fs.readFile(absoluteIconPath)

          // Determine MIME type
          let mimeType: string
          if (ext === ".svg") {
            mimeType = "image/svg+xml"
          } else if (ext === ".png") {
            mimeType = "image/png"
          } else if (ext === ".jpg" || ext === ".jpeg") {
            mimeType = "image/jpeg"
          } else if (ext === ".gif") {
            mimeType = "image/gif"
          } else if (ext === ".webp") {
            mimeType = "image/webp"
          } else {
            mimeType = "application/octet-stream"
          }

          // Return as data URL
          const base64 = content.toString("base64")
          return `data:${mimeType};base64,${base64}`
        } catch {
          continue
        }
      }

      return null
    }),

  /**
   * Get file content from a skill's sub-directory
   */
  getFileContent: publicProcedure
    .input(
      z.object({
        skillName: z.string(),
        filePath: z.string(),  // Relative to skill directory
        cwd: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      // Security: validate filePath doesn't escape skill directory
      if (input.filePath.includes("..") || path.isAbsolute(input.filePath)) {
        throw new Error("Invalid file path")
      }

      // Find the skill directory
      const userSkillsDir = path.join(os.homedir(), ".claude", "skills")
      const builtinSkillsDir = getBuiltinSkillsPath()

      const allSkillDirs: { dir: string; source: "user" | "builtin" | "project" }[] = [
        { dir: userSkillsDir, source: "user" },
        { dir: builtinSkillsDir, source: "builtin" },
      ]

      if (input.cwd) {
        allSkillDirs.unshift({ dir: path.join(input.cwd, ".claude", "skills"), source: "project" })
      }

      for (const { dir, source } of allSkillDirs) {
        // For builtin skills, strip the "builtin-" prefix
        const dirName = source === "builtin" && input.skillName.startsWith("builtin-")
          ? input.skillName.replace("builtin-", "")
          : input.skillName

        const skillDir = path.join(dir, dirName)
        const absoluteFilePath = path.join(skillDir, input.filePath)

        // Verify the resolved path is still within skill directory
        const resolvedPath = path.resolve(absoluteFilePath)
        const resolvedSkillDir = path.resolve(skillDir)
        if (!resolvedPath.startsWith(resolvedSkillDir)) {
          throw new Error("Invalid file path")
        }

        try {
          const stat = await fs.stat(absoluteFilePath)

          // Limit file size to 1MB
          if (stat.size > 1024 * 1024) {
            return { error: "File too large to preview" }
          }

          const ext = path.extname(input.filePath).toLowerCase()
          const fileType = getFileType(input.filePath)

          if (fileType === "image") {
            // Return as data URL for images
            const content = await fs.readFile(absoluteFilePath)
            let mimeType = "application/octet-stream"
            if (ext === ".svg") mimeType = "image/svg+xml"
            else if (ext === ".png") mimeType = "image/png"
            else if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg"
            else if (ext === ".gif") mimeType = "image/gif"
            else if (ext === ".webp") mimeType = "image/webp"

            const base64 = content.toString("base64")
            return {
              type: "image" as const,
              dataUrl: `data:${mimeType};base64,${base64}`,
            }
          } else {
            // Return text content for other files
            const content = await fs.readFile(absoluteFilePath, "utf-8")
            return {
              type: fileType,
              content,
            }
          }
        } catch {
          continue
        }
      }

      return { error: "File not found" }
    }),
})
