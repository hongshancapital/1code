/**
 * Windows Runtime Provider
 *
 * Handles runtime detection on Windows platform
 */

import { spawn } from "node:child_process"
import { BaseRuntimeProvider } from "./base-provider"
import type { ExecResult } from "./types"

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
    return "where"
  }

  resolveCommandAlias(command: string): string {
    return WINDOWS_COMMAND_ALIASES[command] || command
  }

  /**
   * Execute command using PowerShell for better compatibility
   *
   * PowerShell advantages over cmd.exe:
   * - Better PATH resolution
   * - More consistent output format
   * - Better Unicode support
   * - Can handle complex commands
   */
  async execCommand(command: string, timeoutMs = 10000): Promise<ExecResult> {
    return new Promise((resolve) => {
      // Apply command aliases
      let finalCommand = command
      const cmdParts = command.split(" ")
      const cmdName = cmdParts[0]
      if (WINDOWS_COMMAND_ALIASES[cmdName]) {
        cmdParts[0] = WINDOWS_COMMAND_ALIASES[cmdName]
        finalCommand = cmdParts.join(" ")
      }

      const child = spawn("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        finalCommand,
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        env: {
          ...process.env,
          PATH: process.env.PATH || "",
        },
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
          if (this.isNotFoundError(combinedOutput)) {
            resolve({
              stdout: "",
              stderr: "",
              success: false,
              error: "not_found",
            })
          } else if (code === 0 || stdout.trim() || stderr.trim()) {
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
}
