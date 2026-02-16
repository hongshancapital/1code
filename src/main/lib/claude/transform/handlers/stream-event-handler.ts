import type { UIMessageChunk } from "../../types";
import type { TextStreamTracker } from "../trackers/text-stream-tracker";
import type { ToolStreamTracker } from "../trackers/tool-stream-tracker";
import type { ThinkingStreamTracker } from "../trackers/thinking-stream-tracker";
import type { IdManager } from "../id-manager";
import type { StateManager } from "../state-manager";
import type { ToolRegistry } from "../enhancers/tool-registry";
import { createLogger } from "../../../logger";
import { genId } from "../utils";

const log = createLogger("StreamEventHandler");
const transformLog = createLogger("TransformDetail");

/**
 * StreamEventHandler：处理 stream_event 消息
 *
 * 职责：
 * 1. 路由到对应的 StreamTracker (text/tool/thinking)
 * 2. 捕获 message_start / message_delta token 统计
 * 3. 生成流式 chunk
 * 4. 调用 ToolRegistry.notifyInputComplete
 */
export class StreamEventHandler {
  constructor(
    private textTracker: TextStreamTracker,
    private toolTracker: ToolStreamTracker,
    private thinkingTracker: ThinkingStreamTracker,
    private idManager: IdManager,
    private stateManager: StateManager,
    private toolRegistry: ToolRegistry,
    private isUsingOllama: boolean = false,
  ) {}

  *handle(msg: any): Generator<UIMessageChunk> {
    const event = msg.event;
    if (!event) return;

    // 日志输出
    if (this.isUsingOllama) {
      log.info(
        "[Ollama Transform] STREAM_EVENT:",
        event.type,
        "content_block:",
        event.content_block?.type,
      );
    } else {
      log.info(
        "[transform] stream_event:",
        event.type,
        "delta:",
        event.delta?.type,
        "content_block_type:",
        event.content_block?.type,
      );
    }

    // 警告：content_block_start 但无 type
    if (event.type === "content_block_start" && !event.content_block?.type) {
      log.info(
        "[transform] WARNING: content_block_start with no type, full event:",
        JSON.stringify(event),
      );
    }

    // ===== message_start: 捕获 token 统计 + 重置 thinking 状态 =====
    if (event.type === "message_start") {
      // 重置 thinking 状态防止内存泄漏
      this.thinkingTracker.reset();

      // 捕获 per-API-call input tokens
      const msgUsage = event.message?.usage;
      transformLog.info("message_start usage:", JSON.stringify(msgUsage));
      if (msgUsage?.input_tokens) {
        this.stateManager.setLastApiCallInputTokens(msgUsage.input_tokens);
        transformLog.info(
          "Updated lastApiCallInputTokens:",
          msgUsage.input_tokens,
        );
      }
    }

    // ===== message_delta: 捕获 output tokens =====
    if (event.type === "message_delta" && event.usage?.output_tokens) {
      this.stateManager.setLastApiCallOutputTokens(event.usage.output_tokens);
      transformLog.info(
        "Updated lastApiCallOutputTokens:",
        event.usage.output_tokens,
      );
    }

    // ===== TEXT BLOCK =====
    if (
      event.type === "content_block_start" &&
      event.content_block?.type === "text"
    ) {
      if (this.isUsingOllama) {
        log.info(
          "[Ollama Transform] ✓ TEXT BLOCK START - Model is generating text!",
        );
      } else {
        transformLog.info("TEXT BLOCK START");
      }

      // 结束工具流
      const toolEndChunks = this.toolTracker.end();
      for (const chunk of toolEndChunks) {
        yield chunk;
      }

      // 启动文本流
      const textStartChunks = this.textTracker.start();
      for (const chunk of textStartChunks) {
        yield chunk;
      }

      if (this.isUsingOllama) {
        log.info(
          "[Ollama Transform] textStarted set to TRUE, textId:",
          this.textTracker.getCurrentTextId(),
        );
      } else {
        transformLog.info(
          "textStarted set to TRUE, textId:",
          this.textTracker.getCurrentTextId(),
        );
      }
    }

    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "text_delta"
    ) {
      if (this.isUsingOllama) {
        log.info(
          "[Ollama Transform] ✓ TEXT DELTA received, length:",
          event.delta.text?.length,
          "preview:",
          event.delta.text?.slice(0, 50),
        );
      } else {
        log.info(
          "[transform] TEXT DELTA, textStarted:",
          this.textTracker.getState().textStarted,
          "delta:",
          event.delta.text?.slice(0, 20),
        );
      }

      const textDeltaChunks = this.textTracker.delta(event.delta.text || "");
      for (const chunk of textDeltaChunks) {
        yield chunk;
      }
    }

