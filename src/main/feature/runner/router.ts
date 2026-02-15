import { z } from "zod"
import { router, publicProcedure } from "../../lib/trpc/index"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { existsSync } from "node:fs"

// Import runtime detection module
import {
  detectAllTools,
  detectRuntimes,
  getRuntimeEnvironment,
  type DetectedRuntimes,
  type DetectedTools,
  type RuntimeEnvironment,
} from "./lib"

// Import Windows package manager registry
import {
  getWindowsPackageManagerRegistry,
  resetWindowsPackageManagerRegistry,
  getInstallLogs,
  clearInstallLogs,
  type InstallLog,
} from "./lib/windows-package-managers"

// Import tool definitions to get Windows package IDs
import { TOOL_DEFINITIONS } from "./lib/tool-definitions"

const execAsync = promisify(exec)

/**
 * Get enhanced PATH that includes common macOS tool locations.
 * Electron GUI apps launched from Dock don't inherit shell profile PATH,
 * so /opt/homebrew/bin etc. may be missing.
 */
function getEnhancedEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "darwin") return process.env
  const basePath = process.env.PATH || ""
  const extraPaths = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin"]
  const missing = extraPaths.filter(p => !basePath.split(":").includes(p))
  if (missing.length === 0) return process.env
  return { ...process.env, PATH: `${missing.join(":")}:${basePath}` }
}

// Set of skipped categories (persisted in memory for current session)
const skippedCategories = new Set<string>()

// Cache for runtime detection (persistent — only invalidated by explicit user actions like refreshRuntimes)
let runtimeCache: { data: DetectedRuntimes; timestamp: number } | null = null

// Cache for tool detection (persistent — only invalidated by explicit user actions like refreshTools/install)
let toolsCache: { data: DetectedTools; timestamp: number } | null = null

// ============================================================================
// Router
// ============================================================================

