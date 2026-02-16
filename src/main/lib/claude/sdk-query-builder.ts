/**
 * SdkQueryBuilder
 *
 * Builder pattern for constructing Claude Agent SDK query options.
 * Provides a fluent API for configuring all aspects of a Claude query.
 *
 * Features:
 * - Fluent builder API
 * - Type-safe option construction
 * - Support for all SDK options (prompt, system prompt, MCP, agents, etc.)
 * - Validation before build
 */

import type {
  SDKUserMessage,
  Options as SdkOptions,
  McpServerConfig,
  PermissionResult,
  CanUseTool,
  SettingSource,
} from "@anthropic-ai/claude-agent-sdk"
import type {
  SystemPromptConfig,
  McpServerWithMeta,
  AgentConfig,
  ToolPermissionPolicy,
  ToolContext,
} from "./engine-types"

/**
 * SDK query parameters — directly matches `query()` function signature
 */
export type SdkQueryParams = {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: SdkOptions
}

/**
 * @deprecated Use SdkQueryParams instead. Kept for backward compatibility.
 */
export type SdkQueryOptions = SdkQueryParams

/**
 * SdkQueryBuilder - Fluent builder for SDK query options
 */
export class SdkQueryBuilder {
  private _prompt: string | AsyncIterable<SDKUserMessage> = ""
  private _systemPrompt?: SystemPromptConfig
  private _mcpServers?: Record<string, McpServerWithMeta>
  private _agents?: Record<string, AgentConfig>
  private _cwd?: string
  private _env?: Record<string, string>
  private _mode: "plan" | "agent" = "agent"
  private _abortController?: AbortController
  private _toolPermissionPolicy?: ToolPermissionPolicy
  private _stderrHandler?: (data: string) => void
  private _claudeBinaryPath?: string
  private _sessionId?: string
  private _resumeAtUuid?: string
  private _model?: string
  private _maxThinkingTokens?: number
  private _includeSkills = true
  private _isOllama = false
  private _isPlayground = false

  /**
   * Set the user prompt
   */
  setPrompt(prompt: string | AsyncIterable<SDKUserMessage>): this {
    this._prompt = prompt
    return this
  }

  /**
   * Set the system prompt configuration
   */
  setSystemPrompt(config: SystemPromptConfig): this {
    this._systemPrompt = config
    return this
  }

  /**
   * Set MCP servers
   */
  setMcpServers(servers: Record<string, McpServerWithMeta>): this {
    this._mcpServers = servers
    return this
  }

  /**
   * Set agents
   */
  setAgents(agents: Record<string, AgentConfig>): this {
    this._agents = agents
    return this
  }

  /**
   * Set current working directory
   */
  setCwd(cwd: string): this {
    this._cwd = cwd
    return this
  }

  /**
   * Set environment variables
   */
  setEnv(env: Record<string, string>): this {
    this._env = env
    return this
  }

  /**
   * Set the mode (plan or agent)
   */
  setMode(mode: "plan" | "agent"): this {
    this._mode = mode
    return this
  }

  /**
   * Set abort controller for cancellation
   */
  setAbortController(controller: AbortController): this {
    this._abortController = controller
    return this
  }

  /**
   * Set tool permission policy
   */
  setToolPermissionPolicy(policy: ToolPermissionPolicy): this {
    this._toolPermissionPolicy = policy
    return this
  }

  /**
   * Set stderr handler
   */
  setStderrHandler(handler: (data: string) => void): this {
    this._stderrHandler = handler
    return this
  }

  /**
   * Set path to Claude binary
   */
  setClaudeBinaryPath(path: string): this {
    this._claudeBinaryPath = path
    return this
  }

  /**
   * Set session ID for resume
   */
  setSessionId(sessionId: string): this {
    this._sessionId = sessionId
    return this
  }

  /**
   * Set resume at UUID for rollback
   */
  setResumeAtUuid(uuid: string): this {
    this._resumeAtUuid = uuid
    return this
  }

  /**
   * Set the model to use
   */
  setModel(model: string): this {
    this._model = model
    return this
  }

  /**
   * Set max thinking tokens (for extended thinking)
   */
  setMaxThinkingTokens(tokens: number): this {
    this._maxThinkingTokens = tokens
    return this
  }

  /**
   * Set whether to include skills (disabled for Ollama)
   */
  setIncludeSkills(include: boolean): this {
    this._includeSkills = include
    return this
  }

  /**
   * Set whether using Ollama (for special handling)
   */
  setIsOllama(isOllama: boolean): this {
    this._isOllama = isOllama
    return this
  }

  /**
   * Set whether running in playground mode
   */
  setIsPlayground(isPlayground: boolean): this {
    this._isPlayground = isPlayground
    return this
  }

