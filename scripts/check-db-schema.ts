#!/usr/bin/env bun
/**
 * Check database schema and migration state
 */

import { Database } from "bun:sqlite"
import { join } from "path"

const dbPath = join(process.env.HOME!, "Library/Application Support/Agents Dev/data/agents.db")
console.log(`[Check] Opening database: ${dbPath}`)

const db = new Database(dbPath)

// Check chats table schema
console.log("\n[Check] === CHATS TABLE SCHEMA ===")
const chatsSchema = db.query("PRAGMA table_info(chats)").all()
console.log(chatsSchema)

const hasManuallyRenamed = chatsSchema.some((col: any) => col.name === "manually_renamed")
console.log(`\n[Check] Has manually_renamed column: ${hasManuallyRenamed}`)

// Check migration records
console.log("\n[Check] === MIGRATION RECORDS ===")
const migrations = db.query("SELECT * FROM __drizzle_migrations ORDER BY created_at").all()
console.log(`[Check] Total migrations: ${migrations.length}`)

// Check if 0016 migration is recorded
const migration0016 = migrations.find((m: any) => {
  // We need to check the hash matches 0016_add_manually_renamed.sql
  return true // We'll show all and check manually
})

console.log("\n[Check] Last 3 migrations:")
console.log(migrations.slice(-3))

db.close()
