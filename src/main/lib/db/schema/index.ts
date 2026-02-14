import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { relations } from "drizzle-orm"
import { createId } from "../utils"

// ============ PROJECTS ============
export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  // Git remote info (extracted from local .git)
  gitRemoteUrl: text("git_remote_url"),
  gitProvider: text("git_provider"), // "github" | "gitlab" | "bitbucket" | null
  gitOwner: text("git_owner"),
  gitRepo: text("git_repo"),
  // Project mode: "chat" (playground) | "cowork" (simplified, no git) | "coding" (full features with git)
  mode: text("mode").notNull().default("cowork"),
  // Feature configuration: JSON object for widget/tool overrides
  // { widgets?: { [widgetId]: boolean }, tools?: { [toolId]: boolean } }
  featureConfig: text("feature_config"),
  // Custom project icon (absolute path to local image file)
  iconPath: text("icon_path"),
  // Whether this is the special playground project for chat mode
  // Playground chats run in {User}/.hong/.playground and don't appear in workspaces
  isPlayground: integer("is_playground", { mode: "boolean" }).default(false),
})

export const projectsRelations = relations(projects, ({ many }) => ({
  chats: many(chats),
}))

// ============ CHATS ============
export const chats = sqliteTable("chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  // User manually renamed this chat - disable auto-rename if true
  manuallyRenamed: integer("manually_renamed", { mode: "boolean" }).default(false),
  // Worktree fields (for git isolation per chat)
  worktreePath: text("worktree_path"),
  branch: text("branch"),
  baseBranch: text("base_branch"),
  // PR tracking fields
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
  // Tag for grouping (preset tag ID like "red", "blue", etc.)
  tagId: text("tag_id"),
}, (table) => [
  index("chats_worktree_path_idx").on(table.worktreePath),
])

export const chatsRelations = relations(chats, ({ one, many }) => ({
  project: one(projects, {
    fields: [chats.projectId],
    references: [projects.id],
  }),
  subChats: many(subChats),
}))

// ============ SUB-CHATS ============
export const subChats = sqliteTable("sub_chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  sessionId: text("session_id"), // Claude SDK session ID for resume
  streamId: text("stream_id"), // Track in-progress streams
  mode: text("mode").notNull().default("agent"), // "plan" | "agent"
  messages: text("messages").notNull().default("[]"), // JSON array
  // Pre-computed stats for preview (avoids parsing large messages JSON)
  // Format: { inputs: Array<{ messageId, index, content, mode, fileCount, additions, deletions, totalTokens }> }
  statsJson: text("stats_json"),
  // Pre-computed flag for pending plan approval (avoids parsing messages)
  // True when mode="plan" AND messages contain completed ExitPlanMode tool
  hasPendingPlan: integer("has_pending_plan", { mode: "boolean" }).default(false),
  // User manually renamed this sub-chat - disable auto-rename if true
  manuallyRenamed: integer("manually_renamed", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
})

export const subChatsRelations = relations(subChats, ({ one }) => ({
  chat: one(chats, {
    fields: [subChats.chatId],
    references: [chats.id],
  }),
}))

// ============ CLAUDE CODE CREDENTIALS ============
// Stores encrypted OAuth token for Claude Code integration
// DEPRECATED: Use anthropicAccounts for multi-account support
export const claudeCodeCredentials = sqliteTable("claude_code_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  userId: text("user_id"), // Desktop auth user ID (for reference)
})

// ============ MODEL USAGE ============
// Records token usage for each Claude API call
export const modelUsage = sqliteTable("model_usage", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  // Relationships
  subChatId: text("sub_chat_id")
    .notNull()
    .references(() => subChats.id, { onDelete: "cascade" }),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  // Model info
  model: text("model").notNull(),
  // Token usage
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  totalTokens: integer("total_tokens").notNull().default(0),
  // Cost in USD (stored as text for decimal precision)
  costUsd: text("cost_usd"),
  // Session info (for deduplication)
  sessionId: text("session_id"),
  messageUuid: text("message_uuid"), // SDK message UUID for deduplication
  // Request metadata
  mode: text("mode"), // "plan" | "agent"
  source: text("source"), // "chat" (default) | "memory" | "automation" — distinguishes LLM call origin
  durationMs: integer("duration_ms"),
  // Timestamp
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

export const modelUsageRelations = relations(modelUsage, ({ one }) => ({
  subChat: one(subChats, {
    fields: [modelUsage.subChatId],
    references: [subChats.id],
  }),
  chat: one(chats, {
    fields: [modelUsage.chatId],
    references: [chats.id],
  }),
  project: one(projects, {
    fields: [modelUsage.projectId],
    references: [projects.id],
  }),
}))

// ============ ANTHROPIC ACCOUNTS (Multi-account support) ============
// Stores multiple Anthropic OAuth accounts for quick switching
export const anthropicAccounts = sqliteTable("anthropic_accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text("email"), // User's email from OAuth (if available)
  displayName: text("display_name"), // User-editable label
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  desktopUserId: text("desktop_user_id"), // Reference to backend user
})

