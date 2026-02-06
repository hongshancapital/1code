import { z } from "zod"
import { router, publicProcedure } from "../index"
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
} from "../../runtime"

const execAsync = promisify(exec)

// Set of skipped categories (persisted in memory for current session)
const skippedCategories = new Set<string>()

// Cache for runtime detection
let runtimeCache: { data: DetectedRuntimes; timestamp: number } | null = null
const RUNTIME_CACHE_TTL = 60000 // 1 minute

// Cache for tool detection
let toolsCache: { data: DetectedTools; timestamp: number } | null = null
const TOOLS_CACHE_TTL = 60000 // 1 minute

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

    const data = await detectRuntimes()

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
        // Use a longer timeout for installation (10 minutes)
        const { stdout, stderr } = await execAsync(input.command, {
          timeout: 600000,
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
    if (!toolsCache || Date.now() - toolsCache.timestamp >= TOOLS_CACHE_TTL) {
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
   * Install package manager (Homebrew on macOS, Winget on Windows)
   * Linux package managers are pre-installed, so this only works on macOS/Windows
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

    // Ensure tools are detected first
    if (!toolsCache || Date.now() - toolsCache.timestamp >= TOOLS_CACHE_TTL) {
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

    try {
      let output: string

      // macOS: Use osascript to elevate privileges (prompts for admin password)
      if (platform === "darwin") {
        // Escape the command for AppleScript
        const escapedCommand = recommendedPM.installCommand.replace(/"/g, '\\"')
        const osascriptCommand = `osascript -e 'do shell script "${escapedCommand}" with administrator privileges'`

        const { stdout, stderr } = await execAsync(osascriptCommand, {
          timeout: 600000,
          shell: "/bin/bash",
          env: {
            ...process.env,
            NONINTERACTIVE: "1",
          },
        })
        output = stdout || stderr
      }
      // Windows: Open Microsoft Store for winget installation
      else if (platform === "win32" && recommendedPM.name === "winget") {
        // For winget, just open the Microsoft Store
        // The command is already 'start ms-windows-store://...'
        await execAsync(recommendedPM.installCommand, {
          timeout: 10000,
          shell: "cmd.exe",
        })

        // Return a message guiding the user
        return {
          success: false, // Not actually installed yet, user needs to complete in Store
          error: "已打开 Microsoft Store 的 App Installer 页面。请在 Store 中点击「获取」或「安装」按钮完成安装。安装完成后，请点击「刷新」按钮重新检测。",
        }
      }
      // Windows: Other tools
      else {
        const { stdout, stderr } = await execAsync(recommendedPM.installCommand, {
          timeout: 600000,
          shell: "powershell.exe",
        })
        output = stdout || stderr
      }

      // Clear cache so next detection will refresh
      toolsCache = null

      return {
        success: true,
        output,
        packageManager: recommendedPM.name,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error"

      // Check if user cancelled the authentication prompt
      if (errorMessage.includes("User canceled") || errorMessage.includes("(-128)")) {
        return {
          success: false,
          error: "用户取消了管理员权限授权。要安装 Homebrew，需要管理员权限。您可以选择跳过或稍后手动安装。",
        }
      }

      // Check if user lacks admin privileges
      if (errorMessage.includes("administrator privileges") || errorMessage.includes("Need sudo")) {
        return {
          success: false,
          error: "当前用户不是管理员，无法安装 Homebrew。请联系系统管理员将您的账户设为管理员，或选择跳过自动安装。",
        }
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }),
})

/**
 * Get runtime environment info (cached) - for direct import in other modules
 */
export async function getCachedRuntimeEnvironment(): Promise<RuntimeEnvironment> {
  if (!toolsCache || Date.now() - toolsCache.timestamp >= TOOLS_CACHE_TTL) {
    toolsCache = { data: await detectAllTools(), timestamp: Date.now() }
  }
  return getRuntimeEnvironment(toolsCache.data)
}
