/**
 * Chat 生命周期 Hook 定义
 *
 * 对应 claude.ts 中的生命周期节点：
 * - 10 个 emit（通知型，含 streamComplete/streamError）
 * - 1 个 collect（收集 MCP servers）
 * - 1 个 waterfall（增强 prompt）
 */

import type { McpServerWithMeta } from "../../claude/engine-types"
import type { HookDefinition } from "../types"
import { registerHookMode } from "../hook-registry"

// =============================================================================
// Payload 类型
// =============================================================================

export interface ChatSessionStartPayload {
  subChatId: string
  chatId: string
  projectId: string
  cwd: string
  mode: "plan" | "agent"
  prompt: string
  promptNumber: number
  isResume: boolean
  sessionId?: string
  /** Memory 录制开关（默认 true） */
  memoryRecordingEnabled?: boolean
  /** Summary model provider ID */
  summaryProviderId?: string
  /** Summary model ID */
  summaryModelId?: string
}

export interface ChatUserPromptPayload {
  sessionId: string | null
  subChatId: string
  projectId: string
  prompt: string
  promptNumber: number
}

export interface ChatToolOutputPayload {
  sessionId: string | null
  projectId: string
  subChatId: string
  toolName: string
  toolInput: unknown
  toolOutput: unknown
  toolCallId?: string
  promptNumber?: number
}

export interface ChatFileChangedPayload {
  sessionId: string | null
  projectId: string
  subChatId: string
  filePath: string
  changeType: "create" | "modify" | "delete"
}

export interface ChatGitCommitPayload {
  sessionId: string | null
  projectId: string
  subChatId: string
  commitHash: string
  commitMessage: string
}

export interface ChatAssistantMessagePayload {
  sessionId: string | null
  projectId: string
  subChatId: string
  text: string
  messageId?: string
  promptNumber?: number
}

export interface ChatSessionEndPayload {
  sessionId: string | null
  subChatId: string
  projectId: string
}

export interface ChatCleanupPayload {
  subChatId: string
  projectId: string
}

/** collect: MCP server 收集 */
export interface McpCollectPayload {
  cwd: string
  subChatId: string
  projectId: string
  isOllama: boolean
  existingServers: Record<string, McpServerWithMeta>
  /** Image generation API config (baseUrl + apiKey + model) */
  imageConfig?: { baseUrl: string; apiKey: string; model: string }
}

export interface McpServerEntry {
  name: string
  config: McpServerWithMeta
}

/** waterfall: prompt 增强管道 */
export interface PromptEnhancePayload {
  appendSections: string[]
  cwd: string
  projectId: string
  subChatId: string
  prompt: string
  isOllama: boolean
  /** Memory context 注入开关（默认 true） */
  memoryEnabled?: boolean
}

/** emit: 流式完成（成功路径，用于 usage tracking） */
export interface ChatStreamCompletePayload {
  subChatId: string
  chatId: string
  projectId: string
  /** SDK metadata（含 modelUsage、inputTokens、outputTokens、sessionId 等） */
  metadata: Record<string, any>
  assistantText: string
  mode: string
  /** 实际使用的 model（含 fallback） */
  finalModel?: string
  /** Duration in ms */
  durationMs?: number
}

/** emit: 流式错误（错误路径，用于 usage tracking） */
export interface ChatStreamErrorPayload {
  subChatId: string
  chatId: string
  projectId: string
  metadata: Record<string, any>
  error: Error
  mode: string
  finalModel?: string
  durationMs?: number
}

// =============================================================================
// HookMap 扩展（interface 合并）
// =============================================================================

declare module "../types" {
  interface HookMap {
    // emit: 通知型
    "chat:sessionStart": HookDefinition<"emit", ChatSessionStartPayload, void>
    "chat:userPrompt": HookDefinition<"emit", ChatUserPromptPayload, void>
    "chat:toolOutput": HookDefinition<"emit", ChatToolOutputPayload, void>
    "chat:fileChanged": HookDefinition<"emit", ChatFileChangedPayload, void>
    "chat:gitCommit": HookDefinition<"emit", ChatGitCommitPayload, void>
    "chat:assistantMessage": HookDefinition<
      "emit",
      ChatAssistantMessagePayload,
      void
    >
    "chat:sessionEnd": HookDefinition<"emit", ChatSessionEndPayload, void>
    "chat:cleanup": HookDefinition<"emit", ChatCleanupPayload, void>
    "chat:streamComplete": HookDefinition<
      "emit",
      ChatStreamCompletePayload,
      void
    >
    "chat:streamError": HookDefinition<"emit", ChatStreamErrorPayload, void>

    // collect: 收集型
    "chat:collectMcpServers": HookDefinition<
      "collect",
      McpCollectPayload,
      McpServerEntry
    >

    // waterfall: 管道型
    "chat:enhancePrompt": HookDefinition<
      "waterfall",
      PromptEnhancePayload,
      void
    >
  }
}

// =============================================================================
// 运行时模式注册
// =============================================================================

registerHookMode("chat:sessionStart", "emit")
registerHookMode("chat:userPrompt", "emit")
registerHookMode("chat:toolOutput", "emit")
registerHookMode("chat:fileChanged", "emit")
registerHookMode("chat:gitCommit", "emit")
registerHookMode("chat:assistantMessage", "emit")
registerHookMode("chat:sessionEnd", "emit")
registerHookMode("chat:cleanup", "emit")
registerHookMode("chat:streamComplete", "emit")
registerHookMode("chat:streamError", "emit")
registerHookMode("chat:collectMcpServers", "collect")
registerHookMode("chat:enhancePrompt", "waterfall")
