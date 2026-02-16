# CLAUDE.md

> **维护规则**: 此文档只记录架构和关键约定，用于指导后续开发。变更相关架构后须及时同步。不相干的内容不写入。

## What is this?

**Hong** — Local-first Electron desktop app for AI-powered code assistance. Chat sessions link to local project folders, interact with Claude in Plan or Agent mode, and execute tools in real-time.

Default UI mode is **Cowork Mode** (chat + right panel). Alternative **Agents Mode** adds onboarding, auth, Git/Diff panels.

## Commands

```bash
bun run dev              # Electron with hot reload
bun run build            # Compile (verify before commit)
bun run package:mac      # macOS DMG + ZIP
bun run db:generate      # Generate Drizzle migrations
bun run db:push          # Push schema directly (dev only)
```

## Architecture

### Main Process (`src/main/`)

```
src/main/
├── index.ts                 # App entry, Extension registration, OAuth
├── windows/main.ts          # Window creation, IPC handlers
│
├── feature/                 # Extension modules (pluginized features)
│   ├── lite/                # Auth + WSS + HTTP (heavy, 13 files)
│   ├── memory/              # Memory system Extension
│   ├── browser-mcp/         # Browser MCP Extension
│   ├── image-mcp/           # Image MCP Extension
│   ├── usage-tracking/      # Token usage tracking Extension
│   ├── plugin-system/       # Plugin/marketplace/skills/commands (multi-router)
│   ├── automation/          # Automation Extension (router wrapper)
│   ├── insights/            # Insights Extension (router wrapper)
│   ├── terminal/            # Terminal Extension (router wrapper)
│   ├── runner/              # Runner Extension (router wrapper)
│   ├── lsp/                 # LSP Extension (router wrapper)
│   ├── ollama/              # Ollama Extension (router wrapper)
│   └── voice/               # Voice Extension (router wrapper)
│
└── lib/
    ├── extension/           # Extension framework
    │   ├── types.ts         # ExtensionModule interface
    │   ├── extension-manager.ts  # Lifecycle + router merging
    │   ├── hook-registry.ts # HookRegistry (emit/collect/waterfall)
    │   ├── feature-bus.ts   # FeatureBus (cross-extension events)
    │   └── hooks/chat-lifecycle.ts  # 12 chat hooks
    │
    ├── claude/              # Claude engine modules
    │   ├── engine.ts        # Main stream processing
    │   ├── transform.ts     # Tool call → UI message transform
    │   ├── config-loader.ts # .claude.json parsing + cache
    │   ├── prompt-builder.ts # System prompt composition
    │   ├── sdk-query-builder.ts # SDK options construction
    │   ├── mcp-config.ts    # MCP server config aggregation
    │   ├── mentions.ts      # @mention parsing + artifact tracking
    │   ├── prompt-utils.ts  # Ollama context / image prompt / merge
    │   ├── env.ts           # Environment variable building
    │   └── policies/        # Tool permission rules
    │
    ├── logger.ts            # Unified logger (electron-log wrapper)
    │
    ├── trpc/routers/        # tRPC routers (hardcoded + Extension)
    │   ├── index.ts         # createAppRouter (merges Extension routers)
    │   ├── claude.ts        # Core: SDK streaming + chat subscription
    │   ├── chats-new.ts     # Chat lifecycle CRUD
    │   ├── summary-ai.ts    # Lightweight AI calls (naming, commit msgs)
    │   ├── logger.ts        # Log query + real-time subscription
    │   └── ...              # 20+ domain routers
    │
    ├── db/                  # Drizzle + SQLite
    │   └── schema/index.ts  # All table definitions (source of truth)
    ├── git/                 # Git operations + security layer
    └── mcp/                 # MCP servers (artifact-server only)
```

### Renderer (`src/renderer/`)

```
src/renderer/
├── features/
│   ├── agents/              # Chat interface (active-chat, tool renderers)
│   ├── cowork/              # Cowork layout (file tree, preview, artifacts)
│   ├── panel-system/        # Unified panel registration + rendering
│   ├── sidebar/             # Chat list, navigation
│   ├── terminal/            # Terminal UI
│   ├── changes/             # Git changes panel
│   ├── comments/            # Code review comments
│   ├── settings/            # Settings panels
│   └── ...
├── components/ui/           # Radix UI wrappers
└── lib/
    ├── atoms/               # Global Jotai atoms (modularized)
    ├── stores/              # Zustand stores
    ├── logger.ts            # Renderer logger (lightweight console wrapper)
    └── trpc.ts              # tRPC client
```

### Shared (`src/shared/`)

```
src/shared/
├── log-types.ts             # Cross-process log type definitions
├── changes-types.ts         # Git changes types
├── detect-language.ts       # Language detection
├── external-apps.ts         # External app types
└── feature-config.ts        # Feature config types
```

## Extension System

Features are pluginized via `ExtensionModule` interface. Each Extension can provide:
- **router/routers** — tRPC routers (auto-merged into AppRouter)
- **hooks** — Subscribe to chat lifecycle hooks
- **tools** — Internal tool definitions (discoverable via `internalTools.list`)
- **init/cleanup** — Lifecycle management

