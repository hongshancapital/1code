/**
 * Windows Package Manager Providers
 *
 * Supports multiple package managers on Windows (winget, Chocolatey)
 * with automatic fallback
 */

import { exec, execSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { promisify } from "node:util"
import type { ExecResult } from "./types"

const execAsync = promisify(exec)

/**
 * Well-known installation paths for Windows package managers.
 * Electron apps launched from shortcuts may not inherit full PATH.
 */
function getWindowsExtraPaths(): string[] {
  const paths: string[] = []
  // winget
  if (process.env.LOCALAPPDATA) {
    paths.push(`${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps`)
  }
  if (process.env.PROGRAMFILES) {
    paths.push(`${process.env.PROGRAMFILES}\\WinGet\\Links`)
  }
  // Chocolatey
  paths.push("C:\\ProgramData\\chocolatey\\bin")
  return paths
}

/**
 * Get an enhanced environment with common Windows tool paths appended.
 */
function getWindowsEnhancedEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "win32") return process.env
  const basePath = process.env.PATH || ""
  const segments = basePath.split(";")
  const missing = getWindowsExtraPaths().filter(
    (p) => !segments.some((s) => s.toLowerCase() === p.toLowerCase()),
  )
  if (missing.length === 0) return process.env
  return { ...process.env, PATH: `${basePath};${missing.join(";")}` }
}

/**
 * Refresh process.env.PATH from registry so newly installed tools are visible.
 * Reads Machine + User PATH from the Windows registry and merges them.
 */
async function refreshWindowsPath(): Promise<void> {
  if (process.platform !== "win32") return

  try {
    const { stdout } = await execAsync(
      `powershell.exe -NoProfile -NonInteractive -Command "[Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')"`,
      { timeout: 10000 },
    )
    const registryPath = stdout.trim()
    if (registryPath) {
      // Merge: keep any Electron-only paths, add registry paths that are missing
      const currentSegments = (process.env.PATH || "").split(";").map((s) => s.toLowerCase())
      const newSegments = registryPath.split(";").filter(
        (s) => s && !currentSegments.includes(s.toLowerCase()),
      )
      if (newSegments.length > 0) {
        process.env.PATH = `${process.env.PATH};${newSegments.join(";")}`
      }
    }
  } catch {
    // Best effort — don't break the flow
  }
}

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
 * Windows elevation status
 */
export type ElevationStatus = "elevated" | "can-elevate" | "cannot-elevate"

/**
 * Check current process elevation status on Windows.
 * - 'elevated': already running with admin privileges
 * - 'can-elevate': user is in Administrators group, can trigger UAC
 * - 'cannot-elevate': user is not an admin, UAC will require admin credentials
 */
export function getElevationStatus(): ElevationStatus {
  // Check if already elevated via `net session`
  try {
    execSync("net session", { stdio: "ignore" })
    return "elevated"
  } catch {
    // Not elevated
  }

  // Check if user is in Administrators group (SID S-1-5-32-544)
  try {
    const groups = execSync("whoami /groups", { encoding: "utf8" })
    if (groups.includes("S-1-5-32-544")) {
      return "can-elevate"
    }
  } catch {
    // Ignore
  }

  return "cannot-elevate"
}

/**
 * Execute a command with UAC elevation (triggers system UAC dialog).
 *
 * If `powershell: true`, writes the command as a .ps1 script and runs it via
 * `Start-Process powershell.exe -File ... -Verb RunAs`.
 * Otherwise wraps the command in a .bat file and runs via `Start-Process cmd.exe`.
 *
 * Output is captured via temporary files to work around the elevated process
 * running in a separate window/session.
 */
