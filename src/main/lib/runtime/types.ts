/**
 * Runtime Detection Types
 *
 * Shared types for cross-platform runtime detection
 */

export type SupportedPlatform = "darwin" | "win32" | "linux"

export type ToolCategory =
  | "package_manager"
  | "vcs"
  | "search"
  | "json"
  | "network"
  | "js_runtime"
  | "python_runtime"
  | "python_pkg"
  | "go_runtime"
  | "rust_runtime"

/**
 * Windows package IDs for different package managers
 */
export interface WindowsPackageIds {
  winget?: string
  choco?: string
}

export interface ToolDefinition {
  name: string
  displayName: string
  category: ToolCategory
  description: string
  priority: number
  minVersion?: string
  versionFlag?: string
  versionParser?: (output: string) => string
  installCommands: Partial<Record<SupportedPlatform, string>>
  /** Windows-specific package IDs for winget and Chocolatey */
  windowsPackageIds?: WindowsPackageIds
}

export interface ToolInfo {
  name: string
  displayName: string
  category: ToolCategory
  installed: boolean
  version: string | null
  path: string | null
  installCommand: string | null
  description: string
  required: boolean
  minVersion?: string
  priority: number
}

export interface CategoryStatus {
  category: ToolCategory
  displayName: string
  satisfied: boolean
  installedTool: ToolInfo | null
  recommendedTool: ToolInfo | null
  required: boolean
}

export interface DetectedTools {
  platform: NodeJS.Platform
  tools: ToolInfo[]
  categories: CategoryStatus[]
}

export interface RuntimeInfo {
  name: string
  version: string
  path: string
}

export interface DetectedRuntimes {
  node: RuntimeInfo | null
  bun: RuntimeInfo | null
  npm: RuntimeInfo | null
  yarn: RuntimeInfo | null
  pnpm: RuntimeInfo | null
}

export interface RuntimeEnvironment {
  platform: string
  tools: {
    category: string
    name: string
    version: string | null
    path: string | null
  }[]
}

/**
 * Result of command execution with structured error info
 */
export interface ExecResult {
  stdout: string
  stderr: string
  success: boolean
  error?: "not_found" | "timeout" | "execution_failed"
}

/**
 * Platform-specific runtime provider
 */
export interface RuntimeProvider {
  /**
   * Execute command with timeout
   */
  execCommand(command: string, timeoutMs?: number): Promise<ExecResult>

  /**
   * Get command for checking if a tool exists (which/where)
   */
  getWhichCommand(): string

  /**
   * Apply platform-specific command aliases
   */
  resolveCommandAlias(command: string): string

  /**
   * Detect a single tool
   */
  detectTool(def: ToolDefinition): Promise<ToolInfo>

  /**
   * Get install command for a tool
   */
  getInstallCommand(def: ToolDefinition): string | null
}
