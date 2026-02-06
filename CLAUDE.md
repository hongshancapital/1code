# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

**Hong** - A local-first Electron desktop app for AI-powered code assistance. Users create chat sessions linked to local project folders, interact with Claude in Plan or Agent mode, and see real-time tool execution (bash, file edits, web search, etc.).

The app has two UI modes:
- **Agents Mode**: Full-featured mode with onboarding, authentication, Git/Diff panels
- **Cowork Mode** (default): Simplified layout focused on chat + right panel (tasks, artifacts, file tree)

## Commands

```bash
# Development
bun run dev              # Start Electron with hot reload

# Build
bun run build            # Compile app
bun run package          # Package for current platform (dir)
bun run package:mac      # Build macOS (DMG + ZIP)
bun run package:win      # Build Windows (NSIS + portable)
bun run package:linux    # Build Linux (AppImage + DEB)

# Database (Drizzle + SQLite)
bun run db:generate      # Generate migrations from schema
bun run db:push          # Push schema directly (dev only)
```

## Architecture

```
src/
├── main/                    # Electron main process
│   ├── index.ts             # App entry, protocol handlers, OAuth flows
│   ├── auth-manager.ts      # OAuth flow, token refresh
│   ├── auth-store.ts        # Encrypted credential storage (safeStorage)
│   ├── windows/main.ts      # Window creation, IPC handlers
│   └── lib/
│       ├── db/              # Drizzle + SQLite
│       │   ├── index.ts     # DB init, auto-migrate on startup
│       │   ├── schema/      # Drizzle table definitions (12 tables)
│       │   └── utils.ts     # ID generation
│       ├── git/             # Git operations
│       │   ├── index.ts     # createGitRouter() factory
│       │   ├── git-factory.ts  # simple-git instance with lock
│       │   ├── watcher/     # File change watcher (chokidar)
│       │   ├── github/      # GitHub PR integration
│       │   └── security/    # Path validation, command sanitization
│       ├── lsp/             # Language Server Protocol
│       │   ├── manager.ts   # LSP session management (tsserver, tsgo)
│       │   └── types.ts     # LSP type definitions
│       ├── automation/      # Cron-based automations
│       │   └── engine.ts    # Singleton scheduler + executor
│       ├── mcp/             # MCP servers
│       │   └── artifact-server.ts  # Artifact tracking MCP
│       ├── plugins/         # Plugin discovery
│       │   └── index.ts     # ~/.claude/plugins/ scanner
│       └── trpc/routers/    # tRPC routers (27 total)
│
├── preload/                 # IPC bridge (context isolation)
│   └── index.ts             # Exposes desktopApi + tRPC bridge
│
└── renderer/                # React 19 UI
    ├── App.tsx              # Root with providers, onboarding flow
    ├── features/
    │   ├── agents/          # Main chat interface
    │   │   ├── main/        # active-chat.tsx, new-chat-form.tsx
    │   │   ├── ui/          # Tool renderers, sub-chat components
    │   │   ├── commands/    # Slash commands (/plan, /agent, /clear)
    │   │   ├── atoms.ts     # Core agent state atoms
    │   │   └── stores/      # Zustand store for sub-chats
    │   ├── cowork/          # Cowork mode layout
    │   │   ├── cowork-layout.tsx   # Main layout (sidebar + chat + right panel)
    │   │   ├── file-tree-panel.tsx # Project file browser with lazy loading
    │   │   ├── file-preview/       # Multi-format preview with Monaco
    │   │   └── atoms.ts            # Cowork state
    │   ├── automations/     # Automation UI
    │   │   └── _components/ # Automation cards, templates
    │   ├── comments/        # Code review comments
    │   ├── runner/          # Script runner integration
    │   ├── terminal/        # Integrated PTY terminal
    │   ├── changes/         # Git changes panel
    │   ├── sidebar/         # Chat list, archive, navigation
    │   ├── layout/          # Layout components (agents/cowork modes)
    │   ├── onboarding/      # Onboarding pages
    │   └── settings/        # Settings panels
    ├── components/ui/       # Radix UI wrappers
    └── lib/
        ├── atoms/           # Global Jotai atoms
        ├── lsp/             # LSP client hook
        ├── stores/          # Global Zustand stores
        └── trpc.ts          # tRPC client
```

## Database (Drizzle ORM)

**Location:** `{userData}/data/agents.db` (SQLite)

**Schema:** `src/main/lib/db/schema/index.ts`

```typescript
// Core tables:
projects              → id, name, path, mode, featureConfig, iconPath, isPlayground, git info
chats                 → id, name, projectId, worktreePath, branch, baseBranch, prUrl, prNumber, tagId
sub_chats             → id, name, chatId, sessionId, streamId, mode, messages (JSON)
model_usage           → Token usage tracking per API call

// Multi-account support:
anthropicAccounts     → id, email, displayName, oauthToken (encrypted), lastUsedAt
anthropicSettings     → singleton row, activeAccountId

// Automations:
automations           → id, name, triggers (JSON cron), agentPrompt, actions, modelId
automationExecutions  → id, automationId, status, triggeredBy, result, token usage

// Workspace tags (macOS-style):
workspaceTags         → id, name, color (#hex), icon (Lucide name), sortOrder
chatTags              → M:N relation (chatId, tagId)
subChatTags           → M:N relation (subChatId, tagId)

// Legacy (deprecated):
claude_code_credentials → Use anthropicAccounts instead
```

