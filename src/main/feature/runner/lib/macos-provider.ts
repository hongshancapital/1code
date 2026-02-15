/**
 * macOS Runtime Provider
 *
 * Handles runtime detection on macOS platform
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { BaseRuntimeProvider } from "./base-provider"
import type { ExecResult, ToolDefinition, ToolInfo } from "./types"

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

  /** Well-known paths for tools that may not be in Electron's PATH */
  private static readonly KNOWN_PATHS: Record<string, string[]> = {
    brew: ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"],
  }

  /**
   * Override detectTool: if `which` fails, try well-known absolute paths.
   * Electron GUI apps may have a minimal PATH that misses Homebrew etc.
   */
  override async detectTool(def: ToolDefinition): Promise<ToolInfo> {
    const result = await super.detectTool(def)
    if (result.installed) return result

    // Fallback: check known absolute paths
    const knownPaths = MacOSRuntimeProvider.KNOWN_PATHS[def.name]
    if (!knownPaths) return result

    for (const absPath of knownPaths) {
      if (!existsSync(absPath)) continue

      // Found it — get version
      const versionFlag = def.versionFlag || "--version"
      const versionResult = await this.execCommand(`${absPath} ${versionFlag}`)
      let version: string | null = null
      if (versionResult.success) {
        const output = versionResult.stdout || versionResult.stderr
        if (output && def.versionParser) {
          try { version = def.versionParser(output) } catch { version = output.split("\n")[0].trim() }
        } else if (output) {
          version = output.split("\n")[0].trim().replace(/^v/, "")
        }
      }

      return { ...result, installed: true, version, path: absPath }
    }

    return result
  }

  /**
   * Build PATH with common macOS tool locations that may not be in Electron's PATH
   */
  private getEnhancedPath(): string {
    const basePath = process.env.PATH || ""
    const extraPaths = [
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
    ]
    // Prepend extra paths that aren't already present
    const missing = extraPaths.filter(p => !basePath.split(":").includes(p))
    return missing.length > 0 ? `${missing.join(":")}:${basePath}` : basePath
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
          PATH: this.getEnhancedPath(),
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