// Tracks which Anthropic account is currently active
export const anthropicSettings = sqliteTable("anthropic_settings", {
  id: text("id").primaryKey().default("singleton"), // Single row
  activeAccountId: text("active_account_id"), // References anthropicAccounts.id
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

// ============ AUTOMATIONS ============
export const automations = sqliteTable("automations", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  description: text("description"),
  isEnabled: integer("is_enabled", { mode: "boolean" }).default(true),

  // 触发器配置 (JSON)
  // [{ type: 'cron', config: { expression: '0 9 * * *', strict: false } }]
  triggers: text("triggers").notNull().default("[]"),

  // AI 处理配置
  agentPrompt: text("agent_prompt").notNull(),
  skills: text("skills").default("[]"),
  modelId: text("model_id").default("claude-opus-4-20250514"),

  // 执行器配置 (JSON)
  // [{ type: 'inbox', config: {} }]
  actions: text("actions").notNull().default("[]"),

  // 关联项目（可选）
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),

  // 时间和统计
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  lastTriggeredAt: integer("last_triggered_at", { mode: "timestamp" }),
  totalExecutions: integer("total_executions").default(0),
  successfulExecutions: integer("successful_executions").default(0),
  failedExecutions: integer("failed_executions").default(0),
})

export const automationExecutions = sqliteTable(
  "automation_executions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),

    status: text("status").notNull(), // 'pending' | 'running' | 'success' | 'failed'
    triggeredBy: text("triggered_by").notNull(), // 'cron' | 'webhook' | 'startup-missed' | ...
    triggerData: text("trigger_data"), // JSON
    result: text("result"), // JSON
    errorMessage: text("error_message"),

    // 关联 Inbox Chat（如果执行器创建了消息）
    inboxChatId: text("inbox_chat_id").references(() => chats.id),

    // 性能指标
    startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),

    // Token 使用
    inputTokens: integer("input_tokens").default(0),
    outputTokens: integer("output_tokens").default(0),
  },
  (table) => [
    index("executions_automation_idx").on(table.automationId),
    index("executions_status_idx").on(table.status),
  ],
)

