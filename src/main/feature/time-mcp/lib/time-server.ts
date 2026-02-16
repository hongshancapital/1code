/**
 * Time MCP Server
 *
 * Provides a `get_current_time` tool for the agent to retrieve the current
 * date and time in ISO 8601 format.
 *
 * Uses @anthropic-ai/claude-agent-sdk's createSdkMcpServer for seamless integration.
 */

import { z } from "zod"
import { createLogger } from "../../../lib/logger"

const timeMcpLog = createLogger("TimeMcp")

// Dynamic import for ESM module
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null

async function getSdkModule() {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk")
  }
  return sdkModule
}

export async function getTimeToolDefinitions() {
  const { tool } = await getSdkModule()

  return [
    tool(
      "get_current_time",
      `Get the current date and time.

Returns the current date and time in ISO 8601 format (e.g., "2026-02-16T14:30:00.000Z").

Use this tool when you need to:
- Know the current date or time
- Calculate time differences or schedules
- Generate timestamps for logs or records
- Perform time-based operations`,
      {
        format: z
          .enum(["iso", "locale", "unix"])
          .optional()
          .default("iso")
          .describe(
            "Output format: 'iso' for ISO 8601, 'locale' for human-readable local time, 'unix' for Unix timestamp"
          ),
      },
      async (args): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
        const { format } = args

        try {
          const now = new Date()
          let timeString: string

          switch (format) {
            case "locale":
              timeString = now.toLocaleString("zh-CN", {
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
              })
              break
            case "unix":
              timeString = Math.floor(now.getTime() / 1000).toString()
              break
            case "iso":
            default:
              timeString = now.toISOString()
              break
          }

          timeMcpLog.debug(`Time requested in ${format} format: ${timeString}`)

          return {
            content: [
              {
                type: "text",
                text: `Current time (${format}): ${timeString}`,
              },
            ],
          }
        } catch (error) {
          timeMcpLog.error("Failed to get time:", error)
          return {
            content: [
              {
                type: "text",
                text: `Failed to get current time: ${error instanceof Error ? error.message : "Unknown error"}`,
              },
            ],
          }
        }
      }
    ),
  ]
}

export async function createTimeMcpServer() {
  const { createSdkMcpServer } = await getSdkModule()
  const tools = await getTimeToolDefinitions()

  return createSdkMcpServer({
    name: "time",
    version: "1.0.0",
    tools,
  })
}
