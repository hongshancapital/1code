/**
 * Windows Runtime Provider
 *
 * Handles runtime detection on Windows platform
 */

import { spawn } from "node:child_process"
import { BaseRuntimeProvider } from "./base-provider"
import { CATEGORY_INFO } from "./constants"
import type { ExecResult, ToolDefinition, ToolInfo } from "./types"

/**
 * Windows-specific command aliases
 * Maps Unix-style commands to Windows equivalents
 */
const WINDOWS_COMMAND_ALIASES: Record<string, string> = {
  python3: "python",
  pip3: "pip",
}

export class WindowsRuntimeProvider extends BaseRuntimeProvider {
  constructor() {
    super("win32")
  }

  getWhichCommand(): string {
    // Use where.exe (not PowerShell alias) for reliable command detection
    return "C:\\Windows\\System32\\where.exe"
  }

  resolveCommandAlias(command: string): string {
    return WINDOWS_COMMAND_ALIASES[command] || command
  }

  /**
   * Execute command using cmd.exe for better compatibility with native tools
   *
   * Note: We use cmd.exe instead of PowerShell because:
   * - Faster startup time
   * - Better compatibility with native Windows commands like where.exe
   * - More predictable behavior with PATH resolution
   */
  async execCommand(command: string, timeoutMs = 10000): Promise<ExecResult> {
    return new Promise((resolve) => {
      // Apply command aliases
      let finalCommand = command
      const cmdParts = command.split(" ")
      const cmdName = cmdParts[0]

      // Check if this is a where.exe command - preserve it
      if (!command.startsWith("C:\\Windows\\System32\\where.exe")) {
        if (WINDOWS_COMMAND_ALIASES[cmdName]) {
          cmdParts[0] = WINDOWS_COMMAND_ALIASES[cmdName]
          finalCommand = cmdParts.join(" ")
        }
      }

      const child = spawn("cmd.exe", ["/c", finalCommand], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        env: {
          ...process.env,
          PATH: process.env.PATH || "",
        },
        shell: false,
      })

      let stdout = ""
      let stderr = ""
      let resolved = false

      const cleanup = () => {
        if (!resolved) {
          resolved = true
          try {
            spawn("taskkill", ["/pid", String(child.pid), "/f", "/t"], { stdio: "ignore" })
          } catch {
            // Ignore kill errors
          }
        }
      }

      const timer = setTimeout(() => {
        cleanup()
        resolve({
          stdout: "",
          stderr: "",
          success: false,
          error: "timeout",
        })
      }, timeoutMs)

      child.stdout?.on("data", (data) => {
        stdout += data.toString()
      })

      child.stderr?.on("data", (data) => {
        stderr += data.toString()
      })

      child.on("close", (code) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)

          const combinedOutput = stdout + stderr

          // Check for "not found" errors
          if (this.isNotFoundError(combinedOutput) || code === 1 && !stdout.trim()) {
            resolve({
              stdout: "",
              stderr: "",
              success: false,
              error: "not_found",
            })
          } else if (code === 0 || stdout.trim() || stderr.trim()) {
            // Success if we got output or exit code 0
            resolve({
              stdout: stdout.trim(),
              stderr: stderr.trim(),
              success: true,
            })
          } else {
            resolve({
              stdout: "",
              stderr: "",
              success: false,
              error: "execution_failed",
            })
          }
        }
      })

      child.on("error", (err) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timer)
          resolve({
            stdout: "",
            stderr: err.message,
            success: false,
            error: "not_found",
          })
        }
      })
    })
  }

  /**
   * Override detectTool to handle Windows-specific quirks
   */
  override async detectTool(def: ToolDefinition): Promise<ToolInfo> {
    const categoryInfo = CATEGORY_INFO[def.category]
    const finalName = this.resolveCommandAlias(def.name)

    // Use where.exe to find the executable
    const whichCmd = this.getWhichCommand()
    const pathResult = await this.execCommand(`${whichCmd} ${finalName}`)

    if (!pathResult.success || !pathResult.stdout) {
      return {
        name: def.name,
        displayName: def.displayName,
        category: def.category,
        installed: false,
        version: null,
        path: null,
        installCommand: this.getInstallCommand(def),
        description: def.description,
        required: categoryInfo.required,
        minVersion: def.minVersion,
        priority: def.priority,
      }
    }

    // Get version - use the resolved alias name
    const versionFlag = def.versionFlag || "--version"
    const versionResult = await this.execCommand(`${finalName} ${versionFlag}`)

    let version: string | null = null
    if (versionResult.success) {
      const versionOutput = versionResult.stdout || versionResult.stderr

      if (versionOutput && !this.isErrorOutput(versionOutput)) {
        if (def.versionParser) {
          try {
            version = def.versionParser(versionOutput)
          } catch {
            version = versionOutput.split("\n")[0].trim()
          }
        } else {
          version = versionOutput.split("\n")[0].trim().replace(/^v/, "")
        }
      }
    }

    return {
      name: def.name,
      displayName: def.displayName,
      category: def.category,
      installed: true,
      version,
      path: pathResult.stdout.split("\n")[0].trim(),
      installCommand: this.getInstallCommand(def),
      description: def.description,
      required: categoryInfo.required,
      minVersion: def.minVersion,
      priority: def.priority,
    }
  }
}