// ============ WORKSPACE TAGS (macOS-style tags for Chats/Workspaces) ============
export const workspaceTags = sqliteTable("workspace_tags", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  color: text("color"), // Hex color code, e.g., "#FF3B30" (optional - no color = icon only)
  icon: text("icon"), // Optional Lucide icon name identifier
  sortOrder: integer("sort_order").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

// ============ CHAT-TAG ASSOCIATIONS (M:N relationship) ============
export const chatTags = sqliteTable(
  "chat_tags",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => workspaceTags.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => [
    index("chat_tags_chat_idx").on(table.chatId),
    index("chat_tags_tag_idx").on(table.tagId),
  ],
)

// ============ SUBCHAT-TAG ASSOCIATIONS (M:N relationship) ============
export const subChatTags = sqliteTable(
  "sub_chat_tags",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    subChatId: text("sub_chat_id")
      .notNull()
      .references(() => subChats.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => workspaceTags.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => [
    index("sub_chat_tags_sub_chat_idx").on(table.subChatId),
    index("sub_chat_tags_tag_idx").on(table.tagId),
  ],
)

// ============ INSIGHTS (Usage Reports) ============
export const insights = sqliteTable(
  "insights",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    // Report type: 'daily' | 'weekly'
    reportType: text("report_type").notNull(),
    // Report date (YYYY-MM-DD for daily, week start date for weekly)
    reportDate: text("report_date").notNull(),
    // Pre-computed statistics (JSON)
    statsJson: text("stats_json").notNull(),
    // AI-generated summary (1-2 sentences for card display)
    summary: text("summary"),
    // AI-generated HTML report (detailed, for dialog display)
    reportHtml: text("report_html"),
    // AI-generated Markdown report (legacy, kept for compatibility)
    reportMarkdown: text("report_markdown"),
    // Status: 'pending' | 'generating' | 'completed' | 'failed'
    status: text("status").notNull().default("pending"),
    // Error message if failed
    error: text("error"),
    // Temporary data directory for Agent to read
    dataDir: text("data_dir"),
    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => [
    index("insights_type_date_idx").on(table.reportType, table.reportDate),
    index("insights_created_at_idx").on(table.createdAt),
  ],
)

// ============ MEMORY SESSIONS (借鉴 claude-mem sdk_sessions) ============
// 每个 SubChat 的一次完整会话对应一个 MemorySession
export const memorySessions = sqliteTable(
  "memory_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    // 关联到我们的数据模型
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    chatId: text("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    subChatId: text("sub_chat_id").references(() => subChats.id, {
      onDelete: "cascade",
    }),
    // 状态管理
    status: text("status").notNull().default("active"), // "active" | "completed" | "failed"
    startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    startedAtEpoch: integer("started_at_epoch").$defaultFn(() => Date.now()),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    completedAtEpoch: integer("completed_at_epoch"),
    // 会话摘要 (借鉴 claude-mem session_summaries)
    summaryRequest: text("summary_request"),
    summaryInvestigated: text("summary_investigated"),
    summaryLearned: text("summary_learned"),
    summaryCompleted: text("summary_completed"),
    summaryNextSteps: text("summary_next_steps"),
    summaryNotes: text("summary_notes"),
    // Token 统计
    discoveryTokens: integer("discovery_tokens").default(0),
  },
  (table) => [
    index("memory_sessions_project_idx").on(table.projectId),
    index("memory_sessions_sub_chat_idx").on(table.subChatId),
    index("memory_sessions_status_idx").on(table.status),
    index("memory_sessions_started_at_idx").on(table.startedAtEpoch),
  ],
)

export const memorySessionsRelations = relations(
  memorySessions,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [memorySessions.projectId],
      references: [projects.id],
    }),
    chat: one(chats, {
      fields: [memorySessions.chatId],
      references: [chats.id],
    }),
    subChat: one(subChats, {
      fields: [memorySessions.subChatId],
      references: [subChats.id],
    }),
    observations: many(observations),
    userPrompts: many(userPrompts),
  }),
)

// ============ OBSERVATIONS (借鉴 claude-mem observations) ============
// 记录每次工具调用的观察信息
export const observations = sqliteTable(
  "observations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    sessionId: text("session_id")
      .notNull()
      .references(() => memorySessions.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    // 类型系统 (借鉴 claude-mem)
    // "decision" | "bugfix" | "feature" | "refactor" | "discovery" | "change"
    type: text("type").notNull(),
    title: text("title"),
    subtitle: text("subtitle"),
    narrative: text("narrative"),
    // JSON 数组字段
    facts: text("facts"), // JSON: string[]
    concepts: text("concepts"), // JSON: string[]
    filesRead: text("files_read"), // JSON: string[]
    filesModified: text("files_modified"), // JSON: string[]
    // 工具关联
    toolName: text("tool_name"),
    toolCallId: text("tool_call_id"),
    promptNumber: integer("prompt_number"),
    discoveryTokens: integer("discovery_tokens").default(0),
    // 时间戳
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    createdAtEpoch: integer("created_at_epoch").$defaultFn(() => Date.now()),
  },
  (table) => [
    index("observations_session_idx").on(table.sessionId),
    index("observations_project_idx").on(table.projectId),
    index("observations_type_idx").on(table.type),
    index("observations_created_at_idx").on(table.createdAtEpoch),
  ],
)

export const observationsRelations = relations(observations, ({ one }) => ({
  session: one(memorySessions, {
    fields: [observations.sessionId],
    references: [memorySessions.id],
  }),
  project: one(projects, {
    fields: [observations.projectId],
    references: [projects.id],
  }),
}))

// ============ USER PROMPTS (借鉴 claude-mem user_prompts) ============
// 记录用户的每次输入
export const userPrompts = sqliteTable(
  "user_prompts",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    sessionId: text("session_id")
      .notNull()
      .references(() => memorySessions.id, { onDelete: "cascade" }),
    promptNumber: integer("prompt_number").notNull(),
    promptText: text("prompt_text").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    createdAtEpoch: integer("created_at_epoch").$defaultFn(() => Date.now()),
  },
  (table) => [
    index("user_prompts_session_idx").on(table.sessionId),
    index("user_prompts_created_at_idx").on(table.createdAtEpoch),
  ],
)