```
                    ┌─────────────────┐
                    │ ExtensionManager │
                    │  .register()    │
                    │  .initAll()     │
                    │  .getRouters()  │
                    └────────┬────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    HookRegistry       FeatureBus        Router merging
    (12 chat hooks)   (cross-ext events)  (into AppRouter)
```

**14 Extensions registered** in `src/main/index.ts`. Each Extension 的业务代码、router 均内聚在 `feature/<name>/` 下。

**Chat Hooks** (`ChatHook` enum — `src/main/lib/extension/hooks/chat-lifecycle.ts`):

| Enum Key | Mode | 触发点 |
|----------|------|--------|
| SessionStart | emit | 会话创建 |
| UserPrompt | emit | 用户输入 |
| ToolOutput | emit | 工具完成 |
| FileChanged | emit | 文件变更 |
| GitCommit | emit | Git 提交 |
| AssistantMessage | emit | AI 回复 |
| SessionEnd | emit | 会话结束 |
| Cleanup | emit | 订阅取消 |
| StreamComplete | emit | 流成功 |
| StreamError | emit | 流出错 |
| CollectMcpServers | collect | MCP 服务器收集 |
| EnhancePrompt | waterfall | Prompt 增强管道 |

## Key Patterns

**State**: Jotai (UI atoms) + Zustand (complex stores) + React Query (server state via tRPC)

**Claude SDK**: `@anthropic-ai/claude-agent-sdk` streaming via tRPC subscription. Two modes: plan/agent. Session resume via `sessionId`. Multi-account OAuth.

**Chat Hooks**: `claude.ts` 通过 `ChatHook` enum 发射生命周期 hooks → Extensions 订阅响应。10 emit + 1 collect + 1 waterfall。新增 hook 必须在 `ChatHook` enum 中定义。

**MCP Config**: Aggregated from global + project + agent + plugin + builtin sources. Cache in `workingMcpServers` Map. Warmup on app start.

**Auth**: Anthropic OAuth (PKCE) / Okta SAML / API Key. Tokens encrypted via `safeStorage`. Deep links: `hong://` (prod) / `hong-dev://` (dev).

**Git Security**: Path validation + command sanitization + secure FS. `simple-git` with lock mechanism.

**Logging**: Unified logger based on `electron-log`. Main process: `src/main/lib/logger.ts` — file transport (5MB rotation, gzip archive for 90d), Sentry transport (error → captureMessage, warn → breadcrumb), ring buffer transport (2000 entries for UI panel). Renderer: `src/renderer/lib/logger.ts` — lightweight console wrapper with formatted output. Usage: `import { createLogger } from '../lib/logger'; const log = createLogger('ModuleName')`. Raw Claude SDK logs remain separate in `src/main/lib/claude/raw-logger.ts`. Lint rule `no-console: warn` enforced via oxlint.

## TypeScript 规范

- **禁止 `any`** — 使用具体类型或 `unknown` + 类型守卫。已有 `any` 不扩散，改动时顺手收窄。
- **完整的类型推导链** — 函数参数、返回值、泛型约束必须可追溯，避免断链（如中间变量丢失类型导致下游退化为 `any`）。
- **enum 替代字符串字面量** — 多处共享的 key/标识符用 enum 定义为 Single Source of Truth（参考 `ChatHook` enum）。仅单文件内使用的常量可用 `as const` 对象。
- **`type` vs `interface`** — 需要 `declare module` 合并扩展的用 `interface`（如 `HookMap`、`FeatureBusEvents`），其余优先 `type`。

## Database

**Location:** `{userData}/data/agents.db` (SQLite via Drizzle ORM)

**Schema:** `src/main/lib/db/schema/index.ts` — source of truth for all tables.

Auto-migration on app start via `initDatabase()`.

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron, electron-vite, electron-builder |
| UI | React 19, TypeScript, Tailwind CSS |
| Components | Radix UI, Lucide icons, Motion |
| State | Jotai, Zustand, React Query |
| Backend | tRPC, Drizzle ORM, better-sqlite3 |
| Editor | Monaco Editor with LSP |
| Terminal | xterm.js |
| AI | @anthropic-ai/claude-code, @anthropic-ai/claude-agent-sdk |
| Package | bun |

## File Naming

- Components: `PascalCase.tsx`
- Utilities/hooks: `camelCase.ts`
- Stores: `kebab-case.ts`
- Atoms: `camelCaseAtom` suffix

## Deprecated

- `claude_code_credentials` table → use `anthropicAccounts`

## Release

```bash
npm version patch --no-git-tag-version
bun run release          # Build, sign, notarize, upload
```

Auto-update checks `https://cowork.hongshan.com/releases/desktop/latest-mac.yml` on startup.

See `RELEASE.md` for full notarization + stapling + CDN workflow.

## Debugging

```bash
rm -rf ~/Library/Application\ Support/Agents\ Dev/   # Clear all app data
defaults delete dev.hong.agents.dev                    # Clear preferences (dev)
bun run dev                                            # Fresh start
```

Dev mode uses separate userData path and `hong-dev://` protocol.

**Log files:** `~/Library/Logs/Hong/main.log` (current) + date-archived `.log` files + `archive/*.log.gz` (monthly compressed, 90d retention). View in Settings → Debug → Log Viewer. Migration script: `bun scripts/migrate-console-to-logger.ts`.
