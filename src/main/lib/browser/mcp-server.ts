/**
 * Browser MCP Server v3
 * 17 tools, with lockedTool/freeTool factories
 *
 * Tools:
 *  1. browser_status           — free, lightweight state query
 *  2. browser_lock             — free, lock browser for AI session
 *  3. browser_unlock           — free, release browser control
 *  4. browser_navigate         — locked, unified navigation
 *  5. browser_snapshot         — locked, page content with optional CSS query
 *  6. browser_click            — locked, click/dblclick/hover/drag with batch support (unified locator)
 *  7. browser_input            — locked, fill/select/check with batch support (unified locator)
 *  8. browser_capture          — locked, screenshot only (download removed, unified locator)
 *  9. browser_scroll           — locked, scroll page or element into view (unified locator)
 * 10. browser_press            — locked, key press / key combination
 * 11. browser_wait             — locked, wait for element/text/url
 * 12. browser_evaluate         — locked, execute JS + device emulation
 * 13. browser_get_attribute    — locked, get element attributes or HTML (unified locator)
 * 14. browser_extract_content  — locked, extract page content as Markdown/text (unified locator)
 * 15. browser_screenshot_full  — locked, full-page scrolling screenshot
 * 16. browser_network          — locked, start/stop network monitoring
 * 17. browser_network_requests — locked, query captured network requests
 * 18. browser_download_batch   — locked, batch download from page elements (unified locator)
 * 19. browser_console          — locked, query/collect/clear console logs
 */

import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { app } from "electron";
import { browserManager } from "./manager";
import type { CapturedNetworkRequest, SnapshotResult } from "./types";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import sharp from "sharp";

// Initialize Turndown service with GFM support
const turndownService = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});
turndownService.use(gfm);

// Dynamic import for ESM module
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null;

async function getSdkModule() {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk");
  }
  return sdkModule;
}

/**
 * Unified Locator Schema
 * - Starts with @ -> ref
 * - Starts with http://, https://, file:// -> url
 * - Otherwise -> selector
 */
const locatorSchema = z
  .string()
  .describe(
    "Element locator: @e1 (ref), #id/.class (selector), or http(s)://... (url)",
  );

/**
 * Parse a unified locator string into specific components
 */
function parseLocator(locator?: string): {
  ref?: string;
  selector?: string;
  url?: string;
} {
  if (!locator) return {};

  if (locator.startsWith("@")) {
    return { ref: locator };
  }

  if (
    locator.startsWith("http://") ||
    locator.startsWith("https://") ||
    locator.startsWith("file://")
  ) {
    return { url: locator };
  }

  return { selector: locator };
}

/** Tool result type */
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

/** Text result helper */
function text(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }] };
}

/** Error result helper */
function error(msg: string): ToolResult {
  return text(`Error: ${msg}`);
}

/** Get a temp file path for captures */
async function getTempCapturePath(ext = "png"): Promise<string> {
  const tempDir = path.join(app.getPath("temp"), "hong-browser");
  await fs.mkdir(tempDir, { recursive: true });
  return path.join(tempDir, `capture-${Date.now()}.${ext}`);
}

/** Resolve file path — convert relative paths to absolute using working directory */
async function resolveAndEnsurePath(filePath: string): Promise<string> {
  let resolved = filePath;
  if (!path.isAbsolute(filePath)) {
    const baseDir = browserManager.workingDirectory || process.cwd();
    resolved = path.resolve(baseDir, filePath);
  }
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  return resolved;
}

/**
 * Create Browser MCP server with 12 streamlined tools
 */
