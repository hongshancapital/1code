/**
 * Browser MCP Server v2
 * 12 tools (down from 22), with lockedTool/freeTool factories
 *
 * Tools:
 *  1. browser_status   — free, lightweight state query
 *  2. browser_lock     — free, lock browser for AI session
 *  3. browser_unlock   — free, release browser control
 *  4. browser_navigate — locked, unified navigation (url + back/forward/reload + show panel)
 *  5. browser_snapshot  — locked, page content with optional CSS query
 *  6. browser_click    — locked, click/dblclick/hover/drag with batch support
 *  7. browser_input    — locked, fill/select/check with batch support
 *  8. browser_capture  — locked, screenshot/download (always file, never base64)
 *  9. browser_scroll   — locked, scroll page or element into view
 * 10. browser_press    — locked, key press / key combination
 * 11. browser_wait     — locked, wait for element/text/url
 * 12. browser_evaluate — locked, execute JS + device emulation
 */

import { z } from "zod"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import { app } from "electron"
import { browserManager } from "./manager"
import type { SnapshotResult } from "./types"

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
  .describe("CSS selector to target element")

/** Tool result type */
type ToolResult = { content: Array<{ type: "text"; text: string }> }

/** Text result helper */
function text(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }] }
}

/** Error result helper */
function error(msg: string): ToolResult {
  return text(`Error: ${msg}`)
}

/** Get a temp file path for captures */
async function getTempCapturePath(ext = "png"): Promise<string> {
  const tempDir = path.join(app.getPath("temp"), "hong-browser")
  await fs.mkdir(tempDir, { recursive: true })
  return path.join(tempDir, `capture-${Date.now()}.${ext}`)
}

/**
 * Create Browser MCP server with 12 streamlined tools
 */
