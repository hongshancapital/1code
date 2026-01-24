# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is this?

**Hong** (previously 1Code) - A local-first Electron desktop app for AI-powered code assistance. Users create chat sessions linked to local project folders, interact with Claude in Plan or Agent mode, and see real-time tool execution (bash, file edits, web search, etc.).

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
│   ├── index.ts             # App entry, window lifecycle
│   ├── auth-manager.ts      # OAuth flow, token refresh
│   ├── auth-store.ts        # Encrypted credential storage (safeStorage)
│   ├── windows/main.ts      # Window creation, IPC handlers
│   └── lib/
│       ├── db/              # Drizzle + SQLite
│       │   ├── index.ts     # DB init, auto-migrate on startup
│       │   ├── schema/      # Drizzle table definitions
│       │   └── utils.ts     # ID generation
│       ├── git/             # Git operations (status, diff, staging, worktree, stash)
│       ├── lsp/             # Language Server Protocol integration
│       │   ├── manager.ts   # LSP session management (tsserver, tsgo)
│       │   └── types.ts     # LSP type definitions
│       └── trpc/routers/    # tRPC routers
│
├── preload/                 # IPC bridge (context isolation)
│   └── index.ts             # Exposes desktopApi + tRPC bridge
│
└── renderer/                # React 19 UI
    ├── App.tsx              # Root with providers, mode switch (Cowork/Agents)
    ├── features/
    │   ├── agents/          # Main chat interface (shared by both modes)
    │   │   ├── main/        # active-chat.tsx, new-chat-form.tsx
    │   │   ├── ui/          # Tool renderers, sub-chat components
    │   │   ├── commands/    # Slash commands (/plan, /agent, /clear)
    │   │   ├── atoms/       # Jotai atoms for agent state
    │   │   └── stores/      # Zustand store for sub-chats
    │   ├── cowork/          # Cowork mode layout and components
    │   │   ├── cowork-layout.tsx      # Main layout (sidebar + chat + right panel)
    │   │   ├── file-tree-panel.tsx    # Project file browser with lazy loading
    │   │   ├── file-preview/          # Multi-format preview with Monaco editor
    │   │   │   ├── code-editor.tsx    # Monaco editor with LSP integration
    │   │   │   └── text-preview.tsx   # Read-only text preview
    │   │   ├── atoms.ts               # Cowork state (artifacts, editor mode, content search)
    │   │   └── use-artifacts-listener.ts  # IPC listener for file changes
    │   ├── comments/        # Code review comment system
    │   │   ├── atoms.ts     # Comment state with localStorage persistence
    │   │   ├── types.ts     # ReviewComment, CommentThread, LineRange types
    │   │   └── components/  # Gutter layer, indicators, input
    │   ├── runner/          # Script runner integration
    │   │   ├── run-config-selector.tsx # Package.json script selector
    │   │   └── use-run-session-listener.ts # Terminal session management
    │   ├── terminal/        # Integrated terminal
    │   ├── changes/         # Git changes panel (staging, commit, history)
    │   ├── sidebar/         # Chat list, archive, navigation
    │   └── layout/          # Agents mode layout with resizable panels
    ├── components/ui/       # Radix UI wrappers (button, dialog, etc.)
    └── lib/
        ├── atoms/           # Global Jotai atoms
        │   ├── index.ts     # Core atoms (selectedProject, selectedChat)
        │   └── runner.ts    # Script runner state atoms
        ├── lsp/             # LSP client hook
        │   └── use-lsp-client.ts  # Monaco LSP integration
        ├── stores/          # Global Zustand stores
        └── trpc.ts          # tRPC client
```

## Database (Drizzle ORM)

**Location:** `{userData}/data/agents.db` (SQLite)

**Schema:** `src/main/lib/db/schema/index.ts`

```typescript
// Main tables:
projects           → id, name, path, mode, git remote info, timestamps
chats              → id, name, projectId, worktree/branch fields, PR tracking
sub_chats          → id, name, chatId, sessionId, streamId, mode, messages (JSON)
claude_code_credentials → OAuth token storage (encrypted)
model_usage        → Token usage tracking per API call
```

**Auto-migration:** On app start, `initDatabase()` runs migrations from `drizzle/` folder (dev) or `resources/migrations` (packaged).

## tRPC Routers

All backend calls go through tRPC routers (`src/main/lib/trpc/routers/`):

| Router | Purpose |
|--------|---------|
| `projects` | CRUD for local project folders |
| `chats` | Chat/sub-chat management |
| `claude` | Claude SDK integration (streaming, session resume) |
| `files` | File operations (read, write, search, listDirectory) |
| `changes` | Git operations (status, diff, stage, commit) |
| `lsp` | Language Server Protocol (completions, hover, diagnostics) |
| `runner` | Runtime detection, script execution |
| `terminal` | PTY terminal management |

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
- Stored per subChatId in localStorage

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron 33.4.5, electron-vite, electron-builder |
| UI | React 19, TypeScript 5.4.5, Tailwind CSS |
| Components | Radix UI, Lucide icons, Motion, Sonner |
| State | Jotai, Zustand, React Query |
| Backend | tRPC, Drizzle ORM, better-sqlite3 |
| Editor | Monaco Editor with LSP |
| AI | @anthropic-ai/claude-code |
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
- `src/renderer/features/agents/main/active-chat.tsx` - Main chat component
- `src/renderer/features/cowork/atoms.ts` - Cowork state (artifacts, editor, search)
- `src/renderer/features/comments/atoms.ts` - Code review comment state
- `src/renderer/lib/lsp/use-lsp-client.ts` - Monaco LSP integration
- `src/main/lib/trpc/routers/index.ts` - All tRPC routers

## Debugging First Install Issues

```bash
# 1. Clear all app data (auth, database, settings)
rm -rf ~/Library/Application\ Support/Agents\ Dev/

# 2. Reset macOS protocol handler registration (if testing deep links)
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -kill -r -domain local -domain system -domain user

# 3. Clear app preferences
defaults delete dev.21st.agents.dev  # Dev mode
defaults delete dev.21st.agents      # Production

# 4. Run in dev mode with clean state
bun run dev
```

**Dev vs Production App:**
- Dev mode uses `twentyfirst-agents-dev://` protocol
- Dev mode uses separate userData path (`~/Library/Application Support/Agents Dev/`)

## Releasing a New Version

### Prerequisites for Notarization
- Keychain profile: `21st-notarize`
- Create with: `xcrun notarytool store-credentials "21st-notarize" --apple-id YOUR_APPLE_ID --team-id YOUR_TEAM_ID`

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

1. Wait for notarization (2-5 min): `xcrun notarytool history --keychain-profile "21st-notarize"`
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
- tRPC routers (17 routers covering all features)
- Cowork mode with simplified UI (default)
- File tree panel with lazy loading
- Artifacts tracking with context
- Multi-format file preview (text, image, PDF, video, audio, Office)
- Task progress panel
- Monaco code editor with LSP integration (TS/JS)
- Code review comment system (Diff View + File Preview)
- Script runner integration with runtime detection
- Git operations (status, diff, staging, stash)
- Model usage tracking

**In Progress:**
- GitHub PR integration for comments
- tsgo experimental backend support

**Planned:**
- Git worktree per chat (isolation)
- Full feature parity with web app
