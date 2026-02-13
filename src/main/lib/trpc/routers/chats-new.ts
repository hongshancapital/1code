/**
 * Chat CRUD Router
 * Handles chat-level operations (create, read, update, delete, archive)
 */

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm"
import { mkdir, rm, rename } from "fs/promises"
import { existsSync } from "fs"
import { app } from "electron"
import { dirname, join } from "path"
import { z } from "zod"
import { chats, getDatabase, projects, subChats } from "../../db"
import { createId } from "../../db/utils"
import { PLAYGROUND_RELATIVE_PATH } from "../../../../shared/feature-config"
import {
  createWorktreeForChat,
  isValidBranchName,
  renameBranch,
  removeWorktree,
  sanitizeBranchNameForFolder,
  sanitizeProjectName,
} from "../../git"
import { gitCache } from "../../git/cache"
import { withGitLock } from "../../git/git-factory"
import { gitWatcherRegistry } from "../../git/watcher/git-watcher"
import { terminalManager } from "../../terminal/manager"
import { publicProcedure, router } from "../index"
import { subChatsRouter } from "./sub-chats"
import { chatStatsRouter } from "./chat-stats"
import { chatGitRouter } from "./chat-git"
import { chatExportRouter } from "./chat-export"

// Core Chat CRUD router
const chatsCoreRouter = router({
  /**
   * List all non-archived chats (optionally filter by project)
   * By default excludes playground chats - use includePlayground: true to include them
   */
  list: publicProcedure
    .input(z.object({
      projectId: z.string().optional(),
      includePlayground: z.boolean().default(false),
    }).optional())
    .query(({ input }) => {
      const db = getDatabase()

      // Get all chats with their project info
      const allChats = db
        .select({
          chat: chats,
          isPlayground: projects.isPlayground,
        })
        .from(chats)
        .leftJoin(projects, eq(chats.projectId, projects.id))
        .where(isNull(chats.archivedAt))
        .orderBy(desc(chats.updatedAt))
        .all()

      // Filter by projectId if specified
      let filtered = allChats
      if (input?.projectId) {
        filtered = filtered.filter((r) => r.chat.projectId === input.projectId)
      }

      // Exclude playground chats unless explicitly requested
      if (!input?.includePlayground) {
        filtered = filtered.filter((r) => !r.isPlayground)
      }

      return filtered.map((r) => r.chat)
    }),

  /**
   * @deprecated Use listPlaygroundChats instead.
   * This API is kept for backward compatibility during migration.
   *
   * List only playground (chat mode) sub-chats
   * Returns sub-chats from the single playground chat
   */
  listPlayground: publicProcedure.query(() => {
    const db = getDatabase()

    // Get playground project first
    const playground = db
      .select()
      .from(projects)
      .where(eq(projects.isPlayground, true))
      .get()

    if (!playground) {
      return []
    }

    // Get the single playground chat
    const playgroundChat = db
      .select()
      .from(chats)
      .where(and(
        eq(chats.projectId, playground.id),
        isNull(chats.archivedAt),
      ))
      .get()

    if (!playgroundChat) {
      return []
    }

    // Return sub-chats from the playground chat
    return db
      .select()
      .from(subChats)
      .where(eq(subChats.chatId, playgroundChat.id))
      .orderBy(desc(subChats.updatedAt))
      .all()
  }),

  /**
   * @deprecated Use createPlaygroundChat instead.
   * This API is kept for backward compatibility during migration.
   *
   * Get or create the single playground chat for chat mode
   * All chat mode conversations are sub-chats under this single chat
   */
  getOrCreatePlaygroundChat: publicProcedure.mutation(async () => {
    const db = getDatabase()

    // Get playground project first
    const playground = db
      .select()
      .from(projects)
      .where(eq(projects.isPlayground, true))
      .get()

    if (!playground) {
      throw new Error("Playground project not found. Create it first with projects.getOrCreatePlayground")
    }

    // Check if playground chat already exists
    const existingChat = db
      .select()
      .from(chats)
      .where(and(
        eq(chats.projectId, playground.id),
        isNull(chats.archivedAt),
      ))
      .get()

    if (existingChat) {
      return existingChat
    }

    // Create the single playground chat
    const playgroundChat = db
      .insert(chats)
      .values({
        name: "Chat Playground",
        projectId: playground.id,
        worktreePath: playground.path,
      })
      .returning()
      .get()

    return playgroundChat
  }),

  /**
   * Create a new independent playground chat.
   * Each chat gets its own directory in ~/.hong/.playground/{id}/
   * This allows users to start chatting immediately without specifying a folder.
   */
  createPlaygroundChat: publicProcedure
    .input(z.object({
      name: z.string().optional(),
      initialMessage: z.string().optional(),
      initialMessageParts: z
        .array(
          z.union([
            z.object({ type: z.literal("text"), text: z.string() }),
            z.object({
              type: z.literal("data-image"),
              data: z.object({
                url: z.string(),
                mediaType: z.string().optional(),
                filename: z.string().optional(),
                base64Data: z.string().optional(),
              }),
            }),
            z.object({
              type: z.literal("file-content"),
              filePath: z.string(),
              content: z.string(),
            }),
          ]),
        )
        .optional(),
      mode: z.enum(["plan", "agent"]).default("agent"),
    }).optional())
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const homePath = app.getPath("home")
      const playgroundRoot = join(homePath, PLAYGROUND_RELATIVE_PATH)

      // Generate unique ID for this playground
      const playgroundId = createId()
      const playgroundPath = join(playgroundRoot, playgroundId)

      // Create playground directory
      await mkdir(playgroundPath, { recursive: true })

      // Create playground project
      const playgroundProject = db
        .insert(projects)
        .values({
          name: input?.name || "New Chat",
          path: playgroundPath,
          mode: "cowork", // Use cowork mode for full read/write capability
          isPlayground: true,
        })
        .returning()
        .get()

      // Create chat linked to the playground project
      const chat = db
        .insert(chats)
        .values({
          name: input?.name,
          projectId: playgroundProject.id,
          worktreePath: playgroundPath,
        })
        .returning()
        .get()

      // Create initial sub-chat with user message (if provided)
      let initialMessages = "[]"

      if (input?.initialMessageParts && input.initialMessageParts.length > 0) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: input.initialMessageParts,
          },
        ])
      } else if (input?.initialMessage) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: [{ type: "text", text: input.initialMessage }],
          },
        ])
      }

      const subChat = db
        .insert(subChats)
        .values({
          chatId: chat.id,
          mode: input?.mode || "agent",
          messages: initialMessages,
        })
        .returning()
        .get()

      return {
        ...chat,
        project: playgroundProject,
        subChats: [subChat],
      }
    }),

  /**
   * List all playground chats (chats with isPlayground=true projects)
   * Returns chats with their associated project info
   */
  listPlaygroundChats: publicProcedure.query(() => {
    const db = getDatabase()

    // Get all chats that belong to playground projects
    const playgroundChats = db
      .select({
        chat: chats,
        project: projects,
      })
      .from(chats)
      .innerJoin(projects, eq(chats.projectId, projects.id))
      .where(and(
        eq(projects.isPlayground, true),
        isNull(chats.archivedAt),
      ))
      .orderBy(desc(chats.updatedAt))
      .all()

    return playgroundChats.map(({ chat, project }) => ({
      ...chat,
      project,
    }))
  }),

  /**
   * Delete a playground chat and its associated project/directory
   * This is a complete cleanup that removes:
   * - The chat record
   * - The project record
   * - The playground directory
   */
  deletePlaygroundChat: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get chat and project info
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat) {
        throw new Error("Chat not found")
      }

      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, chat.projectId))
        .get()

      if (!project?.isPlayground) {
        throw new Error("This is not a playground chat. Use regular delete.")
      }

      // Delete the playground directory
      if (existsSync(project.path)) {
        await rm(project.path, { recursive: true, force: true })
      }

      // Delete project (will cascade to chat due to foreign key)
      db.delete(projects).where(eq(projects.id, project.id)).run()

      return { success: true }
    }),

  /**
   * Migrate old-format playground sub-chats to new independent format.
   *
   * Old format: Single ~/.hong/.playground/ directory with one chat containing multiple sub-chats
   * New format: Each chat has its own directory ~/.hong/.playground/{id}/
   *
   * This migration:
   * 1. Finds the old playground project (path ends with .playground without sub-ID)
   * 2. Gets all sub-chats with non-empty messages
   * 3. Creates new independent playground chats for each
   * 4. Deletes the old playground project and associated data
   */
  migrateOldPlaygroundSubChats: publicProcedure.mutation(async () => {
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
        .all()

      for (const oldSubChat of oldSubChats) {
        // Skip empty sub-chats
        const messages = JSON.parse(oldSubChat.messages || "[]")
        if (messages.length === 0) {
          skipped++
          continue
        }

        // Create new independent playground directory
        const newPlaygroundId = createId()
        const newPlaygroundPath = join(playgroundRoot, newPlaygroundId)
        await mkdir(newPlaygroundPath, { recursive: true })

        // Create new playground project
        const newProject = db
          .insert(projects)
          .values({
            name: oldSubChat.name || oldChat.name || "Migrated Chat",
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
            name: oldSubChat.name || oldChat.name,
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

    return { migrated, skipped }
  }),

  /**
   * List archived chats (optionally filter by project)
   */
  listArchived: publicProcedure
    .input(z.object({ projectId: z.string().optional() }))
    .query(({ input }) => {
      const db = getDatabase()
      const conditions = [isNotNull(chats.archivedAt)]
      if (input.projectId) {
        conditions.push(eq(chats.projectId, input.projectId))
      }
      return db
        .select()
        .from(chats)
        .where(and(...conditions))
        .orderBy(desc(chats.archivedAt))
        .all()
    }),

  /**
   * Get a single chat with all sub-chats
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()
      if (!chat) return null

      // Only select metadata, not messages (lazy loading for performance)
      const chatSubChats = db
        .select({
          id: subChats.id,
          name: subChats.name,
          chatId: subChats.chatId,
          sessionId: subChats.sessionId,
          streamId: subChats.streamId,
          mode: subChats.mode,
          createdAt: subChats.createdAt,
          updatedAt: subChats.updatedAt,
          manuallyRenamed: subChats.manuallyRenamed,
        })
        .from(subChats)
        .where(eq(subChats.chatId, input.id))
        .orderBy(subChats.createdAt)
        .all()

      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, chat.projectId))
        .get()

      return { ...chat, subChats: chatSubChats, project }
    }),

  /**
   * Create a new chat with optional git worktree
   */
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().optional(),
        initialMessage: z.string().optional(),
        initialMessageParts: z
          .array(
            z.union([
              z.object({ type: z.literal("text"), text: z.string() }),
              z.object({
                type: z.literal("data-image"),
                data: z.object({
                  url: z.string(),
                  mediaType: z.string().optional(),
                  filename: z.string().optional(),
                  base64Data: z.string().optional(),
                }),
              }),
              // Hidden file content - sent to agent but not displayed in UI
              z.object({
                type: z.literal("file-content"),
                filePath: z.string(),
                content: z.string(),
              }),
            ]),
          )
          .optional(),
        baseBranch: z.string().optional(), // Branch to base the worktree off
        branchType: z.enum(["local", "remote"]).optional(), // Whether baseBranch is local or remote
        useWorktree: z.boolean().default(true), // If false, work directly in project dir
        mode: z.enum(["plan", "agent"]).default("agent"),
        customBranchName: z.string().optional(), // Custom branch name for worktree (optional)
      }),
    )
    .mutation(async ({ input }) => {
      console.log("[chats.create] called with:", input)
      const db = getDatabase()

      // Get project path
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .get()
      console.log("[chats.create] found project:", project)
      if (!project) throw new Error("Project not found")

      // Create chat (fast path)
      const chat = db
        .insert(chats)
        .values({ name: input.name, projectId: input.projectId })
        .returning()
        .get()
      console.log("[chats.create] created chat:", chat)

      // Create initial sub-chat with user message (AI SDK format)
      // If initialMessageParts is provided, use it; otherwise fallback to text-only message
      let initialMessages = "[]"

      if (input.initialMessageParts && input.initialMessageParts.length > 0) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: input.initialMessageParts,
          },
        ])
      } else if (input.initialMessage) {
        initialMessages = JSON.stringify([
          {
            id: `msg-${Date.now()}`,
            role: "user",
            parts: [{ type: "text", text: input.initialMessage }],
          },
        ])
      }

      const subChat = db
        .insert(subChats)
        .values({
          chatId: chat.id,
          mode: input.mode,
          messages: initialMessages,
        })
        .returning()
        .get()
      console.log("[chats.create] created subChat:", subChat)

      // Worktree creation result (will be set if useWorktree is true)
      let worktreeResult: {
        worktreePath?: string
        branch?: string
        baseBranch?: string
      } = {}

      // Only create worktree if useWorktree is true
      if (input.useWorktree) {
        console.log(
          "[chats.create] creating worktree with baseBranch:",
          input.baseBranch,
          "type:",
          input.branchType,
          "customBranchName:",
          input.customBranchName,
        )
        const result = await createWorktreeForChat(
          project.path,
          sanitizeProjectName(project.name),
          chat.id,
          input.baseBranch,
          input.branchType,
          input.customBranchName,
        )
        console.log("[chats.create] worktree result:", result)

        if (result.success && result.worktreePath) {
          db.update(chats)
            .set({
              worktreePath: result.worktreePath,
              branch: result.branch,
              baseBranch: result.baseBranch,
            })
            .where(eq(chats.id, chat.id))
            .run()
          worktreeResult = {
            worktreePath: result.worktreePath,
            branch: result.branch,
            baseBranch: result.baseBranch,
          }
        } else {
          console.warn(`[Worktree] Failed: ${result.error}`)
          // Fallback to project path
          db.update(chats)
            .set({ worktreePath: project.path })
            .where(eq(chats.id, chat.id))
            .run()
          worktreeResult = { worktreePath: project.path }
        }
      } else {
        // Local mode: use project path directly, no branch info
        console.log("[chats.create] local mode - using project path directly")
        db.update(chats)
          .set({ worktreePath: project.path })
          .where(eq(chats.id, chat.id))
          .run()
        worktreeResult = { worktreePath: project.path }
      }

      const response = {
        ...chat,
        worktreePath: worktreeResult.worktreePath || project.path,
        branch: worktreeResult.branch,
        baseBranch: worktreeResult.baseBranch,
        subChats: [subChat],
      }

      console.log("[chats.create] returning:", response)
      return response
    }),

  /**
   * Rename a chat
   * Set manuallyRenamed to true when user manually renames
   */
  rename: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1),
      skipManuallyRenamed: z.boolean().optional(), // For internal/auto-rename usage
    }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(chats)
        .set({
          name: input.name,
          updatedAt: new Date(),
          // Only set manuallyRenamed if not explicitly skipped (for auto-rename)
          ...(!input.skipManuallyRenamed && { manuallyRenamed: true }),
        })
        .where(eq(chats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Set the tag for a chat (preset tag ID like "red", "blue", etc.)
   */
  setTag: publicProcedure
    .input(z.object({ id: z.string(), tagId: z.string().nullable() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(chats)
        .set({ tagId: input.tagId, updatedAt: new Date() })
        .where(eq(chats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Rename the git branch for a coding-mode chat.
   * Validates the new name, runs `git branch -m`, and updates the DB.
   */
  renameBranch: publicProcedure
    .input(z.object({
      chatId: z.string(),
      newBranchName: z.string().min(1).max(200),
    }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()
      if (!chat) throw new Error("Chat not found")
      if (!chat.worktreePath || !chat.branch) {
        throw new Error("Chat has no worktree or branch")
      }

      const trimmedName = input.newBranchName.trim()
      if (chat.branch === trimmedName) {
        return chat // no-op
      }

      const validation = isValidBranchName(trimmedName)
      if (!validation.valid) {
        throw new Error(`Invalid branch name: ${validation.error}`)
      }

      const result = await withGitLock(chat.worktreePath, async () => {
        return renameBranch(chat.worktreePath!, chat.branch!, trimmedName)
      })

      if (!result.success) {
        throw new Error(`Failed to rename branch: ${result.error}`)
      }

      const updated = db
        .update(chats)
        .set({ branch: trimmedName, updatedAt: new Date() })
        .where(eq(chats.id, input.chatId))
        .returning()
        .get()

      gitCache.invalidateStatus(chat.worktreePath)
      gitCache.invalidateParsedDiff(chat.worktreePath)

      return updated
    }),

  /**
   * Rename / move the worktree directory for a coding-mode chat.
   * Stops watchers & terminals first, moves the directory, then updates DB.
   * Uses fs.rename first; falls back to copy-verify-delete on EBUSY/EPERM.
   */
  moveWorktree: publicProcedure
    .input(z.object({
      chatId: z.string(),
      newFolderName: z.string().min(1).max(100),
    }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()
      if (!chat) throw new Error("Chat not found")
      if (!chat.worktreePath) throw new Error("Chat has no worktree path")

      const sanitized = sanitizeBranchNameForFolder(input.newFolderName)
      if (!sanitized) throw new Error("Invalid folder name")

      const parentDir = join(chat.worktreePath, "..")
      const newWorktreePath = join(parentDir, sanitized)

      if (newWorktreePath === chat.worktreePath) {
        return chat // no-op
      }

      if (existsSync(newWorktreePath)) {
        throw new Error("A directory with this name already exists")
      }

      // --- Pre-cleanup: stop watchers & terminals (best-effort) ---
      await gitWatcherRegistry.dispose(chat.worktreePath).catch((err: unknown) => {
        console.warn(`[moveWorktree] Failed to dispose watcher: ${err}`)
      })
      await terminalManager.killByWorkspaceId(input.chatId).catch((err: unknown) => {
        console.warn(`[moveWorktree] Failed to kill terminals: ${err}`)
      })

      // --- Move directory ---
      const { rename: fsRename } = await import("fs/promises")
      const { cp, rm: fsRm } = await import("fs/promises")

      let moved = false
      // Strategy 1: fast fs.rename (same filesystem)
      try {
        await fsRename(chat.worktreePath, newWorktreePath)
        moved = true
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if (code !== "EXDEV" && code !== "EBUSY" && code !== "EPERM") {
          // Unrecoverable — restore watcher and rethrow
          await gitWatcherRegistry.getOrCreate(chat.worktreePath).catch(() => {})
          throw new Error(`Failed to move directory: ${(err as Error).message}`)
        }
      }

      // Strategy 2: copy → verify → delete-old
      if (!moved) {
        try {
          await cp(chat.worktreePath, newWorktreePath, { recursive: true, force: true })
        } catch (copyErr) {
          // Clean partial copy, restore watcher
          await fsRm(newWorktreePath, { recursive: true, force: true }).catch(() => {})
          await gitWatcherRegistry.getOrCreate(chat.worktreePath).catch(() => {})
          throw new Error(
            `Copy failed: ${(copyErr as Error).message}. Original directory unchanged.`
          )
        }

        // Verify the copy has a valid .git reference
        const gitRef = join(newWorktreePath, ".git")
        if (!existsSync(gitRef)) {
          await fsRm(newWorktreePath, { recursive: true, force: true }).catch(() => {})
          await gitWatcherRegistry.getOrCreate(chat.worktreePath).catch(() => {})
          throw new Error("Copy verification failed. Original directory unchanged.")
        }

        // Delete old directory (best-effort — failure is non-fatal)
        await fsRm(chat.worktreePath, { recursive: true, force: true }).catch((delErr) => {
          console.warn(
            `[moveWorktree] Old directory not removed: ${(delErr as Error).message}. ` +
            `You may delete it manually: ${chat.worktreePath}`
          )
        })
      }

      // --- Update DB ---
      const updated = db
        .update(chats)
        .set({ worktreePath: newWorktreePath, updatedAt: new Date() })
        .where(eq(chats.id, input.chatId))
        .returning()
        .get()

      // --- Migrate SDK Session Files ---
      // Session files live at: {userData}/claude-sessions/{subChatId}/projects/{sanitized_cwd}/
      // We need to move them so SDK can continue to resume sessions with the new CWD
      const userDataPath = app.getPath("userData")
      const sanitize = (p: string) => p.replace(/[/.]/g, "-")
      const oldSanitized = sanitize(chat.worktreePath)
      const newSanitized = sanitize(newWorktreePath)

      const chatSubChats = db
        .select({ id: subChats.id })
        .from(subChats)
        .where(eq(subChats.chatId, input.chatId))
        .all()

      for (const sc of chatSubChats) {
        const oldDir = join(userDataPath, "claude-sessions", sc.id, "projects", oldSanitized)
        const newDir = join(userDataPath, "claude-sessions", sc.id, "projects", newSanitized)
        try {
          if (existsSync(oldDir) && !existsSync(newDir)) {
            await mkdir(dirname(newDir), { recursive: true })
            await rename(oldDir, newDir)
            console.log(`[moveWorktree] Session dir moved: ${oldSanitized} → ${newSanitized}`)
          }
        } catch (err) {
          console.warn(`[moveWorktree] Failed to move session dir for ${sc.id}:`, err)
          // Non-fatal: conversation will start fresh if session file is missing
        }
      }

      console.log(`[moveWorktree] Moved worktree for chat ${input.chatId} to ${newWorktreePath}`)

      // --- Invalidate caches for old path ---
      gitCache.invalidateStatus(chat.worktreePath)
      gitCache.invalidateParsedDiff(chat.worktreePath)

      return updated
    }),

  /**
   * Archive a chat (also kills any terminal processes in the workspace)
   * Optionally deletes the worktree to free disk space
   */
  archive: publicProcedure
    .input(
      z.object({
        id: z.string(),
        deleteWorktree: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get chat to check for worktree (before archiving)
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.id))
        .get()

      // Archive immediately (optimistic)
      const result = db
        .update(chats)
        .set({ archivedAt: new Date() })
        .where(eq(chats.id, input.id))
        .returning()
        .get()

      // Kill terminal processes in background (don't await)
      terminalManager.killByWorkspaceId(input.id).then((killResult) => {
        if (killResult.killed > 0) {
          console.log(
            `[chats.archive] Killed ${killResult.killed} terminal session(s) for workspace ${input.id}`,
          )
        }
      }).catch((error) => {
        console.error(`[chats.archive] Error killing processes:`, error)
      })

      // Optionally delete worktree in background (don't await)
      if (input.deleteWorktree && chat?.worktreePath && chat?.branch) {
        const project = db
          .select()
          .from(projects)
          .where(eq(projects.id, chat.projectId))
          .get()

        if (project) {
          removeWorktree(project.path, chat.worktreePath).then((worktreeResult) => {
            if (worktreeResult.success) {
              console.log(
                `[chats.archive] Deleted worktree for workspace ${input.id}`,
              )
              // Clear worktreePath since it's deleted (keep branch for reference)
              db.update(chats)
                .set({ worktreePath: null })
                .where(eq(chats.id, input.id))
                .run()
            } else {
              console.warn(
                `[chats.archive] Failed to delete worktree: ${worktreeResult.error}`,
              )
            }
          }).catch((error) => {
            console.error(`[chats.archive] Error removing worktree:`, error)
          })
        }
      }

      // Invalidate git cache for this worktree
      if (chat?.worktreePath) {
        gitCache.invalidateStatus(chat.worktreePath)
        gitCache.invalidateParsedDiff(chat.worktreePath)
      }

      return result
    }),

  /**
   * Restore an archived chat
   */
  restore: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(chats)
        .set({ archivedAt: null })
        .where(eq(chats.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Archive multiple chats at once (also kills terminal processes in each workspace)
   */
  archiveBatch: publicProcedure
    .input(z.object({ chatIds: z.array(z.string()) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      if (input.chatIds.length === 0) return []

      // Archive immediately (optimistic)
      const result = db
        .update(chats)
        .set({ archivedAt: new Date() })
        .where(inArray(chats.id, input.chatIds))
        .returning()
        .all()

      // Kill terminal processes for all workspaces in background (don't await)
      Promise.all(
        input.chatIds.map((id) => terminalManager.killByWorkspaceId(id)),
      ).then((killResults) => {
        const totalKilled = killResults.reduce((sum, r) => sum + r.killed, 0)
        if (totalKilled > 0) {
          console.log(
            `[chats.archiveBatch] Killed ${totalKilled} terminal session(s) for ${input.chatIds.length} workspace(s)`,
          )
        }
      }).catch((error) => {
        console.error(`[chats.archiveBatch] Error killing processes:`, error)
      })

      return result
    }),

  /**
   * Delete a chat permanently (with worktree cleanup)
   */
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get chat before deletion
      const chat = db.select().from(chats).where(eq(chats.id, input.id)).get()

      // Cleanup worktree if it was created (has branch = was a real worktree, not just project path)
      if (chat?.worktreePath && chat?.branch) {
        const project = db
          .select()
          .from(projects)
          .where(eq(projects.id, chat.projectId))
          .get()
        if (project) {
          const result = await removeWorktree(project.path, chat.worktreePath)
          if (!result.success) {
            console.warn(`[Worktree] Cleanup failed: ${result.error}`)
          }
        }
      }

      // Invalidate git cache for this worktree
      if (chat?.worktreePath) {
        gitCache.invalidateStatus(chat.worktreePath)
        gitCache.invalidateParsedDiff(chat.worktreePath)
      }

      return db.delete(chats).where(eq(chats.id, input.id)).returning().get()
    }),
})

/**
 * Merged chatsRouter for backward compatibility
 * Combines chatsCoreRouter with sub-routers to maintain the same API surface
 * Frontend can continue using trpc.chats.* for all procedures
 */
export const chatsRouter = router({
  ...chatsCoreRouter._def.procedures,
  ...subChatsRouter._def.procedures,
  ...chatStatsRouter._def.procedures,
  ...chatGitRouter._def.procedures,
  ...chatExportRouter._def.procedures,
})