  /**
   * Create the canUseTool callback adapting ToolPermissionPolicy to SDK's CanUseTool
   */
  private createCanUseToolCallback(): CanUseTool | undefined {
    if (!this._toolPermissionPolicy) {
      return undefined
    }

    const policy = this._toolPermissionPolicy
    const isOllama = this._isOllama
    const isPlayground = this._isPlayground
    const mode = this._mode
    const cwd = this._cwd || ""

    return async (
      toolName: string,
      toolInput: Record<string, unknown>,
      options: { signal: AbortSignal; toolUseID: string }
    ): Promise<PermissionResult> => {
      const context: ToolContext = {
        mode,
        isPlayground,
        isOllama,
        cwd,
        toolUseId: options.toolUseID,
      }

      const decision = await policy.canUseTool(toolName, toolInput, context)

      // Adapt ToolPermissionDecision → SDK PermissionResult (discriminated union)
      if (decision.behavior === "allow") {
        return {
          behavior: "allow",
          updatedInput: decision.updatedInput,
        }
      }
      return {
        behavior: "deny",
        message: decision.message || "Permission denied by policy",
      }
    }
  }

  /**
   * Build the SDK query options — returns type directly compatible with `query()`
   */
  build(): SdkQueryParams {
    const options: SdkOptions = {
      cwd: this._cwd,
      includePartialMessages: true,
    }

    // Abort controller
    if (this._abortController) {
      options.abortController = this._abortController
    }

    // System prompt
    if (this._systemPrompt) {
      options.systemPrompt = this._systemPrompt as SdkOptions["systemPrompt"]
    }

    // Agents (skip for Ollama)
    // AgentConfig → AgentDefinition: SDK accepts superset fields at runtime
    if (this._agents && Object.keys(this._agents).length > 0 && !this._isOllama) {
      options.agents = this._agents as SdkOptions["agents"]
    }

    // MCP servers
    // McpServerWithMeta → McpServerConfig: extra metadata fields are ignored by SDK at runtime
    // Sanitize server name keys for cross-provider compatibility (hyphens → underscores)
    if (this._mcpServers && Object.keys(this._mcpServers).length > 0) {
      options.mcpServers = sanitizeMcpServerNames(this._mcpServers) as Record<string, McpServerConfig>
    }

    // Environment
    if (this._env) {
      options.env = this._env
    }

    // Permission mode
    if (this._mode === "plan") {
      options.permissionMode = "plan"
    } else {
      options.permissionMode = "bypassPermissions"
      options.allowDangerouslySkipPermissions = true
    }

    // Skills (skip for Ollama)
    if (this._includeSkills && !this._isOllama) {
      options.settingSources = ["project", "user"] as SettingSource[]
    }

    // Tool permission callback
    const canUseTool = this.createCanUseToolCallback()
    if (canUseTool) {
      options.canUseTool = canUseTool
    }

    // Stderr handler
    if (this._stderrHandler) {
      options.stderr = this._stderrHandler
    }

    // Claude binary path
    if (this._claudeBinaryPath) {
      options.pathToClaudeCodeExecutable = this._claudeBinaryPath
    }

    // Session handling
    if (this._sessionId) {
      options.resume = this._sessionId
      if (this._resumeAtUuid && !this._isOllama) {
        options.resumeSessionAt = this._resumeAtUuid
      } else {
        options.continue = true
      }
    } else {
      options.continue = true
    }

    // Model
    if (this._model) {
      options.model = this._model
    }

    // Max thinking tokens
    if (this._maxThinkingTokens) {
      options.maxThinkingTokens = this._maxThinkingTokens
    }

    return {
      prompt: this._prompt,
      options,
    }
  }

  /**
   * Reset builder to initial state
   */
  reset(): this {
    this._prompt = ""
    this._systemPrompt = undefined
    this._mcpServers = undefined
    this._agents = undefined
    this._cwd = undefined
    this._env = undefined
    this._mode = "agent"
    this._abortController = undefined
    this._toolPermissionPolicy = undefined
    this._stderrHandler = undefined
    this._claudeBinaryPath = undefined
    this._sessionId = undefined
    this._resumeAtUuid = undefined
    this._model = undefined
    this._maxThinkingTokens = undefined
    this._includeSkills = true
    this._isOllama = false
    this._isPlayground = false
    return this
  }
}

// ============================================================================
// Default Instance
// ============================================================================

/**
 * Create a new SdkQueryBuilder instance
 */
export function createQueryBuilder(): SdkQueryBuilder {
  return new SdkQueryBuilder()
}

// ============================================================================
// MCP Server Name Sanitization
// ============================================================================

/**
 * Sanitize MCP server names for cross-provider compatibility.
 *
 * SDK internally prefixes tool names as `mcp__<serverName>__<toolName>`.
 * OpenAI function name pattern only allows `^[a-zA-Z0-9_\\.-]+$`,
 * which means hyphens in server names (e.g. "hong-internal", "time-mcp")
 * will cause 400 errors when requests go through LiteLLM to OpenAI models.
 *
 * This function replaces hyphens with underscores in server name keys
 * so the resulting tool names are compatible with all providers.
 */
export function sanitizeMcpServerNames<T>(
  servers: Record<string, T>,
): Record<string, T> {
  const result: Record<string, T> = {}
  for (const [name, config] of Object.entries(servers)) {
    const sanitized = name.replace(/-/g, "_")
    result[sanitized] = config
  }
  return result
}
