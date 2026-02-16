import type { UIMessageChunk } from "../types";

/**
 * 工具上下文：工具调用的完整信息
 */
export interface ToolContext {
  toolCallId: string; // 复合 ID (parentId:childId 或 childId)
  originalId: string; // 原始 tool_use_id
  toolName: string;
  input: Record<string, unknown>;
  parentToolUseId: string | null; // 嵌套工具的父 ID
}

/**
 * 工具结果上下文：工具完成后的信息
 */
export interface ToolOutputContext extends ToolContext {
  output: unknown; // 结构化输出 (msg.tool_use_result 或解析后的 content)
  rawContent: string | unknown; // 原始 block.content
  isError: boolean;
}

/**
 * 工具增强器接口：可插拔的工具特殊逻辑
 */
export interface ToolEnhancer {
  // 匹配工具名
  matches(toolName: string): boolean;

  // 优先级 (数字越小越优先，默认 100)
  priority?: number;

  // 工具输入完成时调用 (捕获参数，如 Bash command)
  onInputComplete?(context: ToolContext): void;

  // 工具结果增强 (生成额外 chunk，如后台任务通知)
  enhanceOutput?(context: ToolOutputContext): UIMessageChunk[];
}

/**
 * 流式追踪器接口：管理单个流的状态 (文本流/工具流/思维流)
 * 注意：不同 tracker 的 start() 参数可能不同，这里使用 any 以保持灵活性
 */
export interface StreamTracker<TState = unknown> {
  // 启动新流 (参数因 tracker 类型而异)
  start(...args: any[]): Generator<UIMessageChunk>;

  // 流式增量
  delta(delta: string | unknown): Generator<UIMessageChunk>;

  // 结束流
  end(): Generator<UIMessageChunk>;

  // 获取当前状态 (用于测试)
  getState(): TState;

  // 重置状态
  reset(): void;
}

/**
 * ID 管理器状态
 */
export interface IdManagerState {
  toolIdMapping: Map<string, string>; // originalId -> compositeId
  emittedToolIds: Set<string>; // 已发射的工具 ID (去重)
}

/**
 * 全局会话状态
 */
export interface SessionState {
  started: boolean;
  startTime: number | null;
  currentParentToolUseId: string | null; // 嵌套工具上下文
  lastTextId: string | null; // 最后文本块 ID (用于 finalTextId)
}

/**
 * Token 追踪状态
 */
export interface TokenState {
  lastApiCallInputTokens: number;
  lastApiCallOutputTokens: number;
}
