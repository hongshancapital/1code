# Browser MCP v2 — 完整重构方案

## 一、工具整合：22 → 12

### 工具映射表

| # | 新工具 | 替代 | 核心变化 |
|---|--------|------|----------|
| 1 | `browser_lock` | 同名 | 加 5 分钟自动释放超时 |
| 2 | `browser_unlock` | 同名 | 不变 |
| 3 | `browser_navigate` | navigate + back + forward + reload | `action` 参数区分，`show` 参数拉起浏览器面板 |
| 4 | `browser_snapshot` | snapshot + get_url + get_title + get_text | 自动附带 URL+title，新增 `query` 参数(CSS selector)→返回 refs |
| 5 | `browser_click` | click + hover + drag | `actions` 数组支持批量，每项有 `mode: click|dblclick|hover|drag` |
| 6 | `browser_input` | fill + type + select + check | `fields` 数组支持批量填写，自动推断元素类型 |
| 7 | `browser_capture` | screenshot + download_image + download_file | 永远写文件（不返回 base64），支持元素级截图，自动临时路径 |
| 8 | `browser_scroll` | scroll | 不变 |
| 9 | `browser_press` | press | 不变 |
| 10 | `browser_wait` | wait | 不变 |
| 11 | `browser_evaluate` | evaluate + emulate | 合并设备模拟到 `emulate` 子参数 |
| 12 | `browser_status` | **新增** | **免 lock**，轻量查询浏览器状态 |

### 删除的工具（10 个）
`browser_back`, `browser_forward`, `browser_reload`, `browser_get_url`, `browser_get_title`, `browser_get_text`, `browser_type`, `browser_select`, `browser_check`, `browser_hover`, `browser_drag`, `browser_fill`, `browser_download_image`, `browser_download_file`, `browser_emulate`

---

## 二、各工具详细设计

### 2.1 `browser_status`（新增，免 lock）

```typescript
// 不需要 lock，AI 随时可以查询浏览器状态
tool("browser_status",
  "Get current browser state without locking. Returns URL, title, ready status, and lock state.",
  {},
  async () => {
    return {
      url: browserManager.currentUrl,
      title: browserManager.currentTitle,
      isReady: browserManager.isReady,
      isLocked: browserManager.isLocked,
    }
  }
)
```

### 2.2 `browser_navigate`（合并导航）

```typescript
tool("browser_navigate",
  "Navigate the browser. Use url to go to a page, or action for back/forward/reload.",
  {
    url: z.string().optional().describe("URL to navigate to"),
    action: z.enum(["back", "forward", "reload"]).optional()
      .describe("Navigation action (alternative to url)"),
    show: z.boolean().default(false)
      .describe("Open the browser panel if not visible"),
  },
  ...
)
```

关键：`show: true` 时通过 IPC `browser:show-panel` 通知渲染进程设置 `browserVisibleAtomFamily(chatId)` 为 true。

### 2.3 `browser_snapshot`（增强观察）

```typescript
tool("browser_snapshot",
  "Get page content and element references. Returns accessibility tree with URL and title. Use query to find elements by CSS selector.",
  {
    interactiveOnly: z.boolean().default(true),
    query: z.string().optional()
      .describe("CSS selector to find specific elements. Returns matching element refs."),
  },
  ...
)
```

返回格式增强：
```
URL: https://example.com
Title: Example Page

[e1] button "Sign In"
[e2] textbox "Email" placeholder="Enter email"
[e3] link "Forgot password?" href="/forgot"
```

**`query` 参数**：在 webview 脚本中新增 `__browserQuerySelector(selector)` 函数，使用 `document.querySelectorAll(selector)` 找到元素，给它们分配 refs，返回匹配的 ref 列表及其角色/名称。适合 web dev 场景下用 `.class` 或 `#id` 精确定位。

### 2.4 `browser_click`（批量交互）

