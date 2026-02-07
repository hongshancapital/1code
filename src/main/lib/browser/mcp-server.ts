/**
 * Browser MCP Server
 * Exposes browser automation tools to Claude Agent SDK
 *
 * Design: Each tool is a simple, focused function
 * Tools follow the agent-browser pattern (ref-based element selection)
 */

import { z } from "zod"
import { browserManager } from "./manager"
import type {
  ClickOptions,
  DownloadOptions,
  EmulateOptions,
  FillOptions,
  NavigateOptions,
  ScreenshotOptions,
  ScreenshotResult,
  ScrollOptions,
  SnapshotOptions,
  SnapshotResult,
  WaitOptions,
} from "./types"

// Dynamic import for ESM module
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null

async function getSdkModule() {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk")
  }
  return sdkModule
}

/** Element ref schema (e.g., "@e1", "@e42") */
const refSchema = z.string().regex(/^@e\d+$/).optional()
  .describe("Element reference from snapshot (e.g., @e2)")

/** CSS selector schema */
const selectorSchema = z.string().optional()
  .describe("CSS selector (fallback when ref not available)")

/** Tool result type */
type ToolResult = { content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> }

/**
 * Create Browser MCP server with all browser automation tools
 */
export async function createBrowserMcpServer() {
  const { createSdkMcpServer, tool } = await getSdkModule()

  return createSdkMcpServer({
    name: "browser",
    version: "1.0.0",
    tools: [
      // ============================================================================
      // Core Tools
      // ============================================================================

      tool(
        "browser_snapshot",
        `Get accessibility tree snapshot with element references.
Call this first to see interactive elements on the page.
Each element has a ref (e.g., @e1, @e2) that you can use with other browser tools.

【Output Format】
[e1] button "Sign In"
[e2] textbox "Email" placeholder="Enter email"
[e3] link "Forgot password?"

【Usage】
1. Call browser_snapshot to get element refs
2. Find the target element's ref (e.g., @e2)
3. Use that ref with browser_click, browser_fill, etc.
4. After page changes, call snapshot again (refs may change)`,
        {
          interactiveOnly: z.boolean().default(true)
            .describe("Only include interactive elements (buttons, links, inputs)"),
        },
        async ({ interactiveOnly = true }: SnapshotOptions): Promise<ToolResult> => {
          const result = await browserManager.execute<SnapshotResult>("snapshot", { interactiveOnly })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: result.data?.snapshot || "Empty page" }] }
        }
      ),

      tool(
        "browser_navigate",
        "Navigate to a URL. Opens the page in the browser.",
        {
          url: z.string().url().describe("URL to navigate to"),
          waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional()
            .describe("When to consider navigation complete"),
        },
        async ({ url, waitUntil }: NavigateOptions): Promise<ToolResult> => {
          const result = await browserManager.execute("navigate", { url, waitUntil })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: `Navigated to ${url}` }] }
        }
      ),

      tool(
        "browser_click",
        "Click an element. Use ref from snapshot (preferred) or CSS selector.",
        {
          ref: refSchema,
          selector: selectorSchema,
          dblClick: z.boolean().default(false).describe("Double click"),
        },
        async ({ ref, selector, dblClick }: ClickOptions): Promise<ToolResult> => {
          if (!ref && !selector) {
            return { content: [{ type: "text", text: "Error: ref or selector required" }] }
          }
          const result = await browserManager.execute("click", { ref, selector, dblClick })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Clicked" }] }
        }
      ),

      tool(
        "browser_fill",
        "Fill an input field. Clears existing value first, then types the new value.",
        {
          ref: refSchema,
          selector: selectorSchema,
          value: z.string().describe("Value to fill"),
        },
        async ({ ref, selector, value }: FillOptions): Promise<ToolResult> => {
          if (!ref && !selector) {
            return { content: [{ type: "text", text: "Error: ref or selector required" }] }
          }
          const result = await browserManager.execute("fill", { ref, selector, value })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: `Filled with: ${value}` }] }
        }
      ),

      tool(
        "browser_type",
        "Type text into the currently focused element. Appends text, does not clear first.",
        {
          text: z.string().describe("Text to type"),
        },
        async ({ text }: { text: string }): Promise<ToolResult> => {
          const result = await browserManager.execute("type", { text })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Typed" }] }
        }
      ),

      tool(
        "browser_screenshot",
        "Take a screenshot of the page or a specific element.",
        {
          ref: refSchema.describe("Element to screenshot (optional)"),
          fullPage: z.boolean().default(false).describe("Capture full page"),
          filePath: z.string().optional().describe("Save to file instead of returning base64"),
          format: z.enum(["png", "jpeg", "webp"]).default("png"),
          quality: z.number().min(0).max(100).optional().describe("Quality for jpeg/webp"),
        },
        async (options: ScreenshotOptions): Promise<ToolResult> => {
          const result = await browserManager.execute<ScreenshotResult>("screenshot", options)
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          if (options.filePath) {
            return { content: [{ type: "text", text: `Screenshot saved to ${options.filePath}` }] }
          }
          return {
            content: [{
              type: "image",
              data: result.data?.base64 || "",
              mimeType: `image/${options.format || "png"}`,
            }],
          }
        }
      ),

      // ============================================================================
      // Navigation Tools
      // ============================================================================

      tool(
        "browser_back",
        "Go back in browser history.",
        {},
        async (): Promise<ToolResult> => {
          const result = await browserManager.execute("back", {})
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Went back" }] }
        }
      ),

      tool(
        "browser_forward",
        "Go forward in browser history.",
        {},
        async (): Promise<ToolResult> => {
          const result = await browserManager.execute("forward", {})
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Went forward" }] }
        }
      ),

      tool(
        "browser_reload",
        "Reload the current page.",
        {},
        async (): Promise<ToolResult> => {
          const result = await browserManager.execute("reload", {})
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Reloaded" }] }
        }
      ),

      // ============================================================================
      // Information Tools
      // ============================================================================

      tool(
        "browser_get_text",
        "Get text content of an element.",
        {
          ref: refSchema,
          selector: selectorSchema,
        },
        async ({ ref, selector }: { ref?: string; selector?: string }): Promise<ToolResult> => {
          if (!ref && !selector) {
            return { content: [{ type: "text", text: "Error: ref or selector required" }] }
          }
          const result = await browserManager.execute<{ text: string }>("getText", { ref, selector })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: result.data?.text || "" }] }
        }
      ),

      tool(
        "browser_get_url",
        "Get the current page URL.",
        {},
        async (): Promise<ToolResult> => {
          const result = await browserManager.execute<{ url: string }>("getUrl", {})
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: result.data?.url || "" }] }
        }
      ),

      tool(
        "browser_get_title",
        "Get the page title.",
        {},
        async (): Promise<ToolResult> => {
          const result = await browserManager.execute<{ title: string }>("getTitle", {})
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: result.data?.title || "" }] }
        }
      ),

      // ============================================================================
      // Interaction Tools
      // ============================================================================

      tool(
        "browser_wait",
        "Wait for an element, text, or URL pattern to appear.",
        {
          selector: z.string().optional().describe("Wait for element matching selector"),
          text: z.string().optional().describe("Wait for text to appear"),
          url: z.string().optional().describe("Wait for URL to match pattern"),
          timeout: z.number().default(30000).describe("Timeout in ms"),
        },
        async ({ selector, text, url, timeout = 30000 }: WaitOptions): Promise<ToolResult> => {
          if (!selector && !text && !url) {
            return { content: [{ type: "text", text: "Error: selector, text, or url required" }] }
          }
          const result = await browserManager.execute("wait", { selector, text, url }, timeout)
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Wait completed" }] }
        }
      ),

      tool(
        "browser_scroll",
        "Scroll the page or scroll an element into view.",
        {
          direction: z.enum(["up", "down", "left", "right"]).optional(),
          amount: z.number().optional().describe("Scroll amount in pixels"),
          ref: refSchema.describe("Scroll element into view"),
          selector: selectorSchema.describe("Scroll element into view"),
        },
        async (options: ScrollOptions): Promise<ToolResult> => {
          const result = await browserManager.execute("scroll", options)
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Scrolled" }] }
        }
      ),

      tool(
        "browser_press",
        "Press a key or key combination (e.g., 'Enter', 'Tab', 'Control+A').",
        {
          key: z.string().describe("Key or combination (e.g., 'Enter', 'Control+A')"),
        },
        async ({ key }: { key: string }): Promise<ToolResult> => {
          const result = await browserManager.execute("press", { key })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: `Pressed ${key}` }] }
        }
      ),

      tool(
        "browser_select",
        "Select an option from a dropdown (<select> element).",
        {
          ref: refSchema,
          selector: selectorSchema,
          value: z.string().describe("Option value to select"),
        },
        async ({ ref, selector, value }: { ref?: string; selector?: string; value: string }): Promise<ToolResult> => {
          if (!ref && !selector) {
            return { content: [{ type: "text", text: "Error: ref or selector required" }] }
          }
          const result = await browserManager.execute("select", { ref, selector, value })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: `Selected ${value}` }] }
        }
      ),

      tool(
        "browser_check",
        "Check or uncheck a checkbox.",
        {
          ref: refSchema,
          selector: selectorSchema,
          checked: z.boolean().describe("Whether to check or uncheck"),
        },
        async ({ ref, selector, checked }: { ref?: string; selector?: string; checked: boolean }): Promise<ToolResult> => {
          if (!ref && !selector) {
            return { content: [{ type: "text", text: "Error: ref or selector required" }] }
          }
          const result = await browserManager.execute("check", { ref, selector, checked })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: checked ? "Checked" : "Unchecked" }] }
        }
      ),

      tool(
        "browser_hover",
        "Hover over an element (useful for tooltips, dropdowns).",
        {
          ref: refSchema,
          selector: selectorSchema,
        },
        async ({ ref, selector }: { ref?: string; selector?: string }): Promise<ToolResult> => {
          if (!ref && !selector) {
            return { content: [{ type: "text", text: "Error: ref or selector required" }] }
          }
          const result = await browserManager.execute("hover", { ref, selector })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Hovered" }] }
        }
      ),

      tool(
        "browser_drag",
        "Drag an element to another element.",
        {
          fromRef: refSchema.describe("Element to drag"),
          fromSelector: selectorSchema.describe("Element to drag"),
          toRef: refSchema.describe("Element to drop onto"),
          toSelector: selectorSchema.describe("Element to drop onto"),
        },
        async ({ fromRef, fromSelector, toRef, toSelector }: {
          fromRef?: string; fromSelector?: string; toRef?: string; toSelector?: string
        }): Promise<ToolResult> => {
          if (!fromRef && !fromSelector) {
            return { content: [{ type: "text", text: "Error: fromRef or fromSelector required" }] }
          }
          if (!toRef && !toSelector) {
            return { content: [{ type: "text", text: "Error: toRef or toSelector required" }] }
          }
          const result = await browserManager.execute("drag", { fromRef, fromSelector, toRef, toSelector })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Dragged" }] }
        }
      ),

      // ============================================================================
      // Advanced Tools
      // ============================================================================

      tool(
        "browser_download_image",
        "Download an image element to a file.",
        {
          ref: refSchema,
          selector: selectorSchema,
          filePath: z.string().describe("Path to save image"),
        },
        async ({ ref, selector, filePath }: DownloadOptions): Promise<ToolResult> => {
          if (!ref && !selector) {
            return { content: [{ type: "text", text: "Error: ref or selector required" }] }
          }
          const result = await browserManager.execute("downloadImage", { ref, selector, filePath })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: `Downloaded to ${filePath}` }] }
        }
      ),

      tool(
        "browser_download_file",
        "Download a file from a URL or link element.",
        {
          ref: refSchema.describe("Link element to download"),
          url: z.string().url().optional().describe("Direct URL to download"),
          filePath: z.string().describe("Path to save file"),
        },
        async ({ ref, url, filePath }: DownloadOptions): Promise<ToolResult> => {
          if (!ref && !url) {
            return { content: [{ type: "text", text: "Error: ref or url required" }] }
          }
          const result = await browserManager.execute("downloadFile", { ref, url, filePath })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: `Downloaded to ${filePath}` }] }
        }
      ),

      tool(
        "browser_emulate",
        "Emulate device settings (viewport, user agent, color scheme, geolocation).",
        {
          viewport: z.object({
            width: z.number(),
            height: z.number(),
            isMobile: z.boolean().optional(),
            hasTouch: z.boolean().optional(),
            deviceScaleFactor: z.number().optional(),
          }).optional(),
          userAgent: z.string().optional(),
          colorScheme: z.enum(["light", "dark", "auto"]).optional(),
          geolocation: z.object({
            latitude: z.number(),
            longitude: z.number(),
          }).optional(),
        },
        async (options: EmulateOptions): Promise<ToolResult> => {
          const result = await browserManager.execute("emulate", options)
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          return { content: [{ type: "text", text: "Emulation settings applied" }] }
        }
      ),

      tool(
        "browser_evaluate",
        "Execute JavaScript code in the browser context. Returns the result.",
        {
          script: z.string().describe("JavaScript code to execute"),
        },
        async ({ script }: { script: string }): Promise<ToolResult> => {
          const result = await browserManager.execute<{ result: unknown }>("evaluate", { script })
          if (!result.success) {
            return { content: [{ type: "text", text: `Error: ${result.error}` }] }
          }
          const value = result.data?.result
          const text = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)
          return { content: [{ type: "text", text }] }
        }
      ),
    ],
  })
}