async function elevatedExec(
  command: string,
  options: { timeoutMs?: number; logStep?: string; powershell?: boolean } = {},
): Promise<ExecResult> {
  const { timeoutMs = 600000, logStep, powershell = false } = options

  if (logStep) {
    addLog({ step: `${logStep} - UAC elevated exec`, command, success: true })
  }

  const tmpDir = join(tmpdir(), `hong-elevate-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })

  const stdoutFile = join(tmpDir, "stdout.txt")
  const stderrFile = join(tmpDir, "stderr.txt")
  const exitCodeFile = join(tmpDir, "exitcode.txt")

  // Build the wrapper script that captures output
  let wrapperFile: string
  let startProcessArgs: string

  // Build extra PATH entries so elevated processes can find winget/choco
  const extraPathEntries = getWindowsExtraPaths().join(";")

  if (powershell) {
    // Write a .ps1 wrapper that executes the command and captures output
    wrapperFile = join(tmpDir, "command.ps1")
    const ps1Content = [
      // Inject extra paths so winget/choco are reachable in the elevated session
      `$env:PATH += ";${extraPathEntries}"`,
      "$ErrorActionPreference = 'Continue'",
      "try {",
      `  ${command} > "${stdoutFile}" 2> "${stderrFile}"`,
      `  $LASTEXITCODE | Out-File -FilePath "${exitCodeFile}" -Encoding utf8`,
      "} catch {",
      `  $_.Exception.Message | Out-File -FilePath "${stderrFile}" -Encoding utf8`,
      `  1 | Out-File -FilePath "${exitCodeFile}" -Encoding utf8`,
      "}",
    ].join("\r\n")
    writeFileSync(wrapperFile, ps1Content, "utf8")

    const escapedWrapper = wrapperFile.replace(/'/g, "''")
    startProcessArgs = `Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${escapedWrapper}' -Verb RunAs -Wait -WindowStyle Hidden`
  } else {
    // Write a .bat wrapper
    wrapperFile = join(tmpDir, "command.bat")
    const batContent = [
      "@echo off",
      "chcp 65001 >nul",
      // Inject extra paths so winget/choco are reachable in the elevated session
      `set "PATH=%PATH%;${extraPathEntries}"`,
      `${command} > "${stdoutFile}" 2> "${stderrFile}"`,
      `echo %errorlevel% > "${exitCodeFile}"`,
    ].join("\r\n")
    writeFileSync(wrapperFile, batContent, "utf8")

    const escapedWrapper = wrapperFile.replace(/'/g, "''")
    startProcessArgs = `Start-Process cmd.exe -ArgumentList '/c','${escapedWrapper}' -Verb RunAs -Wait -WindowStyle Hidden`
  }

  try {
    await execAsync(
      `powershell.exe -NoProfile -NonInteractive -Command "${startProcessArgs.replace(/"/g, '\\"')}"`,
      { timeout: timeoutMs },
    )

    const stdout = existsSync(stdoutFile) ? readFileSync(stdoutFile, "utf8").trim() : ""
    const stderr = existsSync(stderrFile) ? readFileSync(stderrFile, "utf8").trim() : ""
    const exitCode = existsSync(exitCodeFile)
      ? parseInt(readFileSync(exitCodeFile, "utf8").trim(), 10)
      : -1

    const success = exitCode === 0

    if (logStep) {
      addLog({
        step: `${logStep} - UAC ${success ? "succeeded" : "failed"}`,
        command: command.substring(0, 200),
        stdout: stdout.substring(0, 200),
        stderr: stderr.substring(0, 200),
        success,
        error: success ? undefined : "execution_failed",
      })
    }

    return { stdout, stderr, success, error: success ? undefined : "execution_failed" }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error"

    // User cancelled UAC dialog or other error
    const isCancelled =
      errorMsg.includes("canceled") ||
      errorMsg.includes("cancelled") ||
      errorMsg.includes("refused") ||
      errorMsg.includes("1223")

    if (logStep) {
      addLog({
        step: `${logStep} - UAC ${isCancelled ? "cancelled by user" : "error"}`,
        command: command.substring(0, 200),
        success: false,
        error: isCancelled ? "uac_cancelled" : errorMsg,
      })
    }

    return {
      stdout: "",
      stderr: isCancelled ? "UAC_CANCELLED" : errorMsg,
      success: false,
      error: "execution_failed",
    }
  } finally {
    // Clean up temp files
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // Best effort
    }
  }
}