```typescript
tool("browser_click",
  "Click, hover, or drag elements. Supports batch operations.",
  {
    // 单个操作
    ref: refSchema,
    selector: selectorSchema,
    mode: z.enum(["click", "dblclick", "hover", "drag"]).default("click"),
    dragTo: refSchema.describe("Target ref for drag mode"),
    // 批量操作（优先于单个）
    actions: z.array(z.object({
      ref: z.string().optional(),
      selector: z.string().optional(),
      mode: z.enum(["click", "dblclick", "hover", "drag"]).default("click"),
      dragTo: z.string().optional(),
    })).optional().describe("Batch actions. Each item is an independent click/hover/drag."),
  },
  ...
)
```

### 2.5 `browser_input`（批量填写）

```typescript
tool("browser_input",
  "Fill form fields, select options, or toggle checkboxes. Supports batch operations.",
  {
    // 单个操作
    ref: refSchema,
    selector: selectorSchema,
    value: z.string().optional().describe("Value to fill or select"),
    checked: z.boolean().optional().describe("For checkboxes/radios"),
    append: z.boolean().default(false).describe("Append text instead of replacing"),
    // 批量操作
    fields: z.array(z.object({
      ref: z.string().optional(),
      selector: z.string().optional(),
      value: z.string().optional(),
      checked: z.boolean().optional(),
    })).optional().describe("Batch fill. Each item targets one form field."),
  },
  ...
)
```

### 2.6 `browser_capture`（统一截图/下载）

```typescript
tool("browser_capture",
  "Screenshot or download from the browser. Always saves to a file. If no filePath is given, saves to a temporary location.",
  {
    mode: z.enum(["screenshot", "download"]).default("screenshot"),
    // screenshot 参数
    ref: refSchema.describe("Capture a specific element instead of full page"),
    fullPage: z.boolean().default(false),
    // download 参数
    url: z.string().optional().describe("Direct URL to download (for download mode)"),
    // 通用
    filePath: z.string().optional()
      .describe("Save path. If omitted, saves to temp directory. You can show the image in chat using ![screenshot](file_path) markdown."),
  },
  ...
)
```

返回格式：
```
Screenshot saved to: /tmp/hong-browser/screenshot-1707400000.png
💡 To show this image in chat, use: ![screenshot](/tmp/hong-browser/screenshot-1707400000.png)
💡 To save permanently, copy to your project directory.
```

### 2.7 `browser_lock` 增强

```typescript
// 5 分钟自动释放超时
private lockTimeout: NodeJS.Timeout | null = null

lock(): { alreadyLocked: boolean } {
  if (this.state.isLocked) return { alreadyLocked: true }
  this.state.isLocked = true
  // 自动释放超时
  this.lockTimeout = setTimeout(() => {
    this.unlock()
    console.warn("[BrowserManager] Lock auto-released after 5 minutes timeout")
  }, 5 * 60 * 1000)
  this.getWindow()?.webContents.send("browser:lock-state-changed", true)
  this.emit("lockStateChanged", true)
  return { alreadyLocked: false }
}

unlock(): { wasLocked: boolean } {
  if (!this.state.isLocked) return { wasLocked: false }
  this.state.isLocked = false
  if (this.lockTimeout) {
    clearTimeout(this.lockTimeout)
    this.lockTimeout = null
  }
  this.getWindow()?.webContents.send("browser:lock-state-changed", false)
  this.emit("lockStateChanged", false)
  return { wasLocked: true }
}
```

---

## 三、架构改进

### 3.1 Boilerplate 消除 — `lockedTool` 工厂

```typescript
function lockedTool<T>(
  name: string,
  description: string,
  schema: z.ZodRawShape,
  handler: (params: T) => Promise<ToolResult>,
) {
  return tool(name, description, schema, async (params: T): Promise<ToolResult> => {
    if (!browserManager.isLocked) {
      return {
        content: [{ type: "text", text: "Error: Browser is not locked. Call browser_lock first." }],
      }
    }
    return handler(params)
  })
}

// 免 lock 工具直接用 tool()
function freeTool<T>(...) { return tool(...) }
```

### 3.2 所有操作加超时兜底

```typescript
// 在 browserManager.execute 中加入全局超时
async execute<T>(type: string, params: Record<string, unknown>, timeout = 30000): Promise<BrowserResult<T>> {
  const timeoutPromise = new Promise<BrowserResult<T>>((resolve) =>
    setTimeout(() => resolve({ success: false, error: `Operation '${type}' timed out after ${timeout}ms` }), timeout)
  )
  return Promise.race([this._executeInternal(type, params), timeoutPromise])
}
```

