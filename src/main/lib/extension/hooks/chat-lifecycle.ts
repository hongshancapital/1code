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
// Hook Key 枚举（Single Source of Truth）
// =============================================================================

/**
 * Chat 生命周期 Hook 枚举
 *
 * 所有 hook key 的唯一定义来源。
 * Extension 订阅（ctx.hooks.on）和 claude.ts 发射（getHooks().call）都应使用此 enum。
 */
export enum ChatHook {
  /** 会话开始 — 新 session 创建时触发，记录初始 prompt 和元数据 */
  SessionStart = "chat:sessionStart",
  /** 用户输入 — 接收到用户 prompt 后异步触发 */
  UserPrompt = "chat:userPrompt",
  /** 工具输出 — 每个工具执行完成后异步触发 */
  ToolOutput = "chat:toolOutput",
  /** 文件变更 — 检测到文件创建/修改/删除时异步触发 */
  FileChanged = "chat:fileChanged",
  /** Git 提交 — 检测到 git commit 时异步触发 */
  GitCommit = "chat:gitCommit",
  /** AI 回复 — 助手文本回复后异步触发 */
  AssistantMessage = "chat:assistantMessage",
  /** 会话结束 — 流完成后异步触发，用于清理和 summary 生成 */
  SessionEnd = "chat:sessionEnd",
  /** 最终清理 — tRPC subscription 取消时触发，释放资源 */
  Cleanup = "chat:cleanup",
  /** 流完成 — SDK 流成功结束时触发，用于 token 计数 */
  StreamComplete = "chat:streamComplete",
  /** 流错误 — SDK 流出错时触发，用于 token 计数 */
  StreamError = "chat:streamError",
  /** MCP 收集 [collect] — 构建 SDK options 前触发，Extension 返回 MCP 服务器 */
  CollectMcpServers = "chat:collectMcpServers",
  /** Prompt 增强 [waterfall] — 系统提示构建前按优先级串行追加段落 */
  EnhancePrompt = "chat:enhancePrompt",
}

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
    [ChatHook.SessionStart]: HookDefinition<"emit", ChatSessionStartPayload, void>
    [ChatHook.UserPrompt]: HookDefinition<"emit", ChatUserPromptPayload, void>
    [ChatHook.ToolOutput]: HookDefinition<"emit", ChatToolOutputPayload, void>
    [ChatHook.FileChanged]: HookDefinition<"emit", ChatFileChangedPayload, void>
    [ChatHook.GitCommit]: HookDefinition<"emit", ChatGitCommitPayload, void>
    [ChatHook.AssistantMessage]: HookDefinition<
      "emit",
      ChatAssistantMessagePayload,
      void
    >
    [ChatHook.SessionEnd]: HookDefinition<"emit", ChatSessionEndPayload, void>
    [ChatHook.Cleanup]: HookDefinition<"emit", ChatCleanupPayload, void>
    [ChatHook.StreamComplete]: HookDefinition<
      "emit",
      ChatStreamCompletePayload,
      void
    >
    [ChatHook.StreamError]: HookDefinition<"emit", ChatStreamErrorPayload, void>

    // collect: 收集型
    [ChatHook.CollectMcpServers]: HookDefinition<
      "collect",
      McpCollectPayload,
      McpServerEntry
    >

    // waterfall: 管道型
    [ChatHook.EnhancePrompt]: HookDefinition<
      "waterfall",
      PromptEnhancePayload,
      void
    >
  }
}

// =============================================================================
// 运行时模式注册
// =============================================================================

registerHookMode(ChatHook.SessionStart, "emit")
registerHookMode(ChatHook.UserPrompt, "emit")
registerHookMode(ChatHook.ToolOutput, "emit")
registerHookMode(ChatHook.FileChanged, "emit")
registerHookMode(ChatHook.GitCommit, "emit")
registerHookMode(ChatHook.AssistantMessage, "emit")
registerHookMode(ChatHook.SessionEnd, "emit")
registerHookMode(ChatHook.Cleanup, "emit")
registerHookMode(ChatHook.StreamComplete, "emit")
registerHookMode(ChatHook.StreamError, "emit")
registerHookMode(ChatHook.CollectMcpServers, "collect")
registerHookMode(ChatHook.EnhancePrompt, "waterfall")
