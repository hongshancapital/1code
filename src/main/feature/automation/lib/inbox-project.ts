import { eq } from "drizzle-orm"
import { getDatabase, projects } from "../../../lib/db"

export const INBOX_PROJECT_ID = "inbox-special-project"

/**
 * 确保 Inbox 特殊项目存在
 * 在应用启动时调用
 */
export async function ensureInboxProject(): Promise<void> {
  const db = getDatabase()

  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.id, INBOX_PROJECT_ID))
    .get()

  if (!existing) {
    await db.insert(projects).values({
      id: INBOX_PROJECT_ID,
      name: "Inbox",
      path: "/inbox",
      mode: "chat",
      isPlayground: false,
    })

    console.log("[Inbox] Created special inbox project")
  }
}
