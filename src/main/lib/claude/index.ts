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

// ============================================================================
// Claude Engine (New Composable Architecture)
// ============================================================================

// Engine types
export type {
  ConfigOverride,
  ConfigContext,
  LoadedConfig,
  McpServerWithMeta,
  SkillConfig,
  AgentConfig,
  UserProfile,
  PromptStrategy,
  SystemPromptConfig,
  ToolPermissionDecision,
  ToolContext,
  ToolPermissionPolicy,
  OutputChannel,
  EngineRequest,
  EngineEvent,
} from "./engine-types"

// Config loader
export {
  ClaudeConfigLoader,
  getConfigLoader,
  clearConfigCache,
  workingMcpServers,
  mcpCacheKey,
} from "./config-loader"

// Prompt builder
export {
  PromptBuilder,
  getPromptBuilder,
  initializePromptBuilder,
  ChatPromptStrategy,
  AutomationPromptStrategy,
  InsightsPromptStrategy,
  WorkerPromptStrategy,
  type RuntimeEnvProvider,
  type RuntimeTool,
} from "./prompt-builder"

// SDK query builder
export {
  SdkQueryBuilder,
  createQueryBuilder,
  type SdkQueryOptions,
} from "./sdk-query-builder"

// Policies
export {
  PLAN_MODE_BLOCKED_TOOLS,
  CHAT_MODE_BLOCKED_TOOLS,
  AUTOMATION_BLOCKED_TOOLS,
  AllowAllPolicy,
  PlanModePolicy,
  ChatModePolicy,
  AgentModePolicy,
  OllamaPolicy,
  AutomationPolicy,
  CompositePolicy,
  createPolicy,
  createAutomationPolicy,
} from "./policies"

// Output channels
export {
  ConsoleChannel,
  CallbackChannel,
  BufferChannel,
  CompositeChannel,
  NullChannel,
  createConsoleChannel,
  createCallbackChannel,
  createBufferChannel,
  createCompositeChannel,
  createNullChannel,
} from "./output-channel"

// Engine
export {
  ClaudeEngine,
  createChatEngine,
  createAutomationEngine,
  createInsightsEngine,
  createWorkerEngine,
  createChatRequest,
  createAutomationRequest,
  createInsightsRequest,
  createWorkerRequest,
} from "./engine"