**Auto-migration:** On app start, `initDatabase()` runs migrations from `drizzle/` folder (dev) or `resources/migrations` (packaged).

## tRPC Routers

All backend calls go through tRPC routers (`src/main/lib/trpc/routers/`):

| Router | Purpose |
|--------|---------|
| `projects` | CRUD for local project folders |
| `chats` | Chat/sub-chat management |
| `claude` | Claude SDK integration (streaming, session resume) |
| `claudeCode` | Claude Code SDK binary integration |
| `claudeSettings` | Claude model/agent configuration |
| `anthropicAccounts` | Multi-account OAuth management |
| `files` | File operations (read, write, search, listDirectory) |
| `changes` | Git operations via `createGitRouter()` |
| `lsp` | Language Server Protocol (completions, hover, diagnostics) |
| `runner` | Runtime detection, script execution |
| `terminal` | PTY terminal management |
| `ollama` | Local Ollama model support |
| `litellm` | LiteLLM proxy for multiple LLM providers |
| `voice` | Voice input processing |
| `automations` | Cron-triggered AI workflows |
| `tags` | Workspace tags CRUD and associations |
| `skills` | Claude SDK skill discovery and sync |
| `plugins` | Plugin discovery and MCP server configuration |
| `agents` | Agent model configuration |
| `editor` | Monaco editor integration |
| `worktreeConfig` | Git worktree isolation settings |
| `sandboxImport` | Sandbox project import |
| `commands` | Custom command system |
| `usage` | Token usage queries |
| `external` | External service integrations |
| `debug` | Debug info (dev only) |

## Key Patterns

### State Management
- **Jotai**: UI state (selected chat, sidebar open, preview settings)
  - `atomFamily` for per-entity state (artifacts per subChatId, comments per chatId)
  - `atomWithStorage` for localStorage persistence
- **Zustand**: Sub-chat tabs and pinned state
- **React Query**: Server state via tRPC (auto-caching, refetch)

### Claude Integration
- Dynamic import of `@anthropic-ai/claude-code` SDK
- Two modes: "plan" (read-only) and "agent" (full permissions)
- Session resume via `sessionId` stored in SubChat
- Message streaming via tRPC subscription (`claude.onMessage`)
- Multi-account support via `anthropicAccounts` table (quick account switching)

### Automations Engine
- Located in `src/main/lib/automation/engine.ts` (singleton pattern)
- Cron-based triggers using `node-cron`
- AI processing with configurable model and prompt
- Actions: currently supports "inbox" (creates message in Inbox Chat)
- Execution tracking with token usage statistics
- Startup check for missed cron tasks

### MCP & Plugin System
- Plugin discovery from `~/.claude/plugins/marketplaces/`
- MCP server configuration merges: built-in + plugins + Claude API defaults
- Artifact MCP Server (`src/main/lib/mcp/artifact-server.ts`) tracks file/URL contexts
- 30-second cache for plugin metadata to reduce FS access

### LSP Integration
- **Manager** (`src/main/lib/lsp/manager.ts`): Manages tsserver/tsgo processes
- **Client Hook** (`src/renderer/lib/lsp/use-lsp-client.ts`): Connects Monaco to LSP
- Features: Completions, hover, diagnostics, go-to-definition, find references
- Supports TypeScript/JavaScript with tsserver (tsgo experimental)

### Code Review Comments
- Comments stored per chatId in localStorage via `atomFamily`
- Types: `ReviewComment`, `LineRange` (supports single/multi-line, diff sides)
- Sources: "diff-view" | "file-preview" | "github-pr" (future)
- Persisted until submitted to AI

### File Preview with Monaco Editor
- Two modes: "view" (read-only) and "edit" (Monaco with LSP)
- Cmd+S to save, dirty state tracking
- Worker setup for syntax highlighting in Electron environment
- Language detection from file extension (50+ languages)

### Artifacts Tracking
- `useArtifactsListener` hook listens for `file-changed` IPC events
- Each artifact tracks contexts: files read (Read/Glob/Grep) and URLs visited
- Stored per subChatId via Artifact MCP Server (`{userData}/artifacts/{subChatId}.json`)

### Authentication Flow
- Multiple auth methods: Anthropic OAuth (default), Okta SAML (enterprise), API Key
- PKCE protection with state parameter for CSRF prevention
- Tokens encrypted with Electron `safeStorage` and stored in SQLite
- Deep links: `hong://` (production), `hong-dev://` (development)
- Okta uses dedicated callback server for SAML flow