---

## 四、Webview 脚本增强

### 4.1 CSS Selector 查询 → 返回 refs

```javascript
// 新增：通过 CSS selector 查询元素，分配 refs 并返回
window.__browserQuerySelector = function(selector) {
  const elements = document.querySelectorAll(selector);
  const results = [];
  for (const el of elements) {
    if (!isVisible(el)) continue;
    // 检查是否已有 ref
    let existingRef = null;
    for (const [ref, mappedEl] of refMap.entries()) {
      if (mappedEl === el) { existingRef = ref; break; }
    }
    // 没有则分配新 ref
    const ref = existingRef || `@e${++refCounter}`;
    if (!existingRef) refMap.set(ref, el);
    results.push({
      ref,
      role: getRole(el),
      name: getAccessibleName(el),
      tag: el.tagName.toLowerCase(),
      attrs: getRelevantAttrs(el),
    });
  }
  return { success: true, data: results, count: results.length };
};
```

### 4.2 元素级截图辅助

```javascript
// 获取元素的精确裁剪区域（用于元素截图）
window.__browserGetElementClipRect = function(ref) {
  const el = refMap.get(ref);
  if (!el) return null;
  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  const rect = el.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
};
```

### 4.3 增强 hover — 程序触发真实 CSS :hover

当前 `__browserHover` 只派发事件，不触发 CSS `:hover` 伪类。增强方案：

```javascript
window.__browserHover = function(ref) {
  const el = refMap.get(ref);
  if (!el) return { success: false, error: `Element not found: ${ref}` };

  // 1. 派发鼠标事件（触发 JS 事件监听器）
  const rect = el.getBoundingClientRect();
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  el.dispatchEvent(new MouseEvent('mouseenter', { clientX: cx, clientY: cy, bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseover', { clientX: cx, clientY: cy, bubbles: true }));
  el.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }));

  // 2. 注入临时样式强制 :hover 效果（CSS 伪类无法通过 JS 触发）
  // 获取元素的 :hover 规则并临时应用
  el.setAttribute('data-browser-hover', 'true');
  if (!document.getElementById('__browser-hover-style')) {
    const style = document.createElement('style');
    style.id = '__browser-hover-style';
    style.textContent = '[data-browser-hover="true"] { /* inherits :hover styles via specificity trick */ }';
    document.head.appendChild(style);
  }
  // 清理之前的 hover
  document.querySelectorAll('[data-browser-hover]').forEach(e => {
    if (e !== el) e.removeAttribute('data-browser-hover');
  });

  return { success: true, position: { x: cx, y: cy } };
};
```

注：CSS `:hover` 伪类在 Electron webview 中可通过 `webview.sendInputEvent({ type: 'mouseMove', x, y })` 在渲染进程中真正触发。在 `browser-sidebar.tsx` 的 hover 操作处理中使用这个方法。

---

## 五、IPC — 打开浏览器面板

### 5.1 主进程 → 渲染进程

```typescript
// manager.ts
showPanel(): void {
  this.getWindow()?.webContents.send("browser:show-panel")
}
```

### 5.2 Preload

```typescript
// preload/index.ts
onBrowserShowPanel: (callback: () => void) => {
  const handler = () => callback()
  ipcRenderer.on("browser:show-panel", handler)
  return () => ipcRenderer.removeListener("browser:show-panel", handler)
},
```

### 5.3 渲染进程监听

在 `active-chat.tsx` 或 cowork layout 中监听，设置 `browserVisibleAtomFamily(chatId)` = true。

---

## 六、Built-in Skill — `browser`

### 文件：`resources/skills/browser/SKILL.md`

