import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, workspaceTags, chatTags, subChatTags } from "../../db"
import { eq, and, inArray, asc } from "drizzle-orm"

// macOS-style preset colors
export const PRESET_COLORS = [
  { name: "红色", color: "#FF3B30" },
  { name: "橙色", color: "#FF9500" },
  { name: "黄色", color: "#FFCC00" },
  { name: "绿色", color: "#34C759" },
  { name: "蓝色", color: "#007AFF" },
  { name: "紫色", color: "#AF52DE" },
  { name: "灰色", color: "#8E8E93" },
] as const

export const tagsRouter = router({
  // ========== Tag CRUD ==========

  /** Get all tags */
  listTags: publicProcedure.query(() => {
    const db = getDatabase()
    return db
      .select()
      .from(workspaceTags)
      .orderBy(asc(workspaceTags.sortOrder), asc(workspaceTags.name))
      .all()
  }),

  /** Create a new tag */
  createTag: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(50),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).nullable(),
        icon: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      // Get max sortOrder to add new tag at the end
      const maxOrder = db
        .select({ sortOrder: workspaceTags.sortOrder })
        .from(workspaceTags)
        .orderBy(workspaceTags.sortOrder)
        .all()
        .pop()
      const newSortOrder = (maxOrder?.sortOrder ?? -1) + 1

      return db
        .insert(workspaceTags)
        .values({
          name: input.name,
          color: input.color ?? undefined, // Convert null to undefined for Drizzle
          icon: input.icon,
          sortOrder: newSortOrder,
        })
        .returning()
        .get()
    }),

  /** Update a tag */
  updateTag: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(50).optional(),
        color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        icon: z.string().nullable().optional(),
        sortOrder: z.number().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      const { id, ...updates } = input
      return db
        .update(workspaceTags)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(workspaceTags.id, id))
        .returning()
        .get()
    }),

  /** Delete a tag */
  deleteTag: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db.delete(workspaceTags).where(eq(workspaceTags.id, input.id)).run()
    }),

  // ========== Chat Tag Associations ==========

  /** Get tags for a single chat */
  getChatTags: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db
        .select({ tag: workspaceTags })
        .from(chatTags)
        .innerJoin(workspaceTags, eq(chatTags.tagId, workspaceTags.id))
        .where(eq(chatTags.chatId, input.chatId))
        .all()
        .map((r) => r.tag)
    }),

  /** Batch get tags for multiple chats */
  getChatTagsBatch: publicProcedure
    .input(z.object({ chatIds: z.array(z.string()) }))
    .query(({ input }) => {
      const db = getDatabase()
      if (input.chatIds.length === 0) return {}

      const results = db
        .select({
          chatId: chatTags.chatId,
          tag: workspaceTags,
        })
        .from(chatTags)
        .innerJoin(workspaceTags, eq(chatTags.tagId, workspaceTags.id))
        .where(inArray(chatTags.chatId, input.chatIds))
        .all()

      // Group by chatId
      const map: Record<string, typeof workspaceTags.$inferSelect[]> = {}
      for (const r of results) {
        if (!map[r.chatId]) map[r.chatId] = []
        map[r.chatId].push(r.tag)
      }
      return map
    }),

  /** Add a tag to a chat */
  addTagToChat: publicProcedure
    .input(z.object({ chatId: z.string(), tagId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      try {
        return db
          .insert(chatTags)
          .values({
            chatId: input.chatId,
            tagId: input.tagId,
          })
          .returning()
          .get()
      } catch (e) {
        // Ignore duplicate constraint errors
        const error = e as Error
        if (error.message?.includes("UNIQUE constraint failed")) {
          return null
        }
        throw e
      }
    }),

  /** Remove a tag from a chat */
  removeTagFromChat: publicProcedure
    .input(z.object({ chatId: z.string(), tagId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .delete(chatTags)
        .where(
          and(eq(chatTags.chatId, input.chatId), eq(chatTags.tagId, input.tagId)),
        )
        .run()
    }),

  /** Set all tags for a chat (replace existing) */
  setChatTags: publicProcedure
    .input(z.object({ chatId: z.string(), tagIds: z.array(z.string()) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      // Delete existing
      db.delete(chatTags).where(eq(chatTags.chatId, input.chatId)).run()
      // Insert new
      if (input.tagIds.length > 0) {
        for (const tagId of input.tagIds) {
          db.insert(chatTags)
            .values({ chatId: input.chatId, tagId })
            .run()
        }
      }
      return { success: true }
    }),

  // ========== SubChat Tag Associations ==========

  /** Get tags for a single subChat */
  getSubChatTags: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db
        .select({ tag: workspaceTags })
        .from(subChatTags)
        .innerJoin(workspaceTags, eq(subChatTags.tagId, workspaceTags.id))
        .where(eq(subChatTags.subChatId, input.subChatId))
        .all()
        .map((r) => r.tag)
    }),

  /** Batch get tags for multiple subChats */
  getSubChatTagsBatch: publicProcedure
    .input(z.object({ subChatIds: z.array(z.string()) }))
    .query(({ input }) => {
      const db = getDatabase()
      if (input.subChatIds.length === 0) return {}

      const results = db
        .select({
          subChatId: subChatTags.subChatId,
          tag: workspaceTags,
        })
        .from(subChatTags)
        .innerJoin(workspaceTags, eq(subChatTags.tagId, workspaceTags.id))
        .where(inArray(subChatTags.subChatId, input.subChatIds))
        .all()

      const map: Record<string, typeof workspaceTags.$inferSelect[]> = {}
      for (const r of results) {
        if (!map[r.subChatId]) map[r.subChatId] = []
        map[r.subChatId].push(r.tag)
      }
      return map
    }),

  /** Add a tag to a subChat */
  addTagToSubChat: publicProcedure
    .input(z.object({ subChatId: z.string(), tagId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      try {
        return db
          .insert(subChatTags)
          .values({
            subChatId: input.subChatId,
            tagId: input.tagId,
          })
          .returning()
          .get()
      } catch (e) {
        const error = e as Error
        if (error.message?.includes("UNIQUE constraint failed")) {
          return null
        }
        throw e
      }
    }),

  /** Remove a tag from a subChat */
  removeTagFromSubChat: publicProcedure
    .input(z.object({ subChatId: z.string(), tagId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .delete(subChatTags)
        .where(
          and(
            eq(subChatTags.subChatId, input.subChatId),
            eq(subChatTags.tagId, input.tagId),
          ),
        )
        .run()
    }),

  // ========== Preset Colors ==========

  /** Get preset colors */
  getPresetColors: publicProcedure.query(() => PRESET_COLORS),
})
