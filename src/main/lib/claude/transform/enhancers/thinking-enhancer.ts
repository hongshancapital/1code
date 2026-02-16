import type { ToolEnhancer } from "../interfaces";

/**
 * Thinking 增强器：处理 Extended Thinking 去重
 *
 * 职责：
 * 1. 标记流式 thinking 已发射 (避免 assistant 消息重复)
 *
 * 注意：Thinking 不是工具调用，而是内容块
 * 本类仅用于状态管理，实际流式处理在 ThinkingStreamTracker
 */
export class ThinkingEnhancer {
  // Thinking 的去重逻辑已在 ThinkingStreamTracker 和 AssistantHandler 中处理
  // 此类保留以维持架构一致性，可在未来扩展
}
