import type { UIMessageChunk } from "../../types";
import type { IdManager } from "../id-manager";
import type { ToolRegistry } from "../enhancers/tool-registry";
import type { StateManager } from "../state-manager";
import { createLogger } from "../../../logger";

const log = createLogger("UserHandler");

/**
 * UserHandler：处理 user 消息（tool_result）
 *
 * 职责：
 * 1. 处理 tool_result 块
 * 2. 调用 ToolRegistry 增强输出（如 Bash 后台任务检测）
 * 3. 发射 tool-output-available / tool-output-error chunk
 */
export class UserHandler {
  constructor(
    private idManager: IdManager,
    private toolRegistry: ToolRegistry,
    private stateManager: StateManager,
  ) {}

  *handle(msg: any): Generator<UIMessageChunk> {
    if (!msg.message?.content || !Array.isArray(msg.message.content)) {
      return;
    }

    // DEBUG: 记录消息结构
    log.info("[Transform DEBUG] User message:", {
      tool_use_result: msg.tool_use_result,
      tool_use_result_type: typeof msg.tool_use_result,
      content_length: msg.message.content.length,
      blocks: msg.message.content.map((b: any) => ({
        type: b.type,
        tool_use_id: b.tool_use_id,
        content_preview:
          typeof b.content === "string"
            ? b.content.slice(0, 100)
            : typeof b.content,
      })),
    });

    for (const block of msg.message.content) {
      if (block.type !== "tool_result") continue;

      // 查找复合 ID（支持嵌套工具）
      const compositeId =
        this.idManager.getCompositeId(block.tool_use_id) || block.tool_use_id;

      // ===== 错误结果 =====
      if (block.is_error) {
        yield {
          type: "tool-output-error",
          toolCallId: compositeId,
          errorText: String(block.content),
        };
        continue;
      }

      // ===== 正常结果 =====
      // 解析结构化数据
      let output = msg.tool_use_result;
      if (!output && typeof block.content === "string") {
        try {
          // 尝试解析 JSON 嵌入
          const parsed = JSON.parse(block.content);
          if (parsed && typeof parsed === "object") {
            output = parsed;
          }
        } catch {
          // 非 JSON，使用原始内容
        }
      }
      output = output || block.content;

      log.info("[Transform DEBUG] Tool output:", {
        tool_use_id: block.tool_use_id,
        compositeId,
        output_type: typeof output,
        output_keys:
          output && typeof output === "object" ? Object.keys(output) : null,
        numFiles: output?.numFiles,
        backgroundTaskId: output?.backgroundTaskId,
      });

      // ===== 工具增强（如 Bash 后台任务检测）=====
      const toolName = this.idManager.getToolName(block.tool_use_id) || "unknown";
      const toolInput = this.idManager.getInput(block.tool_use_id) || {};

      const enhancedChunks = this.toolRegistry.collectEnhancedOutput({
        toolCallId: compositeId,
        originalId: block.tool_use_id,
        toolName,
        input: toolInput,
        output,
        rawContent: block.content,
        isError: false,
        parentToolUseId: this.stateManager.getParentToolUseId(),
      });

      for (const chunk of enhancedChunks) {
        yield chunk;
      }

      // ===== 发射工具输出 =====
      yield {
        type: "tool-output-available",
        toolCallId: compositeId,
        output,
      };
    }
  }
}
