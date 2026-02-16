import { eq, sql } from "drizzle-orm"
import { getDatabase } from "./index"
import { subChats, subChatMessages } from "./schema"
import { createLogger } from "../logger"

const migrationLog = createLogger("message-migration")

/**
 * ChatMessage structure - matches the format stored in sub_chats.messages JSON
 */
interface ChatMessage {
  id: string
  role: "user" | "assistant" | "system"
  parts: Array<{
    type: string
    text?: string
    [key: string]: unknown
  }>
  metadata?: {
    sdkMessageUuid?: string
    shouldResume?: boolean
    sessionId?: string
    tokens?: number
    [key: string]: unknown
  }
  createdAt?: Date
}

/**
 * Migrate a single sub-chat's messages from JSON to normalized table
 * Returns true if migration succeeded, false if already migrated or failed
 */
export async function migrateSubChat(subChatId: string): Promise<boolean> {
  const db = getDatabase()

  try {
    const subChat = await db.query.subChats.findFirst({
      where: eq(subChats.id, subChatId),
    })

    if (!subChat) {
      migrationLog.warn("SubChat not found for migration:", subChatId)
      return false
    }

    if (subChat.messagesMigrated) {
      return true // Already migrated
    }

    const messages: ChatMessage[] = subChat.messages
      ? JSON.parse(subChat.messages)
      : []

    if (messages.length === 0) {
      // No messages to migrate, just mark as migrated
      await db
        .update(subChats)
        .set({ messagesMigrated: true })
        .where(eq(subChats.id, subChatId))
      migrationLog.info("Marked empty sub-chat as migrated:", subChatId)
      return true
    }

    // Insert all messages into normalized table
    // Ensure createdAt is a valid Date object (handle ISO strings, timestamps, etc.)
    await db.insert(subChatMessages).values(
      messages.map((msg, idx) => {
        let createdAtValue: Date
        if (!msg.createdAt) {
          createdAtValue = new Date()
        } else if (typeof msg.createdAt === "string") {
          createdAtValue = new Date(msg.createdAt)
        } else if (typeof msg.createdAt === "number") {
          createdAtValue = new Date(msg.createdAt)
        } else {
          createdAtValue = msg.createdAt
        }

        return {
          id: msg.id,
          subChatId,
          role: msg.role,
          parts: JSON.stringify(msg.parts),
          metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
          index: idx,
          createdAt: createdAtValue,
        }
      }),
    )

    // Mark as migrated
    await db
      .update(subChats)
      .set({ messagesMigrated: true })
      .where(eq(subChats.id, subChatId))

    migrationLog.info("Migrated sub-chat:", subChatId, "messages:", messages.length)
    return true
  } catch (error) {
    migrationLog.error("Migration failed for sub-chat:", subChatId, error)
    return false
  }
}

/**
 * Get total count of sub-chats that need migration
 */
export async function getUnmigratedCount(): Promise<number> {
  const db = getDatabase()
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(subChats)
    .where(eq(subChats.messagesMigrated, false))
  return result[0]?.count ?? 0
}

/**
 * Get all sub-chats that need migration (with optional limit)
 */
export async function getUnmigratedSubChats(limit = 100) {
  const db = getDatabase()
  return db.query.subChats.findMany({
    where: eq(subChats.messagesMigrated, false),
    limit,
  })
}

/**
 * Run background migration for all unmigrated sub-chats
 * This runs in the background and doesn't block the app startup
 * @param onProgress Optional callback for progress updates (completed, total)
 */
export async function runBackgroundMigration(
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  const db = getDatabase()

  try {
    const total = await getUnmigratedCount()

    if (total === 0) {
      migrationLog.info("No sub-chats to migrate")
      return
    }

    migrationLog.info("Starting background migration for", total, "sub-chats")

    let completed = 0
    const batchSize = 10 // Migrate 10 sub-chats at a time

    while (completed < total) {
      const subChatsToMigrate = await getUnmigratedSubChats(batchSize)

      if (subChatsToMigrate.length === 0) {
        break
      }

      // Migrate in batches
      for (const subChat of subChatsToMigrate) {
        const success = await migrateSubChat(subChat.id)
        if (success) {
          completed++
        }
      }

      // Report progress
      if (onProgress) {
        onProgress(completed, total)
      }

      migrationLog.info("Migration progress:", completed, "/", total)

      // Small delay to not block the main thread too much
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    migrationLog.info("Background migration completed:", completed, "sub-chats")
  } catch (error) {
    migrationLog.error("Background migration failed:", error)
  }
}
