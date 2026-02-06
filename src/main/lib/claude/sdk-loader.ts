/**
 * SDK Loader
 *
 * Handles dynamic loading of the Claude Agent SDK.
 * Extracted to avoid circular imports between engine.ts and index.ts.
 */

// Cached Claude Agent SDK query function
let cachedClaudeQuery: ((options: any) => AsyncIterable<any>) | null = null

/**
 * Get the Claude Agent SDK query function.
 * Uses cache to avoid repeated dynamic imports.
 */
export async function getClaudeQuery() {
  if (cachedClaudeQuery) {
    return cachedClaudeQuery
  }
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  cachedClaudeQuery = sdk.query
  return cachedClaudeQuery
}

/**
 * Clear the cached Claude query function.
 */
export function clearClaudeQueryCache(): void {
  cachedClaudeQuery = null
}
