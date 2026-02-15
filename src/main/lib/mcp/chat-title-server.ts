/**
 * Chat Title MCP Server
 *
 * Provides a `rename_chat` tool for the agent to update the current
 * sub-chat title when the conversation topic has shifted.
 *
 * Uses @anthropic-ai/claude-agent-sdk's createSdkMcpServer for seamless integration.
 */

import { z } from "zod"
import { BrowserWindow } from "electron"
import { getDatabase, subChats, chats } from "../db"
import { eq, asc } from "drizzle-orm"

// Dynamic import for ESM module
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null

async function getSdkModule() {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk")
  }
  return sdkModule
}

export interface ChatTitleMcpContext {
  subChatId: string
  chatId: string
}

export async function getChatTitleToolDefinitions(context: ChatTitleMcpContext) {
  const { tool } = await getSdkModule()

  return [
    tool(
      "rename_chat",
      `Rename the current chat session title.

Use this tool when the conversation topic has clearly shifted away from the current title, making the existing title misleading or outdated. Only rename when the shift is significant — don't rename for minor tangents or follow-up questions on the same topic.

Guidelines:
- Keep titles concise (under 50 characters when possible)
- Use the same language as the user's messages
- Summarize the new dominant topic accurately
- Don't rename if the original topic is still the main focus`,
      {
        title: z.string().min(1).max(100).describe("The new title for this chat session"),
      },
      async (args): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
        const { title } = args

        try {
          const db = getDatabase()

          // Update sub-chat name (without setting manuallyRenamed)
          db.update(subChats)
            .set({ name: title, updatedAt: new Date() })
            .where(eq(subChats.id, context.subChatId))
            .run()

          // Check if this is the first sub-chat of its parent chat
          // If so, also update the parent chat name for sidebar display
          const firstSubChat = db
            .select({ id: subChats.id })
            .from(subChats)
            .where(eq(subChats.chatId, context.chatId))
            .orderBy(asc(subChats.createdAt))
            .limit(1)
            .get()

          const isFirstSubChat = firstSubChat?.id === context.subChatId

          if (isFirstSubChat) {
            db.update(chats)
              .set({ name: title, updatedAt: new Date() })
              .where(eq(chats.id, context.chatId))
              .run()
          }

          // Notify frontend via IPC (reuse existing event)
          BrowserWindow.getAllWindows().forEach((win) => {
            win.webContents.send("sub-chat:ai-name-ready", {
              subChatId: context.subChatId,
              chatId: context.chatId,
              name: title,
              isFirstSubChat,
            })
          })

          console.log(`[ChatTitleMcp] Renamed sub-chat ${context.subChatId} to: ${title}`)

          return {
            content: [
              {
                type: "text",
                text: `Chat title updated to: ${title}`,
              },
            ],
          }
        } catch (error) {
          console.error("[ChatTitleMcp] Failed to rename:", error)
          return {
            content: [
              {
                type: "text",
                text: `Failed to rename chat: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
          }
        }
      },
    ),
  ]
}

export async function createChatTitleMcpServer(context: ChatTitleMcpContext) {
  const { createSdkMcpServer } = await getSdkModule()
  const tools = await getChatTitleToolDefinitions(context)

  return createSdkMcpServer({
    name: "chat-title",
    version: "1.0.0",
    tools,
  })
}
