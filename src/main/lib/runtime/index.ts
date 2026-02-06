/**
 * Runtime Detection Module
 *
 * Cross-platform runtime and tool detection system
 */

export * from "./types"
export * from "./constants"
export * from "./tool-definitions"
export * from "./provider-factory"
export { BaseRuntimeProvider } from "./base-provider"
export { WindowsRuntimeProvider } from "./windows-provider"
export { MacOSRuntimeProvider } from "./macos-provider"
export { LinuxRuntimeProvider } from "./linux-provider"
export * from "./windows-package-managers"

import { getRuntimeProvider } from "./provider-factory"
import { TOOL_DEFINITIONS } from "./tool-definitions"
import { CATEGORY_INFO } from "./constants"
import type {
  DetectedTools,
  DetectedRuntimes,
  RuntimeInfo,
  RuntimeEnvironment,
  ToolInfo,
  ToolCategory,
  CategoryStatus,
  SupportedPlatform,
} from "./types"
import { LinuxRuntimeProvider } from "./linux-provider"

/**
 * Detect all tools and build category status
 */
export async function detectAllTools(): Promise<DetectedTools> {
  const platform = process.platform as SupportedPlatform
  const provider = getRuntimeProvider()

  // Step 1: Detect package managers first
  const pmTools = TOOL_DEFINITIONS.filter((def) => def.category === "package_manager")
  const pmToolsForPlatform = pmTools.filter((def) => {
    if (platform === "linux") {
      return !def.installCommands.darwin && !def.installCommands.win32
    }
    return def.installCommands[platform] !== undefined
  })

  // Detect package managers sequentially (for Linux to find first available)
  const detectedPmTools: ToolInfo[] = []
  for (const def of pmToolsForPlatform) {
    const tool = await provider.detectTool(def)
    detectedPmTools.push(tool)

    // On Linux, cache the detected package manager
    if (platform === "linux" && tool.installed && provider instanceof LinuxRuntimeProvider) {
      provider.setPackageManager(tool.name)
      break
    }
  }

  // Step 2: Detect other tools
  const otherTools = TOOL_DEFINITIONS.filter((def) => {
    if (def.category === "package_manager") return false

    if (platform === "linux") {
      if (def.installCommands.linux) return true
      // Include tools without install commands (detection only)
      return true
    }

    return def.installCommands[platform] !== undefined
  })

  const detectedOtherTools = await Promise.all(
    otherTools.map(def => provider.detectTool(def))
  )

  // Combine all tools
  const allTools = [...detectedPmTools, ...detectedOtherTools]

  // Build category status
  const categories = buildCategoryStatus(allTools)

  return {
    platform,
    tools: allTools,
    categories,
  }
}

/**
 * Build category status from detected tools
 */
function buildCategoryStatus(tools: ToolInfo[]): CategoryStatus[] {
  const categories = Object.keys(CATEGORY_INFO) as ToolCategory[]

  return categories.map((category) => {
    const categoryInfo = CATEGORY_INFO[category]
    const categoryTools = tools
      .filter((t) => t.category === category)
      .sort((a, b) => b.priority - a.priority)

    const installedTools = categoryTools.filter((t) => t.installed)
    const installedTool = installedTools[0] || null
    const recommendedTool = categoryTools[0] || null

    return {
      category,
      displayName: categoryInfo.displayName,
      satisfied: installedTools.length > 0,
      installedTool,
      recommendedTool: installedTools.length > 0 ? null : recommendedTool,
      required: categoryInfo.required,
    }
  })
}

/**
 * Detect specific runtimes (node, bun, npm, yarn, pnpm)
 */
export async function detectRuntimes(): Promise<DetectedRuntimes> {
  const provider = getRuntimeProvider()

  const detectRuntime = async (
    name: string,
    displayName: string
  ): Promise<RuntimeInfo | null> => {
    const whichCmd = provider.getWhichCommand()
    const finalName = provider.resolveCommandAlias(name)

    const pathResult = await provider.execCommand(`${whichCmd} ${finalName}`)
    if (!pathResult.success || !pathResult.stdout) return null

    const versionResult = await provider.execCommand(`${finalName} --version`)
    if (!versionResult.success) return null

    const versionOutput = versionResult.stdout || versionResult.stderr
    if (!versionOutput) return null

    // Skip error messages
    const lowerOutput = versionOutput.toLowerCase()
    const errorPatterns = [
      "is not recognized",
      "not found",
      "cannot find",
      "no such file",
      "the term",
      "error:",
      "fatal:",
    ]
    if (errorPatterns.some(pattern => lowerOutput.includes(pattern))) {
      return null
    }

    return {
      name: displayName,
      version: versionOutput.split("\n")[0].trim().replace(/^v/, ""),
      path: pathResult.stdout.split("\n")[0].trim(),
    }
  }

  const [node, bun, npm, yarn, pnpm] = await Promise.all([
    detectRuntime("node", "Node.js"),
    detectRuntime("bun", "Bun"),
    detectRuntime("npm", "npm"),
    detectRuntime("yarn", "yarn"),
    detectRuntime("pnpm", "pnpm"),
  ])

  return { node, bun, npm, yarn, pnpm }
}

/**
 * Get runtime environment info for system prompt injection
 */
export function getRuntimeEnvironment(tools: DetectedTools): RuntimeEnvironment {
  const installedByCategory = new Map<ToolCategory, ToolInfo>()

  for (const tool of tools.tools) {
    if (!tool.installed) continue
    const existing = installedByCategory.get(tool.category)
    if (!existing || tool.priority > existing.priority) {
      installedByCategory.set(tool.category, tool)
    }
  }

  return {
    platform: tools.platform,
    tools: Array.from(installedByCategory.values()).map((tool) => ({
      category: CATEGORY_INFO[tool.category].displayName,
      name: tool.name,
      version: tool.version,
      path: tool.path,
    })),
  }
}
