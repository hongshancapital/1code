# CLAUDE.md

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
    ├── trpc/routers/        # tRPC routers (hardcoded + Extension)
    │   ├── index.ts         # createAppRouter (merges Extension routers)
    │   ├── claude.ts        # Core: SDK streaming + chat subscription
    │   ├── chats-new.ts     # Chat lifecycle CRUD
    │   ├── summary-ai.ts    # Lightweight AI calls (naming, commit msgs)
    │   └── ...              # 20+ domain routers
    │
    ├── db/                  # Drizzle + SQLite
    │   └── schema/index.ts  # All table definitions (source of truth)
    ├── git/                 # Git operations + security layer
    ├── mcp/                 # MCP servers (artifact, image)
    ├── plugins/             # Plugin discovery (~/.claude/plugins/)
    ├── memory/              # Vector search + embeddings
    ├── browser/             # Headless browser automation
    ├── terminal/            # PTY management
    ├── runtime/             # Script runtime detection
    └── lsp/                 # LSP manager (tsserver/tsgo)
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
    └── trpc.ts              # tRPC client
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

**13 Extensions registered** in `src/main/index.ts`. Router wrappers (terminal, runner, lsp, etc.) provide uniform init/cleanup while keeping implementation in `lib/`.

## Key Patterns

**State**: Jotai (UI atoms) + Zustand (complex stores) + React Query (server state via tRPC)

**Claude SDK**: `@anthropic-ai/claude-agent-sdk` streaming via tRPC subscription. Two modes: plan/agent. Session resume via `sessionId`. Multi-account OAuth.

**Chat Hooks**: `claude.ts` emits lifecycle hooks → Extensions react. 10 emit + 1 collect (`collectMcpServers`) + 1 waterfall (`enhancePrompt`).

**MCP Config**: Aggregated from global + project + agent + plugin + builtin sources. Cache in `workingMcpServers` Map. Warmup on app start.

**Auth**: Anthropic OAuth (PKCE) / Okta SAML / API Key. Tokens encrypted via `safeStorage`. Deep links: `hong://` (prod) / `hong-dev://` (dev).

**Git Security**: Path validation + command sanitization + secure FS. `simple-git` with lock mechanism.

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
