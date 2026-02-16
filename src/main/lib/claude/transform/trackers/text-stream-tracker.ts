import type { StreamTracker } from "../interfaces";
import type { UIMessageChunk } from "../../types";
import { genId } from "../utils";

/**
 * 文本流状态
 */
export interface TextStreamState {
  textId: string | null;
  textStarted: boolean;
}

/**
 * 文本流追踪器：管理文本流的生命周期
 *
 * 职责：
 * 1. 启动文本流 (text-start)
 * 2. 流式文本增量 (text-delta)
 * 3. 结束文本流 (text-end)
 * 4. 自动 ID 生成
 */
export class TextStreamTracker implements StreamTracker<TextStreamState> {
  private textId: string | null = null;
  private textStarted = false;

  /**
   * 启动新文本流
   */
  *start(id?: string): Generator<UIMessageChunk> {
    // 先结束当前流
    if (this.textStarted && this.textId) {
      const endChunks = this.end();
      for (const chunk of endChunks) {
        yield chunk;
      }
    }

    this.textId = id || genId();
    this.textStarted = true;
    yield { type: "text-start", id: this.textId };
  }

  /**
   * 流式文本增量
   */
  *delta(delta: string): Generator<UIMessageChunk> {
    // 如果未启动，自动启动
    if (!this.textStarted || !this.textId) {
      const startChunks = this.start();
      for (const chunk of startChunks) {
        yield chunk;
      }
    }

    yield {
      type: "text-delta",
      id: this.textId!,
      delta,
    };
  }

  /**
   * 结束文本流
   */
  *end(): Generator<UIMessageChunk> {
    if (this.textStarted && this.textId) {
      yield { type: "text-end", id: this.textId };
      this.textStarted = false;
      // 不重置 textId，用于 lastTextId 追踪
    }
  }

  /**
   * 获取当前文本 ID (用于 lastTextId)
   */
  getCurrentTextId(): string | null {
    return this.textId;
  }

  /**
   * 获取当前状态
   */
  getState(): TextStreamState {
    return {
      textId: this.textId,
      textStarted: this.textStarted,
    };
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.textId = null;
    this.textStarted = false;
  }
}
