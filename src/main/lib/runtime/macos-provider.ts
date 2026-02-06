/**
 * macOS Runtime Provider
 *
 * Handles runtime detection on macOS platform
 */

import { spawn } from "node:child_process"
import { BaseRuntimeProvider } from "./base-provider"
import type { ExecResult } from "./types"

export class MacOSRuntimeProvider extends BaseRuntimeProvider {
  constructor() {
    super("darwin")
  }

  getWhichCommand(): string {
    return "which"
  }

  resolveCommandAlias(command: string): string {
    // macOS doesn't need command aliases
    return command
  }

  /**
   * Execute command using bash
   */
  async execCommand(command: string, timeoutMs = 10000): Promise<ExecResult> {
    return new Promise((resolve) => {
      const child = spawn("/bin/bash", ["-c", command], {
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
            child.kill("SIGKILL")
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
