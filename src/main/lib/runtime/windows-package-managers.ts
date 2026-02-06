/**
 * Windows Package Manager Providers
 *
 * Supports multiple package managers on Windows (winget, Chocolatey)
 * with automatic fallback
 */

import { spawn } from "node:child_process"
import type { ExecResult } from "./types"

/**
 * Windows Package Manager Provider Interface
 */
export interface WindowsPackageManager {
  name: string
  displayName: string
  priority: number

  /**
   * Check if this package manager is available
   */
  isAvailable(): Promise<boolean>

  /**
   * Install this package manager itself
   */
  install(): Promise<ExecResult>

  /**
   * Install a tool using this package manager
   */
  installTool(packageId: string, options?: InstallOptions): Promise<ExecResult>

  /**
   * Get the install command for a tool (for UI display)
   */
  getInstallCommand(packageId: string, options?: InstallOptions): string
}

export interface InstallOptions {
  silent?: boolean
  acceptLicenses?: boolean
  version?: string
}

/**
 * Execute PowerShell command
 */
async function execPowerShell(command: string, timeoutMs = 600000): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
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
          // Ignore
        }
      }
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve({
        stdout: "",
        stderr: "Timeout",
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
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: code === 0,
          error: code !== 0 ? "execution_failed" : undefined,
        })
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
 * Winget Package Manager Provider
 */
export class WingetProvider implements WindowsPackageManager {
  name = "winget"
  displayName = "Windows Package Manager"
  priority = 100

  async isAvailable(): Promise<boolean> {
    const result = await execPowerShell("winget --version", 5000)
    return result.success
  }

  async install(): Promise<ExecResult> {
    // Download and install latest winget from GitHub
    const command = `
      $ProgressPreference = 'SilentlyContinue'
      $ErrorActionPreference = 'Stop'
      try {
        $release = Invoke-RestMethod 'https://api.github.com/repos/microsoft/winget-cli/releases/latest'
        $asset = $release.assets | Where-Object { $_.name -match 'msixbundle$' } | Select-Object -First 1
        if (-not $asset) { throw 'No msixbundle found' }
        $tempFile = Join-Path $env:TEMP 'winget.msixbundle'
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tempFile
        Add-AppxPackage -Path $tempFile
        Remove-Item $tempFile -Force
        Write-Output 'Winget installed successfully'
      } catch {
        Write-Error $_.Exception.Message
        exit 1
      }
    `
    return await execPowerShell(command)
  }

  async installTool(packageId: string, options: InstallOptions = {}): Promise<ExecResult> {
    const args = [packageId]

    if (options.silent !== false) {
      args.push("--silent")
    }

    if (options.acceptLicenses !== false) {
      args.push("--accept-package-agreements", "--accept-source-agreements")
    }

    if (options.version) {
      args.push("--version", options.version)
    }

    const command = `winget install ${args.join(" ")}`
    return await execPowerShell(command)
  }

  getInstallCommand(packageId: string, options: InstallOptions = {}): string {
    const args = [packageId]

    if (options.silent !== false) {
      args.push("--silent")
    }

    if (options.acceptLicenses !== false) {
      args.push("--accept-package-agreements", "--accept-source-agreements")
    }

    if (options.version) {
      args.push("--version", options.version)
    }

    return `winget install ${args.join(" ")}`
  }
}

/**
 * Chocolatey Package Manager Provider
 */
export class ChocolateyProvider implements WindowsPackageManager {
  name = "choco"
  displayName = "Chocolatey"
  priority = 80

  async isAvailable(): Promise<boolean> {
    const result = await execPowerShell("choco --version", 5000)
    return result.success
  }

  async install(): Promise<ExecResult> {
    const command = `
      Set-ExecutionPolicy Bypass -Scope Process -Force
      [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
      iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    `
    return await execPowerShell(command)
  }

  async installTool(packageId: string, options: InstallOptions = {}): Promise<ExecResult> {
    const args = ["install", packageId]

    if (options.silent !== false) {
      args.push("-y")
    }

    if (options.version) {
      args.push("--version", options.version)
    }

    const command = `choco ${args.join(" ")}`
    return await execPowerShell(command)
  }

