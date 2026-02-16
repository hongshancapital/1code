/**
 * PromptBuilder
 *
 * Builds system prompts for different scenarios (Chat, Automation, Insights, Workers).
 * Supports section injection, replacement, and full customization.
 *
 * Features:
 * - Built-in sections: software intro, user profile, runtime info, skill awareness, AGENTS.md
 * - Section toggles for different scenarios
 * - Prepend/append custom sections
 * - Replace or remove specific sections
 * - Fully custom system prompt override
 */

import { app } from "electron"
import * as fs from "fs/promises"
import * as path from "path"
import type {
  PromptStrategy,
  SystemPromptConfig,
  UserProfile,
} from "./engine-types"
import { createLogger } from "../logger"

const promptBuilderLog = createLogger("PromptBuilder")


/**
 * Runtime environment tool info
 */
interface RuntimeTool {
  category: string
  name: string
  version?: string
}

/**
 * Runtime environment info provider
 */
type RuntimeEnvProvider = () => Promise<{ tools: RuntimeTool[] }>

/**
 * PromptBuilder - Builds system prompts for different scenarios
 */
export class PromptBuilder {
  private runtimeEnvProvider?: RuntimeEnvProvider

  /**
   * Set the runtime environment provider
   * This allows injection of the runtime detection logic
   */
  setRuntimeEnvProvider(provider: RuntimeEnvProvider): void {
    this.runtimeEnvProvider = provider
  }

  /**
   * Build the software introduction section
   */
  private buildSoftwareIntroSection(cwd?: string): string {
    const appPath = app.getAppPath()
    const exePath = app.getPath("exe")
    const appVersion = app.getVersion()

    // Inject current time
    const now = new Date()
    const currentTime = now.toISOString()

    let intro = `# About This Software
You are running **Hóng** — an internal Cowork AI tool for HongShan (HSG), built on Claude Code Agent.

- **Version**: v${appVersion}
- **App Path**: ${appPath}
- **Executable**: ${exePath}
- **Current Time**: ${currentTime}

Hóng is a local-first desktop application for AI-powered code assistance and collaboration.`

    if (cwd) {
      intro += `\n\nThe current working directory is \`${cwd}\`. By default, any generated files should be placed in this directory unless otherwise specified.\n\n**File Write Security Policy**: You MUST only create or write files within the current working directory (\`${cwd}\`) and its subdirectories. Writing to any path outside this directory is strictly prohibited unless the user has explicitly granted permission for a specific external path in the current conversation. If a task requires writing outside the working directory, ask the user for explicit confirmation before proceeding.`
    }

    return intro
  }

  /**
   * Build the user profile section
   */
  private buildUserProfileSection(userProfile?: UserProfile): string {
    if (!userProfile) {
      return ""
    }

    const profileParts: string[] = []
    if (userProfile.preferredName?.trim()) {
      profileParts.push(`- Preferred name: ${userProfile.preferredName.trim()}`)
    }
    if (userProfile.personalPreferences?.trim()) {
      profileParts.push(`- Personal preferences: ${userProfile.personalPreferences.trim()}`)
    }

    if (profileParts.length === 0) {
      return ""
    }

    return `# User Profile
The following describes the user you are assisting:
${profileParts.join("\n")}

Please use the user's preferred name naturally and warmly in your responses to create a friendly, personalized experience.`
  }

  /**
   * Build the runtime environment section
   */
  private async buildRuntimeSection(): Promise<string> {
    if (!this.runtimeEnvProvider) {
      return ""
    }

    try {
      const runtimeEnv = await this.runtimeEnvProvider()
      if (runtimeEnv.tools.length === 0) {
        return ""
      }

      const toolsList = runtimeEnv.tools
        .map((t) => `- ${t.category}: ${t.name}${t.version ? ` (${t.version})` : ""}`)
        .join("\n")

      return `# Runtime Environment
The following tools are available on this system. Prefer using these when applicable:
${toolsList}`
    } catch (e) {
      promptBuilderLog.warn("Failed to get runtime environment:", e)
      return ""
    }
  }