```markdown
---
name: "browser"
description: "Use the built-in browser for web tasks: browsing, form filling, testing, and web scraping."
---

# Browser Skill

## When to use
- User asks to visit, check, or interact with a website
- WebFetch tool fails (blocked, requires JS rendering, CAPTCHA)
- Need to fill forms, login to services, or interact with web apps
- Testing web applications during development
- Need visual verification of a web page (screenshot)

## Workflow

### Standard browsing
1. Call `browser_navigate` with `show: true` to open the browser panel
2. Call `browser_lock` to take control
3. Use `browser_snapshot` to read page content and get element refs
4. Interact with `browser_click`, `browser_input`, `browser_press` as needed
5. Use `browser_capture` for screenshots (show with markdown: `![desc](path)`)
6. Call `browser_unlock` when done

### Handling authentication / passwords
When a page requires login or password input:
1. Fill what you can (username, etc.)
2. Call `browser_unlock` to return control to the user
3. Tell the user: "I've navigated to the login page. Please enter your password, then let me know when you're ready to continue."
4. When user confirms, call `browser_lock` again and proceed

### Handling CAPTCHAs / bot detection
If you encounter a CAPTCHA or bot detection:
1. Call `browser_unlock` to return control
2. Tell the user: "The site has a CAPTCHA. Please solve it and let me know when done."
3. Resume after user confirmation

### Handling failed fetch/network requests
If `WebFetch` or `curl` fails with 403/429/bot detection:
1. Suggest using the built-in browser as fallback
2. Navigate to the URL with `browser_navigate(url, show: true)`
3. Use `browser_snapshot` to read the rendered content

## Element references
- Always use `@eN` refs from `browser_snapshot` for interactions
- Refs reset after each snapshot — always re-snapshot after page changes
- For web development, use `query` parameter with CSS selectors: `browser_snapshot(query: ".my-class")`
- All element-targeting tools accept both `ref` and `selector` parameters

## Tips
- Use `browser_status` (no lock needed) to check browser state before deciding to use it
- Use `browser_capture` for screenshots — images are saved to files, show them with `![](path)` markdown
- Batch operations with `browser_input(fields: [...])` and `browser_click(actions: [...])` to reduce round trips
- The browser panel persists across messages — no need to re-navigate unless URL changed
```

---

## 七、Overlay / Cursor UX 重构

### 7.1 视觉风格重新设计

**整体设计理念**：从"蓝色科技风"转为更专业沉稳的**深色半透明 + 微光呼吸**效果。

```tsx
// browser-overlay.tsx 重写要点

// 1. 主题色：从 blue-500 改为更中性的 slate/zinc + 淡蓝辉光
// 2. 呼吸灯效果：用 CSS animation 实现边框光效缓慢呼吸
// 3. 锁定蒙版：更轻的磨砂效果 + 扫描线纹理

// 呼吸光效 CSS
const breatheAnimation = `
@keyframes borderBreathe {
  0%, 100% { border-color: rgba(148, 163, 184, 0.2); box-shadow: inset 0 0 20px rgba(148, 163, 184, 0.05); }
  50% { border-color: rgba(148, 163, 184, 0.4); box-shadow: inset 0 0 30px rgba(148, 163, 184, 0.1); }
}
`

// 扫描线纹理（可选）
const scanlineOverlay = `
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(0, 0, 0, 0.03) 2px,
    rgba(0, 0, 0, 0.03) 4px
  );
`
```

### 7.2 AI Cursor 重设计

**关键改动**：
1. 指针颜色从蓝色改为**黑色**（更专业）
2. 移动到目标元素时有明确的**路径动画**
3. Click 时有专门的**按压动画**（缩放 + 涟漪）
4. 非镜像翻转（当前的 scaleX(-1) 不自然）

```tsx
// 黑色指针 SVG
<svg viewBox="0 0 24 24" fill="none">
  <path
    d="M5 2L5 19L9 15L13 22L16 21L12 14L18 14L5 2Z"
    fill="#1a1a1a"
    stroke="white"
    strokeWidth="1.5"
  />
</svg>

// 点击动画序列
// 1. 移动到目标位置 (spring animation)
// 2. 到达后：指针缩小 0.85 (50ms) → 恢复 1.0 (100ms) → 涟漪扩散
// 3. 涟漪：从指针尖端扩散的圆环，颜色 rgba(0,0,0,0.15)
```

### 7.3 Hover 真实触发

在 `browser-sidebar.tsx` 的 `executeOperation` 的 `hover` case 中：

