import { z } from "zod"
import { router, publicProcedure } from "../index"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { existsSync } from "node:fs"

const execAsync = promisify(exec)

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

// Tool detection types
export type ToolCategory = "common" | "nodejs" | "python" | "go"

export interface ToolInfo {
  name: string
  displayName: string
  category: ToolCategory
  installed: boolean
  version: string | null
  path: string | null
  installCommand: string | null
  description: string
  required: boolean // If true, show warning when not installed
}

export interface DetectedTools {
  platform: NodeJS.Platform
  tools: ToolInfo[]
}

// Cache for runtime detection
let runtimeCache: { data: DetectedRuntimes; timestamp: number } | null = null
const RUNTIME_CACHE_TTL = 60000 // 1 minute

// Cache for tool detection
let toolsCache: { data: DetectedTools; timestamp: number } | null = null
const TOOLS_CACHE_TTL = 60000 // 1 minute

// ============================================================================
// Tool Definitions
// ============================================================================

interface ToolDefinition {
  name: string
  displayName: string
  category: ToolCategory
  description: string
  required: boolean
  versionFlag?: string // Default: --version
  versionParser?: (output: string) => string // Extract version from output
  installCommands: {
    darwin?: string
    win32?: string
    linux?: string
  }
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  // Common Tools
  {
    name: "git",
    displayName: "Git",
    category: "common",
    description: "Version control system",
    required: true,
    versionParser: (output) => output.replace(/^git version\s*/, "").split(" ")[0],
    installCommands: {
      darwin: "brew install git",
      win32: "winget install Git.Git",
      linux: "sudo apt install git",
    },
  },
  {
    name: "rg",
    displayName: "ripgrep",
    category: "common",
    description: "Fast search tool for file contents",
    required: false,
    versionParser: (output) => output.replace(/^ripgrep\s*/, "").split(" ")[0],
    installCommands: {
      darwin: "brew install ripgrep",
      win32: "winget install BurntSushi.ripgrep.MSVC",
      linux: "sudo apt install ripgrep",
    },
  },
  {
    name: "fd",
    displayName: "fd",
    category: "common",
    description: "Fast alternative to find command",
    required: false,
    installCommands: {
      darwin: "brew install fd",
      win32: "winget install sharkdp.fd",
      linux: "sudo apt install fd-find",
    },
  },
  {
    name: "jq",
    displayName: "jq",
    category: "common",
    description: "JSON processor for command line",
    required: false,
    versionParser: (output) => output.replace(/^jq-/, ""),
    installCommands: {
      darwin: "brew install jq",
      win32: "winget install jqlang.jq",
      linux: "sudo apt install jq",
    },
  },
  {
    name: "curl",
    displayName: "curl",
    category: "common",
    description: "Command line tool for transferring data",
    required: false,
    versionParser: (output) => output.split(" ")[1],
    installCommands: {
      darwin: "brew install curl",
      win32: "winget install cURL.cURL",
      linux: "sudo apt install curl",
    },
  },
  // macOS specific
  {
    name: "brew",
    displayName: "Homebrew",
    category: "common",
    description: "Package manager for macOS",
    required: false,
    versionParser: (output) => output.replace(/^Homebrew\s*/, "").split("\n")[0],
    installCommands: {
      darwin: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    },
  },
  // Node.js Tools
  {
    name: "node",
    displayName: "Node.js",
    category: "nodejs",
    description: "JavaScript runtime",
    required: false,
    installCommands: {
      darwin: "brew install node",
      win32: "winget install OpenJS.NodeJS.LTS",
      linux: "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install nodejs",
    },
  },
  {
    name: "bun",
    displayName: "Bun",
    category: "nodejs",
    description: "Fast JavaScript runtime",
    required: false,
    installCommands: {
      darwin: "brew install oven-sh/bun/bun",
      win32: "powershell -c \"irm bun.sh/install.ps1|iex\"",
      linux: "curl -fsSL https://bun.sh/install | bash",
    },
  },
  // Python Tools
  {
    name: "python3",
    displayName: "Python",
    category: "python",
    description: "Python interpreter",
    required: false,
    versionParser: (output) => output.replace(/^Python\s*/, ""),
    installCommands: {
      darwin: "brew install python",
      win32: "winget install Python.Python.3.12",
      linux: "sudo apt install python3",
    },
  },
  {
    name: "pip3",
    displayName: "pip",
    category: "python",
    description: "Python package installer",
    required: false,
    versionParser: (output) => output.split(" ")[1],
    installCommands: {
      darwin: "python3 -m ensurepip --upgrade",
      win32: "python -m ensurepip --upgrade",
      linux: "sudo apt install python3-pip",
    },
  },
  {
    name: "uv",
    displayName: "uv",
    category: "python",
    description: "Fast Python package installer",
    required: false,
    installCommands: {
      darwin: "brew install uv",
      win32: "powershell -c \"irm https://astral.sh/uv/install.ps1 | iex\"",
      linux: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    },
  },
  // Go Tools - commented out until Go runtime support is implemented
  // {
  //   name: "go",
  //   displayName: "Go",
  //   category: "go",
  //   description: "Go programming language",
  //   required: false,
  //   versionParser: (output) => output.replace(/^go version go/, "").split(" ")[0],
  //   installCommands: {
  //     darwin: "brew install go",
  //     win32: "winget install GoLang.Go",
  //     linux: "sudo apt install golang-go",
  //   },
  // },
]

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute command with timeout and return stdout
 */
async function execWithTimeout(
  command: string,
  timeoutMs = 5000
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(command, { timeout: timeoutMs })
    return stdout.trim()
  } catch {
    return null
  }
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
  const platform = process.platform as NodeJS.Platform
  const whichCmd = platform === "win32" ? "where" : "which"

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
      installCommand: def.installCommands[platform] || null,
      description: def.description,
      required: def.required,
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
    path: toolPath.split("\n")[0], // Take first result on Windows
    installCommand: def.installCommands[platform] || null,
    description: def.description,
    required: def.required,
  }
}

/**
 * Detect all tools (with platform filtering)
 */
async function detectAllTools(): Promise<DetectedTools> {
  const platform = process.platform as NodeJS.Platform

  // Filter tools by platform (only include tools that have install command for this platform OR are universal)
  const platformTools = TOOL_DEFINITIONS.filter((def) => {
    // Homebrew is macOS only
    if (def.name === "brew" && platform !== "darwin") return false
    return true
  })

  // Detect all tools in parallel
  const tools = await Promise.all(platformTools.map(detectTool))

  return {
    platform,
    tools,
  }
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
})