  /**
   * Build the skill awareness section
   */
  private buildSkillAwarenessSection(): string {
    return `# Skill Awareness (Beta)
Before you start planning or executing a task, check if there are any relevant skills available that could help. Skills are specialized capabilities that provide domain-specific knowledge and workflows.

**When to check for skills:**
- When starting a new task or subtask
- When the task involves specific file formats (PDF, DOCX, spreadsheets, etc.)
- When the task requires specialized domain knowledge

**How to use skills:**
- Review the available skills listed in your system prompt under "Available Skills"
- If a skill matches your current task, invoke it using the Skill tool before proceeding
- Skills can provide better results than generic approaches for their specialized domains`
  }

  /**
   * Load AGENTS.md content from project directory
   */
  private async loadAgentsMdContent(cwd: string): Promise<string> {
    const agentsMdPaths = [
      path.join(cwd, "AGENTS.md"),
      path.join(cwd, ".claude", "AGENTS.md"),
    ]

    for (const agentsMdPath of agentsMdPaths) {
      try {
        const content = await fs.readFile(agentsMdPath, "utf-8")
        return content.trim()
      } catch {
        // File not found, try next path
      }
    }

    return ""
  }

  /**
   * Build the AGENTS.md section
   */
  private async buildAgentsMdSection(cwd?: string): Promise<string> {
    if (!cwd) {
      return ""
    }

    const content = await this.loadAgentsMdContent(cwd)
    if (!content) {
      return ""
    }

    return `# AGENTS.md
The following are the project's AGENTS.md instructions:

${content}`
  }

  /**
   * Get default values for a prompt strategy based on type
   */
  private getStrategyDefaults(type: PromptStrategy["type"]): Partial<PromptStrategy> {
    switch (type) {
      case "chat":
        return {
          includeSoftwareIntro: true,
          includeRuntimeInfo: true,
          includeSkillAwareness: true,
          includeAgentsMd: true,
        }
      case "automation":
        return {
          includeSoftwareIntro: true,
          includeRuntimeInfo: false,
          includeSkillAwareness: false,
          includeAgentsMd: false,
        }
      case "insights":
        return {
          includeSoftwareIntro: false,
          includeRuntimeInfo: false,
          includeSkillAwareness: false,
          includeAgentsMd: false,
        }
      case "worker":
        return {
          includeSoftwareIntro: true,
          includeRuntimeInfo: false,
          includeSkillAwareness: true,
          includeAgentsMd: false,
        }
      default:
        return {}
    }
  }

  /**
   * Build system prompt based on strategy
   *
   * @param strategy - Prompt strategy configuration
   * @param cwd - Current working directory (for AGENTS.md loading)
   * @returns SystemPromptConfig for Claude SDK
   */
  async buildSystemPrompt(
    strategy: PromptStrategy,
    cwd?: string
  ): Promise<SystemPromptConfig> {
    // If custom system prompt is provided, use it directly
    if (strategy.customSystemPrompt) {
      return {
        type: "custom",
        content: strategy.customSystemPrompt,
      }
    }

    // Merge strategy with defaults
    const defaults = this.getStrategyDefaults(strategy.type)
    const mergedStrategy = { ...defaults, ...strategy }

    // Build sections based on strategy
    const sections: Record<string, string> = {}

    // Software intro
    if (mergedStrategy.includeSoftwareIntro) {
      sections.softwareIntro = this.buildSoftwareIntroSection(cwd)
    }

    // User profile
    if (mergedStrategy.userProfile) {
      const userProfileSection = this.buildUserProfileSection(mergedStrategy.userProfile)
      if (userProfileSection) {
        sections.userProfile = userProfileSection
      }
    }

    // Runtime info + AGENTS.md — 并行加载（互不依赖）
    const [runtimeSection, agentsMdSection] = await Promise.all([
      mergedStrategy.includeRuntimeInfo ? this.buildRuntimeSection() : Promise.resolve(""),
      mergedStrategy.includeAgentsMd && cwd ? this.buildAgentsMdSection(cwd) : Promise.resolve(""),
    ])
    if (runtimeSection) {
      sections.runtime = runtimeSection
    }
    if (agentsMdSection) {
      sections.agentsMd = agentsMdSection
    }

    // Skill awareness
    if (mergedStrategy.includeSkillAwareness) {
      sections.skillAwareness = this.buildSkillAwarenessSection()
    }

    // Apply replacements
    if (mergedStrategy.replaceSections) {
      for (const [key, value] of Object.entries(mergedStrategy.replaceSections)) {
        if (value === null) {
          // Remove section
          delete sections[key]
        } else {
          // Replace section
          sections[key] = value
        }
      }
    }

    // Build final append content
    const appendParts: string[] = []

    // Prepend sections
    if (mergedStrategy.prependSections) {
      appendParts.push(...mergedStrategy.prependSections)
    }

    // Built-in sections (in order)
    const sectionOrder = ["softwareIntro", "userProfile", "runtime", "skillAwareness", "agentsMd"]
    for (const key of sectionOrder) {
      if (sections[key]) {
        appendParts.push(sections[key])
      }
    }

    // Append sections
    if (mergedStrategy.appendSections) {
      appendParts.push(...mergedStrategy.appendSections)
    }

    // Filter empty parts and join
    const appendContent = appendParts
      .filter((part) => part && part.trim())
      .map((part) => `\n\n${part}`)
      .join("")

    if (appendContent) {
      return {
        type: "preset",
        preset: "claude_code",
        append: appendContent,
      }
    }

    return {
      type: "preset",
      preset: "claude_code",
    }
  }
}

