import { z } from "zod"
import { router, publicProcedure } from "../index"
import { exec, spawn } from "node:child_process"
import { promisify } from "node:util"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { existsSync } from "node:fs"

const execAsync = promisify(exec)

// Set of skipped categories (persisted in memory for current session)
const skippedCategories = new Set<string>()

// ============================================================================
// Types
// ============================================================================

interface RuntimeInfo {
  name: string
  version: string
  path: string
}

export interface DetectedRuntimes {
  node: RuntimeInfo | null
  bun: RuntimeInfo | null
  npm: RuntimeInfo | null
  yarn: RuntimeInfo | null
  pnpm: RuntimeInfo | null
}

// Tool detection types - new category system
export type ToolCategory =
  | "vcs" // Version Control (git)
  | "search" // Search tools (ripgrep)
  | "json" // JSON processor (jq)
  | "network" // Network tools (curl)
  | "js_runtime" // JavaScript runtime (bun, node)
  | "python_runtime" // Python runtime (python3)
  | "python_pkg" // Python package manager (uv, pip)

export interface ToolInfo {
  name: string
  displayName: string
  category: ToolCategory
  installed: boolean
  version: string | null
  path: string | null
  installCommand: string | null
  description: string
  required: boolean
  minVersion?: string // Minimum required version
  priority: number // Higher priority = preferred in category (only one needed per category)
}

export interface CategoryStatus {
  category: ToolCategory
  displayName: string
  satisfied: boolean // At least one tool installed
  installedTool: ToolInfo | null // The installed tool (highest priority)
  recommendedTool: ToolInfo | null // Tool to install if none installed
  required: boolean // If this category is required for the app to work
}

export interface DetectedTools {
  platform: NodeJS.Platform
  tools: ToolInfo[]
  categories: CategoryStatus[]
}

// Runtime environment info for system prompt injection
export interface RuntimeEnvironment {
  platform: string
  tools: {
    category: string
    name: string
    version: string | null
    path: string | null
  }[]
}

// Cache for runtime detection
let runtimeCache: { data: DetectedRuntimes; timestamp: number } | null = null
const RUNTIME_CACHE_TTL = 60000 // 1 minute

// Cache for tool detection
let toolsCache: { data: DetectedTools; timestamp: number } | null = null
const TOOLS_CACHE_TTL = 60000 // 1 minute

// ============================================================================
// Tool Definitions - Category-based system
// ============================================================================

// Category metadata
const CATEGORY_INFO: Record<
  ToolCategory,
  { displayName: string; required: boolean; description: string }
> = {
  vcs: { displayName: "Version Control", required: true, description: "Git for code versioning" },
  search: { displayName: "Search", required: true, description: "Fast file search" },
  json: { displayName: "JSON", required: false, description: "JSON processing" },
  network: { displayName: "Network", required: false, description: "HTTP requests" },
  js_runtime: { displayName: "JavaScript", required: true, description: "JavaScript/TypeScript runtime" },
  python_runtime: { displayName: "Python", required: false, description: "Python interpreter" },
  python_pkg: { displayName: "Python Packages", required: false, description: "Python package manager" },
}

type SupportedPlatform = "darwin" | "win32" | "linux"

interface ToolDefinition {
  name: string
  displayName: string
  category: ToolCategory
  description: string
  priority: number // Higher = preferred (first choice in category)
  minVersion?: string // Minimum required version (semver)
  versionFlag?: string // Default: --version
  versionParser?: (output: string) => string
  installCommands: Partial<Record<SupportedPlatform, string>>
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  // Version Control (required: true)
  {
    name: "git",
    displayName: "Git",
    category: "vcs",
    description: "Version control system",
    priority: 100,
    minVersion: "2.0.0",
    versionParser: (output) => output.replace(/^git version\s*/, "").split(" ")[0],
    installCommands: {
      darwin: "brew install git",
      win32: "winget install Git.Git",
      linux: "sudo apt install git",
    },
  },

  // Search tools (required: true, one is enough)
  {
    name: "rg",
    displayName: "ripgrep",
    category: "search",
    description: "Fast file content search",
    priority: 100, // Preferred
    minVersion: "13.0.0",
    versionParser: (output) => output.replace(/^ripgrep\s*/, "").split(" ")[0],
    installCommands: {
      darwin: "brew install ripgrep",
      win32: "winget install BurntSushi.ripgrep.MSVC",
      linux: "sudo apt install ripgrep",
    },
  },

