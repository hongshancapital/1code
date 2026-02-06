/**
 * Linux Runtime Provider
 *
 * Handles runtime detection on Linux platform
 */

import { spawn } from "node:child_process"
import { BaseRuntimeProvider } from "./base-provider"
import type { ExecResult, ToolDefinition } from "./types"

/**
 * Linux package manager install commands mapping
 */
const LINUX_INSTALL_COMMANDS: Record<string, Record<string, string>> = {
  apt: {
    git: "sudo apt install -y git",
    rg: "sudo apt install -y ripgrep",
    jq: "sudo apt install -y jq",
    curl: "sudo apt install -y curl",
    python3: "sudo apt install -y python3",
    pip3: "sudo apt install -y python3-pip",
    go: "sudo apt install -y golang-go",
  },
  dnf: {
    git: "sudo dnf install -y git",
    rg: "sudo dnf install -y ripgrep",
    jq: "sudo dnf install -y jq",
    curl: "sudo dnf install -y curl",
    python3: "sudo dnf install -y python3",
    pip3: "sudo dnf install -y python3-pip",
    go: "sudo dnf install -y golang",
  },
  yum: {
    git: "sudo yum install -y git",
    rg: "sudo yum install -y ripgrep",
    jq: "sudo yum install -y jq",
    curl: "sudo yum install -y curl",
    python3: "sudo yum install -y python3",
    pip3: "sudo yum install -y python3-pip",
    go: "sudo yum install -y golang",
  },
  pacman: {
    git: "sudo pacman -S --noconfirm git",
    rg: "sudo pacman -S --noconfirm ripgrep",
    jq: "sudo pacman -S --noconfirm jq",
    curl: "sudo pacman -S --noconfirm curl",
    python3: "sudo pacman -S --noconfirm python",
    pip3: "sudo pacman -S --noconfirm python-pip",
    go: "sudo pacman -S --noconfirm go",
  },
  zypper: {
    git: "sudo zypper install -y git",
    rg: "sudo zypper install -y ripgrep",
    jq: "sudo zypper install -y jq",
    curl: "sudo zypper install -y curl",
    python3: "sudo zypper install -y python3",
    pip3: "sudo zypper install -y python3-pip",
    go: "sudo zypper install -y go",
  },
}

export class LinuxRuntimeProvider extends BaseRuntimeProvider {
  private detectedPackageManager: string | null = null

  constructor() {
    super("linux")
  }

  getWhichCommand(): string {
    return "which"
  }

  resolveCommandAlias(command: string): string {
    // Linux doesn't need command aliases
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

  /**
   * Set detected package manager (called after PM detection)
   */
  setPackageManager(pm: string): void {
    this.detectedPackageManager = pm
  }

  /**
   * Get install command considering Linux package manager
   */
  override getInstallCommand(def: ToolDefinition): string | null {
    // Use dynamic install command based on detected package manager
    if (this.detectedPackageManager && LINUX_INSTALL_COMMANDS[this.detectedPackageManager]) {
      const linuxCmd = LINUX_INSTALL_COMMANDS[this.detectedPackageManager][def.name]
      if (linuxCmd) return linuxCmd
    }

    // Fallback to definition's install command
    return def.installCommands[this.platform] ?? null
  }
}