// ============================================================================
// Predefined Strategies
// ============================================================================

/**
 * Chat mode strategy - Full features for interactive chat
 */
export const ChatPromptStrategy: PromptStrategy = {
  type: "chat",
  includeSoftwareIntro: true,
  includeRuntimeInfo: true,
  includeSkillAwareness: true,
  includeAgentsMd: true,
}

/**
 * Automation mode strategy - Focused on task completion
 */
export const AutomationPromptStrategy: PromptStrategy = {
  type: "automation",
  includeSoftwareIntro: true,
  includeRuntimeInfo: false,
  includeSkillAwareness: false,
  includeAgentsMd: false,
  prependSections: [
    `# Automation Mode
You are executing an automated task. Focus on completing the task efficiently and output structured results.
Do not ask clarifying questions - work with the information provided.`,
  ],
}

/**
 * Insights mode strategy - Data analysis and reporting
 */
export const InsightsPromptStrategy: PromptStrategy = {
  type: "insights",
  includeSoftwareIntro: false,
  includeRuntimeInfo: false,
  includeSkillAwareness: false,
  includeAgentsMd: false,
  customSystemPrompt: `You are a data analysis assistant for Hóng, responsible for generating work insights and reports.

Your task is to analyze the provided data and generate clear, actionable insights.

Guidelines:
- Focus on patterns and trends in the data
- Highlight key metrics and changes
- Provide actionable recommendations
- Use clear, professional language
- Format output in markdown for easy reading`,
}

/**
 * Worker mode strategy - Background task processing
 */
export const WorkerPromptStrategy: PromptStrategy = {
  type: "worker",
  includeSoftwareIntro: true,
  includeRuntimeInfo: false,
  includeSkillAwareness: true,
  includeAgentsMd: false,
  prependSections: [
    `# Worker Mode
You are running as a background worker agent. Process the task autonomously and report results.
- Do not ask for user input
- Complete the task to the best of your ability
- Output structured results that can be stored or displayed later`,
  ],
}

// ============================================================================
// Default Instance
// ============================================================================

let defaultBuilder: PromptBuilder | null = null

/**
 * Get the default PromptBuilder instance
 */
export function getPromptBuilder(): PromptBuilder {
  if (!defaultBuilder) {
    defaultBuilder = new PromptBuilder()
  }
  return defaultBuilder
}

/**
 * Initialize the PromptBuilder with runtime environment provider
 * Should be called once at app startup
 *
 * @param runtimeEnvProvider - Function that returns runtime environment info
 */
export function initializePromptBuilder(runtimeEnvProvider: RuntimeEnvProvider): void {
  const builder = getPromptBuilder()
  builder.setRuntimeEnvProvider(runtimeEnvProvider)
}

// Re-export types for external use
export type { RuntimeEnvProvider, RuntimeTool }