export const userPromptsRelations = relations(userPrompts, ({ one }) => ({
  session: one(memorySessions, {
    fields: [userPrompts.sessionId],
    references: [memorySessions.id],
  }),
}))

// ============ MODEL PROVIDERS (Custom API providers for LLM/Image) ============
// Stores custom API provider configurations
// Note: "anthropic" and "litellm" are virtual providers (not stored in DB)
export const modelProviders = sqliteTable(
  "model_providers",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    // Provider type: currently only "custom" is stored in DB
    // "anthropic" and "litellm" are virtual providers
    type: text("type").notNull().default("custom"),
    // Category: "llm" for chat/agent models, "image" for image generation
    // LLM and Image providers are managed separately
    category: text("category").notNull().default("llm"),
    // Display name for the provider
    name: text("name").notNull(),
    // API endpoint base URL (e.g., "https://api.example.com/v1")
    baseUrl: text("base_url").notNull(),
    // API key (encrypted with safeStorage)
    apiKey: text("api_key").notNull(),
    // Whether this provider is enabled
    isEnabled: integer("is_enabled", { mode: "boolean" }).default(true),
    // Manual model list for providers without /models endpoint
    // JSON array of model IDs, e.g. ["claude-3-5-sonnet", "claude-3-opus"]
    manualModels: text("manual_models"),
    // Timestamps
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => [
    index("model_providers_category_idx").on(table.category),
  ],
)

// ============ CACHED MODELS (from /models endpoint) ============
// Caches model lists fetched from provider /models endpoints
// Reduces API calls and provides offline model selection
export const cachedModels = sqliteTable(
  "cached_models",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => createId()),
    // Provider ID: "anthropic", "litellm", or custom provider ID
    providerId: text("provider_id").notNull(),
    // Original model ID from the provider (e.g., "claude-sonnet-4-20250514")
    modelId: text("model_id").notNull(),
    // Display name for the model
    name: text("name").notNull(),
    // Category: "llm" or "image"
    category: text("category").notNull().default("llm"),
    // Additional metadata as JSON (context window, max tokens, etc.)
    metadata: text("metadata"),
    // When this model was cached
    cachedAt: integer("cached_at", { mode: "timestamp" }).$defaultFn(
      () => new Date(),
    ),
  },
  (table) => [
    index("cached_models_provider_idx").on(table.providerId),
    index("cached_models_category_idx").on(table.category),
  ],
)

// ============ TYPE EXPORTS ============
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
export type SubChat = typeof subChats.$inferSelect
export type NewSubChat = typeof subChats.$inferInsert
export type ClaudeCodeCredential = typeof claudeCodeCredentials.$inferSelect
export type NewClaudeCodeCredential = typeof claudeCodeCredentials.$inferInsert
export type ModelUsage = typeof modelUsage.$inferSelect
export type NewModelUsage = typeof modelUsage.$inferInsert
export type AnthropicAccount = typeof anthropicAccounts.$inferSelect
export type NewAnthropicAccount = typeof anthropicAccounts.$inferInsert
export type AnthropicSettings = typeof anthropicSettings.$inferSelect
export type Automation = typeof automations.$inferSelect
export type NewAutomation = typeof automations.$inferInsert
export type AutomationExecution = typeof automationExecutions.$inferSelect
export type NewAutomationExecution = typeof automationExecutions.$inferInsert
export type WorkspaceTag = typeof workspaceTags.$inferSelect
export type NewWorkspaceTag = typeof workspaceTags.$inferInsert
export type ChatTag = typeof chatTags.$inferSelect
export type NewChatTag = typeof chatTags.$inferInsert
export type SubChatTag = typeof subChatTags.$inferSelect
export type NewSubChatTag = typeof subChatTags.$inferInsert
export type Insight = typeof insights.$inferSelect
export type NewInsight = typeof insights.$inferInsert
export type MemorySession = typeof memorySessions.$inferSelect
export type NewMemorySession = typeof memorySessions.$inferInsert
export type Observation = typeof observations.$inferSelect
export type NewObservation = typeof observations.$inferInsert
export type UserPrompt = typeof userPrompts.$inferSelect
export type NewUserPrompt = typeof userPrompts.$inferInsert
export type ModelProvider = typeof modelProviders.$inferSelect
export type NewModelProvider = typeof modelProviders.$inferInsert
export type CachedModel = typeof cachedModels.$inferSelect
export type NewCachedModel = typeof cachedModels.$inferInsert
