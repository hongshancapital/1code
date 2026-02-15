/**
 * Base Runtime Provider
 *
 * Abstract base class for platform-specific runtime detection
 */

import type {
  RuntimeProvider,
  ToolDefinition,
  ToolInfo,
  ExecResult,
  SupportedPlatform,
} from "./types"
import { CATEGORY_INFO } from "./constants"

export abstract class BaseRuntimeProvider implements RuntimeProvider {
  protected platform: SupportedPlatform

  constructor(platform: SupportedPlatform) {
    this.platform = platform
  }

  abstract execCommand(command: string, timeoutMs?: number): Promise<ExecResult>
  abstract getWhichCommand(): string
  abstract resolveCommandAlias(command: string): string

  /**
   * Detect a single tool from definition
   */
  async detectTool(def: ToolDefinition): Promise<ToolInfo> {
    const whichCmd = this.getWhichCommand()
    const categoryInfo = CATEGORY_INFO[def.category]

    // Apply platform-specific command aliases
    const finalName = this.resolveCommandAlias(def.name)

    // Check if tool exists
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

    // Get version
    const versionFlag = def.versionFlag || "--version"
    const versionResult = await this.execCommand(`${finalName} ${versionFlag}`)

    let version: string | null = null
    if (versionResult.success) {
      const versionOutput = versionResult.stdout || versionResult.stderr

      if (versionOutput) {
        // Skip if output looks like an error message
        if (!this.isErrorOutput(versionOutput)) {
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

  /**
   * Get install command for a tool
   */
  getInstallCommand(def: ToolDefinition): string | null {
    return def.installCommands[this.platform] ?? null
  }

  /**
   * Check if output looks like an error message
   */
  protected isErrorOutput(output: string): boolean {
    const lowerOutput = output.toLowerCase()
    const errorPatterns = [
      "is not recognized",
      "not found",
      "cannot find",
      "no such file",
      "the term",
      "error:",
      "fatal:",
    ]
    return errorPatterns.some(pattern => lowerOutput.includes(pattern))
  }

  /**
   * Check if output contains "command not found" patterns
   */
  protected isNotFoundError(output: string): boolean {
    const notFoundPatterns = [
      "is not recognized as an internal or external command",
      "command not found",
      "No such file or directory",
      "cannot find the path",
      "The term",
    ]
    const lowerOutput = output.toLowerCase()
    return notFoundPatterns.some(pattern => lowerOutput.includes(pattern.toLowerCase()))
  }
}