  // JSON processor (optional)
  {
    name: "jq",
    displayName: "jq",
    category: "json",
    description: "JSON processor",
    priority: 100,
    minVersion: "1.6",
    versionParser: (output) => output.replace(/^jq-/, ""),
    installCommands: {
      darwin: "brew install jq",
      win32: "winget install jqlang.jq",
      linux: "sudo apt install jq",
    },
  },

  // Network tools (optional)
  {
    name: "curl",
    displayName: "curl",
    category: "network",
    description: "HTTP client",
    priority: 100,
    minVersion: "7.0.0",
    versionParser: (output) => output.split(" ")[1],
    installCommands: {
      darwin: "brew install curl",
      win32: "winget install cURL.cURL",
      linux: "sudo apt install curl",
    },
  },

  // JavaScript runtime (required: true, bun preferred)
  {
    name: "bun",
    displayName: "Bun",
    category: "js_runtime",
    description: "Fast JavaScript runtime",
    priority: 100, // Preferred
    minVersion: "1.0.0",
    installCommands: {
      darwin: "brew install oven-sh/bun/bun",
      win32: "powershell -c \"irm bun.sh/install.ps1|iex\"",
      linux: "curl -fsSL https://bun.sh/install | bash",
    },
  },
  {
    name: "node",
    displayName: "Node.js",
    category: "js_runtime",
    description: "JavaScript runtime",
    priority: 50, // Fallback
    minVersion: "18.0.0",
    installCommands: {
      darwin: "brew install node",
      win32: "winget install OpenJS.NodeJS.LTS",
      linux: "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install nodejs",
    },
  },

  // Python runtime (optional)
  {
    name: "python3",
    displayName: "Python",
    category: "python_runtime",
    description: "Python interpreter",
    priority: 100,
    minVersion: "3.10.0",
    versionParser: (output) => output.replace(/^Python\s*/, ""),
    installCommands: {
      darwin: "brew install python",
      win32: "winget install Python.Python.3.12",
      linux: "sudo apt install python3",
    },
  },

  // Python package manager (optional, uv preferred)
  {
    name: "uv",
    displayName: "uv",
    category: "python_pkg",
    description: "Fast Python package manager",
    priority: 100, // Preferred
    minVersion: "0.1.0",
    installCommands: {
      darwin: "brew install uv",
      win32: "powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"",
      linux: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    },
  },
  {
    name: "pip3",
    displayName: "pip",
    category: "python_pkg",
    description: "Python package installer",
    priority: 50, // Fallback
    versionParser: (output) => output.split(" ")[1],
    installCommands: {
      darwin: "python3 -m ensurepip --upgrade",
      win32: "python -m ensurepip --upgrade",
      linux: "sudo apt install python3-pip",
    },
  },
]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute command with timeout and return stdout
 * Uses spawn to ensure proper process cleanup on timeout
 */
async function execWithTimeout(
  command: string,
  timeoutMs = 5000
): Promise<string | null> {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32"
    const shell = isWindows ? "cmd.exe" : "/bin/bash"
    const shellArgs = isWindows ? ["/c", command] : ["-c", command]

    const child = spawn(shell, shellArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    })

    let output = ""
    let resolved = false

    const cleanup = () => {
      if (!resolved) {
        resolved = true
        try {
          // Kill the process and all children
          if (isWindows) {
            spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" })
          } else {
            child.kill("SIGKILL")
          }
        } catch {
          // Ignore kill errors
        }
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve(null)
    }, timeoutMs)

    child.stdout?.on("data", (data) => {
      output += data.toString()
    })

    child.stderr?.on("data", (data) => {
      output += data.toString()
    })

    child.on("close", () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(output.trim() || null)
      }
    })

    child.on("error", () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)
        resolve(null)
      }
    })
  })
}

/**
 * Detect a single runtime
 */
async function detectRuntime(
  name: string,
  displayName: string
): Promise<RuntimeInfo | null> {
  const whichCmd = process.platform === "win32" ? "where" : "which"

  const path = await execWithTimeout(`${whichCmd} ${name}`)
  if (!path) return null

  const version = await execWithTimeout(`${name} --version`)
  if (!version) return null

  return {
    name: displayName,
    version: version.replace(/^v/, ""),
    path: path.split("\n")[0], // Take first result on Windows
  }
}

