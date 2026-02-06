/**
 * Windows Package Manager Providers
 *
 * Supports multiple package managers on Windows (winget, Chocolatey)
 * with automatic fallback
 */

import { spawn } from "node:child_process"
import type { ExecResult } from "./types"

/**
 * Installation log for debugging
 */
export interface InstallLog {
  timestamp: string
  step: string
  command?: string
  stdout?: string
  stderr?: string
  success: boolean
  error?: string
}

const installLogs: InstallLog[] = []

function addLog(log: Omit<InstallLog, "timestamp">) {
  const entry: InstallLog = {
    ...log,
    timestamp: new Date().toISOString(),
  }
  installLogs.push(entry)

  // 保留最近 100 条日志
  if (installLogs.length > 100) {
    installLogs.shift()
  }

  // 同时输出到 console 方便 debug
  console.log(`[Windows PM] ${entry.step}`, {
    command: entry.command,
    success: entry.success,
    error: entry.error,
    stdout: entry.stdout?.substring(0, 200),
    stderr: entry.stderr?.substring(0, 200),
  })
}

export function getInstallLogs(): InstallLog[] {
  return [...installLogs]
}

export function clearInstallLogs(): void {
  installLogs.length = 0
}

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
 * Execute PowerShell command with logging
 */
async function execPowerShell(
  command: string,
  timeoutMs = 600000,
  logStep?: string
): Promise<ExecResult> {
  // 记录开始执行
  if (logStep) {
    addLog({
      step: `${logStep} - 开始执行`,
      command,
      success: true,
    })
  }

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
      const result = {
        stdout: "",
        stderr: "Timeout",
        success: false,
        error: "timeout" as const,
      }

      if (logStep) {
        addLog({
          step: `${logStep} - 超时`,
          command,
          stdout: result.stdout,
          stderr: result.stderr,
          success: false,
          error: "timeout",
        })
      }

      resolve(result)
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

        const result = {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          success: code === 0,
          error: code !== 0 ? ("execution_failed" as const) : undefined,
        }

        if (logStep) {
          addLog({
            step: `${logStep} - ${code === 0 ? '成功' : '失败'}`,
            command,
            stdout: result.stdout,
            stderr: result.stderr,
            success: result.success,
            error: result.error,
          })
        }

        resolve(result)
      }
    })

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timer)

        const result = {
          stdout: "",
          stderr: err.message,
          success: false,
          error: "not_found" as const,
        }

        if (logStep) {
          addLog({
            step: `${logStep} - 执行错误`,
            command,
            stdout: result.stdout,
            stderr: result.stderr,
            success: false,
            error: "not_found",
          })
        }

        resolve(result)
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
    const result = await execPowerShell("winget --version", 5000, "检测 winget")
    return result.success
  }

  async install(): Promise<ExecResult> {
    addLog({
      step: "安装 winget - 准备下载",
      success: true,
    })
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
    return await execPowerShell(command, 600000, "安装 winget")
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
    return await execPowerShell(command, 600000, `winget 安装 ${packageId}`)
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
    const result = await execPowerShell("choco --version", 5000, "检测 Chocolatey")
    return result.success
  }

  async install(): Promise<ExecResult> {
    addLog({
      step: "安装 Chocolatey - 准备下载",
      success: true,
    })

    const command = `
      Set-ExecutionPolicy Bypass -Scope Process -Force
      [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
      iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    `
    return await execPowerShell(command, 600000, "安装 Chocolatey")
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
    return await execPowerShell(command, 600000, `Chocolatey 安装 ${packageId}`)
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
    addLog({
      step: `尝试使用 ${providerName} 安装 ${packageId}`,
      success: true,
    })

    const provider = this.getProvider(providerName)

    if (!provider) {
      addLog({
        step: `包管理器 ${providerName} 未找到`,
        success: false,
        error: "not_found",
      })

      return {
        success: false,
        error: `Package manager「${providerName}」not found`,
      }
    }

    // Check if provider is available
    addLog({
      step: `检查 ${providerName} 是否可用`,
      success: true,
    })

    const isAvailable = await provider.isAvailable()
    if (!isAvailable) {
      addLog({
        step: `${providerName} 不可用`,
        success: false,
        error: "not_available",
      })

      return {
        success: false,
        error: `Package manager「${providerName}」is not available`,
      }
    }

    addLog({
      step: `${providerName} 可用，开始安装 ${packageId}`,
      success: true,
    })

    try {
      const result = await provider.installTool(packageId, options)
      if (result.success) {
        addLog({
          step: `${providerName} 成功安装 ${packageId}`,
          stdout: result.stdout,
          success: true,
        })

        return {
          success: true,
          provider: provider.name,
          output: result.stdout,
        }
      }

      addLog({
        step: `${providerName} 安装 ${packageId} 失败`,
        stdout: result.stdout,
        stderr: result.stderr,
        success: false,
        error: result.error,
      })

      return {
        success: false,
        error: result.stderr || "Installation failed",
        output: result.stdout,
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error"

      addLog({
        step: `${providerName} 安装 ${packageId} 异常`,
        success: false,
        error: errorMsg,
      })

      return {
        success: false,
        error: errorMsg,
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
