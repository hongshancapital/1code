import type { StreamTracker } from "../interfaces";
import type { UIMessageChunk } from "../../types";

/**
 * 思维流状态
 */
export interface ThinkingStreamState {
  currentThinkingId: string | null;
  inThinkingBlock: boolean;
}

/**
 * 思维流追踪器：管理 Extended Thinking 流的生命周期
 *
 * 职责：
 * 1. 启动思维流 (reasoning-start)
 * 2. 流式思维增量 (reasoning-delta)
 * 3. 结束思维流 (reasoning-end)
 */
export class ThinkingStreamTracker implements StreamTracker<ThinkingStreamState> {
  private currentThinkingId: string | null = null;
  private inThinkingBlock = false;

  /**
   * 启动新思维流
   */
  *start(id: string): Generator<UIMessageChunk> {
    // 先结束当前流
    if (this.inThinkingBlock && this.currentThinkingId) {
      const endChunks = this.end();
      for (const chunk of endChunks) {
        yield chunk;
      }
    }

    this.currentThinkingId = id;
    this.inThinkingBlock = true;

    yield {
      type: "reasoning-start",
      id: this.currentThinkingId,
    };
  }

  /**
   * 流式思维增量
   */
  *delta(thinkingText: string): Generator<UIMessageChunk> {
    if (!this.inThinkingBlock || !this.currentThinkingId) {
      return;
    }

    yield {
      type: "reasoning-delta",
      id: this.currentThinkingId,
      delta: thinkingText,
    };
  }

  /**
   * 结束思维流
   */
  *end(): Generator<UIMessageChunk> {
    if (!this.inThinkingBlock || !this.currentThinkingId) {
      return;
    }

    yield {
      type: "reasoning-end",
      id: this.currentThinkingId,
    };

    const thinkingId = this.currentThinkingId;
    this.currentThinkingId = null;
    this.inThinkingBlock = false;

    // 返回 thinkingId 用于标记已发射
    return thinkingId;
  }

  /**
   * 检查是否在思维块中
   */
  isActive(): boolean {
    return this.inThinkingBlock;
  }

  /**
   * 获取当前思维 ID
   */
  getCurrentThinkingId(): string | null {
    return this.currentThinkingId;
  }

  /**
   * 获取当前状态
   */
  getState(): ThinkingStreamState {
    return {
      currentThinkingId: this.currentThinkingId,
      inThinkingBlock: this.inThinkingBlock,
    };
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.currentThinkingId = null;
    this.inThinkingBlock = false;
  }
}
