import type { UIMessageChunk, MCPServer, MCPServerStatus } from "../../types";
import type { SystemCompactEnhancer } from "../enhancers/system-compact-enhancer";
import { createLogger } from "../../../logger";

const log = createLogger("SystemHandler");
const transformLog = createLogger("TransformDetail");

/**
 * SystemHandler：处理 system 消息
 *
 * 职责：
 * 1. 处理 init（session-init chunk，包含 MCP servers / tools / plugins）
 * 2. 处理 compacting 状态机（status:compacting → compact_boundary）
 * 3. 处理 task_notification（后台任务状态更新）
 */
export class SystemHandler {
  constructor(private compactEnhancer: SystemCompactEnhancer) {}

  *handle(msg: any): Generator<UIMessageChunk> {
    // DEBUG: 记录所有 system 消息
    log.info(
      "[transform] SYSTEM subtype:",
      msg.subtype,
      "full msg:",
      JSON.stringify(msg),
    );

    // ===== SESSION INIT =====
    if (msg.subtype === "init") {
      log.info("[MCP Transform] Received SDK init message:", {
        tools: msg.tools?.length,
        mcp_servers: msg.mcp_servers,
        plugins: msg.plugins,
        skills: msg.skills?.length,
      });

      // 映射 MCP servers（验证 status 类型）
      const mcpServers: MCPServer[] = (msg.mcp_servers || []).map(
        (s: {
          name: string;
          status: string;
          serverInfo?: {
            name: string;
            version: string;
            icons?: {
              src: string;
              mimeType?: string;
              sizes?: string[];
              theme?: "light" | "dark";
            }[];
          };
          error?: string;
        }) => {
          const validStatus = ["connected", "failed", "pending", "needs-auth"];
          return {
            name: s.name,
            status: (validStatus.includes(s.status)
              ? s.status
              : "pending") as MCPServerStatus,
            ...(s.serverInfo && { serverInfo: s.serverInfo }),
            ...(s.error && { error: s.error }),
          };
        },
      );

      yield {
        type: "session-init",
        tools: msg.tools || [],
        mcpServers,
        plugins: msg.plugins || [],
        skills: msg.skills || [],
      };
    }

    // ===== COMPACTING STATUS =====
    if (msg.subtype === "status" && msg.status === "compacting") {
      const { compactId } = this.compactEnhancer.startCompacting();
      yield {
        type: "system-Compact",
        toolCallId: compactId,
        state: "input-streaming",
      };
    }

    // ===== COMPACT BOUNDARY =====
    if (msg.subtype === "compact_boundary") {
      const { compactId } = this.compactEnhancer.finishCompacting();
      if (compactId) {
        yield {
          type: "system-Compact",
          toolCallId: compactId,
          state: "output-available",
        };
      }
    }

    // ===== TASK NOTIFICATION =====
    if (msg.subtype === "task_notification") {
      transformLog.info("Task notification received:", {
        task_id: msg.task_id,
        status: msg.status,
        output_file: msg.output_file,
        summary: msg.summary,
      });

      yield {
        type: "task-notification",
        taskId: msg.task_id,
        shellId: msg.task_id, // SDK 不提供 shell_id，使用 task_id
        status: msg.status,
        outputFile: msg.output_file,
        summary: msg.summary,
      };
    }
  }
}
