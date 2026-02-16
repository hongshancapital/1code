import { router } from "../index"
import { projectsRouter } from "./projects"
import { chatsRouter } from "./chats-new"
import { subChatsRouter } from "./sub-chats"
import { chatStatsRouter } from "./chat-stats"
import { chatGitRouter } from "./chat-git"
import { migrationRouter } from "./migration"
import { chatExportRouter } from "./chat-export"
import { claudeRouter } from "./claude"
import { claudeCodeRouter } from "./claude-code"
import { claudeSettingsRouter } from "./claude-settings"
import { anthropicAccountsRouter } from "./anthropic-accounts"
import { litellmRouter } from "./litellm"
import { providersRouter } from "./providers"
import { externalRouter } from "./external"
import { filesRouter } from "./files"
import { debugRouter } from "./debug"
import { agentsRouter } from "./agents"
import { worktreeConfigRouter } from "./worktree-config"
import { sandboxImportRouter } from "./sandbox-import"
import { usageRouter } from "./usage"
import { editorRouter } from "./editor"
import { createGitRouter } from "../../git"
import { tagsRouter } from "./tags"
import { internalToolsRouter } from "./internal-tools"
import { loggerRouter } from "./logger"
import type { BrowserWindow } from "electron"
import { getExtensionManager } from "../../extension"

/**
 * Create the main app router
 * Uses getter pattern to avoid stale window references
 */
export function createAppRouter(_getWindow: () => BrowserWindow | null) {
  // 合并 Extension 提供的 tRPC routers
  const extensionRouters = getExtensionManager().getRouters()

  return router({
    projects: projectsRouter,
    chats: chatsRouter,
    subChats: subChatsRouter,
    chatStats: chatStatsRouter,
    chatGit: chatGitRouter,
    chatExport: chatExportRouter,
    claude: claudeRouter,
    claudeCode: claudeCodeRouter,
    claudeSettings: claudeSettingsRouter,
    anthropicAccounts: anthropicAccountsRouter,
    litellm: litellmRouter,
    // Unified model provider management (replaces litellm for new code)
    providers: providersRouter,
    external: externalRouter,
    files: filesRouter,
    debug: debugRouter,
    agents: agentsRouter,
    worktreeConfig: worktreeConfigRouter,
    sandboxImport: sandboxImportRouter,
    usage: usageRouter,
    editor: editorRouter,
    // Git operations - named "changes" to match Superset API
    changes: createGitRouter(),
    // Workspace tags (macOS-style grouping)
    tags: tagsRouter,
    // Internal tools discovery
    internalTools: internalToolsRouter,
    // Unified logger (query + real-time subscription)
    logger: loggerRouter,
    // Message data migration
    migration: migrationRouter,
    // Extension routers (dynamically merged)
    ...extensionRouters,
  })
}

/**
 * Export the router type for client usage
 */
export type AppRouter = ReturnType<typeof createAppRouter>
