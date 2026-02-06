/**
 * Claude Engine Types
 *
 * Shared types for the composable Claude Engine architecture.
 * These types enable different scenarios (Chat, Automation, Insights, Workers)
 * to configure and use the Claude Agent SDK with customized settings.
 */

import type { AuthManager } from "../../auth-manager"

// Re-export existing types
export type { McpServerConfig, ClaudeConfig, ProjectConfig } from "../claude-config"

/**
 * MCP server configuration with additional metadata
 */
export interface McpServerWithMeta {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  type?: "http" | "sse" | "stdio"
  authType?: "oauth" | "bearer" | "none"
  headers?: Record<string, string>
  _oauth?: {
    accessToken: string
    refreshToken?: string
    clientId?: string
    expiresAt?: number
  }
  // Metadata for tracking source
  _builtin?: boolean
  _plugin?: boolean
  _pluginSource?: string
  [key: string]: unknown
}

/**
 * Skill configuration
 */
export interface SkillConfig {
  name: string
  path: string
  description?: string
  source: "project" | "user" | "plugin"
}

/**
 * Agent configuration (from .claude/agents/ or plugins)
 */
export interface AgentConfig {
  name: string
  description?: string
  prompt?: string
  model?: string
  tools?: string[]
  path?: string
  source?: "project" | "user" | "plugin"
}

/**
 * Override configuration for MCP/Skills/Agents
 * Allows scenarios to customize which resources are loaded
 */
export interface ConfigOverride {
  /**
   * MCP server filtering and additions
   */
  mcpServers?: {
    /** Only load these MCP servers (whitelist) */
    include?: string[]
    /** Exclude these MCP servers (blacklist) */
    exclude?: string[]
    /** Add additional MCP servers */
    add?: Record<string, McpServerWithMeta>
  }

  /**
   * Skill filtering and additions
   */
  skills?: {
    /** Only load these skills (whitelist) */
    include?: string[]
    /** Exclude these skills (blacklist) */
    exclude?: string[]
    /** Add additional skill paths */
    add?: string[]
  }

  /**
   * Agent filtering and additions
   */
  agents?: {
    /** Only load these agents (whitelist) */
    include?: string[]
    /** Exclude these agents (blacklist) */
    exclude?: string[]
    /** Add additional agents */
    add?: Record<string, AgentConfig>
  }
}

/**
 * Context for configuration loading
 */
export interface ConfigContext {
  /** Current working directory */
  cwd: string
  /** Project path (may differ from cwd for worktrees) */
  projectPath?: string
  /** Whether to include builtin MCP (requires auth) */
  includeBuiltin?: boolean
  /** Whether to include plugin MCPs */
  includePlugins?: boolean
  /** Whether to filter out non-working MCP servers (default: true) */
  filterNonWorking?: boolean
  /** User-disabled MCP server names to exclude */
  disabledMcpServers?: string[]
}

/**
 * Loaded configuration result
 */
export interface LoadedConfig {
  mcpServers: Record<string, McpServerWithMeta>
  skills: SkillConfig[]
  agents: Record<string, AgentConfig>
}

/**
 * User profile for system prompt personalization
 */
export interface UserProfile {
  preferredName?: string
  personalPreferences?: string
}

/**
 * Prompt strategy for different scenarios
 * Controls which sections are included in the system prompt
 */
export interface PromptStrategy {
  /** Scenario type */
  type: "chat" | "automation" | "insights" | "worker"

  // Built-in section toggles (defaults are scenario-dependent)
  /** Include Hong software introduction (default: true for chat) */
  includeSoftwareIntro?: boolean
  /** Include runtime environment info (default: true for chat) */
  includeRuntimeInfo?: boolean
  /** Include skill awareness prompt (default: true for chat) */
  includeSkillAwareness?: boolean
  /** Include AGENTS.md content (default: true for chat) */
  includeAgentsMd?: boolean

  /** User profile for personalization */
  userProfile?: UserProfile

  // Custom section injection
  /** Sections to prepend before built-in sections */
  prependSections?: string[]
  /** Sections to append after built-in sections */
  appendSections?: string[]
  /** Replace specific sections (key: section name, value: new content or null to remove) */
  replaceSections?: Record<string, string | null>

  /** Completely override system prompt (skips all built-in logic) */
  customSystemPrompt?: string
}

/**
 * System prompt configuration for Claude SDK
 */
export interface SystemPromptConfig {
  type: "preset" | "custom"
  preset?: "claude_code"
  append?: string
  content?: string
}

/**
 * Tool permission decision
 */
export interface ToolPermissionDecision {
  behavior: "allow" | "deny"
  updatedInput?: Record<string, unknown>
  message?: string
}

/**
 * Context for tool permission checking
 */
export interface ToolContext {
  /** Current mode (plan or agent) */
  mode: "plan" | "agent"
  /** Whether running in playground (chat mode) */
  isPlayground: boolean
  /** Whether using Ollama (local model) */
  isOllama: boolean
  /** Current working directory */
  cwd: string
  /** Tool use ID */
  toolUseId: string
}

/**
 * Tool permission policy interface
 * Implement this to create custom permission checking logic
 */
export interface ToolPermissionPolicy {
  /**
   * Check if a tool can be used
   * @param toolName - Name of the tool being invoked
   * @param toolInput - Input parameters for the tool
   * @param context - Execution context
   * @returns Permission decision
   */
  canUseTool(
    toolName: string,
    toolInput: Record<string, unknown>,
    context: ToolContext
  ): ToolPermissionDecision | Promise<ToolPermissionDecision>
}

/**
 * Output channel interface for receiving Claude events
 * Implement this to customize where Claude output goes
 */
export interface OutputChannel {
  /** Called for each message chunk */
  onMessage(chunk: unknown): void
  /** Called when a tool is invoked */
  onToolCall?(toolName: string, input: unknown, output: unknown): void
  /** Called on error */
  onError?(error: Error): void
  /** Called when session completes */
  onComplete?(result: { sessionId?: string; stats?: unknown }): void
}

/**
 * Engine request for running Claude
 */
export interface EngineRequest {
  /** User prompt or message */
  prompt: string | AsyncIterable<unknown>
  /** Prompt strategy for system prompt configuration */
  promptStrategy: PromptStrategy
  /** Configuration context */
  context: ConfigContext
  /** Configuration override */
  configOverride?: ConfigOverride
  /** Tool permission policy */
  policy?: ToolPermissionPolicy
  /** Output channel */
  outputChannel?: OutputChannel
  /** Auth manager for builtin MCP */
  authManager?: AuthManager
  /** Session ID for resume */
  sessionId?: string
  /** Model to use */
  model?: string
  /** Mode (plan or agent) */
  mode?: "plan" | "agent"
  /** Custom agents configuration (from .claude/agents/ or plugins) */
  agents?: Record<string, AgentConfig>
}

/**
 * Engine event types
 */
export type EngineEvent =
  | { type: "message"; chunk: unknown }
  | { type: "tool-start"; toolName: string; input: unknown }
  | { type: "tool-end"; toolName: string; output: unknown }
  | { type: "error"; error: Error }
  | { type: "complete"; sessionId?: string; stats?: unknown }
