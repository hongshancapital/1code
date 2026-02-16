---
name: "browser"
description: "This skill should be used when the user asks to \"open a web page\", \"fill a form\", \"click a button\", \"take a screenshot\", \"scrape a website\", \"test a web UI\", \"download a file from a page\", \"browse to URL\", or any task involving interaction with the built-in browser. Provides guidance on the browser MCP tool workflow, authentication handling, and troubleshooting."
---

# Browser Automation Skill

## When to use
- Navigate to web pages and extract information.
- Fill forms, click buttons, and interact with web UIs.
- Take screenshots or download files from web pages.
- Test web applications during development.
- Scrape structured data from websites.
- Debug frontend issues by inspecting live pages.

## Tool Overview (12 tools)

| Tool | Lock | Purpose |
|------|------|---------|
| `browser_status` | No | Check browser state (URL, title, ready, locked) |
| `browser_lock` | No | Lock browser for AI session (MUST call first) |
| `browser_unlock` | No | Release browser control (MUST call when done) |
| `browser_navigate` | Yes | Go to URL, back/forward/reload, open panel |
| `browser_snapshot` | Yes | Get page elements with refs, or CSS query |
| `browser_click` | Yes | Click/dblclick/hover/drag, supports batch |
| `browser_input` | Yes | Fill/select/check form fields, supports batch |
| `browser_capture` | Yes | Screenshot or download (always saves to file) |
| `browser_scroll` | Yes | Scroll page or element into view |
| `browser_press` | Yes | Press key or key combination |
| `browser_wait` | Yes | Wait for element/text/URL to appear |
| `browser_evaluate` | Yes | Execute JS or configure device emulation |

## Standard Workflow

Every browser session MUST follow this pattern:

```
1. browser_lock          → Lock browser (blocks user interaction)
2. browser_navigate      → Go to target URL (use show:true if panel not visible)
3. browser_snapshot      → Get element refs
4. browser_click/input   → Interact with elements using refs (@e1, @e2...)
5. browser_snapshot      → Re-snapshot after page changes (refs reset!)
6. ... repeat 3-5 as needed ...
7. browser_unlock        → Release control (CRITICAL - don't forget!)
```

## Key Rules

### Always lock/unlock
- Call `browser_lock` before ANY browser tool (except `browser_status`).
- Call `browser_unlock` when ALL operations are complete.
- Lock auto-releases after 5 minutes as a safety net — still always unlock explicitly.

### Refs reset on each snapshot
- Element refs like `@e1` are only valid until the next `browser_snapshot` call.
- After navigation or clicks that cause page changes, always re-snapshot.

### Screenshots always save to files
- `browser_capture` NEVER returns image data inline.
- If no `filePath` is given, it saves to a temp directory.
- To show in chat: `![description](file_path)`.

### Batch operations for efficiency
- `browser_click` accepts `actions` array for multiple clicks in sequence.
- `browser_input` accepts `fields` array for filling multiple form fields at once.
- Use batch mode when filling forms or performing repetitive clicks.

### CSS selector queries
- Use `browser_snapshot` with `query` parameter to find elements by CSS selector.
- Useful for web development: `query: ".error-message"` or `query: "[data-testid='submit']"`.
- Query results include assigned refs that work with other tools.

## Handling Common Scenarios

### Authentication / Login pages
1. Snapshot to find username/password fields.
2. Use `browser_input` with `fields` array to fill both at once.
3. Click the submit button.
4. Wait for navigation or dashboard element to appear.
5. If 2FA/CAPTCHA appears, inform the user and unlock the browser for manual intervention.

### CAPTCHA encountered
1. Detect CAPTCHA by snapshot content or waiting timeout.
2. Unlock the browser: `browser_unlock`.
3. Inform the user: "I've encountered a CAPTCHA. Please solve it manually, then tell me to continue."
4. When user says to continue: re-lock and proceed.

### Page load failures
1. If navigation fails, try `browser_navigate` with `action: "reload"`.
2. If still failing, check the URL format.
3. As a last resort, use `browser_evaluate` to check `document.readyState`.

### Single Page Applications (SPAs)
- After clicking, use `browser_wait` with `selector` to wait for content changes.
- Avoid relying on page navigation events — SPAs update in-place.

### Dropdowns and modals
1. Click the trigger element to open.
2. Re-snapshot to see the newly visible options.
3. Click the desired option.

### File downloads
- Use `browser_capture` with `mode: "download"` and provide the `url` or `ref`.
- Always provide a meaningful `filePath`.

## Device Emulation
Use `browser_evaluate` with `emulate` parameter:

```json
{
  "emulate": {
    "viewport": { "width": 375, "height": 812, "isMobile": true, "hasTouch": true },
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)..."
  }
}
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Browser not locked" error | Call `browser_lock` first |
| Element ref not found | Re-snapshot — refs reset on each call |
| Click doesn't work | Try `browser_evaluate` with `el.click()` as fallback |
| Form not submitting | Check if there's a submit button to click, or press Enter |
| Page content not updating | Use `browser_wait` before re-snapshot |
| Screenshot fails | Ensure browser has loaded; try with `fullPage: false` |
