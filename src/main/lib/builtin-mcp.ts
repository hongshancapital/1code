/**
 * Built-in MCP Server Configuration
 *
 * Provides configuration for Hong's internal MCP server that requires
 * Okta authentication. The token is dynamically injected from AuthManager
 * on each SDK call to ensure it's always fresh (auto-refreshed if needed).
 */

import { type AuthManager, getAzureAuthHeaders } from "../auth-manager"
import { getEnv, getApiOrigin } from "./env"

// API base URL from validated environment
function getApiBaseUrl(): string {
  return getEnv().MAIN_VITE_API_URL
}

/**
 * Built-in MCP server name
 */
export const BUILTIN_MCP_NAME = "hong-internal"

/**
 * Built-in MCP server configuration interface
 */
export interface BuiltinMcpConfig {
  url: string
  type: "http" | "sse"
  headers: Record<string, string>
  // Mark as builtin so UI can differentiate
  _builtin: true
}

/**
 * Get the built-in MCP server configuration with current auth token.
 * Uses AuthManager.getValidToken() to ensure token is fresh (auto-refreshes if needed).
 *
 * @param authManager - The AuthManager instance to get the valid token from
 * @returns MCP server config or null if not authenticated
 */
export async function getBuiltinMcpConfig(
  authManager: AuthManager
): Promise<BuiltinMcpConfig | null> {
  // getValidToken() will auto-refresh if token is about to expire
  const token = await authManager.getValidToken()

  if (!token) {
    console.log("[Builtin MCP] No auth token available, skipping built-in MCP")
    return null
  }

  const apiUrl = getApiBaseUrl()
  const origin = getApiOrigin()

  return {
    url: `${apiUrl}/v1/api/mcp`,
    type: "http",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/plain, */*",
      Origin: origin,
      Referer: `${origin}/`,
      // Browser-like headers to pass CloudFront WAF
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      // Azure AD authentication header
      ...getAzureAuthHeaders(),
    },
    _builtin: true,
  }
}

/**
 * Inject built-in MCP server into the MCP servers object.
 * Only adds if user is authenticated. Uses async to ensure token is refreshed.
 *
 * @param mcpServers - Existing MCP servers config (from ~/.claude.json)
 * @param authManager - The AuthManager instance for token management
 * @returns Updated MCP servers with built-in server added
 */
export async function injectBuiltinMcp(
  mcpServers: Record<string, any> | undefined,
  authManager: AuthManager
): Promise<Record<string, any>> {
  const builtinConfig = await getBuiltinMcpConfig(authManager)

  if (!builtinConfig) {
    // Not authenticated, return original servers unchanged
    return mcpServers || {}
  }

  // Add built-in MCP server (with lower priority than user-configured servers)
  // User can override by adding a server with the same name in ~/.claude.json
  const result = {
    [BUILTIN_MCP_NAME]: builtinConfig,
    ...mcpServers,
  }

  console.log(`[Builtin MCP] Injected ${BUILTIN_MCP_NAME} MCP server`)
  return result
}

/**
 * Check if built-in MCP is available (user is authenticated)
 */
export function isBuiltinMcpAvailable(authManager: AuthManager): boolean {
  return authManager.isAuthenticated()
}

/**
 * Get built-in MCP server info for UI display
 */
export function getBuiltinMcpInfo(authManager: AuthManager): {
  name: string
  url: string
  available: boolean
} {
  const apiUrl = getApiBaseUrl()

  return {
    name: BUILTIN_MCP_NAME,
    url: `${apiUrl}/v1/api/mcp`,
    available: authManager.isAuthenticated(),
  }
}

/**
 * Get built-in MCP placeholder for displaying when user is not authenticated.
 * This allows showing the MCP in the list with a "needs login" status.
 */
export function getBuiltinMcpPlaceholder(): {
  name: string
  url: string
  requiresLogin: true
  _builtin: true
  _placeholder: true
} {
  const apiUrl = getApiBaseUrl()

  return {
    name: BUILTIN_MCP_NAME,
    url: `${apiUrl}/v1/api/mcp`,
    requiresLogin: true,
    _builtin: true,
    _placeholder: true,
  }
}