export async function createBrowserMcpServer() {
  const { createSdkMcpServer, tool } = await getSdkModule()

  /** Tool that requires browser lock */
  function lockedTool<T extends z.ZodRawShape>(
    name: string,
    description: string,
    schema: T,
    handler: (params: z.infer<z.ZodObject<T>>) => Promise<ToolResult>,
  ) {
    return tool(name, description, schema, async (params: z.infer<z.ZodObject<T>>): Promise<ToolResult> => {
      if (!browserManager.isLocked) {
        return error("Browser is not locked. Call browser_lock first before using browser tools.")
      }
      return handler(params)
    })
  }

  return createSdkMcpServer({
    name: "browser",
    version: "2.0.0",
    tools: [
      // ======================================================================
      // 1. browser_status — free, no lock needed
      // ======================================================================
      tool(
        "browser_status",
        "Get current browser state without locking. Returns URL, title, ready status, and lock state. Use this to check if browser is available before deciding to use it.",
        {},
        async (): Promise<ToolResult> => {
          return text(JSON.stringify({
            url: browserManager.currentUrl,
            title: browserManager.currentTitle,
            isReady: browserManager.isReady,
            isLocked: browserManager.isLocked,
          }, null, 2))
        }
      ),

      // ======================================================================
      // 2. browser_lock — free
      // ======================================================================
      tool(
        "browser_lock",
        `Lock the browser for AI operation. You MUST call this before using any other browser tools (except browser_status).
This displays a visual indicator to the user that AI is controlling the browser.
After finishing all browser operations, you MUST call browser_unlock to release control.
The lock auto-releases after 5 minutes as a safety net.`,
        {},
        async (): Promise<ToolResult> => {
          const result = browserManager.lock()
          if (result.alreadyLocked) {
            return text("Browser already locked. Proceeding with operations.")
          }
          return text("Browser locked. You can now use browser tools. Remember to call browser_unlock when done.")
        }
      ),

      // ======================================================================
      // 3. browser_unlock — free
      // ======================================================================
      tool(
        "browser_unlock",
        `Unlock the browser after AI operations are complete.
You MUST call this after finishing all browser operations.
IMPORTANT: Failure to unlock will block the user from interacting with the browser.`,
        {},
        async (): Promise<ToolResult> => {
          const result = browserManager.unlock()
          if (!result.wasLocked) {
            return text("Browser was not locked.")
          }
          return text("Browser unlocked. User has regained control.")
        }
      ),

      // ======================================================================
      // 4. browser_navigate — unified navigation
      // ======================================================================
      lockedTool(
        "browser_navigate",
        `Navigate the browser. Use url to go to a page, or action for back/forward/reload.
Set show: true to open the browser panel if it's not visible.`,
        {
          url: z.string().optional().describe("URL to navigate to"),
          action: z.enum(["back", "forward", "reload"]).optional()
            .describe("Navigation action (alternative to url)"),
          show: z.boolean().default(false)
            .describe("Open the browser panel if not visible"),
          waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional()
            .describe("When to consider navigation complete"),
        },
        async ({ url, action, show, waitUntil }) => {
          // Show browser panel if requested
          if (show) {
            browserManager.showPanel()
          }

          if (url) {
            const result = await browserManager.execute("navigate", { url, waitUntil })
            if (!result.success) return error(result.error!)
            return text(`Navigated to ${url}`)
          }

          if (action) {
            const result = await browserManager.execute(action, {})
            if (!result.success) return error(result.error!)
            const actionLabels = { back: "Went back", forward: "Went forward", reload: "Reloaded" }
            return text(actionLabels[action])
          }

          // Just show panel, no navigation
          if (show) {
            return text("Browser panel opened.")
          }

          return error("Provide url or action parameter.")
        }
      ),

      // ======================================================================
      // 5. browser_snapshot — enhanced page observation
      // ======================================================================
      lockedTool(
        "browser_snapshot",
        `Get page content and element references. Returns accessibility tree with URL and title.
Each element has a ref (e.g., @e1) for use with browser_click, browser_input, etc.

Use query parameter to find elements by CSS selector — useful for web development.
After page changes, call snapshot again (refs reset on each snapshot).

【Output Format】
URL: https://example.com
Title: Example Page

[e1] button "Sign In"
[e2] textbox "Email" placeholder="Enter email"
[e3] link "Forgot password?"`,
        {
          interactiveOnly: z.boolean().default(true)
            .describe("Only include interactive elements (buttons, links, inputs)"),
          query: z.string().optional()
            .describe("CSS selector to find specific elements. Returns matching element refs."),
        },
        async ({ interactiveOnly, query }) => {
          // CSS query mode
          if (query) {
            const queryResult = await browserManager.execute<{ data: unknown[]; count: number }>(
              "querySelector", { selector: query }
            )
            if (!queryResult.success) return error(queryResult.error!)
            const data = queryResult.data
            const header = `URL: ${browserManager.currentUrl || "unknown"}\nTitle: ${browserManager.currentTitle || "unknown"}\nQuery: ${query} (${data?.count || 0} matches)\n\n`
            return text(header + JSON.stringify(data?.data || [], null, 2))
          }

          // Standard snapshot
          const result = await browserManager.execute<SnapshotResult>("snapshot", { interactiveOnly })
          if (!result.success) return error(result.error!)

          const header = `URL: ${browserManager.currentUrl || "unknown"}\nTitle: ${browserManager.currentTitle || "unknown"}\n\n`
          return text(header + (result.data?.snapshot || "Empty page"))
        }
      ),

      // ======================================================================
      // 6. browser_click — batch click/hover/drag
      // ======================================================================
      lockedTool(
        "browser_click",
        `Click, double-click, hover, or drag elements. Supports batch operations.

Single operation: provide ref or selector with optional mode.
Batch operation: provide actions array for multiple operations in sequence.

Modes: click (default), dblclick, hover, drag (requires dragTo ref).`,
        {
          // Single operation
          ref: refSchema,
          selector: selectorSchema,
          mode: z.enum(["click", "dblclick", "hover", "drag"]).default("click")
            .describe("Interaction mode"),
          dragTo: z.string().regex(/^@e\d+$/).optional()
            .describe("Target ref for drag mode"),
          // Batch operations
          actions: z.array(z.object({
            ref: z.string().optional(),
            selector: z.string().optional(),
            mode: z.enum(["click", "dblclick", "hover", "drag"]).default("click"),
            dragTo: z.string().optional(),
          })).optional().describe("Batch actions. Each item is an independent click/hover/drag."),
        },
        async ({ ref, selector, mode, dragTo, actions }) => {
          // Batch mode
          if (actions && actions.length > 0) {
            const results: string[] = []
            for (let i = 0; i < actions.length; i++) {
              const a = actions[i]
              const r = await executeSingleClick(a.ref, a.selector, a.mode, a.dragTo)
              results.push(`[${i + 1}] ${r}`)
            }
            return text(results.join("\n"))
          }

          // Single mode
          if (!ref && !selector) {
            return error("ref or selector required (or use actions array for batch)")
          }
          const result = await executeSingleClick(ref, selector, mode, dragTo)
          return text(result)
        }
      ),

      // ======================================================================
      // 7. browser_input — batch fill/select/check
      // ======================================================================
      lockedTool(
        "browser_input",
        `Fill form fields, select dropdown options, or toggle checkboxes. Supports batch.

Single operation: provide ref/selector + value (for text/select) or checked (for checkbox).
Batch operation: provide fields array for filling multiple form fields at once.

The tool auto-detects element type and applies the right action.`,
        {
          // Single operation
          ref: refSchema,
          selector: selectorSchema,
          value: z.string().optional().describe("Value to fill or option to select"),
          checked: z.boolean().optional().describe("For checkboxes/radios: check or uncheck"),
          append: z.boolean().default(false).describe("Append text instead of replacing"),
          // Batch operations
          fields: z.array(z.object({
            ref: z.string().optional(),
            selector: z.string().optional(),
            value: z.string().optional(),
            checked: z.boolean().optional(),
          })).optional().describe("Batch fill. Each item targets one form field."),
        },
        async ({ ref, selector, value, checked, append, fields }) => {
          // Batch mode
          if (fields && fields.length > 0) {
            const results: string[] = []
            for (let i = 0; i < fields.length; i++) {
              const f = fields[i]
              const r = await executeSingleInput(f.ref, f.selector, f.value, f.checked)
              results.push(`[${i + 1}] ${r}`)
            }
            return text(results.join("\n"))
          }

          // Single mode
          if (!ref && !selector) {
            return error("ref or selector required (or use fields array for batch)")
          }
          const result = await executeSingleInput(ref, selector, value, checked, append)
          return text(result)
        }
      ),

      // ======================================================================
      // 8. browser_capture — screenshot/download, ALWAYS file
      // ======================================================================
      lockedTool(
        "browser_capture",
        `Screenshot or download from the browser. ALWAYS saves to a file (never returns image data inline).
If no filePath is given, saves to a temporary location and returns the path.

To show the screenshot in chat, use markdown: ![description](file_path)`,
        {
          mode: z.enum(["screenshot", "download"]).default("screenshot"),
          // Screenshot params
          ref: refSchema.describe("Capture a specific element instead of full page"),
          fullPage: z.boolean().default(false).describe("Capture full scrollable page"),
          // Download params
          url: z.string().optional().describe("Direct URL to download (for download mode)"),
          // Common
          filePath: z.string().optional()
            .describe("Save path. If omitted, saves to temp directory."),
        },
        async ({ mode, ref, fullPage, url, filePath }) => {
          if (mode === "download") {
            // Download mode
            if (!url && !ref) {
              return error("url or ref required for download mode")
            }
            const savePath = filePath || await getTempCapturePath("bin")
            const result = await browserManager.execute("downloadFile", { ref, url, filePath: savePath })
            if (!result.success) return error(result.error!)
            return text(`Downloaded to: ${savePath}`)
          }

          // Screenshot mode — capture directly in main process (no base64 IPC)
          const savePath = filePath || await getTempCapturePath("png")

          if (ref) {
            // Element screenshot: still needs renderer to locate the element
            const result = await browserManager.execute<{ base64: string; width: number; height: number }>(
              "screenshot", { ref, fullPage, filePath: savePath }
            )
            if (!result.success) return error(result.error!)
            // Write base64 from renderer to file
            if (result.data?.base64) {
              try {
                const buffer = Buffer.from(result.data.base64, "base64")
                await fs.writeFile(savePath, buffer)
              } catch (e) {
                return error(`Failed to save screenshot: ${e}`)
              }
            }
          } else {
            // Full page / viewport screenshot: use main process capturePage() directly
            const result = await browserManager.captureScreenshot(savePath)
            if (!result.success) return error(result.error!)
          }

          return text(
            `Screenshot saved to: ${savePath}\n` +
            `To show in chat: ![screenshot](local-file://localhost${savePath})`
          )
        }
      ),

      // ======================================================================
      // 9. browser_scroll
      // ======================================================================
      lockedTool(
        "browser_scroll",
        "Scroll the page or scroll an element into view.",
        {
          direction: z.enum(["up", "down", "left", "right"]).optional(),
          amount: z.number().optional().describe("Scroll amount in pixels"),
          ref: refSchema.describe("Scroll element into view"),
          selector: selectorSchema.describe("Scroll element into view"),
        },
        async (options) => {
          const result = await browserManager.execute("scroll", options)
          if (!result.success) return error(result.error!)
          return text("Scrolled")
        }
      ),

      // ======================================================================
      // 10. browser_press
      // ======================================================================
      lockedTool(
        "browser_press",
        "Press a key or key combination (e.g., 'Enter', 'Tab', 'Control+A', 'Shift+Tab').",
        {
          key: z.string().describe("Key or combination (e.g., 'Enter', 'Control+A')"),
        },
        async ({ key }) => {
          const result = await browserManager.execute("press", { key })
          if (!result.success) return error(result.error!)
          return text(`Pressed ${key}`)
        }
      ),

      // ======================================================================
      // 11. browser_wait
      // ======================================================================
      lockedTool(
        "browser_wait",
        "Wait for an element, text, or URL pattern to appear on the page.",
        {
          selector: z.string().optional().describe("Wait for element matching CSS selector"),
          text: z.string().optional().describe("Wait for text to appear on page"),
          url: z.string().optional().describe("Wait for URL to match pattern"),
          timeout: z.number().default(30000).describe("Timeout in ms"),
        },
        async ({ selector, text: waitText, url, timeout }) => {
          if (!selector && !waitText && !url) {
            return error("selector, text, or url required")
          }
          const result = await browserManager.execute(
            "wait", { selector, text: waitText, url }, timeout
          )
          if (!result.success) return error(result.error!)
          return text("Wait completed")
        }
      ),

      // ======================================================================
      // 12. browser_evaluate — JS execution + device emulation
      // ======================================================================
      lockedTool(
        "browser_evaluate",
        `Execute JavaScript in the browser context and return the result.
Can also configure device emulation (viewport, user agent, color scheme, geolocation).`,
        {
          script: z.string().optional().describe("JavaScript code to execute"),
          emulate: z.object({
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
          }).optional().describe("Device emulation settings"),
        },
        async ({ script, emulate }) => {
          const results: string[] = []

          // Apply emulation if provided
          if (emulate) {
            const emuResult = await browserManager.execute("emulate", emulate)
            if (!emuResult.success) return error(emuResult.error!)
            results.push("Emulation applied.")
          }

          // Execute script if provided
          if (script) {
            const result = await browserManager.execute<{ result: unknown }>("evaluate", { script })
            if (!result.success) return error(result.error!)
            const value = result.data?.result
            const output = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value)
            results.push(output)
          }

          if (results.length === 0) {
            return error("Provide script or emulate parameter.")
          }

          return text(results.join("\n"))
        }
      ),
    ],
  })
}

