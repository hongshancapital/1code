import { observable } from "@trpc/server/observable"
import { z } from "zod"
import {
  mcpCacheKey,
  workingMcpServers,
} from "../../claude"
import {
  getProjectMcpServers,
  readClaudeConfig,
  updateMcpServerConfig,
  removeMcpServerConfig,
  writeClaudeConfig,
  type McpServerConfig,
  type ProjectConfig,
} from "../../claude-config"
import {
  getServerStatusFromConfig,
  fetchToolsForServer,
  getAllMcpConfigHandler,
} from "../../claude/mcp-config"
import {
  ensureMcpTokensFresh,
  getMcpAuthStatus as getMcpAuthStatusFn,
  startMcpOAuth as startMcpOAuthFn,
} from "../../mcp-auth"
import { fetchOAuthMetadata, getMcpBaseUrl } from "../../oauth"
import {
  discoverInstalledPlugins,
  discoverPluginMcpServers,
} from "../../../feature/plugin-system/lib"
import {
  getEnabledPlugins,
  getApprovedPluginMcpServers,
} from "./claude-settings"
import { publicProcedure, router } from "../index"
import { createLogger } from "../../logger"

const mcpLog = createLogger("MCP")
const getMcpConfigLog = createLogger("getMcpConfig")
const claudeLog = createLogger("claude")

