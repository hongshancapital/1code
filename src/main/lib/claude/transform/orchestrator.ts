import type { UIMessageChunk, MessageMetadata } from "../types";
import type { StreamEventHandler } from "./handlers/stream-event-handler";
import type { AssistantHandler } from "./handlers/assistant-handler";
import type { UserHandler } from "./handlers/user-handler";
import type { SystemHandler } from "./handlers/system-handler";
import type { StateManager } from "./state-manager";
import { createLogger } from "../../logger";

const log = createLogger("TransformOrchestrator");

/**
 * TransformOrchestrator：主协调器
 *
 * 职责：
 * 1. 路由消息到对应 handler
 * 2. 生成 start/finish chunk
 * 3. 构建 message-metadata
 * 4. 追踪 parent_tool_use_id
 */
export class TransformOrchestrator {
  constructor(
    private streamEventHandler: StreamEventHandler,
    private assistantHandler: AssistantHandler,
    private userHandler: UserHandler,
    private systemHandler: SystemHandler,
    private stateManager: StateManager,
    private options: {
      emitSdkMessageUuid?: boolean;
      isUsingOllama?: boolean;
    } = {},
  ) {}

  *process(msg: any): Generator<UIMessageChunk> {
    // DEBUG: 日志记录
    if (this.options.isUsingOllama) {
      log.debug(
        "[Ollama Transform] MSG:",
        msg.type,
        msg.subtype || "",
        msg.event?.type || "",
      );
      if (msg.type === "system") {
        log.debug(
          "[Ollama Transform] SYSTEM message full:",
          JSON.stringify(msg, null, 2),
        );
      }
      if (msg.type === "stream_event") {
        log.debug(
          "[Ollama Transform] STREAM_EVENT:",
          msg.event?.type,
          "content_block:",
          msg.event?.content_block?.type,
        );
      }
      if (msg.type === "assistant") {
        log.debug(
          "[Ollama Transform] ASSISTANT message, content blocks:",
          msg.message?.content?.length || 0,
        );
      }
    } else {
      log.debug(
        "[transform] MSG:",
        msg.type,
        msg.subtype || "",
        msg.event?.type || "",
      );
    }

    // 追踪 parent_tool_use_id（嵌套工具）
    if (msg.parent_tool_use_id !== undefined) {
      this.stateManager.setParentToolUseId(msg.parent_tool_use_id);
    }

    // 发射 start（仅一次）
    if (!this.stateManager.isStarted()) {
      this.stateManager.start();
      yield { type: "start" };
      yield { type: "start-step" };
    }

    // ===== 路由到对应 handler =====
    if (msg.type === "stream_event") {
      const chunks = this.streamEventHandler.handle(msg);
      for (const chunk of chunks) {
        yield chunk;
      }
    } else if (msg.type === "assistant") {
      const chunks = this.assistantHandler.handle(msg);
      for (const chunk of chunks) {
        yield chunk;
      }
    } else if (msg.type === "user") {
      const chunks = this.userHandler.handle(msg);
      for (const chunk of chunks) {
        yield chunk;
      }
    } else if (msg.type === "system") {
      const chunks = this.systemHandler.handle(msg);
      for (const chunk of chunks) {
        yield chunk;
      }
    } else if (msg.type === "result") {
      // 处理 result（最终消息）
      yield* this.handleResult(msg);
    }
  }

  private *handleResult(msg: any): Generator<UIMessageChunk> {
    // DEBUG: 日志 token 数据
    const transformLog = createLogger("TransformDetail");
    transformLog.debug("RESULT msg.usage:", JSON.stringify(msg.usage));
    log.debug("[transform] RESULT msg.modelUsage:", JSON.stringify(msg.modelUsage));

    const inputTokens = msg.usage?.input_tokens;
    const outputTokens = msg.usage?.output_tokens;

    // 提取 per-model usage
    const modelUsage = msg.modelUsage
      ? Object.fromEntries(
          Object.entries(msg.modelUsage).map(([model, usage]: [string, any]) => [
            model,
            {
              inputTokens: usage.inputTokens || 0,
              outputTokens: usage.outputTokens || 0,
              cacheReadInputTokens: usage.cacheReadInputTokens || 0,
              cacheCreationInputTokens: usage.cacheCreationInputTokens || 0,
              costUSD: usage.costUSD || 0,
            },
          ]),
        )
      : undefined;

    const lastCallInputTokens = this.stateManager.getLastApiCallInputTokens();
    const lastCallOutputTokens = this.stateManager.getLastApiCallOutputTokens();

    transformLog.debug("Building metadata with lastCall tokens:", {
      lastCallInputTokens,
      lastCallOutputTokens,
      inputTokens,
      outputTokens,
    });

    const metadata: MessageMetadata = {
      sessionId: msg.session_id,
      sdkMessageUuid: this.options.emitSdkMessageUuid ? msg.uuid : undefined,
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens && outputTokens ? inputTokens + outputTokens : undefined,
      totalCostUsd: msg.total_cost_usd,
      durationMs: this.stateManager.getStartTime()
        ? Date.now() - this.stateManager.getStartTime()!
        : undefined,
      resultSubtype: msg.subtype || "success",
      // finalTextId 用于折叠工具（当有最终响应时）
      finalTextId: this.stateManager.getLastTextId() || undefined,
      modelUsage,
      lastCallInputTokens: lastCallInputTokens || undefined,
      lastCallOutputTokens: lastCallOutputTokens || undefined,
    };

    transformLog.debug("Emitting message-metadata:", JSON.stringify(metadata));

    yield { type: "message-metadata", messageMetadata: metadata };
    yield { type: "finish-step" };
    yield { type: "finish", messageMetadata: metadata };
  }
}