// ============================================================================
// Internal helpers for batch operations
// ============================================================================

async function executeSingleClick(
  ref?: string,
  selector?: string,
  mode: string = "click",
  dragTo?: string,
): Promise<string> {
  if (!ref && !selector) return "Skipped: no ref or selector"

  switch (mode) {
    case "hover": {
      const result = await browserManager.execute("hover", { ref, selector })
      return result.success ? `Hovered ${ref || selector}` : `Error: ${result.error}`
    }
    case "drag": {
      if (!dragTo) return "Error: dragTo required for drag mode"
      const result = await browserManager.execute("drag", {
        fromRef: ref, fromSelector: selector,
        toRef: dragTo,
      })
      return result.success ? `Dragged ${ref || selector} → ${dragTo}` : `Error: ${result.error}`
    }
    case "dblclick": {
      const result = await browserManager.execute("click", { ref, selector, dblClick: true })
      return result.success ? `Double-clicked ${ref || selector}` : `Error: ${result.error}`
    }
    default: {
      const result = await browserManager.execute("click", { ref, selector, dblClick: false })
      return result.success ? `Clicked ${ref || selector}` : `Error: ${result.error}`
    }
  }
}

async function executeSingleInput(
  ref?: string,
  selector?: string,
  value?: string,
  checked?: boolean,
  append?: boolean,
): Promise<string> {
  if (!ref && !selector) return "Skipped: no ref or selector"

  // Checkbox/radio toggle
  if (checked !== undefined) {
    const result = await browserManager.execute("check", { ref, selector, checked })
    return result.success ? `${checked ? "Checked" : "Unchecked"} ${ref || selector}` : `Error: ${result.error}`
  }

  // Select dropdown or text fill
  if (value !== undefined) {
    // Try fill first (works for text inputs, textareas, selects)
    if (append) {
      const result = await browserManager.execute("type", { ref, selector, text: value })
      return result.success ? `Appended to ${ref || selector}` : `Error: ${result.error}`
    }
    const result = await browserManager.execute("fill", { ref, selector, value })
    return result.success ? `Filled ${ref || selector}` : `Error: ${result.error}`
  }

  return "Error: value or checked required"
}
