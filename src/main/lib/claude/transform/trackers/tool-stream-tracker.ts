import type { StreamTracker } from "../interfaces";
import type { UIMessageChunk } from "../../types";
import { createLogger } from "../../../logger";

const log = createLogger("ToolStreamTracker");

/**
 * 工具流状态
 */
export interface ToolStreamState {
  currentToolCallId: string | null;
  currentToolName: string | null;
  currentToolOriginalId: string | null;
  accumulatedToolInput: string;
}

/**
 * 工具流追踪器：管理工具输入流的生命周期
 *
 * 职责：
 * 1. 启动工具流 (tool-input-start)
 * 2. 流式工具输入增量 (tool-input-delta)
 * 3. 结束工具流 (tool-input-available，包含完整 JSON)
 * 4. 累积 JSON 输入并解析
 */
export class ToolStreamTracker implements StreamTracker<ToolStreamState> {
  private currentToolCallId: string | null = null;
  private currentToolName: string | null = null;
  private currentToolOriginalId: string | null = null;
  private accumulatedToolInput = "";

  /**
   * 启动新工具流
   * @param params - { toolCallId, toolName, originalId }
   */
  *start(params: {
    toolCallId: string;
    toolName: string;
    originalId: string;
  }): Generator<UIMessageChunk> {
    // 先结束当前流
    if (this.currentToolCallId) {
      const endChunks = this.end();
      for (const chunk of endChunks) {
        yield chunk;
      }
    }

    this.currentToolCallId = params.toolCallId;
    this.currentToolName = params.toolName;
    this.currentToolOriginalId = params.originalId;
    this.accumulatedToolInput = "";

    yield {
      type: "tool-input-start",
      toolCallId: this.currentToolCallId,
      toolName: this.currentToolName,
    };
  }

  /**
   * 流式工具输入增量
   */
  *delta(partialJson: string): Generator<UIMessageChunk> {
    if (!this.currentToolCallId) {
      log.warn("delta called without active tool call");
      return;
    }

    this.accumulatedToolInput += partialJson;

    yield {
      type: "tool-input-delta",
      toolCallId: this.currentToolCallId,
      inputTextDelta: partialJson,
    };
  }

  /**
   * 结束工具流，发射完整输入
   */
  *end(): Generator<UIMessageChunk> {
    if (!this.currentToolCallId) {
      return;
    }

    // 解析累积的 JSON 输入
    let parsedInput: Record<string, unknown> = {};
    if (this.accumulatedToolInput) {
      try {
        parsedInput = JSON.parse(this.accumulatedToolInput);
      } catch (e) {
        // 流可能中断 (网络错误/取消) 导致不完整 JSON
        log.error(
          "Failed to parse tool input JSON:",
          (e as Error).message,
          "partial:",
          this.accumulatedToolInput.slice(0, 120),
        );
        parsedInput = { _raw: this.accumulatedToolInput, _parseError: true };
      }
    }

    yield {
      type: "tool-input-available",
      toolCallId: this.currentToolCallId,
      toolName: this.currentToolName || "unknown",
      input: parsedInput,
    };

    // 返回完整上下文 (供 onInputComplete 回调使用)
    return {
      toolCallId: this.currentToolCallId,
      originalId: this.currentToolOriginalId!,
      toolName: this.currentToolName!,
      input: parsedInput,
    };
  }

  /**
   * 获取当前工具上下文 (用于 enhancer 回调)
   */
  getCurrentContext(): {
    toolCallId: string;
    originalId: string;
    toolName: string;
    input: Record<string, unknown>;
  } | null {
    if (!this.currentToolCallId || !this.currentToolOriginalId || !this.currentToolName) {
      return null;
    }

    let parsedInput: Record<string, unknown> = {};
    if (this.accumulatedToolInput) {
      try {
        parsedInput = JSON.parse(this.accumulatedToolInput);
      } catch {
        parsedInput = { _raw: this.accumulatedToolInput, _parseError: true };
      }
    }

    return {
      toolCallId: this.currentToolCallId,
      originalId: this.currentToolOriginalId,
      toolName: this.currentToolName,
      input: parsedInput,
    };
  }

  /**
   * 获取当前状态
   */
  getState(): ToolStreamState {
    return {
      currentToolCallId: this.currentToolCallId,
      currentToolName: this.currentToolName,
      currentToolOriginalId: this.currentToolOriginalId,
      accumulatedToolInput: this.accumulatedToolInput,
    };
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.currentToolCallId = null;
    this.currentToolName = null;
    this.currentToolOriginalId = null;
    this.accumulatedToolInput = "";
  }
}
