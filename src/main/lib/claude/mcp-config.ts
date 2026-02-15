/**
 * MCP 配置管理
 *
 * 从 claude.ts 提取的 MCP 服务器配置相关函数：
 * - getClaudeCodeToken — 凭证解密
 * - getServerStatusFromConfig — 服务器状态判断
 * - fetchToolsForServer — 单服务器工具拉取
 * - getAllMcpConfigHandler — 完整 MCP 配置聚合（global + project + plugin + builtin）
 */

import { eq } from "drizzle-orm";
import path from "path";
import {
  mcpCacheKey,
  workingMcpServers,
} from "../claude";
import {
  readClaudeConfig,
  readAgentConfig,
  GLOBAL_MCP_PATH,
  type McpServerConfig,
  type ProjectConfig,
} from "../claude-config";
import { claudeCodeCredentials, getDatabase } from "../db";
import {
  ensureMcpTokensFresh,
  fetchMcpTools,
  fetchMcpToolsStdio,
  type McpToolInfo,
} from "../mcp-auth";
import { fetchOAuthMetadata, getMcpBaseUrl } from "../oauth";
import {
  getEnabledPlugins,
  getApprovedPluginMcpServers,
} from "../trpc/routers/claude-settings";
import {
  discoverPluginMcpServers,
} from "../../feature/plugin-system/lib";
import {
  BUILTIN_MCP_NAME,
  getBuiltinMcpConfig,
  getBuiltinMcpPlaceholder,
} from "../builtin-mcp";
import { getAuthManager } from "../../index";
import { decryptToken } from "../crypto";

/**
 * Get Claude Code OAuth token from local SQLite
 * Returns null if not connected
 */
export function getClaudeCodeToken(): string | null {
  try {
    const db = getDatabase();
    const cred = db
      .select()
      .from(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .get();

    if (!cred?.oauthToken) {
      console.log("[claude] No Claude Code credentials found");
      return null;
    }

    return decryptToken(cred.oauthToken);
  } catch (error) {
    console.error("[claude] Error getting Claude Code token:", error);
    return null;
  }
}

/**
 * Determine server status based on config
 * - If authType is "none" -> "connected" (no auth required)
 * - If has Authorization header -> "connected" (OAuth completed, SDK can use it)
 * - If has _oauth but no headers -> "needs-auth" (legacy config, needs re-auth to migrate)
 * - If HTTP server (has URL) with explicit authType -> "needs-auth"
 * - HTTP server without authType -> "connected" (assume public)
 * - Local stdio server -> "connected"
 */
export function getServerStatusFromConfig(serverConfig: McpServerConfig): string {
  const headers = serverConfig.headers as Record<string, string> | undefined;
  const { _oauth: oauth, authType } = serverConfig;

  // If authType is explicitly "none", no auth required
  if (authType === "none") {
    return "connected";
  }

  // If has Authorization header, it's ready for SDK to use
  if (headers?.Authorization) {
    return "connected";
  }

  // If has _oauth but no headers, this is a legacy config that needs re-auth
  // (old format that SDK can't use)
  if (oauth?.accessToken && !headers?.Authorization) {
    return "needs-auth";
  }

  // If HTTP server with explicit authType (oauth/bearer), needs auth
  if (serverConfig.url && ["oauth", "bearer"].includes(authType ?? "")) {
    return "needs-auth";
  }

  // HTTP server without authType - assume no auth required (public endpoint)
  // Local stdio server - also connected
  return "connected";
}

const MCP_FETCH_TIMEOUT_HTTP_MS = 10_000;
// stdio servers (esp. npx) need longer: download + install + spawn + listTools
const MCP_FETCH_TIMEOUT_STDIO_MS = 30_000;

/**
 * Fetch tools from an MCP server (HTTP or stdio transport)
 */
export async function fetchToolsForServer(
  serverConfig: McpServerConfig,
): Promise<McpToolInfo[]> {
  const isStdio = !!serverConfig.command;
  const timeoutMs = isStdio ? MCP_FETCH_TIMEOUT_STDIO_MS : MCP_FETCH_TIMEOUT_HTTP_MS;
  const timeoutPromise = new Promise<McpToolInfo[]>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), timeoutMs),
  );

  const fetchPromise = (async () => {
    // HTTP transport
    if (serverConfig.url) {
      const headers = serverConfig.headers as
        | Record<string, string>
        | undefined;
      try {
        return await fetchMcpTools(serverConfig.url, headers);
      } catch {
        return [];
      }
    }

    // Stdio transport
    const command = serverConfig.command;
    if (command) {
      try {
        return await fetchMcpToolsStdio({
          command,
          args: serverConfig.args,
          env: serverConfig.env,
        });
      } catch {
        return [];
      }
    }

    return [];
  })();

  try {
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch {
    return [];
  }
}

