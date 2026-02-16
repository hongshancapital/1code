/**
 * Migration Router
 * Exposes message migration status and control to the renderer via tRPC
 */

import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { getDatabase } from "../../db"
import { subChats } from "../../db/schema"
import { publicProcedure, router } from "../index"
import { createLogger } from "../../logger"

const migrationLog = createLogger("migration-trpc")

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

export const migrationRouter = router({
  /**
   * Get the count of unmigrated sub-chats
   */
  getUnmigratedCount: publicProcedure.query(async () => {
    const db = getDatabase()
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(subChats)
      .where(eq(subChats.messagesMigrated, false))
    return result[0]?.count ?? 0
  }),

  /**
   * Migrate a batch of sub-chats (for background progress)
   */
  migrateBatch: publicProcedure
    .input(z.object({ batchSize: z.number().default(10) }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get unmigrated sub-chats
      const unmigrated = await db.query.subChats.findMany({
        where: eq(subChats.messagesMigrated, false),
        limit: input.batchSize,
      })

      if (unmigrated.length === 0) {
        return { migrated: 0, remaining: 0 }
      }

      let migrated = 0

      for (const subChat of unmigrated) {
        try {
          const messages: ChatMessage[] = subChat.messages
            ? JSON.parse(subChat.messages)
            : []

          if (messages.length === 0) {
            // No messages to migrate, just mark as migrated
            await db
              .update(subChats)
              .set({ messagesMigrated: true })
              .where(eq(subChats.id, subChat.id))
            migrated++
            continue
          }

          // Import the schema for inserting
          const { subChatMessages } = await import("../../db/schema")

          // Insert all messages into normalized table
          await db.insert(subChatMessages).values(
            messages.map((msg, idx) => {
              // Ensure createdAt is a valid Date object
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
                subChatId: subChat.id,
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
            .where(eq(subChats.id, subChat.id))

          migrated++
          migrationLog.info("Migrated sub-chat:", subChat.id, "messages:", messages.length)
        } catch (error) {
          migrationLog.error("Migration failed for sub-chat:", subChat.id, error)
        }
      }

      // Get remaining count
      const remainingResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(subChats)
        .where(eq(subChats.messagesMigrated, false))
      const remaining = remainingResult[0]?.count ?? 0

      return { migrated, remaining }
    }),
})