export async function getBrowserToolDefinitions() {
  const { tool } = await getSdkModule();

  /** Tool that requires browser lock */
  function lockedTool<T extends z.ZodRawShape>(
    name: string,
    description: string,
    schema: T,
    handler: (params: z.infer<z.ZodObject<T>>) => Promise<ToolResult>,
  ) {
    return tool(
      name,
      description,
      schema,
      async (params: z.infer<z.ZodObject<T>>): Promise<ToolResult> => {
        if (!browserManager.isLocked) {
          // If the browser was unlocked (manually or by timeout), we should stop the AI
          // by returning a clear error.
          return error(
            "Browser lock is not active. The session may have timed out or been manually unlocked by the user. " +
              "If you need to continue, you must call browser_lock again.",
          );
        }

        // Renew the lock timer on every successful tool call
        // This prevents the 5-minute timer from expiring while the AI is working
        browserManager.renewLock();

        return handler(params);
      },
    );
  }

  const commonDescription = `
## Locator Parameter
Unified parameter to locate elements or resources:
- \`@e1\`, \`@e2\` -> Element reference from snapshot
- \`button.submit\`, \`#main\` -> CSS selector
- \`https://...\`, \`file://...\` -> Direct URL
`;

  return [
      // ======================================================================
      // 1. browser_status — free, no lock needed
      // ======================================================================
      tool(
        "browser_status",
        "Get current browser state without locking. Returns URL, title, ready status, and lock state. Use this to check if browser is available before deciding to use it.",
        {},
        async (): Promise<ToolResult> => {
          return text(
            JSON.stringify(
              {
                url: browserManager.currentUrl,
                title: browserManager.currentTitle,
                isReady: browserManager.isReady,
                isLocked: browserManager.isLocked,
              },
              null,
              2,
            ),
          );
        },
      ),

      // ======================================================================
      // 2. browser_lock — free, auto-opens browser panel if needed
      // ======================================================================
      tool(
        "browser_lock",
        `Lock the browser for AI operation. You MUST call this before using any other browser tools (except browser_status).
This displays a visual indicator to the user that AI is controlling the browser.
After finishing all browser operations, you MUST call browser_unlock to release control.
The lock auto-releases after 5 minutes as a safety net.`,
        {},
        async (): Promise<ToolResult> => {
          // Auto-open browser panel and wait for ready
          const ready = await browserManager.ensureReady();
          if (!ready) {
            return error(
              "Browser failed to initialize. The browser panel could not be opened.",
            );
          }

          const result = browserManager.lock();
          if (result.alreadyLocked) {
            return text("Browser already locked. Proceeding with operations.");
          }
          return text(
            "Browser locked. You can now use browser tools. Remember to call browser_unlock when done.",
          );
        },
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
          const result = browserManager.unlock();
          if (!result.wasLocked) {
            return text("Browser was not locked.");
          }
          return text("Browser unlocked. User has regained control.");
        },
      ),

      // ======================================================================
      // 4. browser_navigate — unified navigation
      // ======================================================================
      lockedTool(
        "browser_navigate",
        `Navigate the browser. Use url to go to a page, or action for back/forward/reload.
Set show: true to open the browser panel if it's not visible.
Supports local file paths (absolute paths auto-converted to file:// URLs).

【waitUntil options】
- load (default): Wait for window.load event (all resources loaded)
- domcontentloaded: Wait for DOM parsed (faster, no waiting for images/styles)
- networkidle: Wait for network idle 500ms (good for SPAs with async loading)
- none: Return immediately without waiting`,
        {
          url: z
            .string()
            .optional()
            .describe("URL or local file path to navigate to"),
          action: z
            .enum(["back", "forward", "reload"])
            .optional()
            .describe("Navigation action (alternative to url)"),
          show: z
            .boolean()
            .default(false)
            .describe("Open the browser panel if not visible"),
          waitUntil: z
            .enum(["load", "domcontentloaded", "networkidle", "none"])
            .default("load")
            .describe("When to consider navigation complete"),
          timeout: z
            .number()
            .int()
            .min(1000)
            .max(120000)
            .default(30000)
            .describe("Navigation timeout in milliseconds"),
        },
        async ({ url, action, waitUntil, timeout }) => {
          if (url) {
            const result = await browserManager.execute<{
              url: string;
              title: string;
              loadState: string;
              loadTime: number;
            }>("navigate", { url, waitUntil, timeout });
            if (!result.success) return error(result.error!);

            const data = result.data!;
            const response: Record<string, unknown> = {
              url: data.url,
              title: data.title,
              loadState: data.loadState,
              loadTime:
                data.loadTime < 1000
                  ? `${data.loadTime}ms`
                  : `${(data.loadTime / 1000).toFixed(1)}s`,
            };
            if (data.loadState === "timeout") {
              response.warning =
                "Page did not fully load within timeout — content may be incomplete";
            }

            return text(JSON.stringify(response, null, 2));
          }

          if (action) {
            const result = await browserManager.execute(action, {});
            if (!result.success) return error(result.error!);
            const actionLabels = {
              back: "Went back",
              forward: "Went forward",
              reload: "Reloaded",
            };
            return text(actionLabels[action]);
          }

          return error("Provide url or action parameter.");
        },
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
          interactiveOnly: z
            .boolean()
            .default(true)
            .describe(
              "Only include interactive elements (buttons, links, inputs)",
            ),
          query: z
            .string()
            .optional()
            .describe(
              "CSS selector to find specific elements. Returns matching element refs.",
            ),
          maxElements: z
            .number()
            .optional()
            .describe(
              "Maximum number of elements to include. Useful for large pages to avoid truncation.",
            ),
          includeImages: z
            .boolean()
            .default(false)
            .describe("Include image elements in snapshot"),
          includeLinks: z
            .boolean()
            .default(false)
            .describe("Include link elements in snapshot"),
        },
        async ({
          interactiveOnly,
          query,
          maxElements,
          includeImages,
          includeLinks,
        }) => {
          // CSS query mode
          if (query) {
            // Query mode: use querySelector to find matching elements
            // Webview's __browserQuerySelector returns { success, data: Array, count }
            // After BrowserManager.execute, queryResult.data IS the array directly
            const queryResult = await browserManager.execute<unknown[]>(
              "querySelector",
              { selector: query },
            );
            if (!queryResult.success) return error(queryResult.error!);
            const matches = queryResult.data || [];
            const count = Array.isArray(matches) ? matches.length : 0;
            const header = `URL: ${browserManager.currentUrl || "unknown"}\nTitle: ${browserManager.currentTitle || "unknown"}\nQuery: ${query} (${count} matches)\n\n`;
            return text(header + JSON.stringify(matches, null, 2));
          }

          // Standard snapshot
          const result = await browserManager.execute<SnapshotResult>(
            "snapshot",
            { interactiveOnly, maxElements, includeImages, includeLinks },
          );
          if (!result.success) return error(result.error!);

          const header = `URL: ${browserManager.currentUrl || "unknown"}\nTitle: ${browserManager.currentTitle || "unknown"}\n\n`;
          let snapshot = result.data?.snapshot || "Empty page";
          const truncated = (
            result.data as SnapshotResult & { truncated?: boolean }
          )?.truncated;

          // Output size protection
          const MAX_SNAPSHOT_CHARS = 80000;
          let sizeWarning = "";
          if (snapshot.length > MAX_SNAPSHOT_CHARS) {
            snapshot = snapshot.slice(0, MAX_SNAPSHOT_CHARS);
            sizeWarning =
              "\n\n⚠ Snapshot truncated due to size. Use `interactiveOnly: true`, `query` parameter, or `maxElements` to narrow results.";
          } else if (truncated) {
            sizeWarning = `\n\n⚠ Snapshot limited to ${maxElements} elements. Increase maxElements or remove the limit to see more.`;
          }

          return text(header + snapshot + sizeWarning);
        },
      ),

      // ======================================================================
      // 6. browser_click — batch click/hover/drag (Unified Locator)
      // ======================================================================
      lockedTool(
        "browser_click",
        `Click, double-click, hover, or drag elements. Supports batch operations.
${commonDescription}
Single operation: provide locator with optional mode.
Batch operation: provide actions array.

Modes: click (default), dblclick, hover, drag (requires dragTo locator).`,
        {
          // Single operation
          locator: locatorSchema.optional(),
          mode: z
            .enum(["click", "dblclick", "hover", "drag"])
            .default("click")
            .describe("Interaction mode"),
          dragTo: locatorSchema
            .optional()
            .describe("Target locator for drag mode"),
          // Batch operations
          actions: z
            .array(
              z.object({
                locator: locatorSchema,
                mode: z
                  .enum(["click", "dblclick", "hover", "drag"])
                  .default("click"),
                dragTo: locatorSchema.optional(),
              }),
            )
            .optional()
            .describe(
              "Batch actions. Each item is an independent click/hover/drag.",
            ),
        },
        async ({ locator, mode, dragTo, actions }) => {
          // Batch mode
          if (actions && actions.length > 0) {
            const results: string[] = [];
            for (let i = 0; i < actions.length; i++) {
              const a = actions[i];
              const parsedLocator = parseLocator(a.locator);
              const parsedDragTo = parseLocator(a.dragTo);

              const r = await executeSingleClick(
                parsedLocator.ref,
                parsedLocator.selector,
                a.mode,
                parsedDragTo.ref || parsedDragTo.selector, // dragTo needs a target ref or selector
              );
              results.push(`[${i + 1}] ${r}`);
            }
            return text(results.join("\n"));
          }

          // Single mode
          if (!locator) {
            return error("locator required (or use actions array for batch)");
          }
          const parsedLocator = parseLocator(locator);
          const parsedDragTo = parseLocator(dragTo);

          const result = await executeSingleClick(
            parsedLocator.ref,
            parsedLocator.selector,
            mode,
            parsedDragTo.ref || parsedDragTo.selector,
          );
          return text(result);
        },
      ),

      // ======================================================================
      // 7. browser_input — batch fill/select/check (Unified Locator)
      // ======================================================================
      lockedTool(
        "browser_input",
        `Fill form fields, select dropdown options, or toggle checkboxes. Supports batch.
${commonDescription}
Single operation: provide locator + value (for text/select) or checked (for checkbox).
Batch operation: provide fields array.

The tool auto-detects element type and applies the right action.`,
        {
          // Single operation
          locator: locatorSchema.optional(),
          value: z
            .string()
            .optional()
            .describe("Value to fill or option to select"),
          checked: z
            .boolean()
            .optional()
            .describe("For checkboxes/radios: check or uncheck"),
          append: z
            .boolean()
            .default(false)
            .describe("Append text instead of replacing"),
          // Batch operations
          fields: z
            .array(
              z.object({
                locator: locatorSchema,
                value: z.string().optional(),
                checked: z.boolean().optional(),
              }),
            )
            .optional()
            .describe("Batch fill. Each item targets one form field."),
        },
        async ({ locator, value, checked, append, fields }) => {
          // Batch mode
          if (fields && fields.length > 0) {
            const results: string[] = [];
            for (let i = 0; i < fields.length; i++) {
              const f = fields[i];
              const parsed = parseLocator(f.locator);
              const r = await executeSingleInput(
                parsed.ref,
                parsed.selector,
                f.value,
                f.checked,
              );
              results.push(`[${i + 1}] ${r}`);
            }
            return text(results.join("\n"));
          }

          // Single mode
          if (!locator) {
            return error("locator required (or use fields array for batch)");
          }
          const parsed = parseLocator(locator);
          const result = await executeSingleInput(
            parsed.ref,
            parsed.selector,
            value,
            checked,
            append,
          );
          return text(result);
        },
      ),

      // ======================================================================
      // 8. browser_capture — screenshot ONLY (Unified Locator)
      // ======================================================================
      lockedTool(
        "browser_capture",
        `Take a screenshot of the viewport or a specific element. ALWAYS saves to a file.
${commonDescription}
If no filePath is given, saves to a temporary location.
To show the screenshot in chat, use markdown: ![description](file_path)

Note: For full-page scrolling screenshots, use browser_screenshot_full.`,
        {
          locator: locatorSchema
            .optional()
            .describe("Capture a specific element instead of viewport"),
          filePath: z
            .string()
            .optional()
            .describe("Save path. If omitted, saves to temp directory."),
        },
        async ({ locator, filePath }) => {
          const savePath = filePath
            ? await resolveAndEnsurePath(filePath)
            : await getTempCapturePath("png");

          const parsed = parseLocator(locator);

          if (parsed.ref || parsed.selector) {
            // Element screenshot: renderer scrolls element into view & returns rect,
            // then main process captures directly — no base64 IPC, no data corruption.
            const rectResult = await browserManager.execute<{
              x: number;
              y: number;
              width: number;
              height: number;
            }>("getElementRect", {
              ref: parsed.ref,
              selector: parsed.selector,
            });

            if (!rectResult.success) return error(rectResult.error!);
            if (!rectResult.data) return error("Element not found");

            const rect = rectResult.data;
            if (rect.width <= 0 || rect.height <= 0) {
              return error(
                `Element has zero size (${rect.width}x${rect.height})`,
              );
            }

            const result = await browserManager.captureScreenshot(savePath, {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            });
            if (!result.success) return error(result.error!);
          } else {
            // Viewport screenshot: use main process capturePage() directly
            const result = await browserManager.captureScreenshot(savePath);
            if (!result.success) return error(result.error!);
          }

          return text(`Screenshot saved to: ${savePath}`);
        },
      ),

      // ======================================================================
      // 9. browser_scroll (Unified Locator)
      // ======================================================================
      lockedTool(
        "browser_scroll",
        `Scroll the page or scroll an element into view.
${commonDescription}`,
        {
          direction: z.enum(["up", "down", "left", "right"]).optional(),
          amount: z.number().optional().describe("Scroll amount in pixels"),
          locator: locatorSchema
            .optional()
            .describe("Scroll element into view"),
        },
        async ({ direction, amount, locator }) => {
          const parsed = parseLocator(locator);
          // browser-sidebar.tsx 'scroll' case supports { ref, selector }
          const result = await browserManager.execute("scroll", {
            direction,
            amount,
            ref: parsed.ref,
            selector: parsed.selector,
          });
          if (!result.success) return error(result.error!);
          return text("Scrolled");
        },
      ),

      // ======================================================================
      // 10. browser_press
      // ======================================================================
      lockedTool(
        "browser_press",
        "Press a key or key combination (e.g., 'Enter', 'Tab', 'Control+A', 'Shift+Tab').",
        {
          key: z
            .string()
            .describe("Key or combination (e.g., 'Enter', 'Control+A')"),
        },
        async ({ key }) => {
          const result = await browserManager.execute("press", { key });
          if (!result.success) return error(result.error!);
          return text(`Pressed ${key}`);
        },
      ),

      // ======================================================================
      // 11. browser_wait
      // ======================================================================
      lockedTool(
        "browser_wait",
        "Wait for an element, text, or URL pattern to appear on the page.",
        {
          selector: z
            .string()
            .optional()
            .describe("Wait for element matching CSS selector"),
          text: z
            .string()
            .optional()
            .describe("Wait for text to appear on page"),
          url: z.string().optional().describe("Wait for URL to match pattern"),
          timeout: z.number().default(30000).describe("Timeout in ms"),
        },
        async ({ selector, text: waitText, url, timeout }) => {
          if (!selector && !waitText && !url) {
            return error("selector, text, or url required");
          }
          const result = await browserManager.execute(
            "wait",
            { selector, text: waitText, url },
            timeout,
          );
          if (!result.success) return error(result.error!);
          return text("Wait completed");
        },
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
          emulate: z
            .object({
              viewport: z
                .object({
                  width: z.number(),
                  height: z.number(),
                  isMobile: z.boolean().optional(),
                  hasTouch: z.boolean().optional(),
                  deviceScaleFactor: z.number().optional(),
                })
                .optional(),
              userAgent: z.string().optional(),
              colorScheme: z.enum(["light", "dark", "auto"]).optional(),
              geolocation: z
                .object({
                  latitude: z.number(),
                  longitude: z.number(),
                })
                .optional(),
            })
            .optional()
            .describe("Device emulation settings"),
        },
        async ({ script, emulate }) => {
          const results: string[] = [];

          // Apply emulation if provided
          if (emulate) {
            const emuResult = await browserManager.execute("emulate", emulate);
            if (!emuResult.success) return error(emuResult.error!);
            results.push("Emulation applied.");
          }

          // Execute script if provided
          if (script) {
            const result = await browserManager.execute<{ result: unknown }>(
              "evaluate",
              { script },
            );
            if (!result.success) return error(result.error!);
            const value = result.data?.result;
            const output =
              typeof value === "object"
                ? JSON.stringify(value, null, 2)
                : String(value);
            results.push(output);
          }

          if (results.length === 0) {
            return error("Provide script or emulate parameter.");
          }

          return text(results.join("\n"));
        },
      ),

      // ======================================================================
      // 13. browser_get_attribute (Unified Locator)
      // ======================================================================
      lockedTool(
        "browser_get_attribute",
        `Get element attributes or HTML content. Use specific attribute name, or special values: __all (all attributes), __innerHTML, __outerHTML, __textContent.
${commonDescription}`,
        {
          locator: locatorSchema,
          attribute: z
            .string()
            .optional()
            .describe(
              "Attribute name or __all/__innerHTML/__outerHTML/__textContent",
            ),
        },
        async ({ locator, attribute }) => {
          const parsed = parseLocator(locator);
          if (!parsed.ref && !parsed.selector) return error("Invalid locator");

          const result = await browserManager.execute<{
            value: string | null;
            exists?: boolean;
            attributes?: Record<string, string>;
          }>("getAttribute", {
            ref: parsed.ref,
            selector: parsed.selector,
            attribute,
          });
          if (!result.success) return error(result.error!);

          const data = result.data!;
          if (data.attributes) {
            return text(JSON.stringify(data.attributes, null, 2));
          }
          if (data.exists === false) {
            return text("Attribute does not exist");
          }
          return text(String(data.value));
        },
      ),

      // ======================================================================
      // 14. browser_extract_content — HTML to Markdown (Unified Locator)
      // ======================================================================
      lockedTool(
        "browser_extract_content",
        `Extract page content as Markdown. 'article' mode (default) detects main content. 'full' gets whole page. 'plain' gets text only.
${commonDescription}`,
        {
          locator: locatorSchema.optional(),
          mode: z.enum(["article", "full", "plain"]).default("article"),
        },
        async ({ locator, mode }) => {
          const parsed = parseLocator(locator);

          // 1. Get HTML from renderer
          const result = await browserManager.execute<{
            html?: string;
            text?: string;
            title: string;
            mode: string;
          }>("extractContent", {
            ref: parsed.ref,
            selector: parsed.selector,
            mode,
          });
          if (!result.success) return error(result.error!);

          const { html, text: plainText, title } = result.data!;

          // 2. Convert to Markdown (if not plain mode)
          let content = "";
          if (mode === "plain") {
            content = plainText || "";
          } else if (html) {
            try {
              content = turndownService.turndown(html);
            } catch (e) {
              return error(`Markdown conversion failed: ${e}`);
            }
          }

          return text(`# ${title}\n\n${content}`);
        },
      ),

      // ======================================================================
      // 15. browser_screenshot_full — scroll & stitch
      // ======================================================================
      lockedTool(
        "browser_screenshot_full",
        "Take a full-page scrolling screenshot. Automatically scrolls, captures, and stitches. Returns a file path.",
        {
          filePath: z.string().optional().describe("Save path"),
        },
        async ({ filePath }) => {
          // 1. Get fullpage capture from main process (buffers)
          // This avoids passing huge base64 strings through IPC which causes crashes/corruption
          const result = await browserManager.captureFullPageSegments();
          if (!result.success) return error(result.error!);

          const { segments, width, viewportHeight, totalHeight } = result.data!;

          if (segments.length === 0)
            return error("No screenshot segments captured");

          // 2. Stitch with sharp
          try {
            const buffers = segments; // Already Buffers

            // Get dimensions from first segment to handle DPI scaling
            const firstMeta = await sharp(buffers[0]).metadata();
            const segWidth = firstMeta.width || width;
            const segHeight = firstMeta.height || viewportHeight;

            // Calculate scale factor (Physical / Logical)
            const scale = segWidth / width;

            // Scaled total height
            const scaledTotalHeight = Math.ceil(totalHeight * scale);

            // Create composite list
            const composite = buffers.map((buf, i) => {
              let top = i * segHeight;

              // Handle last segment alignment (overlap instead of overflow)
              // This fixes the "Image to composite is outside the canvas" error
              // when the page height is not a perfect multiple of the viewport height.
              if (i === buffers.length - 1) {
                if (top + segHeight > scaledTotalHeight) {
                  // Align to bottom
                  top = Math.max(0, scaledTotalHeight - segHeight);
                }
              }

              return {
                input: buf,
                top: Math.round(top),
                left: 0,
              };
            });

            const savePath = filePath
              ? await resolveAndEnsurePath(filePath)
              : await getTempCapturePath("png");

            const outputBuffer = await sharp({
              create: {
                width: segWidth,
                height: scaledTotalHeight,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 },
              },
            })
              .composite(composite)
              .png()
              .toBuffer();

            await fs.writeFile(savePath, outputBuffer);

            return text(
              `Full page screenshot saved to: ${savePath}\nDimensions: ${segWidth}x${scaledTotalHeight}`,
            );
          } catch (e) {
            return error(`Failed to stitch screenshot: ${e}`);
          }
        },
      ),

      // ======================================================================
      // 16. browser_network
      // ======================================================================
      lockedTool(
        "browser_network",
        "Start, stop, clear, or collect network monitoring. Captures fetch/XHR requests and response bodies (text/json only).",
        {
          action: z
            .enum(["start", "stop", "clear", "collect"])
            .describe("Start, stop, clear, or collect (wait for) requests"),
          options: z
            .object({
              maxRequests: z.number().optional(),
              maxBodySize: z.number().optional(),
              captureTypes: z
                .array(z.string())
                .optional()
                .describe(
                  "Resource types to capture (e.g. ['fetch', 'xhr', 'script']). Default: ['fetch', 'xhr']",
                ),
              // Collect params
              urlPattern: z.string().optional().describe("Regex pattern for URL (collect mode)"),
              method: z.string().optional().describe("HTTP method (collect mode)"),
              count: z.number().int().min(1).default(1).describe("Number of requests to collect (collect mode)"),
              timeout: z.number().int().default(30000).describe("Timeout in ms (collect mode)"),
            })
            .optional(),
        },
        async ({ action, options }) => {
          if (action === "start") {
            // Direct call to main process method (CDP-based)
            const result = await browserManager.startNetworkCapture(options || {});
            if (!result.success) return error(result.error!);
            return text("Network monitoring started.");
          } else if (action === "collect") {
            const result = await browserManager.waitForNetworkRequests({
              urlPattern: options?.urlPattern,
              method: options?.method,
              count: options?.count,
              timeout: options?.timeout,
            });
            if (!result.success) return error(result.error!);
            return text(JSON.stringify(result.data!.requests, null, 2));
          } else if (action === "clear") {
            const result = await browserManager.clearNetworkCapture();
            if (!result.success) return error(result.error!);
            return text("Network capture cleared.");
          } else {
            const result = await browserManager.stopNetworkCapture();
            if (!result.success) return error(result.error!);
            return text(
              `Network monitoring stopped. Captured ${result.data} requests.`,
            );
          }
        },
      ),

      // ======================================================================
      // 17. browser_network_requests
      // ======================================================================
      lockedTool(
        "browser_network_requests",
        "Get captured network requests. Support filtering.",
        {
          urlPattern: z.string().optional().describe("Regex pattern for URL"),
          method: z.string().optional(),
          hasError: z.boolean().optional(),
          limit: z.number().default(50),
          offset: z.number().default(0),
        },
        async (filter) => {
          // Direct call to main process method
          const result = await browserManager.getNetworkRequests(filter);
          if (!result.success) return error(result.error!);

          const { requests, total, capturing } = result.data!;
          return text(
            JSON.stringify(
              {
                capturing,
                total,
                count: requests.length,
                requests,
              },
              null,
              2,
            ),
          );
        },
      ),

      // ======================================================================
      // 18. browser_download_batch — batch download from page elements (Unified Locator)
      // ======================================================================
      lockedTool(
        "browser_download_batch",
        `Download one or more resources from the current page.
${commonDescription}
Uses the browser's fetch API internally, bypassing CORS restrictions.
Supports concurrent downloads, retry, and smart attribute detection.`,
        {
          items: z
            .array(
              z.object({
                locator: locatorSchema.optional().describe("Element or URL"),
                filePath: z
                  .string()
                  .describe("Save path (relative or absolute)"),
                attribute: z
                  .string()
                  .optional()
                  .describe(
                    'Element attribute to get URL from, e.g. "poster". Auto-detected if omitted.',
                  ),
              }),
            )
            .min(1)
            .describe("Items to download"),
          options: z
            .object({
              retry: z
                .number()
                .int()
                .min(0)
                .max(10)
                .default(0)
                .describe("Retry count on failure"),
              timeout: z
                .number()
                .int()
                .min(1000)
                .max(120000)
                .default(30000)
                .describe("Per-item timeout in ms"),
              continueOnError: z
                .boolean()
                .default(true)
                .describe("Continue downloading if one item fails"),
              concurrent: z
                .number()
                .int()
                .min(1)
                .max(10)
                .default(3)
                .describe("Max concurrent downloads"),
            })
            .optional()
            .describe("Global download options"),
        },
        async ({ items, options }) => {
          // Map unified locator to old structure for renderer
          const mappedItems = items.map((item) => {
            const parsed = parseLocator(item.locator);
            return {
              ref: parsed.ref,
              url: parsed.url,
              selector: parsed.selector,
              filePath: item.filePath,
              attribute: item.attribute,
            };
          });

          // Execute batch download in renderer (fetches in webview context)
          const result = await browserManager.execute<{
            summary: {
              total: number;
              successful: number;
              failed: number;
              totalSize: number;
              duration: number;
            };
            results: Array<{
              input: { ref?: string; url?: string; selector?: string };
              status: "success" | "failed";
              filePath?: string;
              size?: number;
              url?: string;
              mimeType?: string;
              error?: string;
              retries?: number;
            }>;
            _writeQueue: Array<{ filePath: string; base64: string }>;
          }>("downloadBatch", { items: mappedItems, options });

          if (!result.success) return error(result.error!);

          const { summary, results: itemResults, _writeQueue } = result.data!;

          // Write files to disk (main process has filesystem access)
          const writeErrors: string[] = [];
          for (const item of _writeQueue) {
            try {
              const savePath = await resolveAndEnsurePath(item.filePath);
              const buffer = Buffer.from(item.base64, "base64");
              await fs.writeFile(savePath, buffer);
              // Update the result's filePath to absolute path
              const matchResult = itemResults.find(
                (r) => r.filePath === item.filePath && r.status === "success",
              );
              if (matchResult) matchResult.filePath = savePath;
            } catch (e) {
              writeErrors.push(`${item.filePath}: ${e}`);
              // Mark as failed
              const matchResult = itemResults.find(
                (r) => r.filePath === item.filePath && r.status === "success",
              );
              if (matchResult) {
                matchResult.status = "failed";
                matchResult.error = `File write failed: ${e}`;
                summary.successful--;
                summary.failed++;
              }
            }
          }

          // Format sizes for display
          const formatSize = (bytes: number) => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
          };

          const formatDuration = (ms: number) => {
            if (ms < 1000) return `${ms}ms`;
            return `${(ms / 1000).toFixed(1)}s`;
          };

          // Build response
          const displayResults = itemResults.map((r) => {
            if (r.status === "success") {
              return {
                input: r.input,
                status: r.status,
                filePath: r.filePath,
                size: r.size ? formatSize(r.size) : undefined,
                url: r.url,
                mimeType: r.mimeType,
              };
            }
            return {
              input: r.input,
              status: r.status,
              error: r.error,
              retries: r.retries,
            };
          });

          return text(
            JSON.stringify(
              {
                summary: {
                  total: summary.total,
                  successful: summary.successful,
                  failed: summary.failed,
                  totalSize: formatSize(summary.totalSize),
                  duration: formatDuration(summary.duration),
                },
                results: displayResults,
              },
              null,
              2,
            ),
          );
        },
      ),

      // ======================================================================
      // 19. browser_console — query/collect/clear console logs
      // ======================================================================
      lockedTool(
        "browser_console",
        `Access browser console logs. Three modes:

【query】 Query existing logs with filters, pagination
【collect】 Wait for new matching logs to appear (real-time monitoring)
【clear】 Clear log buffer (optionally filtered by level)

Logs are buffered in-memory (max 1000 entries) from webview console-message events.`,
        {
          action: z
            .enum(["query", "collect", "clear"])
            .describe("Operation mode"),
          filters: z
            .object({
              levels: z
                .array(z.enum(["log", "info", "warn", "error", "debug"]))
                .optional()
                .describe("Filter by log levels (default: all)"),
              textPattern: z
                .string()
                .optional()
                .describe("Regex pattern to match log message content"),
              sourcePattern: z
                .string()
                .optional()
                .describe("Regex pattern to match source file"),
              minTimestamp: z
                .number()
                .optional()
                .describe("Only return logs after this timestamp (ms)"),
            })
            .optional()
            .describe("Log filters (shared across all modes)"),
          // query params
          limit: z
            .number()
            .int()
            .min(1)
            .max(500)
            .default(50)
            .describe("Max logs to return (query mode)"),
          offset: z
            .number()
            .int()
            .min(0)
            .default(0)
            .describe("Skip first N logs for pagination (query mode)"),
          // collect params
          count: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(1)
            .describe(
              "Number of matching logs to collect before returning (collect mode)",
            ),
          timeout: z
            .number()
            .int()
            .min(1000)
            .max(120000)
            .default(30000)
            .describe("Max wait time in ms (collect mode)"),
        },
        async ({ action, filters, limit, offset, count, timeout }) => {
          const operationType =
            action === "query"
              ? "consoleQuery"
              : action === "collect"
                ? "consoleCollect"
                : "consoleClear";

          const result = await browserManager.execute<{
            action: string;
            logs?: Array<{
              id: number;
              level: string;
              message: string;
              timestamp: number;
              source: string;
            }>;
            total?: number;
            returned?: number;
            hasMore?: boolean;
            collected?: number;
            requested?: number;
            timedOut?: boolean;
            waitTime?: number;
            cleared?: number;
            remaining?: number;
          }>(operationType, { filters, limit, offset, count, timeout });

          if (!result.success) return error(result.error!);
          return text(JSON.stringify(result.data!, null, 2));
        },
      ),

      // ======================================================================
      // 20. browser_upload_file (Unified Locator)
      // ======================================================================
      lockedTool(
        "browser_upload_file",
        `Upload a file to a file input element.
${commonDescription}
Uses the browser debugger protocol to securely set file input files.`,
        {
          locator: locatorSchema,
          filePath: z.string().describe("Absolute path to the file to upload"),
        },
        async ({ locator, filePath }) => {
          const parsed = parseLocator(locator);
          const absPath = await resolveAndEnsurePath(filePath);

          // Verify file exists
          try {
            await fs.access(absPath);
          } catch {
            return error(`File not found: ${absPath}`);
          }

          const result = await browserManager.execute("uploadFile", {
            ref: parsed.ref,
            selector: parsed.selector,
            filePath: absPath,
          });
          if (!result.success) return error(result.error!);
          return text(`File uploaded to ${parsed.ref || parsed.selector}`);
        },
      ),

      // ======================================================================
      // 21. browser_cookies
      // ======================================================================
      lockedTool(
        "browser_cookies",
        `Manage browser cookies.
- get: List all cookies (optionally filtered by domain/name)
- set: Set a cookie
- delete: Delete a cookie
- clear: Clear all cookies`,
        {
          action: z.enum(["get", "set", "delete", "clear"]),
          cookie: z
            .object({
              name: z.string().optional(),
              value: z.string().optional(),
              domain: z.string().optional(),
              path: z.string().optional(),
              secure: z.boolean().optional(),
              httpOnly: z.boolean().optional(),
            })
            .optional()
            .describe("Cookie data for set/delete operations"),
          url: z.string().optional().describe("URL to get/set cookies for"),
        },
        async ({ action, cookie, url }) => {
          const result = await browserManager.execute<{
            cookies?: unknown[];
            count?: number;
          }>("cookies", {
            action,
            cookie,
            url,
          });
          if (!result.success) return error(result.error!);

          if (action === "get") {
            return text(JSON.stringify(result.data?.cookies || [], null, 2));
          }
          return text(`Cookie action '${action}' completed.`);
        },
      ),

      // ======================================================================
      // 22. browser_storage
      // ======================================================================
      lockedTool(
        "browser_storage",
        `Manage local/session storage.
- get: Get all keys or specific key
- set: Set a key-value pair
- delete: Delete a key
- clear: Clear all storage`,
        {
          type: z.enum(["local", "session"]).default("local"),
          action: z.enum(["get", "set", "delete", "clear"]),
          key: z.string().optional(),
          value: z.string().optional(),
        },
        async ({ type, action, key, value }) => {
          const result = await browserManager.execute<{
            data?: Record<string, string> | string | null;
          }>("storage", {
            type,
            action,
            key,
            value,
          });
          if (!result.success) return error(result.error!);

          if (action === "get") {
            if (key) {
              return text(String(result.data?.data));
            }
            return text(JSON.stringify(result.data?.data || {}, null, 2));
          }
          return text(`Storage action '${action}' completed.`);
        },
      ),
    ];
}

