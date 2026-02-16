import type { ToolEnhancer, ToolContext, ToolOutputContext } from "../interfaces";
import type { UIMessageChunk } from "../../types";
import { createLogger } from "../../../logger";

const log = createLogger("BashEnhancer");

/**
 * Bash 工具增强器：处理后台任务检测与通知
 *
 * 职责：
 * 1. 捕获 Bash 命令 (onInputComplete)
 * 2. 检测 backgroundTaskId (enhanceOutput)
 * 3. 生成 task-notification chunk
 */
export class BashEnhancer implements ToolEnhancer {
  private bashCommandMapping = new Map<string, string>();

  priority = 10;

  matches(toolName: string): boolean {
    return toolName === "Bash";
  }

  onInputComplete(context: ToolContext): void {
    const command = context.input.command as string;
    if (command) {
      // 使用 originalId (工具结果中使用原始 ID)
      this.bashCommandMapping.set(context.originalId, command);
    }
  }

  enhanceOutput(context: ToolOutputContext): UIMessageChunk[] {
    if (context.isError) return [];

    const output = context.output as any;

    // 检测后台任务
    if (output?.backgroundTaskId) {
      const bashCommand = this.bashCommandMapping.get(context.originalId);
      log.info(
        "Background task started:",
        output.backgroundTaskId,
        "command:",
        bashCommand,
      );

      // 生成任务摘要 (截断长命令)
      let summary: string;
      if (bashCommand) {
        summary =
          bashCommand.length > 60
            ? bashCommand.slice(0, 57) + "..."
            : bashCommand;
      } else {
        summary = `Background task ${output.backgroundTaskId}`;
      }

      // 提取 outputFile 路径
      let outputFile: string | undefined;
      if (typeof context.rawContent === "string") {
        const match = context.rawContent.match(
          /Output is being written to: (\/[^\n\r]+)/,
        );
        if (match) {
          outputFile = match[1].trim();
        }
      }
      // 也检查 content 数组 (tool_result 可能有数组内容)
      if (!outputFile && Array.isArray(context.rawContent)) {
        for (const item of context.rawContent) {
          if (item.type === "text" && typeof item.text === "string") {
            const match = item.text.match(
              /Output is being written to: (\/[^\n\r]+)/,
            );
            if (match) {
              outputFile = match[1].trim();
              break;
            }
          }
        }
      }

      log.info("Background task outputFile extraction:", {
        contentType: typeof context.rawContent,
        isArray: Array.isArray(context.rawContent),
        extractedPath: outputFile,
      });

      return [
        {
          type: "task-notification",
          taskId: output.backgroundTaskId,
          shellId: output.backgroundTaskId,
          status: "running" as const,
          outputFile,
          summary,
          command: bashCommand,
        },
      ];
    }

    return [];
  }

  /**
   * 清空命令映射 (用于测试)
   */
  clear(): void {
    this.bashCommandMapping.clear();
  }
}