  getInstallCommand(packageId: string, options: InstallOptions = {}): string {
    const args = ["install", packageId]

    if (options.silent !== false) {
      args.push("-y")
    }

    if (options.version) {
      args.push("--version", options.version)
    }

    return `choco ${args.join(" ")}`
  }
}

/**
 * Windows Package Manager Registry
 */
export class WindowsPackageManagerRegistry {
  private providers: WindowsPackageManager[] = [
    new WingetProvider(),
    new ChocolateyProvider(),
  ]

  private cachedProvider: WindowsPackageManager | null = null

  /**
   * Get the best available package manager
   */
  async getAvailableProvider(): Promise<WindowsPackageManager | null> {
    if (this.cachedProvider) {
      return this.cachedProvider
    }

    // Sort by priority (higher first)
    const sorted = [...this.providers].sort((a, b) => b.priority - a.priority)

    for (const provider of sorted) {
      if (await provider.isAvailable()) {
        this.cachedProvider = provider
        return provider
      }
    }

    return null
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): WindowsPackageManager | null {
    return this.providers.find(p => p.name === name) || null
  }

  /**
   * Get all providers
   */
  getAllProviders(): WindowsPackageManager[] {
    return [...this.providers]
  }

  /**
   * Install a tool using a specific package manager by name
   */
  async installToolWithProvider(
    providerName: string,
    packageId: string,
    options: InstallOptions = {}
  ): Promise<{ success: boolean; provider?: string; error?: string; output?: string }> {
    const provider = this.getProvider(providerName)

    if (!provider) {
      return {
        success: false,
        error: `Package manager「${providerName}」not found`,
      }
    }

    // Check if provider is available
    const isAvailable = await provider.isAvailable()
    if (!isAvailable) {
      return {
        success: false,
        error: `Package manager「${providerName}」is not available`,
      }
    }

    try {
      const result = await provider.installTool(packageId, options)
      if (result.success) {
        return {
          success: true,
          provider: provider.name,
          output: result.stdout,
        }
      }

      return {
        success: false,
        error: result.stderr || "Installation failed",
        output: result.stdout,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  /**
   * Install a tool using the best available package manager
   * Automatically falls back to next provider if first fails
   */
  async installTool(
    packageId: string,
    options: InstallOptions = {}
  ): Promise<{ success: boolean; provider?: string; error?: string; output?: string }> {
    const sorted = [...this.providers].sort((a, b) => b.priority - a.priority)

    for (const provider of sorted) {
      if (!(await provider.isAvailable())) {
        continue
      }

      try {
        const result = await provider.installTool(packageId, options)
        if (result.success) {
          return {
            success: true,
            provider: provider.name,
            output: result.stdout,
          }
        }
      } catch (error) {
        // Continue to next provider
        continue
      }
    }

    return {
      success: false,
      error: "No package manager available or all installation attempts failed",
    }
  }

  /**
   * Install a package manager if none are available
   */
  async ensurePackageManager(): Promise<{
    success: boolean
    provider?: string
    error?: string
  }> {
    // Check if any provider is available
    const available = await this.getAvailableProvider()
    if (available) {
      return { success: true, provider: available.name }
    }

    // Try to install providers in priority order
    const sorted = [...this.providers].sort((a, b) => b.priority - a.priority)

    for (const provider of sorted) {
      try {
        const result = await provider.install()
        if (result.success) {
          this.cachedProvider = provider
          return { success: true, provider: provider.name }
        }
      } catch (error) {
        // Continue to next provider
        continue
      }
    }

    return {
      success: false,
      error: "Failed to install any package manager",
    }
  }

  /**
   * Clear cached provider (call after installing new package manager)
   */
  clearCache(): void {
    this.cachedProvider = null
  }
}

// Singleton instance
let registryInstance: WindowsPackageManagerRegistry | null = null

export function getWindowsPackageManagerRegistry(): WindowsPackageManagerRegistry {
  if (!registryInstance) {
    registryInstance = new WindowsPackageManagerRegistry()
  }
  return registryInstance
}

export function resetWindowsPackageManagerRegistry(): void {
  registryInstance = null
}