/**
 * Detect a single tool from definition
 */
async function detectTool(def: ToolDefinition): Promise<ToolInfo> {
  const platform = process.platform as SupportedPlatform
  const whichCmd = platform === "win32" ? "where" : "which"
  const categoryInfo = CATEGORY_INFO[def.category]

  // Check if tool exists
  const toolPath = await execWithTimeout(`${whichCmd} ${def.name}`)

  if (!toolPath) {
    return {
      name: def.name,
      displayName: def.displayName,
      category: def.category,
      installed: false,
      version: null,
      path: null,
      installCommand: def.installCommands[platform] ?? null,
      description: def.description,
      required: categoryInfo.required,
      minVersion: def.minVersion,
      priority: def.priority,
    }
  }

  // Get version
  const versionFlag = def.versionFlag || "--version"
  const versionOutput = await execWithTimeout(`${def.name} ${versionFlag}`)

  let version: string | null = null
  if (versionOutput) {
    if (def.versionParser) {
      try {
        version = def.versionParser(versionOutput)
      } catch {
        version = versionOutput.split("\n")[0].trim()
      }
    } else {
      // Default: remove leading 'v' and take first line
      version = versionOutput.split("\n")[0].trim().replace(/^v/, "")
    }
  }

  return {
    name: def.name,
    displayName: def.displayName,
    category: def.category,
    installed: true,
    version,
    path: toolPath.split("\n")[0],
    installCommand: def.installCommands[platform] ?? null,
    description: def.description,
    required: categoryInfo.required,
    minVersion: def.minVersion,
    priority: def.priority,
  }
}

/**
 * Build category status from detected tools
 * Considers skipped categories as satisfied
 */
function buildCategoryStatus(tools: ToolInfo[]): CategoryStatus[] {
  const categories = Object.keys(CATEGORY_INFO) as ToolCategory[]

  return categories.map((category) => {
    const categoryInfo = CATEGORY_INFO[category]
    const categoryTools = tools
      .filter((t) => t.category === category)
      .sort((a, b) => b.priority - a.priority) // Sort by priority descending

    const installedTools = categoryTools.filter((t) => t.installed)
    const installedTool = installedTools[0] || null // Highest priority installed tool
    const recommendedTool = categoryTools[0] || null // Highest priority tool to recommend

    // Consider skipped categories as satisfied
    const isSkipped = skippedCategories.has(category)
    const isSatisfied = installedTools.length > 0 || isSkipped

    return {
      category,
      displayName: categoryInfo.displayName,
      satisfied: isSatisfied,
      installedTool,
      recommendedTool: isSatisfied ? null : recommendedTool,
      required: categoryInfo.required,
    }
  })
}

/**
 * Detect all tools and build category status
 */
async function detectAllTools(): Promise<DetectedTools> {
  const platform = process.platform as SupportedPlatform

  // Filter tools by platform
  const platformTools = TOOL_DEFINITIONS.filter((def) => {
    // Only include tools that have install command for this platform
    return def.installCommands[platform] !== undefined
  })

  // Detect all tools in parallel
  const tools = await Promise.all(platformTools.map(detectTool))

  // Build category status
  const categories = buildCategoryStatus(tools)

  return {
    platform,
    tools,
    categories,
  }
}

/**
 * Get runtime environment info for system prompt injection
 */
export function getRuntimeEnvironment(tools: DetectedTools): RuntimeEnvironment {
  const installedByCategory = new Map<ToolCategory, ToolInfo>()

  // Get highest priority installed tool for each category
  for (const tool of tools.tools) {
    if (!tool.installed) continue
    const existing = installedByCategory.get(tool.category)
    if (!existing || tool.priority > existing.priority) {
      installedByCategory.set(tool.category, tool)
    }
  }

  return {
    platform: tools.platform,
    tools: Array.from(installedByCategory.values()).map((tool) => ({
      category: CATEGORY_INFO[tool.category].displayName,
      name: tool.name,
      version: tool.version,
      path: tool.path,
    })),
  }
}

/**
 * Get runtime environment info (cached) - for direct import in other modules
 */
