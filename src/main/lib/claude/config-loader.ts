/**
 * ClaudeConfigLoader
 *
 * Unified configuration loader for MCP servers, Skills, and Agents.
 * Supports override mechanism for different scenarios (Chat, Automation, Insights, Workers).
 *
 * Features:
 * - Load global MCP servers from ~/.claude.json
 * - Load project-specific MCP servers
 * - Load builtin MCP server (Hong internal, requires auth)
 * - Load plugin MCP servers
 * - Support include/exclude/add override for all resources
 */

import type { AuthManager } from "../../auth-manager"
import {
  readClaudeConfig,
  readAgentConfig,
  getProjectMcpServers,
  resolveProjectPathFromWorktree,
  type ClaudeConfig,
} from "../claude-config"
import { getBuiltinMcpConfig, BUILTIN_MCP_NAME } from "../builtin-mcp"
import { discoverPluginMcpServers } from "../plugins"
import { getEnabledPlugins, getApprovedPluginMcpServers } from "../trpc/routers/claude-settings"
import { ensureMcpTokensFresh } from "../mcp-auth"
import type {
  ConfigOverride,
  ConfigContext,
  LoadedConfig,
  McpServerWithMeta,
  SkillConfig,
  AgentConfig,
} from "./engine-types"

/**
 * Global scope sentinel for MCP cache keys
 */
const GLOBAL_SCOPE = "__global__"

/**
 * Generate cache key for MCP server working status.
 * Canonical implementation — all consumers should import this.
 *
 * @param scope - projectPath for project-scoped servers, null for global
 * @param serverName - MCP server name
 * @returns Key in format "scope::serverName"
 */
export function mcpCacheKey(scope: string | null, serverName: string): string {
  return `${scope ?? GLOBAL_SCOPE}::${serverName}`
}

/**
 * Cache for MCP server working status
 * Key: scope::serverName, Value: boolean (true = working)
 * This is the SINGLE SOURCE OF TRUTH for working status.
 * Populated by claude.ts getAllMcpConfig and fetchMcpToolsForProject.
 */
export const workingMcpServers = new Map<string, boolean>()

/**
 * ClaudeConfigLoader - Unified configuration loader
 */
export class ClaudeConfigLoader {
  private claudeConfigCache: { config: ClaudeConfig; timestamp: number } | null = null
  private readonly CACHE_TTL_MS = 5000 // 5 seconds cache for claude config

  /**
   * Read ~/.claude.json with caching
   */
  private async getClaudeConfig(): Promise<ClaudeConfig> {
    const now = Date.now()
    if (this.claudeConfigCache && now - this.claudeConfigCache.timestamp < this.CACHE_TTL_MS) {
      return this.claudeConfigCache.config
    }
    const config = await readClaudeConfig()
    this.claudeConfigCache = { config, timestamp: now }
    return config
  }

  /**
   * Clear config cache (useful after config modifications)
   */
  clearCache(): void {
    this.claudeConfigCache = null
  }

  /**
   * Load global MCP servers from ~/.claude.json (user scope)
   */
  async loadGlobalMcpServers(): Promise<Record<string, McpServerWithMeta>> {
    const config = await this.getClaudeConfig()
    return (config.mcpServers || {}) as Record<string, McpServerWithMeta>
  }

  /**
   * Load project-specific MCP servers from ~/.claude.json
   * Automatically resolves worktree paths to original project paths
   */
  async loadProjectMcpServers(cwd: string): Promise<Record<string, McpServerWithMeta>> {
    const config = await this.getClaudeConfig()
    const servers = getProjectMcpServers(config, cwd)
    return (servers || {}) as Record<string, McpServerWithMeta>
  }

  /**
   * Load builtin MCP server (Hong internal)
   * Requires authentication via AuthManager
   */
  async loadBuiltinMcpServer(authManager: AuthManager): Promise<McpServerWithMeta | null> {
    const builtinConfig = await getBuiltinMcpConfig(authManager)
    if (!builtinConfig) {
      return null
    }
    return {
      ...builtinConfig,
      _builtin: true,
    } as McpServerWithMeta
  }

  /**
   * Load plugin MCP servers from ~/.claude/plugins/
   * Only loads enabled and approved plugins
   */
  async loadPluginMcpServers(): Promise<Record<string, McpServerWithMeta>> {
    const [pluginConfigs, enabledPlugins, approvedMcpServers] = await Promise.all([
      discoverPluginMcpServers(),
      getEnabledPlugins(),
      getApprovedPluginMcpServers(),
    ])

    const result: Record<string, McpServerWithMeta> = {}

    for (const config of pluginConfigs) {
      // Check if plugin is enabled
      if (!enabledPlugins.includes(config.pluginSource)) {
        continue
      }

      for (const [serverName, serverConfig] of Object.entries(config.mcpServers)) {
        // Check if MCP server is approved
        const approvalKey = `${config.pluginSource}:${serverName}`
        if (!approvedMcpServers.includes(approvalKey)) {
          continue
        }

        result[serverName] = {
          ...serverConfig,
          _plugin: true,
          _pluginSource: config.pluginSource,
        } as McpServerWithMeta
      }
    }

    return result
  }

