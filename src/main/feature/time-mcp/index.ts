/**
 * Time MCP Extension
 *
 * Injects a `get_current_time` MCP tool into the agent's available tools.
 * Provides the agent with the ability to query the current date and time.
 */

import type {
  ExtensionModule,
  ExtensionContext,
  CleanupFn,
} from "../../lib/extension/types"
import { ChatHook, type McpServerEntry } from "../../lib/extension/hooks/chat-lifecycle"
import { createTimeMcpServer } from "./lib/time-server"

class TimeMcpExtension implements ExtensionModule {
  name = "time-mcp" as const
  description = "Time query tool for agents"

  initialize(ctx: ExtensionContext): CleanupFn {
    // chat:collectMcpServers — inject time MCP tool
    const offCollect = ctx.hooks.on(
      ChatHook.CollectMcpServers,
      async (payload) => {
        // Skip for Ollama (only available for Anthropic Claude)
        if (payload.isOllama) return []

        try {
          const server = await createTimeMcpServer()
          return [{ name: "time", config: server }] as McpServerEntry[]
        } catch (err) {
          ctx.error("[Time MCP] Failed to create server:", err)
          return []
        }
      },
      { source: this.name }
    )

    return () => {
      offCollect()
    }
  }
}

export const timeMcpExtension = new TimeMcpExtension()
