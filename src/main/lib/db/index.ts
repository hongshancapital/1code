import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { app } from "electron"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import * as schema from "./schema"

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database.Database | null = null

/**
 * Get the database path in the app's user data directory
 */
function getDatabasePath(): string {
  const userDataPath = app.getPath("userData")
  const dataDir = join(userDataPath, "data")

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  return join(dataDir, "agents.db")
}

/**
 * Get the migrations folder path
 * Handles both development and production (packaged) environments
 */
function getMigrationsPath(): string {
  if (app.isPackaged) {
    // Production: migrations bundled in resources
    return join(process.resourcesPath, "migrations")
  }
  // Development: from out/main -> apps/desktop/drizzle
  return join(__dirname, "../../drizzle")
}

/**
 * Initialize the database with Drizzle ORM
 */
export function initDatabase() {
  if (db) {
    return db
  }

  const dbPath = getDatabasePath()
  console.log(`[DB] Initializing database at: ${dbPath}`)

  // Create SQLite connection
  sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")

  // Create Drizzle instance
  db = drizzle(sqlite, { schema })

  // Run migrations
  const migrationsPath = getMigrationsPath()
  console.log(`[DB] Running migrations from: ${migrationsPath}`)

  try {
    migrate(db, { migrationsFolder: migrationsPath })
    console.log("[DB] Migrations completed")
  } catch (error) {
    console.error("[DB] Migration error:", error)
    // Don't throw - try to continue with manual column additions
    console.log("[DB] Attempting manual schema fixes...")
  }

  // Ensure is_playground column exists (for chat mode feature)
  // This handles cases where migrations fail due to conflicts
  try {
    sqlite.exec(`ALTER TABLE projects ADD COLUMN is_playground INTEGER DEFAULT 0`)
    console.log("[DB] Added is_playground column")
  } catch (e: unknown) {
    // Column likely already exists, ignore
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] is_playground column check:", error.message)
    }
  }

  // Ensure tag_id column exists on chats table (for preset tags)
  try {
    sqlite.exec(`ALTER TABLE chats ADD COLUMN tag_id TEXT`)
    console.log("[DB] Added tag_id column to chats")
  } catch (e: unknown) {
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] tag_id column check:", error.message)
    }
  }

  // Ensure workspace_tags tables exist (for grouping feature)
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS workspace_tags (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `)
    sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS workspace_tags_name_idx ON workspace_tags(name)`)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS chat_tags (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES workspace_tags(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      )
    `)
    sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS chat_tags_unique_idx ON chat_tags(chat_id, tag_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS chat_tags_chat_idx ON chat_tags(chat_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS chat_tags_tag_idx ON chat_tags(tag_id)`)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sub_chat_tags (
        id TEXT PRIMARY KEY,
        sub_chat_id TEXT NOT NULL REFERENCES sub_chats(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES workspace_tags(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      )
    `)
    sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS sub_chat_tags_unique_idx ON sub_chat_tags(sub_chat_id, tag_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS sub_chat_tags_sub_chat_idx ON sub_chat_tags(sub_chat_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS sub_chat_tags_tag_idx ON sub_chat_tags(tag_id)`)
    console.log("[DB] Workspace tags tables ensured")
  } catch (e: unknown) {
    const error = e as Error
    console.log("[DB] Workspace tags tables check:", error.message)
  }

  // Ensure stats_json column exists on sub_chats table (for preview optimization)
  try {
    sqlite.exec(`ALTER TABLE sub_chats ADD COLUMN stats_json TEXT`)
    console.log("[DB] Added stats_json column to sub_chats")
  } catch (e: unknown) {
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] stats_json column check:", error.message)
    }
  }

  // Ensure has_pending_plan column exists on sub_chats table
  try {
    sqlite.exec(`ALTER TABLE sub_chats ADD COLUMN has_pending_plan INTEGER DEFAULT 0`)
    console.log("[DB] Added has_pending_plan column to sub_chats")
  } catch (e: unknown) {
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] has_pending_plan column check:", error.message)
    }
  }

  // Ensure manually_renamed column exists on chats and sub_chats tables
  try {
    sqlite.exec(`ALTER TABLE chats ADD COLUMN manually_renamed INTEGER DEFAULT 0`)
    console.log("[DB] Added manually_renamed column to chats")
  } catch (e: unknown) {
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] chats manually_renamed column check:", error.message)
    }
  }
  try {
    sqlite.exec(`ALTER TABLE sub_chats ADD COLUMN manually_renamed INTEGER DEFAULT 0`)
    console.log("[DB] Added manually_renamed column to sub_chats")
  } catch (e: unknown) {
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] sub_chats manually_renamed column check:", error.message)
    }
  }

  // Ensure insights table exists (for usage analysis reports)
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY,
        report_type TEXT NOT NULL,
        report_date TEXT NOT NULL,
        stats_json TEXT NOT NULL,
        report_markdown TEXT,
        status TEXT DEFAULT 'pending' NOT NULL,
        error TEXT,
        data_dir TEXT,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS insights_type_date_idx ON insights(report_type, report_date)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS insights_created_at_idx ON insights(created_at)`)
    console.log("[DB] Insights table ensured")
  } catch (e: unknown) {
    const error = e as Error
    console.log("[DB] Insights table check:", error.message)
  }

  // Ensure summary and report_html columns exist on insights table (for warm coworker style reports)
  try {
    sqlite.exec(`ALTER TABLE insights ADD COLUMN summary TEXT`)
    console.log("[DB] Added summary column to insights")
  } catch (e: unknown) {
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] summary column check:", error.message)
    }
  }
  try {
    sqlite.exec(`ALTER TABLE insights ADD COLUMN report_html TEXT`)
    console.log("[DB] Added report_html column to insights")
  } catch (e: unknown) {
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] report_html column check:", error.message)
    }
  }

  // Ensure memory tables exist (for Memory + Search feature)
  try {
    // Memory Sessions table (tracks each SubChat session for memory)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS memory_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        chat_id TEXT REFERENCES chats(id) ON DELETE CASCADE,
        sub_chat_id TEXT REFERENCES sub_chats(id) ON DELETE CASCADE,
        status TEXT DEFAULT 'active' NOT NULL,
        started_at INTEGER,
        started_at_epoch INTEGER,
        completed_at INTEGER,
        completed_at_epoch INTEGER,
        summary_request TEXT,
        summary_investigated TEXT,
        summary_learned TEXT,
        summary_completed TEXT,
        summary_next_steps TEXT,
        summary_notes TEXT,
        discovery_tokens INTEGER DEFAULT 0
      )
    `)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS memory_sessions_project_idx ON memory_sessions(project_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS memory_sessions_sub_chat_idx ON memory_sessions(sub_chat_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS memory_sessions_status_idx ON memory_sessions(status)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS memory_sessions_started_at_idx ON memory_sessions(started_at_epoch)`)

    // Observations table (records tool call observations)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES memory_sessions(id) ON DELETE CASCADE,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        narrative TEXT,
        facts TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        tool_name TEXT,
        tool_call_id TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        created_at INTEGER,
        created_at_epoch INTEGER
      )
    `)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS observations_session_idx ON observations(session_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS observations_project_idx ON observations(project_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS observations_type_idx ON observations(type)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS observations_created_at_idx ON observations(created_at_epoch)`)

    // User Prompts table (records user inputs)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS user_prompts (
        id TEXT PRIMARY KEY NOT NULL,
        session_id TEXT NOT NULL REFERENCES memory_sessions(id) ON DELETE CASCADE,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at INTEGER,
        created_at_epoch INTEGER
      )
    `)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS user_prompts_session_idx ON user_prompts(session_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS user_prompts_created_at_idx ON user_prompts(created_at_epoch)`)

    // FTS5 Virtual Tables for full-text search
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        title,
        subtitle,
        narrative,
        facts,
        concepts,
        content='observations',
        content_rowid='rowid'
      )
    `)

    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS user_prompts_fts USING fts5(
        prompt_text,
        content='user_prompts',
        content_rowid='rowid'
      )
    `)

    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_sessions_fts USING fts5(
        summary_request,
        summary_learned,
        summary_completed,
        summary_next_steps,
        content='memory_sessions',
        content_rowid='rowid'
      )
    `)

    // Triggers to keep FTS tables in sync with main tables
    // observations_fts triggers
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts)
        VALUES (new.rowid, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
      END
    `)
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts)
        VALUES('delete', old.rowid, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
      END
    `)
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts)
        VALUES('delete', old.rowid, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts)
        VALUES (new.rowid, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
      END
    `)

    // user_prompts_fts triggers
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS user_prompts_ai AFTER INSERT ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.rowid, new.prompt_text);
      END
    `)
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS user_prompts_ad AFTER DELETE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.rowid, old.prompt_text);
      END
    `)
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS user_prompts_au AFTER UPDATE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.rowid, old.prompt_text);
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.rowid, new.prompt_text);
      END
    `)

    // memory_sessions_fts triggers
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_sessions_ai AFTER INSERT ON memory_sessions BEGIN
        INSERT INTO memory_sessions_fts(rowid, summary_request, summary_learned, summary_completed, summary_next_steps)
        VALUES (new.rowid, new.summary_request, new.summary_learned, new.summary_completed, new.summary_next_steps);
      END
    `)
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_sessions_ad AFTER DELETE ON memory_sessions BEGIN
        INSERT INTO memory_sessions_fts(memory_sessions_fts, rowid, summary_request, summary_learned, summary_completed, summary_next_steps)
        VALUES('delete', old.rowid, old.summary_request, old.summary_learned, old.summary_completed, old.summary_next_steps);
      END
    `)
    sqlite.exec(`
      CREATE TRIGGER IF NOT EXISTS memory_sessions_au AFTER UPDATE ON memory_sessions BEGIN
        INSERT INTO memory_sessions_fts(memory_sessions_fts, rowid, summary_request, summary_learned, summary_completed, summary_next_steps)
        VALUES('delete', old.rowid, old.summary_request, old.summary_learned, old.summary_completed, old.summary_next_steps);
        INSERT INTO memory_sessions_fts(rowid, summary_request, summary_learned, summary_completed, summary_next_steps)
        VALUES (new.rowid, new.summary_request, new.summary_learned, new.summary_completed, new.summary_next_steps);
      END
    `)

    console.log("[DB] Memory tables ensured (3 tables + 3 FTS + 9 triggers)")
  } catch (e: unknown) {
    const error = e as Error
    console.log("[DB] Memory tables check:", error.message)
  }

  // Ensure source column exists on model_usage table (for distinguishing chat/memory/automation usage)
  try {
    sqlite.exec(`ALTER TABLE model_usage ADD COLUMN source TEXT`)
    console.log("[DB] Added source column to model_usage")
  } catch (e: unknown) {
    const error = e as Error
    if (!error.message?.includes("duplicate column")) {
      console.log("[DB] source column check:", error.message)
    }
  }

  // Ensure model_providers and cached_models tables exist (for unified provider management)
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS model_providers (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'custom',
        category TEXT NOT NULL DEFAULT 'llm',
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL,
        is_enabled INTEGER DEFAULT 1,
        created_at INTEGER,
        updated_at INTEGER
      )
    `)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS model_providers_category_idx ON model_providers(category)`)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS cached_models (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'llm',
        metadata TEXT,
        cached_at INTEGER
      )
    `)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS cached_models_provider_idx ON cached_models(provider_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS cached_models_category_idx ON cached_models(category)`)
    console.log("[DB] Model providers tables ensured")
  } catch (e: unknown) {
    const error = e as Error
    console.log("[DB] Model providers tables check:", error.message)
  }

  // Ensure automations tables exist (for automation engine)
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS automations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        is_enabled INTEGER DEFAULT 1,
        triggers TEXT NOT NULL DEFAULT '[]',
        agent_prompt TEXT NOT NULL,
        skills TEXT DEFAULT '[]',
        model_id TEXT DEFAULT 'claude-opus-4-20250514',
        actions TEXT NOT NULL DEFAULT '[]',
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_triggered_at INTEGER,
        total_executions INTEGER DEFAULT 0,
        successful_executions INTEGER DEFAULT 0,
        failed_executions INTEGER DEFAULT 0
      )
    `)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS automation_executions (
        id TEXT PRIMARY KEY,
        automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        triggered_by TEXT NOT NULL,
        trigger_data TEXT,
        result TEXT,
        error_message TEXT,
        inbox_chat_id TEXT REFERENCES chats(id),
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER,
        input_tokens INTEGER DEFAULT 0,
        output_tokens INTEGER DEFAULT 0
      )
    `)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS executions_automation_idx ON automation_executions(automation_id)`)
    sqlite.exec(`CREATE INDEX IF NOT EXISTS executions_status_idx ON automation_executions(status)`)
    console.log("[DB] Automations tables ensured")
  } catch (e: unknown) {
    const error = e as Error
    console.log("[DB] Automations tables check:", error.message)
  }

  return db
}

/**
 * Get the database instance
 */
export function getDatabase() {
  if (!db) {
    return initDatabase()
  }
  return db
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
    console.log("[DB] Database connection closed")
  }
}

// Re-export schema for convenience
export * from "./schema"