  /**
   * Load MCP servers from ~/.agent.json
   */
  async loadAgentJsonMcpServers(): Promise<Record<string, McpServerWithMeta>> {
    const config = await readAgentConfig()
    if (!config.mcpServers) return {}
    const result: Record<string, McpServerWithMeta> = {}
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      result[name] = { ...serverConfig, _source: "agent-json" } as McpServerWithMeta
    }
    return result
  }

  /**
   * Load all skills from project and user directories
   * Note: Actual skill loading is handled by Claude SDK via settingSources option
   * This method is for discovery/override purposes
   */
  async loadSkills(_cwd?: string): Promise<SkillConfig[]> {
    // Skills are loaded by SDK via settingSources: ["project", "user"]
    // This method returns empty for now - SDK handles actual loading
    // Future: Could scan directories for override filtering
    return []
  }

  /**
   * Load all agents from project and user directories
   * Note: Agents are discovered via buildAgentsOption in agent-utils.ts
   * This method is for override purposes
   */
  async loadAgents(_cwd?: string): Promise<Record<string, AgentConfig>> {
    // Agents are loaded by buildAgentsOption in agent-utils.ts
    // This method returns empty for now - actual loading happens at query time
    // Future: Could scan directories for override filtering
    return {}
  }

  /**
   * Apply override to a Record of servers/agents
   */
  private applyRecordOverride<T>(
    items: Record<string, T>,
    override?: { include?: string[]; exclude?: string[]; add?: Record<string, T> }
  ): Record<string, T> {
    if (!override) {
      return items
    }

    let result = { ...items }

    // Apply include filter (whitelist)
    if (override.include && override.include.length > 0) {
      const includeSet = new Set(override.include)
      result = Object.fromEntries(
        Object.entries(result).filter(([key]) => includeSet.has(key))
      )
    }

    // Apply exclude filter (blacklist)
    if (override.exclude && override.exclude.length > 0) {
      const excludeSet = new Set(override.exclude)
      result = Object.fromEntries(
        Object.entries(result).filter(([key]) => !excludeSet.has(key))
      )
    }

    // Apply additions
    if (override.add) {
      result = { ...result, ...override.add }
    }

    return result
  }

  /**
   * Apply override to skills array
   */
  private applySkillsOverride(
    skills: SkillConfig[],
    override?: { include?: string[]; exclude?: string[]; add?: string[] }
  ): SkillConfig[] {
    if (!override) {
      return skills
    }

    let result = [...skills]

    // Apply include filter (whitelist)
    if (override.include && override.include.length > 0) {
      const includeSet = new Set(override.include)
      result = result.filter((s) => includeSet.has(s.name))
    }

    // Apply exclude filter (blacklist)
    if (override.exclude && override.exclude.length > 0) {
      const excludeSet = new Set(override.exclude)
      result = result.filter((s) => !excludeSet.has(s.name))
    }

    // Apply additions (paths -> SkillConfig)
    if (override.add && override.add.length > 0) {
      for (const path of override.add) {
        result.push({
          name: path.split("/").pop() || path,
          path,
          source: "user" as const,
        })
      }
    }

    return result
  }

  /**
   * Filter MCP servers to only include working ones
   * Uses the cached workingMcpServers map updated by getAllMcpConfig
   *
   * @param servers - MCP servers to filter
   * @param projectServers - Project-specific servers (for scope determination)
   * @param projectPath - Project path for scope resolution
   */
  private filterWorkingServers(
    servers: Record<string, McpServerWithMeta>,
    projectServers: Record<string, McpServerWithMeta>,
    projectPath: string
  ): Record<string, McpServerWithMeta> {
    if (workingMcpServers.size === 0) {
      // Cache not populated yet - return all servers
      return servers
    }

    // Resolve worktree path to original project path to match cache keys
    const resolvedProjectPath = resolveProjectPathFromWorktree(projectPath) || projectPath

    const filtered: Record<string, McpServerWithMeta> = {}
    for (const [name, config] of Object.entries(servers)) {
      // Use resolved project scope if server is from project, otherwise global
      const scope = name in projectServers ? resolvedProjectPath : null
      const cacheKey = mcpCacheKey(scope, name)

      // Include server if it's marked working, or if it's not in cache at all
      // (new servers or plugin servers might not be cached yet)
      if (workingMcpServers.get(cacheKey) === true || !workingMcpServers.has(cacheKey)) {
        filtered[name] = config
      }
    }

    const skipped = Object.keys(servers).length - Object.keys(filtered).length
    if (skipped > 0) {
      console.log(`[ClaudeConfigLoader] Filtered out ${skipped} non-working MCP(s)`)
    }

    return filtered
  }

  /**
   * Filter out user-disabled MCP servers
   *
   * @param servers - MCP servers to filter
   * @param disabledServers - List of server names to exclude
   */
  filterDisabledServers(
    servers: Record<string, McpServerWithMeta>,
    disabledServers?: string[]
  ): Record<string, McpServerWithMeta> {
    if (!disabledServers || disabledServers.length === 0) {
      return servers
    }

    const disabledSet = new Set(disabledServers)
    const filtered = Object.fromEntries(
      Object.entries(servers).filter(([name]) => !disabledSet.has(name))
    )

    const skipped = Object.keys(servers).length - Object.keys(filtered).length
    if (skipped > 0) {
      console.log(
        `[ClaudeConfigLoader] Disabled ${skipped} MCP server(s) by user preference: ${disabledServers.join(", ")}`
      )
    }

    return filtered
  }

  /**
   * Get unified configuration with override support
   * This is the main entry point for loading all configuration
   *
   * @param context - Configuration context (cwd, projectPath, etc.)
   * @param authManager - Optional auth manager for builtin MCP
   * @param override - Optional override configuration
   * @returns Loaded configuration with MCP servers, skills, and agents
   */
  async getConfig(
    context: ConfigContext,
    authManager?: AuthManager,
    override?: ConfigOverride
  ): Promise<LoadedConfig> {
    // Load all MCP servers in parallel
    const [globalServers, projectServers, pluginServers, agentJsonServers, builtinServer] = await Promise.all([
      this.loadGlobalMcpServers(),
      this.loadProjectMcpServers(context.cwd),
      context.includePlugins !== false ? this.loadPluginMcpServers() : Promise.resolve({}),
      this.loadAgentJsonMcpServers(),
      context.includeBuiltin !== false && authManager
        ? this.loadBuiltinMcpServer(authManager)
        : Promise.resolve(null),
    ])

    // Merge MCP servers with priority: builtin < plugins < agent.json < global < project
    let mcpServers: Record<string, McpServerWithMeta> = {}

    // 1. Builtin (lowest priority)
    if (builtinServer) {
      mcpServers[BUILTIN_MCP_NAME] = builtinServer
    }

    // 2. Plugin servers
    mcpServers = { ...mcpServers, ...pluginServers }

    // 3. Agent.json servers
    mcpServers = { ...mcpServers, ...agentJsonServers }

    // 4. Global servers
    mcpServers = { ...mcpServers, ...globalServers }

    // 5. Project servers (highest priority)
    mcpServers = { ...mcpServers, ...projectServers }

    // Apply override
    mcpServers = this.applyRecordOverride(mcpServers, override?.mcpServers)

    // Filter to only working MCPs if cache is available
    if (context.filterNonWorking !== false) {
      mcpServers = this.filterWorkingServers(mcpServers, projectServers, context.cwd)
    }

    // Filter user-disabled servers
    if (context.disabledMcpServers) {
      mcpServers = this.filterDisabledServers(mcpServers, context.disabledMcpServers)
    }

    // Load skills and agents
    const [skills, agents] = await Promise.all([
      this.loadSkills(context.cwd),
      this.loadAgents(context.cwd),
    ])

    // Apply overrides
    const filteredSkills = this.applySkillsOverride(skills, override?.skills)
    const filteredAgents = this.applyRecordOverride(agents, override?.agents)

    return {
      mcpServers,
      skills: filteredSkills,
      agents: filteredAgents,
    }
  }

  /**
   * Get configuration with MCP tokens refreshed
   * Call this before passing MCP servers to SDK to ensure tokens are valid
   *
   * @param context - Configuration context
   * @param authManager - Auth manager for builtin MCP
   * @param override - Optional override configuration
   * @returns Configuration with refreshed MCP tokens
   */
  async getConfigWithFreshTokens(
    context: ConfigContext,
    authManager?: AuthManager,
    override?: ConfigOverride
  ): Promise<LoadedConfig> {
    const config = await this.getConfig(context, authManager, override)

    // Refresh MCP tokens if there are any servers
    if (Object.keys(config.mcpServers).length > 0) {
      const lookupPath = context.projectPath || context.cwd
      config.mcpServers = (await ensureMcpTokensFresh(
        config.mcpServers,
        lookupPath
      )) as Record<string, McpServerWithMeta>
    }

    return config
  }
}

/**
 * Default singleton instance
 */
let defaultLoader: ClaudeConfigLoader | null = null

/**
 * Get the default ClaudeConfigLoader instance
 */
export function getConfigLoader(): ClaudeConfigLoader {
  if (!defaultLoader) {
    defaultLoader = new ClaudeConfigLoader()
  }
  return defaultLoader
}

/**
 * Clear the default loader's cache
 */
export function clearConfigCache(): void {
  defaultLoader?.clearCache()
}