export async function getCachedRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  if (!toolsCache || Date.now() - toolsCache.timestamp >= TOOLS_CACHE_TTL) {
    toolsCache = { data: await detectAllTools(), timestamp: Date.now() }
  }
  return getRuntimeEnvironment(toolsCache.data)
}

// ============================================================================
// Router
// ============================================================================

export const runnerRouter = router({
  /**
   * Detect installed runtimes (cached)
   */
  detectRuntimes: publicProcedure.query(async (): Promise<DetectedRuntimes> => {
    // Return cached data if still valid
    if (runtimeCache && Date.now() - runtimeCache.timestamp < RUNTIME_CACHE_TTL) {
      return runtimeCache.data
    }

    // Detect all runtimes in parallel
    const [node, bun, npm, yarn, pnpm] = await Promise.all([
      detectRuntime("node", "Node.js"),
      detectRuntime("bun", "Bun"),
      detectRuntime("npm", "npm"),
      detectRuntime("yarn", "yarn"),
      detectRuntime("pnpm", "pnpm"),
    ])

    const data: DetectedRuntimes = { node, bun, npm, yarn, pnpm }

    // Cache the result
    runtimeCache = { data, timestamp: Date.now() }

    return data
  }),

  /**
   * Force refresh runtime detection
   */
  refreshRuntimes: publicProcedure.mutation(async (): Promise<DetectedRuntimes> => {
    // Clear cache
    runtimeCache = null

    // Detect all runtimes in parallel
    const [node, bun, npm, yarn, pnpm] = await Promise.all([
      detectRuntime("node", "Node.js"),
      detectRuntime("bun", "Bun"),
      detectRuntime("npm", "npm"),
      detectRuntime("yarn", "yarn"),
      detectRuntime("pnpm", "pnpm"),
    ])

    const data: DetectedRuntimes = { node, bun, npm, yarn, pnpm }
    runtimeCache = { data, timestamp: Date.now() }

    return data
  }),

  /**
   * Read package.json scripts from a project
   */
  getPackageScripts: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ input }) => {
      const packageJsonPath = join(input.projectPath, "package.json")

      if (!existsSync(packageJsonPath)) {
        return {
          scripts: {} as Record<string, string>,
          hasPackageJson: false,
          name: null as string | null,
          version: null as string | null,
        }
      }

      try {
        const content = await readFile(packageJsonPath, "utf-8")
        const packageJson = JSON.parse(content)
        return {
          scripts: (packageJson.scripts || {}) as Record<string, string>,
          hasPackageJson: true,
          name: packageJson.name as string | null,
          version: packageJson.version as string | null,
        }
      } catch (error) {
        console.error("[runner] Failed to parse package.json:", error)
        return {
          scripts: {} as Record<string, string>,
          hasPackageJson: true,
          name: null,
          version: null,
          error: "Failed to parse package.json",
        }
      }
    }),

  /**
   * Detect which package manager a project uses based on lock files
   */
  detectPackageManager: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ input }): Promise<{ detected: string; lockFile: string | null }> => {
      const lockFiles = [
        { file: "bun.lockb", pm: "bun" },
        { file: "pnpm-lock.yaml", pm: "pnpm" },
        { file: "yarn.lock", pm: "yarn" },
        { file: "package-lock.json", pm: "npm" },
      ]

      for (const { file, pm } of lockFiles) {
        if (existsSync(join(input.projectPath, file))) {
          return { detected: pm, lockFile: file }
        }
      }

      // Default to npm if no lock file found
      return { detected: "npm", lockFile: null }
    }),

  /**
   * Build the run command for a script
   */
  buildRunCommand: publicProcedure
    .input(
      z.object({
        projectPath: z.string(),
        scriptName: z.string(),
        packageManager: z.enum(["auto", "bun", "npm", "yarn", "pnpm"]),
        isDebugMode: z.boolean().default(false),
        debugPort: z.number().default(9229),
      })
    )
    .mutation(async ({ input }) => {
      let pm = input.packageManager

      // Auto-detect package manager
      if (pm === "auto") {
        const lockFiles = [
          { file: "bun.lockb", pm: "bun" as const },
          { file: "pnpm-lock.yaml", pm: "pnpm" as const },
          { file: "yarn.lock", pm: "yarn" as const },
          { file: "package-lock.json", pm: "npm" as const },
        ]

        for (const { file, pm: detectedPm } of lockFiles) {
          if (existsSync(join(input.projectPath, file))) {
            pm = detectedPm
            break
          }
        }

        // Default to npm if still auto
        if (pm === "auto") pm = "npm"
      }

      // Build the run command
      let command: string
      const runCmd =
        pm === "npm" ? "npm run" : pm === "yarn" ? "yarn" : `${pm} run`

      if (input.isDebugMode) {
        if (pm === "bun") {
          // Bun has its own debug flag
          command = `bun --inspect=0.0.0.0:${input.debugPort} run ${input.scriptName}`
        } else {
          // Node.js based - use NODE_OPTIONS
          command = `NODE_OPTIONS="--inspect=0.0.0.0:${input.debugPort}" ${runCmd} ${input.scriptName}`
        }
      } else {
        command = `${runCmd} ${input.scriptName}`
      }

      return {
        command,
        packageManager: pm,
        scriptName: input.scriptName,
        isDebugMode: input.isDebugMode,
        debugPort: input.isDebugMode ? input.debugPort : undefined,
      }
    }),

  /**
   * Validate a custom runtime path
   */
  validateRuntimePath: publicProcedure
    .input(
      z.object({
        path: z.string(),
        type: z.enum(["node", "bun", "npm", "yarn", "pnpm"]),
      })
    )
    .mutation(async ({ input }) => {
      if (!existsSync(input.path)) {
        return { valid: false, error: "Path does not exist", version: null }
      }

      try {
        const { stdout } = await execAsync(`"${input.path}" --version`, {
          timeout: 5000,
        })
        return {
          valid: true,
          version: stdout.trim().replace(/^v/, ""),
          error: null,
        }
      } catch {
        return {
          valid: false,
          error: "Failed to execute runtime",
          version: null,
        }
      }
    }),

  /**
   * Detect common CLI tools (cached)
   */
  detectTools: publicProcedure.query(async (): Promise<DetectedTools> => {
    // Return cached data if still valid
    if (toolsCache && Date.now() - toolsCache.timestamp < TOOLS_CACHE_TTL) {
      return toolsCache.data
    }

    const data = await detectAllTools()

    // Cache the result
    toolsCache = { data, timestamp: Date.now() }

    return data
  }),

  /**
   * Force refresh tool detection
   */
  refreshTools: publicProcedure.mutation(async (): Promise<DetectedTools> => {
    // Clear cache
    toolsCache = null

    const data = await detectAllTools()
    toolsCache = { data, timestamp: Date.now() }

    return data
  }),

  /**
   * Get runtime environment info for system prompt injection
   * Returns only the essential info: one tool per category (highest priority installed)
   */
  getRuntimeEnvironment: publicProcedure.query(async (): Promise<RuntimeEnvironment> => {
    // Use cached tools data if available
    if (!toolsCache || Date.now() - toolsCache.timestamp >= TOOLS_CACHE_TTL) {
      toolsCache = { data: await detectAllTools(), timestamp: Date.now() }
    }

    return getRuntimeEnvironment(toolsCache.data)
  }),

  /**
   * Install a tool using the provided command
   * Note: This runs the command in a shell. For commands requiring sudo,
   * the user will be prompted for password in the terminal.
   */
  installTool: publicProcedure
    .input(
      z.object({
        toolName: z.string(),
        command: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean; error?: string; output?: string }> => {
      try {
        // Execute the install command
        // Use a longer timeout for installation (5 minutes)
        const { stdout, stderr } = await execAsync(input.command, {
          timeout: 300000,
          shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
        })

        // Clear cache so next detection will refresh
        toolsCache = null

        return {
          success: true,
          output: stdout || stderr,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        return {
          success: false,
          error: errorMessage,
        }
      }
    }),

  /**
   * Skip a category - mark it as satisfied without installing
   * User can skip required categories if they prefer manual installation
   */
  skipCategory: publicProcedure
    .input(
      z.object({
        category: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      skippedCategories.add(input.category)
      // Clear cache so next detection will reflect the skip
      toolsCache = null
      return { success: true }
    }),

  /**
   * Reset all skipped categories
   */
  resetSkippedCategories: publicProcedure.mutation(async (): Promise<{ success: boolean }> => {
    skippedCategories.clear()
    toolsCache = null
    return { success: true }
  }),
})
