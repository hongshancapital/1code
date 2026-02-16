import type { SessionState, TokenState } from "./interfaces";

/**
 * 状态管理器：管理全局会话状态
 *
 * 职责：
 * 1. 会话生命周期 (started, startTime)
 * 2. 嵌套工具上下文 (currentParentToolUseId)
 * 3. 最后文本块 ID (lastTextId, 用于 finalTextId)
 * 4. Token 统计 (lastApiCallInputTokens, lastApiCallOutputTokens)
 */
export class StateManager {
  private session: SessionState = {
    started: false,
    startTime: null,
    currentParentToolUseId: null,
    lastTextId: null,
  };

  private tokens: TokenState = {
    lastApiCallInputTokens: 0,
    lastApiCallOutputTokens: 0,
  };

  // ===== 会话状态 =====

  isStarted(): boolean {
    return this.session.started;
  }

  start(): void {
    this.session.started = true;
    this.session.startTime = Date.now();
  }

  getStartTime(): number | null {
    return this.session.startTime;
  }

  // ===== 嵌套工具上下文 =====

  setParentToolUseId(parentId: string | null): void {
    this.session.currentParentToolUseId = parentId;
  }

  getParentToolUseId(): string | null {
    return this.session.currentParentToolUseId;
  }

  // ===== 最后文本块 ID =====

  setLastTextId(textId: string): void {
    this.session.lastTextId = textId;
  }

  getLastTextId(): string | null {
    return this.session.lastTextId;
  }

  // ===== Token 统计 =====

  setLastApiCallInputTokens(tokens: number): void {
    this.tokens.lastApiCallInputTokens = tokens;
  }

  getLastApiCallInputTokens(): number {
    return this.tokens.lastApiCallInputTokens;
  }

  setLastApiCallOutputTokens(tokens: number): void {
    this.tokens.lastApiCallOutputTokens = tokens;
  }

  getLastApiCallOutputTokens(): number {
    return this.tokens.lastApiCallOutputTokens;
  }

  // ===== 完整状态获取 (用于测试) =====

  getSessionState(): SessionState {
    return { ...this.session };
  }

  getTokenState(): TokenState {
    return { ...this.tokens };
  }

  // ===== 重置 =====

  reset(): void {
    this.session = {
      started: false,
      startTime: null,
      currentParentToolUseId: null,
      lastTextId: null,
    };
    this.tokens = {
      lastApiCallInputTokens: 0,
      lastApiCallOutputTokens: 0,
    };
  }
}