export const mcpRouter = router({
  getMcpConfig: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .query(async ({ input }) => {
      try {
        const config = await readClaudeConfig();
        const globalServers = config.mcpServers || {};
        const projectMcpServers =
          getProjectMcpServers(config, input.projectPath) || {};

        // Merge global + project (project overrides global)
        const merged = { ...globalServers, ...projectMcpServers };

        // Add plugin MCP servers (enabled + approved only)
        const [enabledPluginSources, pluginMcpConfigs, approvedServers] =
          await Promise.all([
            getEnabledPlugins(),
            discoverPluginMcpServers(),
            getApprovedPluginMcpServers(),
          ]);

        for (const pluginConfig of pluginMcpConfigs) {
          if (!enabledPluginSources.includes(pluginConfig.pluginSource))
            continue;
          for (const [name, serverConfig] of Object.entries(
            pluginConfig.mcpServers,
          )) {
            if (!merged[name]) {
              const identifier = `${pluginConfig.pluginSource}:${name}`;
              if (approvedServers.includes(identifier)) {
                merged[name] = serverConfig;
              }
            }
          }
        }

        // Convert to array format - determine status from config (no caching)
        const mcpServers = Object.entries(merged).map(
          ([name, serverConfig]) => {
            const configObj = serverConfig as Record<string, unknown>;
            const status = getServerStatusFromConfig(configObj);
            const hasUrl = !!configObj.url;

            return {
              name,
              status,
              config: { ...configObj, _hasUrl: hasUrl },
            };
          },
        );

        return { mcpServers, projectPath: input.projectPath };
      } catch (error) {
        getMcpConfigLog.error("Error reading config:", error);
        return {
          mcpServers: [],
          projectPath: input.projectPath,
          error: String(error),
        };
      }
    }),

  /**
   * Get ALL MCP servers configuration (global + all projects)
   * Returns grouped data for display in settings
   * Also populates the workingMcpServers cache
   */
  getAllMcpConfig: publicProcedure.query(getAllMcpConfigHandler),

  /**
   * Retry connection to a specific MCP server
   * Returns updated status and tools for that server
   */
  retryMcpServer: publicProcedure
    .input(
      z.object({
        serverName: z.string(),
        groupName: z.string(), // "Global", project name, or "Plugin: xxx"
      }),
    )
    .mutation(async ({ input }) => {
      const { serverName, groupName } = input;
      claudeLog.info(
        `[MCP] Retrying connection to ${serverName} in group ${groupName}`,
      );

      try {
        // Re-fetch all config to find this server
        const config = await readClaudeConfig();

        let serverConfig: McpServerConfig | undefined;
        let scope: string | null = null;

        // Find the server in the appropriate group
        if (groupName === "Global") {
          serverConfig = config.mcpServers?.[serverName];
          scope = null;
        } else if (groupName.startsWith("Plugin:")) {
          // Plugin MCP servers - need to look in plugin configs
          const _plugins = await discoverInstalledPlugins();
          const pluginConfigs = await discoverPluginMcpServers();

          for (const pluginMcp of pluginConfigs) {
            if (pluginMcp.mcpServers[serverName]) {
              serverConfig = pluginMcp.mcpServers[serverName];
              scope = `plugin:${pluginMcp.pluginSource}`;
              break;
            }
          }
        } else {
          // Project-specific server — groupName 是项目路径
          // 先从 projects 中查找，找不到再 fallback 到 global
          const projectConfig = config.projects?.[groupName];
          if (projectConfig?.mcpServers?.[serverName]) {
            serverConfig = projectConfig.mcpServers[serverName];
            scope = groupName;
          } else {
            // fallback: 可能 groupName 是显示名而非完整路径，尝试遍历
            for (const [projectPath, pConfig] of Object.entries(config.projects ?? {})) {
              const pc = pConfig as ProjectConfig;
              if (pc?.mcpServers?.[serverName]) {
                serverConfig = pc.mcpServers[serverName];
                scope = projectPath;
                break;
              }
            }
            // 最终 fallback 到 global
            if (!serverConfig) {
              serverConfig = config.mcpServers?.[serverName];
              scope = null;
            }
          }
        }

        if (!serverConfig) {
          return {
            success: false,
            error: `Server ${serverName} not found in ${groupName}`,
            status: "failed" as const,
            tools: [],
          };
        }

        // Try to connect and fetch tools
        const tools = await fetchToolsForServer(serverConfig);

        // Update cache
        const cacheKey = mcpCacheKey(scope, serverName);

        if (tools.length > 0) {
          workingMcpServers.set(cacheKey, true);
          claudeLog.info(
            `[MCP] Successfully connected to ${serverName}: ${tools.length} tools`,
          );
          return {
            success: true,
            status: "connected" as const,
            tools,
          };
        }

        // No tools - check if needs auth
        workingMcpServers.set(cacheKey, false);
        let needsAuth = false;

        if (serverConfig.url) {
          try {
            const baseUrl = getMcpBaseUrl(serverConfig.url);
            const metadata = await fetchOAuthMetadata(baseUrl);
            needsAuth = !!metadata && !!metadata.authorization_endpoint;
          } catch {
            // If probe fails, assume no auth needed
          }
        }

        const status = needsAuth ? "needs-auth" : "failed";
        claudeLog.info(
          `[MCP] Failed to connect to ${serverName}: status=${status}`,
        );

        return {
          success: false,
          status,
          tools: [],
          needsAuth,
          error: needsAuth ? "Authentication required" : "Connection failed",
        };
      } catch (error) {
        mcpLog.error(`Error retrying ${serverName}:`, error);
        return {
          success: false,
          status: "failed" as const,
          tools: [],
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  /**
   * Start MCP OAuth flow for a server
   * Fetches OAuth metadata internally when needed
   */
  startMcpOAuth: publicProcedure
    .input(
      z.object({
        serverName: z.string(),
        projectPath: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      return startMcpOAuthFn(input.serverName, input.projectPath);
    }),

  /**
   * Get MCP auth status for a server
   */
  getMcpAuthStatus: publicProcedure
    .input(
      z.object({
        serverName: z.string(),
        projectPath: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return getMcpAuthStatusFn(input.serverName, input.projectPath);
    }),

  addMcpServer: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            "Name must contain only letters, numbers, underscores, and hyphens",
          ),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
        transport: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().url().optional(),
        authType: z.enum(["none", "oauth", "bearer"]).optional(),
        bearerToken: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const serverName = input.name.trim();

      if (input.transport === "stdio" && !input.command?.trim()) {
        throw new Error("Command is required for stdio servers");
      }
      if (input.transport === "http" && !input.url?.trim()) {
        throw new Error("URL is required for HTTP servers");
      }
      if (input.scope === "project" && !input.projectPath) {
        throw new Error("Project path required for project-scoped servers");
      }

      const serverConfig: McpServerConfig = {};
      if (input.transport === "stdio") {
        serverConfig.command = input.command!.trim();
        if (input.args && input.args.length > 0) {
          serverConfig.args = input.args;
        }
        if (input.env && Object.keys(input.env).length > 0) {
          serverConfig.env = input.env;
        }
      } else {
        serverConfig.url = input.url!.trim();
        if (input.authType) {
          serverConfig.authType = input.authType;
        }
        if (input.bearerToken) {
          serverConfig.headers = {
            Authorization: `Bearer ${input.bearerToken}`,
          };
        }
      }

      // Check existence before writing
      const existingConfig = await readClaudeConfig();
      const projectPath = input.projectPath;
      if (input.scope === "project" && projectPath) {
        if (existingConfig.projects?.[projectPath]?.mcpServers?.[serverName]) {
          throw new Error(
            `Server "${serverName}" already exists in this project`,
          );
        }
      } else {
        if (existingConfig.mcpServers?.[serverName]) {
          throw new Error(`Server "${serverName}" already exists`);
        }
      }

      const config = updateMcpServerConfig(
        existingConfig,
        input.scope === "project" ? (projectPath ?? null) : null,
        serverName,
        serverConfig,
      );
      await writeClaudeConfig(config);

      return { success: true, name: serverName };
    }),

  updateMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
        newName: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .optional(),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        env: z.record(z.string(), z.string()).optional(),
        url: z.string().url().optional(),
        authType: z.enum(["none", "oauth", "bearer"]).optional(),
        bearerToken: z.string().optional(),
        disabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const config = await readClaudeConfig();
      const projectPath =
        input.scope === "project" ? input.projectPath : undefined;

      // Check server exists
      let servers: Record<string, McpServerConfig> | undefined;
      if (projectPath) {
        servers = config.projects?.[projectPath]?.mcpServers;
      } else {
        servers = config.mcpServers;
      }
      if (!servers?.[input.name]) {
        throw new Error(`Server "${input.name}" not found`);
      }

      const existing = servers[input.name];

      // Handle rename: create new, remove old
      if (input.newName && input.newName !== input.name) {
        if (servers[input.newName]) {
          throw new Error(`Server "${input.newName}" already exists`);
        }
        const updated = removeMcpServerConfig(
          config,
          projectPath ?? null,
          input.name,
        );
        const finalConfig = updateMcpServerConfig(
          updated,
          projectPath ?? null,
          input.newName,
          existing,
        );
        await writeClaudeConfig(finalConfig);
        return { success: true, name: input.newName };
      }

      // Build update object from provided fields
      const update: Partial<McpServerConfig> = {};
      if (input.command !== undefined) update.command = input.command;
      if (input.args !== undefined) update.args = input.args;
      if (input.env !== undefined) update.env = input.env;
      if (input.url !== undefined) update.url = input.url;
      if (input.disabled !== undefined) update.disabled = input.disabled;

      // Handle bearer token
      if (input.bearerToken) {
        update.authType = "bearer";
        update.headers = { Authorization: `Bearer ${input.bearerToken}` };
      }

      // Handle authType changes
      if (input.authType) {
        update.authType = input.authType;
        if (input.authType === "none") {
          // Clear auth-related fields
          update.headers = undefined;
          update._oauth = undefined;
        }
      }

      const merged = { ...existing, ...update };
      const updatedConfig = updateMcpServerConfig(
        config,
        projectPath ?? null,
        input.name,
        merged,
      );
      await writeClaudeConfig(updatedConfig);

      // 如果禁用状态变化,立即更新缓存
      if (input.disabled !== undefined) {
        const scope = input.scope === "project" ? (projectPath ?? null) : null
        const cacheKey = mcpCacheKey(scope, input.name)

        if (input.disabled) {
          // 禁用时标记为不可用
          workingMcpServers.set(cacheKey, false)
          mcpLog.info(`Disabled server ${input.name}, updated cache`)
        } else {
          // 启用时移除缓存(下次 query 会重新检测)
          workingMcpServers.delete(cacheKey)
          mcpLog.info(`Enabled server ${input.name}, cache will refresh on next query`)
        }
      }

      return { success: true, name: input.name };
    }),

  removeMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const config = await readClaudeConfig();
      const projectPath =
        input.scope === "project" ? input.projectPath : undefined;

      // Check server exists
      let servers: Record<string, McpServerConfig> | undefined;
      if (projectPath) {
        servers = config.projects?.[projectPath]?.mcpServers;
      } else {
        servers = config.mcpServers;
      }
      if (!servers?.[input.name]) {
        throw new Error(`Server "${input.name}" not found`);
      }

      const updated = removeMcpServerConfig(
        config,
        projectPath ?? null,
        input.name,
      );
      await writeClaudeConfig(updated);

      return { success: true };
    }),

  setMcpBearerToken: publicProcedure
    .input(
      z.object({
        name: z.string(),
        scope: z.enum(["global", "project"]),
        projectPath: z.string().optional(),
        token: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      const config = await readClaudeConfig();
      const projectPath =
        input.scope === "project" ? input.projectPath : undefined;

      // Check server exists
      let servers: Record<string, McpServerConfig> | undefined;
      if (projectPath) {
        servers = config.projects?.[projectPath]?.mcpServers;
      } else {
        servers = config.mcpServers;
      }
      if (!servers?.[input.name]) {
        throw new Error(`Server "${input.name}" not found`);
      }

      const existing = servers[input.name];
      const updatedServer: McpServerConfig = {
        ...existing,
        authType: "bearer",
        headers: { Authorization: `Bearer ${input.token}` },
      };

      const updatedConfig = updateMcpServerConfig(
        config,
        projectPath ?? null,
        input.name,
        updatedServer,
      );
      await writeClaudeConfig(updatedConfig);

      return { success: true };
    }),

  getPendingPluginMcpApprovals: publicProcedure
    .input(z.object({ projectPath: z.string().optional() }))
    .query(async ({ input }) => {
      const [enabledPluginSources, pluginMcpConfigs, approvedServers] =
        await Promise.all([
          getEnabledPlugins(),
          discoverPluginMcpServers(),
          getApprovedPluginMcpServers(),
        ]);

      // Read global/project servers for conflict check
      const config = await readClaudeConfig();
      const globalServers = config.mcpServers || {};
      const projectServers = input.projectPath
        ? getProjectMcpServers(config, input.projectPath) || {}
        : {};

      const pending: Array<{
        pluginSource: string;
        serverName: string;
        identifier: string;
        config: Record<string, unknown>;
      }> = [];

      for (const pluginConfig of pluginMcpConfigs) {
        if (!enabledPluginSources.includes(pluginConfig.pluginSource)) continue;

        for (const [name, serverConfig] of Object.entries(
          pluginConfig.mcpServers,
        )) {
          const identifier = `${pluginConfig.pluginSource}:${name}`;
          if (
            !approvedServers.includes(identifier) &&
            !globalServers[name] &&
            !projectServers[name]
          ) {
            pending.push({
              pluginSource: pluginConfig.pluginSource,
              serverName: name,
              identifier,
              config: serverConfig as Record<string, unknown>,
            });
          }
        }
      }

      return { pending };
    }),

  /**
   * 订阅 MCP 服务器状态变化(实时推送)
   */
  mcpStatus: publicProcedure.subscription(() => {
    return observable<{
      type: "serverStatus" | "warmupState"
      data: unknown
    }>((emit) => {
      let cleanupFn: (() => void) | null = null
      let disposed = false

      // 动态导入,避免循环依赖
      import("../../claude/mcp-warmup-manager")
        .then(({ getMcpWarmupManager }) => {
          const warmupManager = getMcpWarmupManager()

          const onServerStatus = (data: unknown) => {
            emit.next({ type: "serverStatus", data })
          }

          const onWarmupState = (state: string) => {
            emit.next({ type: "warmupState", data: { state } })
          }

          warmupManager.on("serverStatusChange", onServerStatus)
          warmupManager.on("stateChange", onWarmupState)

          cleanupFn = () => {
            warmupManager.off("serverStatusChange", onServerStatus)
            warmupManager.off("stateChange", onWarmupState)
          }

          // 如果在 import 完成前已被取消订阅,立即清理
          if (disposed) cleanupFn()
        })
        .catch((error) => {
          claudeLog.error("[MCP Status] Failed to load warmup manager:", error)
        })

      return () => {
        disposed = true
        cleanupFn?.()
      }
    })
  }),

  /**
   * 获取当前 MCP 预热状态(用于首次加载)
   */
  getMcpWarmupState: publicProcedure.query(async () => {
    try {
      const { getMcpWarmupManager } = await import("../../claude/mcp-warmup-manager")
      const warmupManager = getMcpWarmupManager()
      return {
        state: warmupManager.getState(),
        servers: Array.from(warmupManager.serverStates.entries()).map(
          ([name, state]) => ({ name, ...state })
        ),
      }
    } catch (error) {
      claudeLog.error("[MCP Warmup State] Error:", error)
      return {
        state: "idle" as const,
        servers: [],
      }
    }
  }),
})
