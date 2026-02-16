import { eq, and, desc, asc, sql } from "drizzle-orm"
import { getDatabase } from "./index"
import { subChats, subChatMessages } from "./schema"

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
 * Get all messages for a sub-chat
 * Uses new table if migrated, falls back to legacy JSON column
 */
export async function getMessages(subChatId: string): Promise<ChatMessage[]> {
  const subChat = await getDatabase().query.subChats.findFirst({
    where: eq(subChats.id, subChatId),
  })

  if (!subChat) {
    return []
  }

  // Check migration status
  if (subChat.messagesMigrated) {
    // Read from normalized table
    const rows = await getDatabase().query.subChatMessages.findMany({
      where: eq(subChatMessages.subChatId, subChatId),
      orderBy: asc(subChatMessages.index),
    })

    return rows.map((row) => ({
      id: row.id,
      role: row.role as "user" | "assistant" | "system",
      parts: JSON.parse(row.parts),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.createdAt,
    }))
  }

  // Fallback to legacy JSON column
  return subChat.messages ? JSON.parse(subChat.messages) : []
}

/**
 * Append a new message to the sub-chat
 * Uses new table if migrated, writes to legacy JSON column otherwise
 */
export async function appendMessage(
  subChatId: string,
  message: ChatMessage,
): Promise<void> {
  const subChat = await getDatabase().query.subChats.findFirst({
    where: eq(subChats.id, subChatId),
  })

  if (!subChat) {
    return
  }

  if (subChat.messagesMigrated) {
    // Get current max index
    const lastMessage = await getDatabase().query.subChatMessages.findFirst({
      where: eq(subChatMessages.subChatId, subChatId),
      orderBy: desc(subChatMessages.index),
    })

    const nextIndex = (lastMessage?.index ?? -1) + 1

    // Ensure createdAt is a valid Date object
    const appendCreatedAt = message.createdAt
      ? (typeof message.createdAt === "string" ? new Date(message.createdAt) : message.createdAt)
      : new Date()

    await getDatabase().insert(subChatMessages).values({
      id: message.id,
      subChatId,
      role: message.role,
      parts: JSON.stringify(message.parts),
      metadata: message.metadata ? JSON.stringify(message.metadata) : null,
      index: nextIndex,
      createdAt: appendCreatedAt,
    })
  } else {
    // Legacy: append to JSON array
    const messages: ChatMessage[] = subChat.messages
      ? JSON.parse(subChat.messages)
      : []
    messages.push(message)

    await getDatabase()
      .update(subChats)
      .set({ messages: JSON.stringify(messages) })
      .where(eq(subChats.id, subChatId))
  }
}

/**
 * Replace all messages in a sub-chat
 */
export async function replaceAllMessages(
  subChatId: string,
  messages: ChatMessage[],
): Promise<void> {
  const subChat = await getDatabase().query.subChats.findFirst({
    where: eq(subChats.id, subChatId),
  })

  if (!subChat) {
    return
  }

  if (subChat.messagesMigrated) {
    // Delete all existing messages
    await getDatabase().delete(subChatMessages).where(
      eq(subChatMessages.subChatId, subChatId),
    )

    // Insert all new messages
    if (messages.length > 0) {
      await getDatabase().insert(subChatMessages).values(
        messages.map((msg, idx) => {
          // Ensure createdAt is a valid Date object
          const createdAtValue = msg.createdAt
            ? (typeof msg.createdAt === "string" ? new Date(msg.createdAt) : msg.createdAt)
            : new Date()
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
    }
  } else {
    await getDatabase()
      .update(subChats)
      .set({ messages: JSON.stringify(messages) })
      .where(eq(subChats.id, subChatId))
  }
}

/**
 * Truncate messages after a specific message (for rollback)
 */
export async function truncateAfter(
  subChatId: string,
  messageId: string,
): Promise<void> {
  const messages = await getMessages(subChatId)
  const index = messages.findIndex((m) => m.id === messageId)

  if (index === -1) {
    return
  }

  // Keep messages up to and including this message
  const truncated = messages.slice(0, index + 1)
  await replaceAllMessages(subChatId, truncated)
}

/**
 * Get message count for a sub-chat
 */
export async function getMessageCount(subChatId: string): Promise<number> {
  const subChat = await getDatabase().query.subChats.findFirst({
    where: eq(subChats.id, subChatId),
  })

  if (!subChat) {
    return 0
  }

  if (subChat.messagesMigrated) {
    const result = await getDatabase()
      .select({ count: sql<number>`count(*)` })
      .from(subChatMessages)
      .where(eq(subChatMessages.subChatId, subChatId))
    return result[0]?.count ?? 0
  }

  const messages: ChatMessage[] = subChat.messages
    ? JSON.parse(subChat.messages)
    : []
  return messages.length
}

/**
 * Check if a sub-chat has been migrated
 */
export async function isMigrated(subChatId: string): Promise<boolean> {
  const subChat = await getDatabase().query.subChats.findFirst({
    where: eq(subChats.id, subChatId),
    columns: { messagesMigrated: true },
  })
  return subChat?.messagesMigrated ?? false
}

/**
 * Migrate a single sub-chat's messages from JSON to normalized table
 */
export async function migrateSubChat(subChatId: string): Promise<void> {
  const subChat = await getDatabase().query.subChats.findFirst({
    where: eq(subChats.id, subChatId),
  })

  if (!subChat || subChat.messagesMigrated) {
    return
  }

  const messages: ChatMessage[] = subChat.messages
    ? JSON.parse(subChat.messages)
    : []

  if (messages.length === 0) {
    // No messages to migrate, just mark as migrated
    await getDatabase()
      .update(subChats)
      .set({ messagesMigrated: true })
      .where(eq(subChats.id, subChatId))
    return
  }

  // Insert all messages into normalized table
  await getDatabase().insert(subChatMessages).values(
    messages.map((msg, idx) => ({
      id: msg.id,
      subChatId,
      role: msg.role,
      parts: JSON.stringify(msg.parts),
      metadata: msg.metadata ? JSON.stringify(msg.metadata) : null,
      index: idx,
      createdAt: msg.createdAt ?? new Date(),
    })),
  )

  // Mark as migrated
  await getDatabase()
    .update(subChats)
    .set({ messagesMigrated: true })
    .where(eq(subChats.id, subChatId))
}

/**
 * Get total count of sub-chats that need migration
 */
export async function getUnmigratedCount(): Promise<number> {
  const result = await getDatabase()
    .select({ count: sql<number>`count(*)` })
    .from(subChats)
    .where(eq(subChats.messagesMigrated, false))
  return result[0]?.count ?? 0
}

/**
 * Get all sub-chats that need migration (with optional limit)
 */
export async function getUnmigratedSubChats(limit = 100) {
  return getDatabase().query.subChats.findMany({
    where: eq(subChats.messagesMigrated, false),
    limit,
  })
}

/**
 * Update pre-computed stats (statsJson, hasPendingPlan) for a sub-chat
 */
export async function updateSubChatStats(
  subChatId: string,
  statsJson: string | null,
  hasPendingPlan: boolean,
): Promise<void> {
  await getDatabase()
    .update(subChats)
    .set({ statsJson, hasPendingPlan })
    .where(eq(subChats.id, subChatId))
}