export async function createBrowserMcpServer() {
  const { createSdkMcpServer } = await getSdkModule();
  const tools = await getBrowserToolDefinitions();

  return createSdkMcpServer({
    name: "browser",
    version: "2.0.0",
    tools,
  });
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
  if (!ref && !selector) return "Skipped: no ref or selector";

  switch (mode) {
    case "hover": {
      const result = await browserManager.execute("hover", { ref, selector });
      return result.success
        ? `Hovered ${ref || selector}`
        : `Error: ${result.error}`;
    }
    case "drag": {
      if (!dragTo) return "Error: dragTo required for drag mode";
      const result = await browserManager.execute("drag", {
        fromRef: ref,
        fromSelector: selector,
        toRef: dragTo,
      });
      return result.success
        ? `Dragged ${ref || selector} → ${dragTo}`
        : `Error: ${result.error}`;
    }
    case "dblclick": {
      const result = await browserManager.execute("click", {
        ref,
        selector,
        dblClick: true,
      });
      return result.success
        ? `Double-clicked ${ref || selector}`
        : `Error: ${result.error}`;
    }
    default: {
      const result = await browserManager.execute("click", {
        ref,
        selector,
        dblClick: false,
      });
      return result.success
        ? `Clicked ${ref || selector}`
        : `Error: ${result.error}`;
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
  if (!ref && !selector) return "Skipped: no ref or selector";

  // Checkbox/radio toggle
  if (checked !== undefined) {
    const result = await browserManager.execute("check", {
      ref,
      selector,
      checked,
    });
    return result.success
      ? `${checked ? "Checked" : "Unchecked"} ${ref || selector}`
      : `Error: ${result.error}`;
  }

  // Select dropdown or text fill
  if (value !== undefined) {
    // Try fill first (works for text inputs, textareas, selects)
    if (append) {
      const result = await browserManager.execute("type", {
        ref,
        selector,
        text: value,
      });
      return result.success
        ? `Appended to ${ref || selector}`
        : `Error: ${result.error}`;
    }
    const result = await browserManager.execute("fill", {
      ref,
      selector,
      value,
    });
    return result.success
      ? `Filled ${ref || selector}`
      : `Error: ${result.error}`;
  }

  return "Error: value or checked required";
}