/**
 * Handler for getAllMcpConfig - exported so it can be called on app startup
 */
export async function getAllMcpConfigHandler() {
  try {
    const totalStart = Date.now();

    // 不再无条件 clear —— 保留预热阶段已建立的缓存，
    // 后续 convertServers 会按 key 覆盖写入最新状态。

    const config = await readClaudeConfig();

    const convertServers = async (
      servers: Record<string, McpServerConfig> | undefined,
      scope: string | null,
    ) => {
      if (!servers) return [];

      const results = await Promise.all(
        Object.entries(servers).map(async ([name, serverConfig]) => {
          const configObj = serverConfig as Record<string, unknown>;
          let status = getServerStatusFromConfig(serverConfig);
          const headers = serverConfig.headers as
            | Record<string, string>
            | undefined;

          let tools: McpToolInfo[] = [];
          let needsAuth = false;

          try {
            tools = await fetchToolsForServer(serverConfig);
          } catch (error) {
            console.error(`[MCP] Failed to fetch tools for ${name}:`, error);
          }

          const cacheKey = mcpCacheKey(scope, name);
          if (tools.length > 0) {
            status = "connected";
            workingMcpServers.set(cacheKey, true);
          } else {
            workingMcpServers.set(cacheKey, false);
            if (serverConfig.url) {
              try {
                const baseUrl = getMcpBaseUrl(serverConfig.url);
                const metadata = await fetchOAuthMetadata(baseUrl);
                needsAuth = !!metadata && !!metadata.authorization_endpoint;
              } catch {
                // If probe fails, assume no auth needed
              }
            } else if (
              serverConfig.authType === "oauth" ||
              serverConfig.authType === "bearer"
            ) {
              needsAuth = true;
            }

            if (needsAuth && !headers?.Authorization) {
              status = "needs-auth";
            } else {
              // No tools and doesn't need auth - server failed to connect or has no tools
              status = "failed";
            }
          }

          return { name, status, tools, needsAuth, config: configObj };
        }),
      );

      return results;
    };

    // Build list of all groups to process with timing
    const groupTasks: Array<{
      groupName: string;
      projectPath: string | null;
      promise: Promise<{
        mcpServers: Array<{
          name: string;
          status: string;
          tools: McpToolInfo[];
          needsAuth: boolean;
          config: Record<string, unknown>;
          requiresLogin?: boolean;
        }>;
        duration: number;
      }>;
    }> = [];

    // Global MCPs
    if (config.mcpServers) {
      groupTasks.push({
        groupName: "Global",
        projectPath: null,
        promise: (async () => {
          const start = Date.now();
          const freshServers = await ensureMcpTokensFresh(
            config.mcpServers!,
            GLOBAL_MCP_PATH,
          );
          const mcpServers = await convertServers(freshServers, null); // null = global scope
          return { mcpServers, duration: Date.now() - start };
        })(),
      });
    } else {
      groupTasks.push({
        groupName: "Global",
        projectPath: null,
        promise: Promise.resolve({ mcpServers: [], duration: 0 }),
      });
    }

    // Project MCPs
    if (config.projects) {
      for (const [projectPath, projectConfig] of Object.entries(
        config.projects,
      )) {
        if (
          projectConfig.mcpServers &&
          Object.keys(projectConfig.mcpServers).length > 0
        ) {
          const groupName = path.basename(projectPath) || projectPath;
          groupTasks.push({
            groupName,
            projectPath,
            promise: (async () => {
              const start = Date.now();
              const freshServers = await ensureMcpTokensFresh(
                projectConfig.mcpServers!,
                projectPath,
              );
              const mcpServers = await convertServers(
                freshServers,
                projectPath,
              ); // projectPath = scope
              return { mcpServers, duration: Date.now() - start };
            })(),
          });
        }
      }
    }

    // Process all groups in parallel
    const results = await Promise.all(groupTasks.map((t) => t.promise));

    // Build groups with timing info
    const groupsWithTiming = groupTasks.map((task, i) => ({
      groupName: task.groupName,
      projectPath: task.projectPath,
      mcpServers: results[i].mcpServers,
      duration: results[i].duration,
    }));

    // Log performance (sorted by duration DESC)
    const totalDuration = Date.now() - totalStart;
    const workingCount = [...workingMcpServers.values()].filter(
      (v) => v,
    ).length;
    const sortedByDuration = [...groupsWithTiming].sort(
      (a, b) => b.duration - a.duration,
    );

    console.log(
      `[MCP] Cache updated in ${totalDuration}ms. Working: ${workingCount}/${workingMcpServers.size}`,
    );
    for (const g of sortedByDuration) {
      if (g.mcpServers.length > 0) {
        console.log(
          `[MCP]   ${g.groupName}: ${g.duration}ms (${g.mcpServers.length} servers)`,
        );
      }
    }

    // Return groups without timing info
    const groups = groupsWithTiming.map(
      ({ groupName, projectPath, mcpServers }) => ({
        groupName,
        projectPath,
        mcpServers,
      }),
    );

    // Built-in MCP (Hong internal API with Okta auth)
    // Use AuthManager to ensure token is fresh (auto-refreshed if needed)
    const authManager = getAuthManager();
    const builtinConfig = await getBuiltinMcpConfig(authManager);

    if (builtinConfig) {
      // User is authenticated - try to fetch tools from built-in MCP
      let builtinTools: McpToolInfo[] = [];
      let builtinStatus = "connected";

      try {
        builtinTools = await fetchMcpTools(
          builtinConfig.url,
          builtinConfig.headers,
        );
        if (builtinTools.length === 0) {
          builtinStatus = "failed";
        }
        // Cache the working status
        const cacheKey = mcpCacheKey(null, BUILTIN_MCP_NAME);
        workingMcpServers.set(cacheKey, builtinTools.length > 0);
      } catch (error) {
        console.error(`[MCP] Failed to fetch tools for built-in MCP:`, error);
        builtinStatus = "failed";
        workingMcpServers.set(mcpCacheKey(null, BUILTIN_MCP_NAME), false);
      }

      groups.unshift({
        groupName: "Built-in",
        projectPath: null,
        mcpServers: [
          {
            name: BUILTIN_MCP_NAME,
            status: builtinStatus,
            tools: builtinTools,
            needsAuth: false, // Auth is handled internally via Okta
            config: {
              url: builtinConfig.url,
              type: builtinConfig.type,
              _builtin: true,
            },
          },
        ],
      });
    } else {
      // User is not authenticated - show placeholder with "needs-login" status
      console.log("[MCP] User not authenticated, adding builtin placeholder");
      try {
        const placeholder = getBuiltinMcpPlaceholder();
        console.log("[MCP] Builtin placeholder created:", placeholder.name);
        groups.unshift({
          groupName: "Built-in",
          projectPath: null,
          mcpServers: [
            {
              name: placeholder.name,
              status: "needs-login",
              tools: [],
              needsAuth: true,
              requiresLogin: true,
              config: {
                url: placeholder.url,
                _builtin: true,
                _placeholder: true,
              },
            },
          ],
        });
        console.log(
          "[MCP] Builtin placeholder added to groups, total groups:",
          groups.length,
        );
      } catch (error) {
        console.error("[MCP] Failed to create builtin placeholder:", error);
        // Still add a minimal placeholder even if getBuiltinMcpPlaceholder fails
        groups.unshift({
          groupName: "Built-in",
          projectPath: null,
          mcpServers: [
            {
              name: BUILTIN_MCP_NAME,
              status: "needs-login",
              tools: [],
              needsAuth: true,
              requiresLogin: true,
              config: {
                _builtin: true,
                _placeholder: true,
              },
            },
          ],
        });
        console.log("[MCP] Minimal builtin placeholder added after error");
      }
    }

    // Agent Config MCPs (from ~/.agent.json)
    const agentConfig = await readAgentConfig();
    if (
      agentConfig.mcpServers &&
      Object.keys(agentConfig.mcpServers).length > 0
    ) {
      const agentMcpServers = await convertServers(
        agentConfig.mcpServers,
        null,
      );
      groups.push({
        groupName: "Agent Config",
        projectPath: null,
        mcpServers: agentMcpServers,
      });
    }

    // Plugin MCPs (from installed plugins)
    const [enabledPluginSources, pluginMcpConfigs, approvedServers] =
      await Promise.all([
        getEnabledPlugins(),
        discoverPluginMcpServers(),
        getApprovedPluginMcpServers(),
      ]);

    for (const pluginConfig of pluginMcpConfigs) {
      // Only show MCP servers from enabled plugins
      if (!enabledPluginSources.includes(pluginConfig.pluginSource)) continue;

      const globalServerNames = config.mcpServers
        ? Object.keys(config.mcpServers)
        : [];
      if (Object.keys(pluginConfig.mcpServers).length > 0) {
        const pluginMcpServers = (
          await Promise.all(
            Object.entries(pluginConfig.mcpServers).map(
              async ([name, serverConfig]) => {
                // Skip servers that have been promoted to ~/.claude.json (e.g., after OAuth)
                if (globalServerNames.includes(name)) return null;

                const configObj = serverConfig as Record<string, unknown>;
                const identifier = `${pluginConfig.pluginSource}:${name}`;
                const isApproved = approvedServers.includes(identifier);

                if (!isApproved) {
                  return {
                    name,
                    status: "pending-approval",
                    tools: [] as McpToolInfo[],
                    needsAuth: false,
                    config: configObj,
                    isApproved,
                  };
                }

                // Try to get status and tools for approved servers
                let status = getServerStatusFromConfig(serverConfig);
                const headers = serverConfig.headers as
                  | Record<string, string>
                  | undefined;
                let tools: McpToolInfo[] = [];
                let needsAuth = false;

                try {
                  tools = await fetchToolsForServer(serverConfig);
                } catch (error) {
                  console.error(
                    `[MCP] Failed to fetch tools for plugin ${name}:`,
                    error,
                  );
                }

                if (tools.length > 0) {
                  status = "connected";
                } else {
                  // Same OAuth detection logic as regular MCP servers
                  if (serverConfig.url) {
                    try {
                      const baseUrl = getMcpBaseUrl(serverConfig.url);
                      const metadata = await fetchOAuthMetadata(baseUrl);
                      needsAuth =
                        !!metadata && !!metadata.authorization_endpoint;
                    } catch {
                      // If probe fails, assume no auth needed
                    }
                  } else if (
                    serverConfig.authType === "oauth" ||
                    serverConfig.authType === "bearer"
                  ) {
                    needsAuth = true;
                  }

                  if (needsAuth && !headers?.Authorization) {
                    status = "needs-auth";
                  } else {
                    status = "failed";
                  }
                }

                return {
                  name,
                  status,
                  tools,
                  needsAuth,
                  config: configObj,
                  isApproved,
                };
              },
            ),
          )
        ).filter((s): s is NonNullable<typeof s> => s !== null);

        groups.push({
          groupName: `Plugin: ${pluginConfig.pluginSource}`,
          projectPath: null,
          mcpServers: pluginMcpServers,
        });
      }
    }

    return { groups };
  } catch (error) {
    console.error("[getAllMcpConfig] Error:", error);
    return { groups: [], error: String(error) };
  }
}
