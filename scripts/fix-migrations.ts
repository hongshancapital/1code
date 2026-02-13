#!/usr/bin/env bun
/**
 * Fix migration history by populating __drizzle_migrations table
 * with all existing migrations from drizzle/meta/_journal.json
 *
 * Usage:
 *   bun run scripts/fix-migrations.ts                  # Auto-detect dev/prod
 *   bun run scripts/fix-migrations.ts --prod           # Use production DB
 *   bun run scripts/fix-migrations.ts --dev            # Use dev DB
 *   bun run scripts/fix-migrations.ts --path /path/to/agents.db
 */

import { Database } from "bun:sqlite"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"

// Parse command line arguments
const args = process.argv.slice(2)
const prodFlag = args.includes("--prod")
const devFlag = args.includes("--dev")
const pathIndex = args.indexOf("--path")
const customPath = pathIndex >= 0 ? args[pathIndex + 1] : null

// Determine database path
let dbPath: string

if (customPath) {
  dbPath = customPath
  console.log(`[Fix] Using custom database path: ${dbPath}`)
} else if (prodFlag) {
  dbPath = join(process.env.HOME!, "Library/Application Support/Hong/data/agents.db")
  console.log(`[Fix] Using production database`)
} else if (devFlag) {
  dbPath = join(process.env.HOME!, "Library/Application Support/Agents Dev/data/agents.db")
  console.log(`[Fix] Using development database`)
} else {
  // Auto-detect: try prod first, then dev
  const prodPath = join(process.env.HOME!, "Library/Application Support/Hong/data/agents.db")
  const devPath = join(process.env.HOME!, "Library/Application Support/Agents Dev/data/agents.db")

  if (existsSync(prodPath)) {
    dbPath = prodPath
    console.log(`[Fix] Auto-detected production database`)
  } else if (existsSync(devPath)) {
    dbPath = devPath
    console.log(`[Fix] Auto-detected development database`)
  } else {
    console.error(`[Fix] Error: No database found at:`)
    console.error(`  - ${prodPath}`)
    console.error(`  - ${devPath}`)
    console.error(`[Fix] Use --path to specify custom location`)
    process.exit(1)
  }
}

console.log(`[Fix] Opening database: ${dbPath}`)
const db = new Database(dbPath)

// Read migration journal
const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json")
const journal = JSON.parse(readFileSync(journalPath, "utf-8"))

console.log(`[Fix] Found ${journal.entries.length} migrations in journal`)

// Check current migration state
const existingMigrations = db.query("SELECT * FROM __drizzle_migrations").all()
console.log(`[Fix] Current migrations in DB: ${existingMigrations.length}`)

if (existingMigrations.length > 0) {
  console.log("[Fix] Migration history already exists. Checking for missing entries...")
  const existingHashes = new Set(existingMigrations.map((m: any) => m.hash))

  for (const entry of journal.entries) {
    const sqlPath = join(process.cwd(), "drizzle", `${entry.tag}.sql`)
    try {
      const sqlContent = readFileSync(sqlPath, "utf-8")
      const hash = createHash("sha256").update(sqlContent).digest("hex")

      if (!existingHashes.has(hash)) {
        console.log(`[Fix] Missing migration: ${entry.tag}`)
        console.log(`[Fix]   Inserting: hash=${hash.substring(0, 8)}..., created_at=${entry.when}`)

        db.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
          .run(hash, entry.when)
      }
    } catch (error) {
      console.error(`[Fix] Error processing ${entry.tag}:`, error)
    }
  }
} else {
  console.log("[Fix] Migration history is empty. Populating all migrations...")

  // Populate all migrations
  for (const entry of journal.entries) {
    const sqlPath = join(process.cwd(), "drizzle", `${entry.tag}.sql`)

    try {
      const sqlContent = readFileSync(sqlPath, "utf-8")
      const hash = createHash("sha256").update(sqlContent).digest("hex")

      console.log(`[Fix] Inserting migration: ${entry.tag}`)
      console.log(`[Fix]   hash: ${hash.substring(0, 16)}...`)
      console.log(`[Fix]   created_at: ${entry.when}`)

      db.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)")
        .run(hash, entry.when)
    } catch (error) {
      console.error(`[Fix] Error processing ${entry.tag}:`, error)
    }
  }
}

// Verify
const finalCount = db.query("SELECT COUNT(*) as count FROM __drizzle_migrations").get() as { count: number }
console.log(`[Fix] Final migration count: ${finalCount.count}`)

db.close()
console.log("[Fix] Done! Please restart the app.")
