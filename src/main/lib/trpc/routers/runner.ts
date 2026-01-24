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

interface DetectedRuntimes {
  node: RuntimeInfo | null
  bun: RuntimeInfo | null
  npm: RuntimeInfo | null
  yarn: RuntimeInfo | null
  pnpm: RuntimeInfo | null
}

// Cache for runtime detection
let runtimeCache: { data: DetectedRuntimes; timestamp: number } | null = null
const RUNTIME_CACHE_TTL = 60000 // 1 minute

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
})
