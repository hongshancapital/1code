import { and, desc, eq } from "drizzle-orm"
import { mkdir } from "fs/promises"
import { join } from "path"
import { app } from "electron"
import { chats, getDatabase, projects, subChats } from "../db"
import { createId } from "../db/utils"
import { PLAYGROUND_RELATIVE_PATH } from "../../../shared/feature-config"

/**
 * Migrate old-format playground sub-chats to new independent format.
 *
 * Old format: Single ~/.hong/.playground/ directory with one chat containing multiple sub-chats
 * New format: Each chat has its own directory ~/.hong/.playground/{id}/
 *
 * This migration:
 * 1. Finds the old playground project (path equals playgroundRoot exactly)
 * 2. Gets all sub-chats with non-empty messages
 * 3. Creates new independent playground chats for each
 * 4. Deletes the old playground project and associated data
 *
 * Call this at app startup after database initialization.
 */
export async function migrateOldPlaygroundSubChats(): Promise<{ migrated: number; skipped: number }> {
  const db = getDatabase()
  const homePath = app.getPath("home")
  const playgroundRoot = join(homePath, PLAYGROUND_RELATIVE_PATH)

  // Find old-format playground project
  // Old format has path exactly matching playgroundRoot (no sub-ID)
  const oldPlayground = db
    .select()
    .from(projects)
    .where(and(
      eq(projects.isPlayground, true),
      eq(projects.path, playgroundRoot),
    ))
    .get()

  if (!oldPlayground) {
    // No old format playground found - nothing to migrate
    return { migrated: 0, skipped: 0 }
  }

  console.log("[PlaygroundMigration] Found old-format playground, starting migration...")

  // Get all chats under the old playground
  const oldChats = db
    .select()
    .from(chats)
    .where(eq(chats.projectId, oldPlayground.id))
    .all()

  let migrated = 0
  let skipped = 0

  for (const oldChat of oldChats) {
    // Get all sub-chats for this chat
    const oldSubChats = db
      .select()
      .from(subChats)
      .where(eq(subChats.chatId, oldChat.id))
      .orderBy(desc(subChats.createdAt))
      .all()

    for (const oldSubChat of oldSubChats) {
      // Skip empty sub-chats
      const messages = JSON.parse(oldSubChat.messages || "[]")
      if (messages.length === 0) {
        skipped++
        continue
      }

      try {
        // Create new independent playground directory
        const newPlaygroundId = createId()
        const newPlaygroundPath = join(playgroundRoot, newPlaygroundId)
        await mkdir(newPlaygroundPath, { recursive: true })

        // Derive name from first user message or use default
        let chatName = oldSubChat.name || oldChat.name || "Migrated Chat"
        if (chatName === "Migrated Chat" || chatName === "Chat Playground") {
          const firstUserMsg = messages.find((m: { role: string; parts?: Array<{ type: string; text?: string }> }) => m.role === "user")
          if (firstUserMsg?.parts?.[0]?.text) {
            const text = firstUserMsg.parts[0].text.trim()
            chatName = text.length > 25 ? text.substring(0, 25) + "..." : text
          }
        }

        // Create new playground project
        const newProject = db
          .insert(projects)
          .values({
            name: chatName,
            path: newPlaygroundPath,
            mode: "cowork",
            isPlayground: true,
          })
          .returning()
          .get()

        // Create new chat
        const newChat = db
          .insert(chats)
          .values({
            name: chatName,
            projectId: newProject.id,
            worktreePath: newPlaygroundPath,
          })
          .returning()
          .get()

        // Create new sub-chat with original messages
        db.insert(subChats)
          .values({
            chatId: newChat.id,
            name: oldSubChat.name,
            mode: oldSubChat.mode || "agent",
            messages: oldSubChat.messages,
            sessionId: oldSubChat.sessionId,
            streamId: oldSubChat.streamId,
          })
          .run()

        migrated++
      } catch (err) {
        console.error(`[PlaygroundMigration] Failed to migrate sub-chat ${oldSubChat.id}:`, err)
        skipped++
      }
    }

    // Delete old sub-chats for this chat
    db.delete(subChats).where(eq(subChats.chatId, oldChat.id)).run()
  }

  // Delete old chats
  for (const oldChat of oldChats) {
    db.delete(chats).where(eq(chats.id, oldChat.id)).run()
  }

  // Delete old playground project
  db.delete(projects).where(eq(projects.id, oldPlayground.id)).run()

  // Note: We don't delete the old ~/.hong/.playground/ directory itself
  // as it's now the parent directory for new playground chats

  console.log(`[PlaygroundMigration] Migration complete: ${migrated} migrated, ${skipped} skipped`)
  return { migrated, skipped }
}