    // ===== TOOL USE BLOCK =====
    if (
      event.type === "content_block_start" &&
      event.content_block?.type === "tool_use"
    ) {
      // 结束文本流和当前工具流
      const textEndChunks = this.textTracker.end();
      for (const chunk of textEndChunks) {
        yield chunk;
      }
      const toolEndChunks = this.toolTracker.end();
      for (const chunk of toolEndChunks) {
        yield chunk;
      }

      const originalId = event.content_block.id || genId();
      const parentId = this.stateManager.getParentToolUseId();
      const compositeId = this.idManager.makeCompositeId(originalId, parentId);
      const toolName = event.content_block.name || "unknown";

      // 存储映射（包含工具名）
      this.idManager.setMapping(originalId, compositeId, toolName);

      // 启动工具流
      const toolStartChunks = this.toolTracker.start({
        toolCallId: compositeId,
        toolName,
        originalId,
      });
      for (const chunk of toolStartChunks) {
        yield chunk;
      }
    }

    if (event.delta?.type === "input_json_delta") {
      const partialJson = event.delta.partial_json || "";
      const toolDeltaChunks = this.toolTracker.delta(partialJson);
      for (const chunk of toolDeltaChunks) {
        yield chunk;
      }
    }

    // ===== THINKING BLOCK (Extended Thinking) =====
    if (
      event.type === "content_block_start" &&
      event.content_block?.type === "thinking"
    ) {
      const thinkingId = `thinking-${Date.now()}`;

      // 立即标记为已发射（防止 assistant 消息重复）
      this.idManager.markEmitted("thinking-streamed");

      const thinkingStartChunks = this.thinkingTracker.start(thinkingId);
      for (const chunk of thinkingStartChunks) {
        yield chunk;
      }
    }

    if (
      event.delta?.type === "thinking_delta" &&
      this.thinkingTracker.isActive()
    ) {
      const thinkingText = String(event.delta.thinking || "");
      const thinkingDeltaChunks = this.thinkingTracker.delta(thinkingText);
      for (const chunk of thinkingDeltaChunks) {
        yield chunk;
      }
    }

    // ===== content_block_stop: 结束当前流 =====
    if (event.type === "content_block_stop") {
      if (this.isUsingOllama) {
        log.info(
          "[Ollama Transform] CONTENT BLOCK STOP, textStarted:",
          this.textTracker.getState().textStarted,
        );
      } else {
        log.info(
          "[transform] CONTENT BLOCK STOP, textStarted:",
          this.textTracker.getState().textStarted,
        );
      }

      // 结束文本流
      const textEndChunks = this.textTracker.end();
      for (const chunk of textEndChunks) {
        yield chunk;
        // 更新 lastTextId
        if (chunk.type === "text-end") {
          this.stateManager.setLastTextId(chunk.id);
        }
      }

      if (this.isUsingOllama) {
        log.info(
          "[Ollama Transform] after endTextBlock, textStarted:",
          this.textTracker.getState().textStarted,
        );
      }

      // 结束工具流
      // 先获取当前上下文（在 end() 之前）
      const currentContext = this.toolTracker.getCurrentContext();

      const toolEndChunks = this.toolTracker.end();
      for (const chunk of toolEndChunks) {
        yield chunk;
        // 标记工具已发射 + 保存工具输入 + 调用 enhancer
        if (chunk.type === "tool-input-available") {
          this.idManager.markEmitted(chunk.toolCallId);

          // 保存工具输入到 IdManager（用于 UserHandler）
          if (currentContext) {
            this.idManager.setInput(currentContext.originalId, currentContext.input);

            // 通知 ToolRegistry：工具输入完成
            this.toolRegistry.notifyInputComplete({
              toolCallId: currentContext.toolCallId,
              originalId: currentContext.originalId,
              toolName: currentContext.toolName,
              input: currentContext.input,
              parentToolUseId: this.stateManager.getParentToolUseId(),
            });
          }
        }
      }

      // 结束 thinking 流
      if (this.thinkingTracker.isActive()) {
        const thinkingEndChunks = this.thinkingTracker.end();
        for (const chunk of thinkingEndChunks) {
          yield chunk;
          // 标记 thinking 已发射
          if (chunk.type === "reasoning-end") {
            this.idManager.markEmitted(chunk.id);
            this.idManager.markEmitted("thinking-streamed");
          }
        }
      }
    }
  }
}
