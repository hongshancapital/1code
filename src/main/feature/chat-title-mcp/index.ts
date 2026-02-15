/**
 * Chat Title MCP Extension
 *
 * Injects a `rename_chat` MCP tool and chat title context into the system prompt:
 * - chat:collectMcpServers → conditionally inject chat-title MCP server
 *   (only when user hasn't manually renamed the sub-chat)
 * - chat:enhancePrompt → inject current title context into system prompt
 */

import type {
  ExtensionModule,
  ExtensionContext,
  CleanupFn,
} from "../../lib/extension/types"
import type { McpServerEntry } from "../../lib/extension/hooks/chat-lifecycle"
import { createChatTitleMcpServer } from "../../lib/mcp/chat-title-server"
import { getDatabase, subChats } from "../../lib/db"
import { eq } from "drizzle-orm"

class ChatTitleMcpExtension implements ExtensionModule {
  name = "chat-title-mcp" as const
  description = "Chat title awareness and rename tool for agents"

  initialize(ctx: ExtensionContext): CleanupFn {
    // chat:collectMcpServers — conditionally inject rename_chat MCP tool
    const offCollect = ctx.hooks.on(
      "chat:collectMcpServers",
      async (payload) => {
        if (payload.isOllama) return []

        try {
          const db = getDatabase()
          const subChat = db
            .select({
              name: subChats.name,
              chatId: subChats.chatId,
              manuallyRenamed: subChats.manuallyRenamed,
            })
            .from(subChats)
            .where(eq(subChats.id, payload.subChatId))
            .get()

          // Don't provide rename tool if user manually renamed
          if (!subChat || subChat.manuallyRenamed) return []

          const server = await createChatTitleMcpServer({
            subChatId: payload.subChatId,
            chatId: subChat.chatId,
          })

          return [{ name: "chat-title", config: server }] as McpServerEntry[]
        } catch (err) {
          ctx.error("[Chat Title MCP] Failed to create server:", err)
          return []
        }
      },
      { source: this.name },
    )

    // chat:enhancePrompt — inject current title into system prompt
    const offEnhance = ctx.hooks.on(
      "chat:enhancePrompt",
      (payload) => {
        try {
          const db = getDatabase()
          const subChat = db
            .select({
              name: subChats.name,
              manuallyRenamed: subChats.manuallyRenamed,
            })
            .from(subChats)
            .where(eq(subChats.id, payload.subChatId))
            .get()

          // Skip: no title yet, or user manually renamed (no need to intervene)
          if (!subChat?.name || subChat.manuallyRenamed) return payload

          return {
            ...payload,
            appendSections: [
              ...payload.appendSections,
              `# Current Chat Title
This chat is currently titled: "${subChat.name}"
If the conversation topic shifts significantly from this title, use the \`rename_chat\` MCP tool to update it to better reflect the current discussion. Only rename when the shift is meaningful — minor tangents don't warrant a title change.`,
            ],
          }
        } catch (err) {
          ctx.error("[Chat Title MCP] Failed to build title context:", err)
          return payload
        }
      },
      { source: this.name, priority: 300 },
    )

    return () => {
      offCollect()
      offEnhance()
    }
  }
}

export const chatTitleMcpExtension = new ChatTitleMcpExtension()
