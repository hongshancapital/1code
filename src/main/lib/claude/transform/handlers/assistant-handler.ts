import type { UIMessageChunk } from "../../types";
import type { TextStreamTracker } from "../trackers/text-stream-tracker";
import type { ToolStreamTracker } from "../trackers/tool-stream-tracker";
import type { IdManager } from "../id-manager";
import type { StateManager } from "../state-manager";
import type { ToolRegistry } from "../enhancers/tool-registry";
import { createLogger } from "../../../logger";
import { genId } from "../utils";

const log = createLogger("AssistantHandler");

/**
 * AssistantHandler：处理 assistant 消息（完整内容块）
 *
 * 职责：
 * 1. 处理 assistant 消息中的 text/tool_use/thinking 块
 * 2. 去重流式已发射的内容（避免重复）
 * 3. 存储工具调用映射（用于 tool-result 匹配）
 * 4. 调用 ToolRegistry.notifyInputComplete
 */
export class AssistantHandler {
  constructor(
    private textTracker: TextStreamTracker,
    private toolTracker: ToolStreamTracker,
    private idManager: IdManager,
    private stateManager: StateManager,
    private toolRegistry: ToolRegistry,
  ) {}

  *handle(msg: any): Generator<UIMessageChunk> {
    if (!msg.message?.content) return;

    for (const block of msg.message.content) {
      // ===== THINKING BLOCK =====
      if (block.type === "thinking" && block.thinking) {
        // 跳过已流式发射的 thinking
        if (this.idManager.isEmitted("thinking-streamed")) {
          continue;
        }

        // 标记已发射（防止重复）
        this.idManager.markEmitted("thinking-streamed");

        // 发射完整 thinking 块（fallback when streaming missed）
        const thinkingId = genId();
        yield { type: "reasoning-start", id: thinkingId };
        yield { type: "reasoning-delta", id: thinkingId, delta: block.thinking };
        yield { type: "reasoning-end", id: thinkingId };
      }

      // ===== TEXT BLOCK =====
      if (block.type === "text") {
        log.info(
          "[transform] ASSISTANT TEXT block, textStarted:",
          this.textTracker.getState().textStarted,
          "text length:",
          block.text?.length,
        );

        // 结束工具流
        const toolEndChunks = this.toolTracker.end();
        for (const chunk of toolEndChunks) {
          yield chunk;
        }

        // 只在未流式发射时才发射文本
        // (当 includePartialMessages=true 时，text 已通过 stream_event 发射)
        if (!this.textTracker.getState().textStarted) {
          log.info("[transform] EMITTING assistant text (textStarted was false)");

          const textId = genId();
          yield { type: "text-start", id: textId };
          yield { type: "text-delta", id: textId, delta: block.text };
          yield { type: "text-end", id: textId };

          // 更新 lastTextId
          this.stateManager.setLastTextId(textId);
        } else {
          log.info("[transform] SKIPPING assistant text (textStarted is true)");
        }
      }

      // ===== TOOL_USE BLOCK =====
      if (block.type === "tool_use") {
        // 结束文本流和工具流
        const textEndChunks = this.textTracker.end();
        for (const chunk of textEndChunks) {
          yield chunk;
        }
        const toolEndChunks = this.toolTracker.end();
        for (const chunk of toolEndChunks) {
          yield chunk;
        }

        // 跳过已流式发射的工具
        if (this.idManager.isEmitted(block.id)) {
          log.info(
            "[transform] SKIPPING duplicate tool_use (already emitted via streaming):",
            block.id,
          );
          continue;
        }

        // 标记已发射
        this.idManager.markEmitted(block.id);

        const parentId = this.stateManager.getParentToolUseId();
        const compositeId = this.idManager.makeCompositeId(block.id, parentId);

        // 存储映射（用于 tool-result 匹配，包含工具名和输入）
        this.idManager.setMapping(block.id, compositeId, block.name);
        this.idManager.setInput(block.id, block.input);

        // 通知 ToolRegistry：工具输入完成
        this.toolRegistry.notifyInputComplete({
          toolCallId: compositeId,
          originalId: block.id,
          toolName: block.name,
          input: block.input,
          parentToolUseId: parentId,
        });

        yield {
          type: "tool-input-available",
          toolCallId: compositeId,
          toolName: block.name,
          input: block.input,
        };
      }
    }
  }
}