export const runnerRouter = router({
  /**
   * Detect installed runtimes (cached)
   */
  detectRuntimes: publicProcedure.query(async (): Promise<DetectedRuntimes> => {
    if (runtimeCache) {
      return runtimeCache.data
    }

    const data = await detectRuntimes()
    runtimeCache = { data, timestamp: Date.now() }

    return data
  }),

  /**
   * Force refresh runtime detection
   */
  refreshRuntimes: publicProcedure.mutation(async (): Promise<DetectedRuntimes> => {
    // Clear cache
    runtimeCache = null

    const data = await detectRuntimes()
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
    if (toolsCache) {
      return toolsCache.data
    }

    const data = await detectAllTools()
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
    if (!toolsCache) {
      toolsCache = { data: await detectAllTools(), timestamp: Date.now() }
    }

    return getRuntimeEnvironment(toolsCache.data)
  }),

  /**
   * Install a tool using the provided command
   * On Windows, automatically tries both winget and Chocolatey with fallback
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
    .mutation(async ({ input }): Promise<{ success: boolean; error?: string; output?: string; provider?: string }> => {
      try {
        // On Windows, try to use the package manager registry with automatic fallback
        if (process.platform === "win32") {
          // Find the tool definition to get package IDs
          const toolDef = TOOL_DEFINITIONS.find(t => t.name === input.toolName)

          if (toolDef?.windowsPackageIds) {
            const registry = getWindowsPackageManagerRegistry()

            // Try winget first with winget-specific package ID
            const wingetId = toolDef.windowsPackageIds.winget
            if (wingetId) {
              const result = await registry.installToolWithProvider("winget", wingetId, {
                silent: true,
                acceptLicenses: true,
              })

              if (result.success) {
                // Clear cache so next detection will refresh
                toolsCache = null
                resetWindowsPackageManagerRegistry()

                return {
                  success: true,
                  output: result.output,
                  provider: result.provider,
                }
              }

              // Propagate permission errors immediately
              if (result.error === "NO_ADMIN") {
                return { success: false, error: "NO_ADMIN" }
              }
            }

            // If winget failed and we have a choco ID, try Chocolatey with choco-specific package ID
            const chocoId = toolDef.windowsPackageIds.choco
            if (chocoId) {
              const result = await registry.installToolWithProvider("choco", chocoId, {
                silent: true,
                acceptLicenses: true,
              })

              if (result.success) {
                toolsCache = null
                resetWindowsPackageManagerRegistry()

                return {
                  success: true,
                  output: result.output,
                  provider: result.provider,
                }
              }

              // Propagate permission errors
              if (result.error === "NO_ADMIN") {
                return { success: false, error: "NO_ADMIN" }
              }

              // Both failed, return the last error
              return {
                success: false,
                error: "INSTALL_FAILED",
              }
            }
          }
        }

        // Fallback to direct command execution for non-Windows or tools without package IDs
        const { stdout, stderr } = await execAsync(input.command, {
          timeout: 600000,
          shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
          env: getEnhancedEnv(),
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

  /**
   * Get the detected Linux package manager (if on Linux)
   */
  getDetectedPackageManager: publicProcedure.query(async (): Promise<{
    platform: NodeJS.Platform
    packageManager: string | null
    needsInstall: boolean
    installCommand: string | null
  }> => {
    const platform = process.platform

    // Ensure tools are detected first
    if (!toolsCache) {
      toolsCache = { data: await detectAllTools(), timestamp: Date.now() }
    }

    const pmCategory = toolsCache.data.categories.find((c) => c.category === "package_manager")

    return {
      platform,
      packageManager: pmCategory?.installedTool?.name ?? null,
      needsInstall: !pmCategory?.satisfied && platform !== "linux",
      installCommand: pmCategory?.recommendedTool?.installCommand ?? null,
    }
  }),

  /**
   * Install package manager (Homebrew on macOS, Winget/Chocolatey on Windows)
   * Linux package managers are pre-installed, so this only works on macOS/Windows
   * On Windows, automatically tries both winget and Chocolatey
   */
  installPackageManager: publicProcedure.mutation(async (): Promise<{
    success: boolean
    error?: string
    output?: string
    packageManager?: string
  }> => {
    const platform = process.platform

    // Linux doesn't need package manager installation
    if (platform === "linux") {
      return {
        success: false,
        error: "Linux package managers are pre-installed with the system",
      }
    }

    // Windows: Use the package manager registry with UAC elevation support
    if (platform === "win32") {
      const registry = getWindowsPackageManagerRegistry()

      try {
        const result = await registry.ensurePackageManager()

        if (result.success) {
          // Clear cache so next detection will refresh
          toolsCache = null

          return {
            success: true,
            output: `Successfully installed ${result.provider}`,
            packageManager: result.provider,
          }
        }

        // Propagate structured error codes (NO_ADMIN, INSTALL_FAILED, etc.)
        return {
          success: false,
          error: result.error === "NO_ADMIN" ? "NO_ADMIN"
            : result.error === "UAC_CANCELLED" ? "NO_ADMIN"
            : "INSTALL_FAILED",
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        return {
          success: false,
          error: errorMessage.includes("NO_ADMIN") ? "NO_ADMIN" : "INSTALL_FAILED",
        }
      }
    }

    // macOS: Check admin privilege first, then install Homebrew
    if (platform === "darwin") {
      // Ensure tools are detected first
      if (!toolsCache) {
        toolsCache = { data: await detectAllTools(), timestamp: Date.now() }
      }

      const pmCategory = toolsCache.data.categories.find((c) => c.category === "package_manager")
      const recommendedPM = pmCategory?.recommendedTool

      if (!recommendedPM || !recommendedPM.installCommand) {
        return {
          success: false,
          error: "No package manager installation available for this platform",
        }
      }

      // Check if current user has admin (sudo) access via dseditgroup
      const { execFile } = await import("node:child_process")
      const { promisify: promisifyLocal } = await import("node:util")
      const execFileAsync = promisifyLocal(execFile)
      const username = (await execFileAsync("whoami")).stdout.trim()

      try {
        await execFileAsync("dseditgroup", ["-o", "checkmember", "-m", username, "admin"])
      } catch {
        // dseditgroup exits non-zero when user is NOT an admin
        return {
          success: false,
          error: "NO_ADMIN",
        }
      }

      // User is admin — grant temporary passwordless sudo via osascript,
      // then install Homebrew, and clean up afterwards.
      const { app } = await import("electron")
      const sudoersFile = "/etc/sudoers.d/hong-temp"

      // Step 1: Elevate via system password dialog to write temporary sudoers rule
      try {
        await execFileAsync("osascript", [
          "-e",
          `do shell script "echo '${username} ALL=(ALL) NOPASSWD: ALL' > ${sudoersFile} && chmod 0440 ${sudoersFile}" with administrator privileges`,
        ], { timeout: 60000 }) // 60s for user to enter password
      } catch {
        return { success: false, error: "NO_ADMIN" }
      }

      // Step 2: Install Homebrew
      // Dev mode: open Terminal.app so developer can see real-time output
      // Production: run silently in background
      if (!app.isPackaged) {
        // Dev mode — open Terminal.app with install command + cleanup
        try {
          const fullCmd = `${recommendedPM.installCommand} ; sudo rm -f ${sudoersFile}`
          const escapedCmd = fullCmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
          await execFileAsync("osascript", [
            "-e",
            `tell application "Terminal"\nactivate\ndo script "${escapedCmd}"\nend tell`,
          ], { timeout: 10000 })
          toolsCache = null
          // Return special flag so frontend can poll for completion
          return { success: false, error: "INSTALLING_IN_TERMINAL" }
        } catch {
          // Cleanup sudoers on failure
          try { await execAsync(`sudo rm -f ${sudoersFile}`) } catch { /* best effort */ }
          return { success: false, error: "INSTALL_FAILED" }
        }
      }

      // Production mode — install silently
      try {
        const output = await execAsync(recommendedPM.installCommand, {
          timeout: 600000, // 10 minutes for Homebrew installation
          env: { ...getEnhancedEnv(), NONINTERACTIVE: "1" },
        })
        toolsCache = null
        return {
          success: true,
          output: output.stdout,
          packageManager: recommendedPM.name,
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        if (errorMessage.includes("Need sudo access") || errorMessage.includes("not an Administrator")) {
          return { success: false, error: "NO_ADMIN" }
        }
        return { success: false, error: "INSTALL_FAILED" }
      } finally {
        // Step 3: Always clean up temporary sudoers rule
        try {
          await execAsync(`sudo rm -f ${sudoersFile}`)
        } catch {
          // Best effort cleanup
        }
      }
    }

    return {
      success: false,
      error: "Unsupported platform",
    }
  }),

  /**
   * Get Windows package manager installation logs (for debugging)
   */
  getInstallLogs: publicProcedure.query((): InstallLog[] => {
    return getInstallLogs()
  }),

  /**
   * Clear Windows package manager installation logs
   */
  clearInstallLogs: publicProcedure.mutation((): void => {
    clearInstallLogs()
  }),
})

/**
 * Get runtime environment info (cached) - for direct import in other modules
 */
export async function getCachedRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  if (!toolsCache) {
    toolsCache = { data: await detectAllTools(), timestamp: Date.now() }
  }
  return getRuntimeEnvironment(toolsCache.data)
}
