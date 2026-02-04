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
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
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
