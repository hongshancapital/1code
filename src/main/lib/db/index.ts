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
