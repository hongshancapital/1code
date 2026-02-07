import { router } from "../index"
import { projectsRouter } from "./projects"
import { chatsRouter } from "./chats"
import { claudeRouter } from "./claude"
import { claudeCodeRouter } from "./claude-code"
import { claudeSettingsRouter } from "./claude-settings"
import { anthropicAccountsRouter } from "./anthropic-accounts"
import { ollamaRouter } from "./ollama"
import { litellmRouter } from "./litellm"
import { terminalRouter } from "./terminal"
import { externalRouter } from "./external"
import { filesRouter } from "./files"
import { debugRouter } from "./debug"
import { skillsRouter } from "./skills"
import { agentsRouter } from "./agents"
import { worktreeConfigRouter } from "./worktree-config"
import { sandboxImportRouter } from "./sandbox-import"
import { commandsRouter } from "./commands"
import { voiceRouter } from "./voice"
import { usageRouter } from "./usage"
import { runnerRouter } from "./runner"
import { lspRouter } from "./lsp"
import { editorRouter } from "./editor"
import { pluginsRouter } from "./plugins"
import { marketplaceRouter } from "./marketplace"
import { createGitRouter } from "../../git"
import { automationsRouter } from "./automations"
import { tagsRouter } from "./tags"
import { insightsRouter } from "./insights"
import { memoryRouter } from "./memory"
import { browserRouter } from "./browser"
import { BrowserWindow } from "electron"

/**
 * Create the main app router
 * Uses getter pattern to avoid stale window references
 */
export function createAppRouter(_getWindow: () => BrowserWindow | null) {
  return router({
    projects: projectsRouter,
    chats: chatsRouter,
    claude: claudeRouter,
    claudeCode: claudeCodeRouter,
    claudeSettings: claudeSettingsRouter,
    anthropicAccounts: anthropicAccountsRouter,
    ollama: ollamaRouter,
    litellm: litellmRouter,
    terminal: terminalRouter,
    external: externalRouter,
    files: filesRouter,
    debug: debugRouter,
    skills: skillsRouter,
    agents: agentsRouter,
    worktreeConfig: worktreeConfigRouter,
    sandboxImport: sandboxImportRouter,
    commands: commandsRouter,
    voice: voiceRouter,
    usage: usageRouter,
    runner: runnerRouter,
    lsp: lspRouter,
    editor: editorRouter,
    plugins: pluginsRouter,
    // Plugin marketplace management
    marketplace: marketplaceRouter,
    // Git operations - named "changes" to match Superset API
    changes: createGitRouter(),
    // Automations (cron triggers, AI processing, inbox executor)
    automations: automationsRouter,
    // Workspace tags (macOS-style grouping)
    tags: tagsRouter,
    // Insights (usage reports with AI analysis)
    insights: insightsRouter,
    // Memory (session tracking, observations, search)
    memory: memoryRouter,
    // Browser automation for AI agents
    browser: browserRouter,
  })
}

/**
 * Export the router type for client usage
 */
export type AppRouter = ReturnType<typeof createAppRouter>