```typescript
case "hover": {
  const ref = params.ref as string
  if (ref) {
    // 1. 获取元素位置
    const rect = await webview.executeJavaScript(
      `window.__browserGetElementRect("${ref}")`
    )
    if (rect) {
      // 2. 移动 AI cursor
      setCursorPosition({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
      await new Promise(r => setTimeout(r, 300))
      // 3. 发送真实 mouseMove 事件（触发 CSS :hover）
      webview.sendInputEvent({
        type: "mouseMove",
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      })
    }
    // 4. 同时派发 JS 事件
    const result = await webview.executeJavaScript(
      `window.__browserHover("${ref}")`
    )
    return result
  }
  return { success: false, error: "No ref provided" }
}
```

### 7.4 Click/Fill 时的指针联动

所有涉及元素的操作（click/fill/hover/drag）都应：
1. 先获取元素 rect
2. 动画移动 cursor 到元素中心
3. 等待动画完成（~300ms）
4. 执行操作
5. click 额外加按压+涟漪动画

这个逻辑已经部分存在于 click/fill/hover，需要统一到一个 helper：

```typescript
async function animateCursorToElement(webview, ref, setCursorPosition) {
  const rect = await webview.executeJavaScript(
    `window.__browserGetElementRect("${ref}")`
  )
  if (rect) {
    setCursorPosition({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    })
    await new Promise(r => setTimeout(r, 300))
  }
  return rect
}
```

---

## 八、Bug 修复

### 8.1 `browser_get_text` selector 参数不工作

**原因**：`scripts.ts` 中 `__browserGetText` 只接受 ref，不支持 selector。
**修复**：在新的 `browser_snapshot` 的 `query` 功能中统一解决 — 用 selector 查询后拿到 ref，再用 ref 操作。

### 8.2 Screenshot base64 序列化错误

**原因**：MCP 工具返回 `{ type: "image", data: base64 }` 时，base64 数据过大导致序列化失败。
**修复**：`browser_capture` **永远写文件，返回文件路径**。自动临时路径使用 `app.getPath('temp')/hong-browser/`。

```typescript
import { app } from "electron"
import * as path from "path"
import * as fs from "fs/promises"

async function getCapturePath(filePath?: string, ext = "png"): Promise<string> {
  if (filePath) return filePath
  const tempDir = path.join(app.getPath("temp"), "hong-browser")
  await fs.mkdir(tempDir, { recursive: true })
  return path.join(tempDir, `capture-${Date.now()}.${ext}`)
}
```

---

## 九、实施步骤（按文件分组）

### Phase 1：核心重构（MCP + Manager）
1. **`src/main/lib/browser/manager.ts`**
   - Lock 超时自动释放
   - `showPanel()` IPC 方法
   - `execute()` 全局超时兜底
2. **`src/main/lib/browser/mcp-server.ts`**
   - 完全重写：12 个工具替代 22 个
   - `lockedTool()` / `freeTool()` 工厂函数
   - 截图永远写文件 + 自动临时路径
3. **`src/main/lib/browser/types.ts`**
   - 新增 `QueryResult` 等类型

### Phase 2：Webview 脚本
4. **`src/renderer/features/browser-sidebar/scripts.ts`**
   - 新增 `__browserQuerySelector(selector)`
   - 新增 `__browserGetElementClipRect(ref)`
   - 增强 `__browserHover` (mouseMove 坐标)
   - 修复 `__browserGetText` 支持 selector

### Phase 3：IPC 桥接
5. **`src/preload/index.ts`**
   - 新增 `onBrowserShowPanel` 监听
6. **`src/renderer/features/browser-sidebar/browser-sidebar.tsx`**
   - 监听 `browser:show-panel` → 设置 visible
   - hover 操作使用 `webview.sendInputEvent`
   - 统一 cursor 动画 helper

### Phase 4：Overlay UX 重构
7. **`src/renderer/features/browser-sidebar/browser-overlay.tsx`**
   - 呼吸光效动画
   - 黑色指针 + 点击按压动画
   - 更精致的状态栏
   - 锁定模式视觉升级

### Phase 5：Skill
8. **`resources/skills/browser/SKILL.md`**
   - 创建 browser 内置技能
   - 操作指南 + 场景处理（密码、CAPTCHA、fetch 失败）