### Git Security Layer
- Path validation (`src/main/lib/git/security/path-validation.ts`) prevents directory traversal
- Command validation (`git-commands.ts`) sanitizes inputs
- Secure FS operations (`secure-fs.ts`) for file operations
- Git factory (`git-factory.ts`) creates `simple-git` instances with lock mechanism

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron 33.4.5, electron-vite, electron-builder |
| UI | React 19, TypeScript 5.4.5, Tailwind CSS |
| Components | Radix UI, Lucide icons, Motion, Sonner |
| State | Jotai, Zustand, React Query |
| Backend | tRPC + superjson, Drizzle ORM, better-sqlite3 |
| Editor | Monaco Editor 0.55.1 with LSP |
| Terminal | xterm.js with addons (canvas, fit, search) |
| AI | @anthropic-ai/claude-code, @anthropic-ai/claude-agent-sdk |
| Scheduling | node-cron (for automations) |
| i18n | i18next |
| Package Manager | bun |

## File Naming

- Components: PascalCase (`ActiveChat.tsx`, `AgentsSidebar.tsx`)
- Utilities/hooks: camelCase (`useFileUpload.ts`, `formatters.ts`)
- Stores: kebab-case (`sub-chat-store.ts`, `agent-chat-store.ts`)
- Atoms: camelCase with `Atom` suffix (`selectedAgentChatIdAtom`)

## Important Files

- `electron.vite.config.ts` - Build config (main/preload/renderer entries)
- `src/main/lib/db/schema/index.ts` - Drizzle schema (source of truth)
- `src/main/lib/lsp/manager.ts` - LSP session management
- `src/main/lib/automation/engine.ts` - Automation execution engine
- `src/main/lib/plugins/index.ts` - Plugin discovery and MCP configuration
- `src/renderer/features/agents/main/active-chat.tsx` - Main chat component
- `src/renderer/features/agents/atoms.ts` - Core agent state atoms
- `src/renderer/features/cowork/atoms.ts` - Cowork state (artifacts, editor, search)
- `src/renderer/features/comments/atoms.ts` - Code review comment state
- `src/renderer/lib/lsp/use-lsp-client.ts` - Monaco LSP integration
- `src/main/lib/trpc/routers/index.ts` - All tRPC routers (27 routers)

## Debugging First Install Issues

```bash
# 1. Clear all app data (auth, database, settings)
rm -rf ~/Library/Application\ Support/Agents\ Dev/

# 2. Reset macOS protocol handler registration (if testing deep links)
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -kill -r -domain local -domain system -domain user

# 3. Clear app preferences
defaults delete dev.hong.agents.dev  # Dev mode
defaults delete dev.hong.agents      # Production

# 4. Run in dev mode with clean state
bun run dev
```

**Dev vs Production App:**
- Dev mode uses `twentyfirst-agents-dev://` protocol
- Dev mode uses separate userData path (`~/Library/Application Support/Agents Dev/`)

## Releasing a New Version

### Prerequisites for Notarization
- Keychain profile: `hong-notarize`
- Create with: `xcrun notarytool store-credentials "hong-notarize" --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID`

### Release Commands

```bash
# Bump version first
npm version patch --no-git-tag-version  # 0.0.27 → 0.0.28

# Full release (build, sign, submit notarization, upload to CDN)
bun run release

# Or step by step:
bun run build              # Compile TypeScript
bun run package:mac        # Build & sign macOS app
bun run dist:manifest      # Generate latest-mac.yml manifests
./scripts/upload-release-wrangler.sh  # Submit notarization & upload to R2 CDN
```

### After Release Script Completes

1. Wait for notarization (2-5 min): `xcrun notarytool history --keychain-profile "hong-notarize"`
2. Staple DMGs: `cd release && xcrun stapler staple *.dmg`
3. Re-upload stapled DMGs to R2 and GitHub (see RELEASE.md)
4. Update changelog: `gh release edit v0.0.X --notes "..."`
5. Upload manifests (triggers auto-updates!)
6. Sync to public: `./scripts/sync-to-public.sh`

### Auto-Update Flow

1. App checks `https://cowork.hongshan.com/releases/desktop/latest-mac.yml` on startup and focus
2. If version in manifest > current version, shows "Update Available" banner
3. User clicks Download → downloads ZIP in background
4. User clicks "Restart Now" → installs update and restarts

## Current Status

**Done:**
- Drizzle ORM with auto-migration
- tRPC routers (27 routers covering all features)
- Cowork mode with simplified UI (default)
- File tree panel with lazy loading
- Artifacts tracking with context (via Artifact MCP Server)
- Multi-format file preview (text, image, PDF, video, audio, Office)
- Task progress panel
- Monaco code editor with LSP integration (TS/JS)
- Code review comment system (Diff View + File Preview)
- Script runner integration with runtime detection
- Git operations (status, diff, staging, stash, worktree)
- Model usage tracking
- Multi-account Anthropic OAuth support
- Workspace tags (macOS Finder-style colored tags)
- Automations framework (cron triggers + AI processing + Inbox executor)
- Plugin and MCP server system
- LiteLLM and Ollama integration for local/alternative models
- Voice input support
- i18n support (Chinese/English)

**In Progress:**
- GitHub PR integration for comments
- tsgo experimental backend support

**Planned:**
- Full feature parity with web app
