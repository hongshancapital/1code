/**
 * Image MCP Extension
 *
 * 将 claude.ts 中的 Image MCP 相关硬编码逻辑迁移为 Hook 注入：
 * - chat:collectMcpServers → 注入 image-gen（条件）和 image-process（无条件）MCP servers
 */

import type {
  ExtensionModule,
  ExtensionContext,
  ToolDefinition,
  CleanupFn,
} from "../../lib/extension/types"
import { ChatHook } from "../../lib/extension/hooks/chat-lifecycle"
import { createImageGenMcpServer, getImageGenToolDefinitions } from "./lib/image-gen-server"
import { createImageProcessMcpServer, getImageProcessToolDefinitions } from "./lib/image-process-server"
import type { McpServerEntry } from "../../lib/extension/hooks/chat-lifecycle"

class ImageMcpExtension implements ExtensionModule {
  name = "image-mcp" as const
  description = "Image generation and processing MCP server injection"

  initialize(ctx: ExtensionContext): CleanupFn {
    // chat:collectMcpServers — 注入 image MCP servers
    const off = ctx.hooks.on(
      ChatHook.CollectMcpServers,
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
    )

    return off
  }

  async listTools(): Promise<{ category: string; tools: ToolDefinition[] }[]> {
    const dummyCtx = { cwd: process.cwd(), subChatId: "tool-discovery", apiConfig: { baseUrl: "", apiKey: "", model: "" } }
    const results: { category: string; tools: ToolDefinition[] }[] = []
    const fmt = (t: any): ToolDefinition => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || t.input_schema || {},
    })

    try {
      const genDefs = await getImageGenToolDefinitions(dummyCtx)
      results.push({ category: "imageGen", tools: genDefs.map(fmt) })
    } catch { /* image-gen might not be available */ }

    try {
      const procDefs = await getImageProcessToolDefinitions(dummyCtx)
      results.push({ category: "imageProcess", tools: procDefs.map(fmt) })
    } catch { /* ignore */ }

    return results
  }

}

export const imageMcpExtension = new ImageMcpExtension()