/**
 * Try elevated installation based on current elevation status.
 * - 'elevated': shouldn't reach here (already have admin)
 * - 'can-elevate': trigger UAC dialog
 * - 'cannot-elevate': return NO_ADMIN error
 */
async function installWithElevation(
  command: string,
  logStep: string,
  options: { powershell?: boolean } = {},
): Promise<ExecResult> {
  const status = getElevationStatus()

  if (status === "cannot-elevate") {
    addLog({ step: `${logStep} - user is not admin`, success: false, error: "NO_ADMIN" })
    return { stdout: "", stderr: "NO_ADMIN", success: false, error: "execution_failed" }
  }

  // can-elevate (or elevated, though unlikely to reach here)
  const result = await elevatedExec(command, {
    timeoutMs: 600000,
    logStep,
    powershell: options.powershell,
  })

  if (!result.success && result.stderr === "UAC_CANCELLED") {
    return { stdout: "", stderr: "UAC_CANCELLED", success: false, error: "execution_failed" }
  }

  return result
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
      env: getWindowsEnhancedEnv(),
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
    if (result.success) return true

    // Fallback: try the well-known direct path.
    // Note: winget.exe under WindowsApps is an App Execution Alias (reparse point),
    // so existsSync may return false even when it exists. Just try running it directly.
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      const directPath = join(localAppData, "Microsoft", "WindowsApps", "winget.exe")
      const directResult = await execPowerShell(
        `& "${directPath}" --version`, 5000, "检测 winget (直接路径)",
      )
      if (directResult.success) return true
    }

    return false
  }

  async install(): Promise<ExecResult> {
    addLog({
      step: "安装 winget - 开始",
      success: true,
    })

    // Step 1: Install VCLibs dependency (required for winget)
    addLog({
      step: "安装 winget - 检查 VCLibs 依赖",
      success: true,
    })

    const vcLibsCommand = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
  # Check if VCLibs is already installed
  $vclibs = Get-AppxPackage -Name 'Microsoft.VCLibs.140.00.UWPDesktop' -ErrorAction SilentlyContinue
  if (-not $vclibs) {
    Write-Output 'Installing VCLibs...'
    $vcLibsUrl = 'https://aka.ms/Microsoft.VCLibs.x64.14.00.Desktop.appx'
    $vcLibsPath = Join-Path $env:TEMP 'vclibs.appx'
    Invoke-WebRequest -Uri $vcLibsUrl -OutFile $vcLibsPath
    Add-AppxPackage -Path $vcLibsPath
    Remove-Item $vcLibsPath -Force
    Write-Output 'VCLibs installed'
  } else {
    Write-Output 'VCLibs already installed'
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()

    let vcLibsResult = await execPowerShell(vcLibsCommand, 120000, "安装 VCLibs 依赖")
    if (!vcLibsResult.success) {
      // Try with elevation
      vcLibsResult = await installWithElevation(vcLibsCommand, "安装 VCLibs 依赖 (elevated)", { powershell: true })
      if (!vcLibsResult.success) {
        addLog({
          step: "安装 winget - VCLibs 安装失败",
          success: false,
          error: vcLibsResult.stderr,
        })
        return vcLibsResult
      }
    }

    // Step 2: Install UI.Xaml dependency (required for winget 1.6+)
    addLog({
      step: "安装 winget - 检查 UI.Xaml 依赖",
      success: true,
    })

    const uiXamlCommand = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
  # Check if UI.Xaml 2.8 is already installed
  $xaml = Get-AppxPackage -Name 'Microsoft.UI.Xaml.2.8' -ErrorAction SilentlyContinue
  if (-not $xaml) {
    Write-Output 'Installing UI.Xaml 2.8...'
    # Download from NuGet and extract the appx
    $nugetUrl = 'https://www.nuget.org/api/v2/package/Microsoft.UI.Xaml/2.8.6'
    $nugetPath = Join-Path $env:TEMP 'uixaml.zip'
    $extractPath = Join-Path $env:TEMP 'uixaml'
    Invoke-WebRequest -Uri $nugetUrl -OutFile $nugetPath
    Expand-Archive -Path $nugetPath -DestinationPath $extractPath -Force
    $appxPath = Join-Path $extractPath 'tools\\AppX\\x64\\Release\\Microsoft.UI.Xaml.2.8.appx'
    if (Test-Path $appxPath) {
      Add-AppxPackage -Path $appxPath
      Write-Output 'UI.Xaml 2.8 installed'
    } else {
      Write-Output 'UI.Xaml appx not found, skipping'
    }
    Remove-Item $nugetPath -Force -ErrorAction SilentlyContinue
    Remove-Item $extractPath -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    Write-Output 'UI.Xaml 2.8 already installed'
  }
} catch {
  # UI.Xaml failure is not fatal, winget might still work
  Write-Output "UI.Xaml installation skipped: $_"
}
`.trim()

    // UI.Xaml is optional, don't fail if it doesn't install
    let uiXamlResult = await execPowerShell(uiXamlCommand, 120000, "安装 UI.Xaml 依赖")
    if (!uiXamlResult.success) {
      uiXamlResult = await installWithElevation(uiXamlCommand, "安装 UI.Xaml 依赖 (elevated)", { powershell: true })
      // Don't return on failure, UI.Xaml is optional
    }

    // Step 3: Install winget itself
    addLog({
      step: "安装 winget - 下载 winget",
      success: true,
    })

    const wingetCommand = `
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'Stop'
try {
  Write-Output 'Fetching latest winget release...'
  $release = Invoke-RestMethod 'https://api.github.com/repos/microsoft/winget-cli/releases/latest'

  # Find the msixbundle
  $msixBundle = $release.assets | Where-Object { $_.name -match '\\.msixbundle$' } | Select-Object -First 1
  if (-not $msixBundle) {
    throw 'No msixbundle found in release'
  }

  # Also get the license file if available
  $license = $release.assets | Where-Object { $_.name -match '_License.*\\.xml$' } | Select-Object -First 1

  $bundlePath = Join-Path $env:TEMP 'winget.msixbundle'
  Write-Output "Downloading winget from $($msixBundle.browser_download_url)..."
  Invoke-WebRequest -Uri $msixBundle.browser_download_url -OutFile $bundlePath

  if ($license) {
    $licensePath = Join-Path $env:TEMP 'winget_license.xml'
    Write-Output 'Downloading license...'
    Invoke-WebRequest -Uri $license.browser_download_url -OutFile $licensePath
    Write-Output 'Installing winget with license...'
    Add-AppxProvisionedPackage -Online -PackagePath $bundlePath -LicensePath $licensePath -ErrorAction SilentlyContinue
  }

  # Try Add-AppxPackage; on 0x80073CF3 conflict, retry with -ForceUpdateFromAnyVersion
  Write-Output 'Installing winget package...'
  try {
    Add-AppxPackage -Path $bundlePath -ErrorAction Stop
  } catch {
    if ($_.Exception.Message -match '0x80073CF3') {
      Write-Output 'Version conflict detected, retrying with -ForceUpdateFromAnyVersion...'
      Add-AppxPackage -Path $bundlePath -ForceUpdateFromAnyVersion -ErrorAction Stop
    } else {
      throw
    }
  }

  Remove-Item $bundlePath -Force -ErrorAction SilentlyContinue
  if ($licensePath) { Remove-Item $licensePath -Force -ErrorAction SilentlyContinue }

  Write-Output 'Winget installed successfully'
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
`.trim()

    // Try normal install first
    let result = await execPowerShell(wingetCommand, 600000, "安装 winget")
    if (result.success) {
      await refreshWindowsPath()
      addLog({ step: "安装 winget - 完成", success: true })
      return result
    }

    // Failed — check elevation status and try UAC (run as PowerShell script)
    result = await installWithElevation(wingetCommand, "安装 winget (elevated)", { powershell: true })

    if (result.success) {
      await refreshWindowsPath()
      addLog({ step: "安装 winget - 完成 (elevated)", success: true })
    } else {
      // Even if install "failed", winget may already exist (just a PATH issue or
      // an older version was already present). Refresh PATH and check before giving up.
      await refreshWindowsPath()
      const stillAvailable = await this.isAvailable()
      if (stillAvailable) {
        addLog({ step: "安装 winget - 已存在 (PATH 问题)", success: true })
        return { stdout: "winget already available", stderr: "", success: true }
      }

      addLog({
        step: "安装 winget - 失败",
        success: false,
        error: result.stderr,
      })
    }

    return result
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

    // Try normal install first
    let result = await execPowerShell(command, 600000, `winget 安装 ${packageId}`)
    if (!result.success) {
      // Failed — try with elevation
      result = await installWithElevation(command, `winget 安装 ${packageId} (elevated)`)
    }

    if (result.success) {
      await refreshWindowsPath()
    }
    return result
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
    if (result.success) return true

    // Fallback: try the well-known direct path
    const directPath = "C:\\ProgramData\\chocolatey\\bin\\choco.exe"
    if (existsSync(directPath)) {
      const directResult = await execPowerShell(
        `& "${directPath}" --version`, 5000, "检测 Chocolatey (直接路径)",
      )
      return directResult.success
    }

    return false
  }

  async install(): Promise<ExecResult> {
    addLog({
      step: "安装 Chocolatey - 准备下载",
      success: true,
    })

    const command = `Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))`

    // Try normal install first
    let result = await execPowerShell(command, 600000, "安装 Chocolatey")
    if (!result.success) {
      // Failed — try with elevation (run as PowerShell script)
      result = await installWithElevation(command, "安装 Chocolatey (elevated)", { powershell: true })
    }

    // Regardless of exit code, refresh PATH and verify choco is actually usable.
    // The install script exits 0 even when it detects an existing install and
    // does nothing, but choco may still not be on PATH.
    await refreshWindowsPath()

    if (await this.isAvailable()) {
      addLog({ step: "安装 Chocolatey - 验证通过", success: true })
      return { stdout: result.stdout, stderr: result.stderr, success: true }
    }

    // Still not available — treat as failure
    addLog({ step: "安装 Chocolatey - 验证失败 (choco 不在 PATH 中)", success: false, error: "verification_failed" })
    return { stdout: result.stdout, stderr: "Chocolatey installed but not found on PATH", success: false, error: "execution_failed" }
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

    // Try normal install first
    let result = await execPowerShell(command, 600000, `Chocolatey 安装 ${packageId}`)
    if (!result.success) {
      // Failed — try with elevation
      result = await installWithElevation(command, `Chocolatey 安装 ${packageId} (elevated)`)
    }

    if (result.success) {
      await refreshWindowsPath()
    }
    return result
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

      // Propagate structured error codes
      if (result.stderr === "NO_ADMIN" || result.stderr === "UAC_CANCELLED") {
        return { success: false, error: "NO_ADMIN" }
      }

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
   * Install a package manager if none are available.
   * Returns structured error codes: NO_ADMIN, UAC_CANCELLED, INSTALL_FAILED
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
    let lastError = "INSTALL_FAILED"

    for (const provider of sorted) {
      try {
        const result = await provider.install()
        if (result.success) {
          this.cachedProvider = provider
          return { success: true, provider: provider.name }
        }

        // Propagate structured error codes from elevation logic
        if (result.stderr === "NO_ADMIN") {
          return { success: false, error: "NO_ADMIN" }
        }
        if (result.stderr === "UAC_CANCELLED") {
          return { success: false, error: "NO_ADMIN" }
        }

        lastError = result.stderr || "INSTALL_FAILED"
      } catch (error) {
        // Continue to next provider
        continue
      }
    }

    return {
      success: false,
      error: lastError,
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
