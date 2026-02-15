/**
 * Image MCP Extension
 *
 * 将 claude.ts 中的 Image MCP 相关硬编码逻辑迁移为 Hook 注入：
 * - chat:collectMcpServers → 注入 image-gen（条件）和 image-process（无条件）MCP servers
 */

import type {
  ExtensionModule,
  ExtensionContext,
} from "../../lib/extension/types"
import { createImageGenMcpServer } from "../../lib/mcp/image-gen-server"
import { createImageProcessMcpServer } from "../../lib/mcp/image-process-server"
import type { McpServerEntry } from "../../lib/extension/hooks/chat-lifecycle"

class ImageMcpExtension implements ExtensionModule {
  name = "image-mcp" as const
  description = "Image generation and processing MCP server injection"

  private cleanupFns: Array<() => void> = []

  async initialize(ctx: ExtensionContext): Promise<void> {
    // chat:collectMcpServers — 注入 image MCP servers
    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:collectMcpServers",
        async (payload) => {
          if (payload.isOllama) return []

          const entries: McpServerEntry[] = []

          // Image Gen（条件注入：需要 imageConfig）
          if (payload.imageConfig) {
            ctx.log(
              "[Image Gen MCP] imageConfig:",
              `provider=${payload.imageConfig.model} baseUrl=${payload.imageConfig.baseUrl}`,
            )
            try {
              const imageGenMcp = await createImageGenMcpServer({
                cwd: payload.cwd,
                subChatId: payload.subChatId,
                apiConfig: {
                  baseUrl: payload.imageConfig.baseUrl,
                  apiKey: payload.imageConfig.apiKey,
                  model: payload.imageConfig.model,
                },
              })
              entries.push({ name: "image-gen", config: imageGenMcp })
            } catch (err) {
              ctx.error("[Image Gen MCP] Failed to create server:", err)
            }
          }

          // Image Process（无条件注入）
          try {
            const imageProcessMcp = await createImageProcessMcpServer({
              cwd: payload.cwd,
              subChatId: payload.subChatId,
            })
            entries.push({ name: "image-process", config: imageProcessMcp })
          } catch (err) {
            ctx.error("[Image Process MCP] Failed to create server:", err)
          }

          return entries
        },
        { source: this.name },
      ),
    )
  }

  async cleanup(): Promise<void> {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
  }
}

export const imageMcpExtension = new ImageMcpExtension()
