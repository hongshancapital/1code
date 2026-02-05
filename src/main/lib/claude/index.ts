export { createTransformer } from "./transform"
export type { UIMessageChunk, MessageMetadata } from "./types"
export {
  logRawClaudeMessage,
  getLogsDirectory,
  cleanupOldLogs,
} from "./raw-logger"
export {
  buildClaudeEnv,
  getClaudeShellEnvironment,
  clearClaudeEnvCache,
  logClaudeEnv,
  getBundledClaudeBinaryPath,
} from "./env"
export { checkOfflineFallback } from "./offline-handler"
export type { OfflineCheckResult, CustomClaudeConfig } from "./offline-handler"

// 缓存 Claude Agent SDK query 函数
let cachedClaudeQuery: ((options: any) => AsyncIterable<any>) | null = null

/**
 * 获取 Claude Agent SDK 的 query 函数
 * 使用缓存避免重复动态导入
 */
export async function getClaudeQuery() {
  if (cachedClaudeQuery) {
    return cachedClaudeQuery
  }
  const sdk = await import("@anthropic-ai/claude-agent-sdk")
  cachedClaudeQuery = sdk.query
  return cachedClaudeQuery
}
