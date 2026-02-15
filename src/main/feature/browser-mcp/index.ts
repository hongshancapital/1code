/**
 * Browser MCP Extension
 *
 * 将 claude.ts 中的 Browser 相关硬编码逻辑迁移为 Hook 注入：
 * - chat:collectMcpServers → 注入 browser MCP server
 * - chat:enhancePrompt → 注入 Active Browser Context 到 system prompt
 */

import type {
  ExtensionModule,
  ExtensionContext,
} from "../../lib/extension/types"
import { createBrowserMcpServer, browserManager } from "../../lib/browser"

class BrowserMcpExtension implements ExtensionModule {
  name = "browser-mcp" as const
  description = "Browser MCP server injection and context enhancement"

  private cleanupFns: Array<() => void> = []

  async initialize(ctx: ExtensionContext): Promise<void> {
    // chat:collectMcpServers — 注入 browser MCP server
    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:collectMcpServers",
        async (payload) => {
          if (payload.isOllama) return []

          try {
            const browserMcp = await createBrowserMcpServer()
            if (payload.cwd) {
              browserManager.workingDirectory = payload.cwd
            }
            ctx.log(
              "[Browser MCP] Added browser MCP server (ready:",
              browserManager.isReady,
              ")",
            )
            return [{ name: "browser", config: browserMcp }]
          } catch (err) {
            ctx.error("[Browser MCP] Failed to create server:", err)
            return []
          }
        },
        { source: this.name },
      ),
    )

    // chat:enhancePrompt — Browser context 注入（priority=200，在 Memory 之后）
    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:enhancePrompt",
        (payload) => {
          if (
            browserManager.isReady &&
            browserManager.currentUrl &&
            browserManager.currentUrl !== "about:blank"
          ) {
            const browserTitle = browserManager.currentTitle || "Unknown"
            const browserUrl = browserManager.currentUrl
            return {
              ...payload,
              appendSections: [
                ...payload.appendSections,
                `# Active Browser Context
The user is currently using the built-in browser and viewing:
- **Page Title**: ${browserTitle}
- **URL**: ${browserUrl}

If the user needs help with the page content, you can use the browser MCP tools (browser_lock, browser_snapshot, browser_click, browser_fill, browser_screenshot, etc.) to assist them. Remember to call browser_lock before and browser_unlock after using browser tools.`,
              ],
            }
          }
          return payload
        },
        { source: this.name, priority: 200 },
      ),
    )
  }

  async cleanup(): Promise<void> {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
  }
}

export const browserMcpExtension = new BrowserMcpExtension()
