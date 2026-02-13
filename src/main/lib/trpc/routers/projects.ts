import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, projects, chats, subChats } from "../../db"
import { eq, desc, and, isNull } from "drizzle-orm"
import { dialog, BrowserWindow, app } from "electron"
import { basename, join, dirname } from "path"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { existsSync } from "node:fs"
import { mkdir, copyFile, unlink, rename, readdir, rm, stat } from "node:fs/promises"
import { extname } from "node:path"
import { getGitRemoteInfo, isGitRepo } from "../../git"
import { INBOX_PROJECT_ID } from "../../automation/inbox-project"
import { getLaunchDirectory } from "../../cli"
import { PLAYGROUND_RELATIVE_PATH, PLAYGROUND_PROJECT_NAME } from "../../../../shared/feature-config"
import { createId } from "../../db/utils"

const execAsync = promisify(exec)

// Get the playground directory path
export function getPlaygroundPath(): string {
  const homePath = app.getPath("home")
  return join(homePath, PLAYGROUND_RELATIVE_PATH)
}

export const projectsRouter = router({
  /**
   * Get launch directory from CLI args (consumed once)
   * Based on PR #16 by @caffeinum
   */
  getLaunchDirectory: publicProcedure.query(() => {
    return getLaunchDirectory()
  }),

  /**
   * List all projects (excludes playground project by default)
   */
  list: publicProcedure
    .input(z.object({ includePlayground: z.boolean().default(false) }).optional())
    .query(({ input }) => {
      const db = getDatabase()
      const all = db.select().from(projects).orderBy(desc(projects.updatedAt)).all()

      return all.filter((p) => {
        // Always exclude inbox special project
        if (p.id === INBOX_PROJECT_ID) return false
        // Exclude playground unless requested
        if (p.isPlayground && !input?.includePlayground) return false
        // For non-playground projects, check path exists
        if (!p.isPlayground && !existsSync(p.path)) {
          // Clean up stale project from DB
          db.delete(projects).where(eq(projects.id, p.id)).run()
          return false
        }
        return true
      })
    }),

  /**
   * @deprecated Use chats.createPlaygroundChat instead.
   * This API is kept for backward compatibility during migration.
   * It will be removed in a future version.
   *
   * Get or create the playground project for chat mode
   * Playground runs in {User}/.hong/.playground
   */
  getOrCreatePlayground: publicProcedure.mutation(async () => {
    const db = getDatabase()
    const playgroundPath = getPlaygroundPath()

    // Check if playground project already exists
    const existing = db
      .select()
      .from(projects)
      .where(eq(projects.isPlayground, true))
      .get()

    if (existing) {
      // Ensure directory exists
      if (!existsSync(playgroundPath)) {
        await mkdir(playgroundPath, { recursive: true })
      }
      return existing
    }

    // Create playground directory
    await mkdir(playgroundPath, { recursive: true })

    // Create playground project
    const playground = db
      .insert(projects)
      .values({
        name: PLAYGROUND_PROJECT_NAME,
        path: playgroundPath,
        mode: "chat",
        isPlayground: true,
      })
      .returning()
      .get()

    return playground
  }),

  /**
   * Get the playground project (if exists)
   */
  getPlayground: publicProcedure.query(() => {
    const db = getDatabase()
    return db
      .select()
      .from(projects)
      .where(eq(projects.isPlayground, true))
      .get() ?? null
  }),

  /**
   * Get a single project by ID
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()
      return db.select().from(projects).where(eq(projects.id, input.id)).get()
    }),

  /**
   * Open folder picker and create project
   * Mode is auto-detected: "coding" if folder has .git, "cowork" otherwise
   */
  openFolder: publicProcedure
    .mutation(async ({ ctx }) => {
    const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

    if (!window) {
      console.error("[Projects] No window available for folder dialog")
      return null
    }

    // Ensure window is focused before showing dialog (fixes first-launch timing issue on macOS)
    if (!window.isFocused()) {
      console.log("[Projects] Window not focused, focusing before dialog...")
      window.focus()
      // Small delay to ensure focus is applied by the OS
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select Project Folder",
      buttonLabel: "Open Project",
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folderPath = result.filePaths[0]!
    const folderName = basename(folderPath)

    // Check if folder is a git repo and get remote info
    const hasGit = await isGitRepo(folderPath)
    const gitInfo = await getGitRemoteInfo(folderPath)

    // Auto-detect mode: "coding" if has git, "cowork" otherwise
    const mode = hasGit ? "coding" : "cowork"

    const db = getDatabase()

    // Check if project already exists
    const existing = db
      .select()
      .from(projects)
      .where(eq(projects.path, folderPath))
      .get()

    if (existing) {
      // Update the updatedAt timestamp, git info, and mode based on current git status
      const updatedProject = db
        .update(projects)
        .set({
          updatedAt: new Date(),
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
          mode, // Update mode based on current git status
        })
        .where(eq(projects.id, existing.id))
        .returning()
        .get()

      return updatedProject
    }

    // Create new project with git info
    const newProject = db
      .insert(projects)
      .values({
        name: folderName,
        path: folderPath,
        gitRemoteUrl: gitInfo.remoteUrl,
        gitProvider: gitInfo.provider,
        gitOwner: gitInfo.owner,
        gitRepo: gitInfo.repo,
        mode,
      })
      .returning()
      .get()

    return newProject
  }),

  /**
   * Create a project from a known path
   * Mode is auto-detected if not specified: "coding" if folder has .git, "cowork" otherwise
   */
  create: publicProcedure
    .input(z.object({
      path: z.string(),
      name: z.string().optional(),
      mode: z.enum(["chat", "cowork", "coding"]).optional(),
      isPlayground: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const name = input.name || basename(input.path)

      // Check if project already exists
      const existing = db
        .select()
        .from(projects)
        .where(eq(projects.path, input.path))
        .get()

      if (existing) {
        return existing
      }

      // Check if folder is a git repo and get remote info (skip for chat mode)
      const hasGit = input.mode !== "chat" && await isGitRepo(input.path)
      const gitInfo = input.mode !== "chat" ? await getGitRemoteInfo(input.path) : { remoteUrl: null, provider: null, owner: null, repo: null }

      // Use provided mode or auto-detect based on git status
      const mode = input.mode ?? (hasGit ? "coding" : "cowork")

      return db
        .insert(projects)
        .values({
          name,
          path: input.path,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
          mode,
          isPlayground: input.isPlayground ?? false,
        })
        .returning()
        .get()
    }),

  /**
   * Rename a project
   */
  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(projects)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Delete a project and all its chats
   */
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .delete(projects)
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Refresh git info for a project (in case remote changed)
   */
  refreshGitInfo: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get project
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id))
        .get()

      if (!project) {
        return null
      }

      // Get fresh git info
      const gitInfo = await getGitRemoteInfo(project.path)

      // Update project
      return db
        .update(projects)
        .set({
          updatedAt: new Date(),
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Clone a GitHub repo and create a project
   */
  cloneFromGitHub: publicProcedure
    .input(z.object({ repoUrl: z.string() }))
    .mutation(async ({ input }) => {
      const { repoUrl } = input

      // Parse the URL to extract owner/repo
      let owner: string | null = null
      let repo: string | null = null

      // Match HTTPS format: https://github.com/owner/repo
      const httpsMatch = repoUrl.match(
        /https?:\/\/github\.com\/([^/]+)\/([^/]+)/,
      )
      if (httpsMatch) {
        owner = httpsMatch[1] || null
        repo = httpsMatch[2]?.replace(/\.git$/, "") || null
      }

      // Match SSH format: git@github.com:owner/repo
      const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/(.+)/)
      if (sshMatch) {
        owner = sshMatch[1] || null
        repo = sshMatch[2]?.replace(/\.git$/, "") || null
      }

      // Match short format: owner/repo
      const shortMatch = repoUrl.match(/^([^/]+)\/([^/]+)$/)
      if (shortMatch) {
        owner = shortMatch[1] || null
        repo = shortMatch[2]?.replace(/\.git$/, "") || null
      }

      if (!owner || !repo) {
        throw new Error("Invalid GitHub URL or repo format")
      }

      // Clone to ~/.hong/repos/{owner}/{repo}
      const homePath = app.getPath("home")
      const reposDir = join(homePath, ".hong", "repos", owner)
      const clonePath = join(reposDir, repo)

      // Check if already cloned
      if (existsSync(clonePath)) {
        // Project might already exist in DB
        const db = getDatabase()
        const existing = db
          .select()
          .from(projects)
          .where(eq(projects.path, clonePath))
          .get()

        if (existing) {
          return existing
        }

        // Create project for existing clone (always coding mode for GitHub clones)
        const gitInfo = await getGitRemoteInfo(clonePath)
        const newProject = db
          .insert(projects)
          .values({
            name: repo,
            path: clonePath,
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
            mode: "coding",
          })
          .returning()
          .get()

        return newProject
      }

      // Create repos directory
      await mkdir(reposDir, { recursive: true })

      // Clone the repo
      const cloneUrl = `https://github.com/${owner}/${repo}.git`
      await execAsync(`git clone "${cloneUrl}" "${clonePath}"`)

      // Get git info and create project (always coding mode for GitHub clones)
      const db = getDatabase()
      const gitInfo = await getGitRemoteInfo(clonePath)

      const newProject = db
        .insert(projects)
        .values({
          name: repo,
          path: clonePath,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
          mode: "coding",
        })
        .returning()
        .get()

      return newProject
    }),

  /**
   * Update project mode
   * @param mode - Project mode: "chat" (playground) | "cowork" (simplified) | "coding" (full git features)
   * Note: Playground projects cannot change mode
   */
  updateMode: publicProcedure
    .input(z.object({
      id: z.string(),
      mode: z.enum(["chat", "cowork", "coding"]),
    }))
    .mutation(({ input }) => {
      const db = getDatabase()

      // Don't allow changing mode of playground project
      const project = db.select().from(projects).where(eq(projects.id, input.id)).get()
      if (project?.isPlayground) {
        return project
      }

      return db
        .update(projects)
        .set({ mode: input.mode, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Update project feature configuration
   * Controls which widgets and tools are enabled for this project
   */
  updateFeatureConfig: publicProcedure
    .input(z.object({
      id: z.string(),
      featureConfig: z.string().nullable(),
    }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(projects)
        .set({ featureConfig: input.featureConfig, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Refresh project mode based on current git status
   * Auto-detects: "coding" if folder has .git, "cowork" otherwise
   */
  refreshMode: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get project
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id))
        .get()

      if (!project) {
        return null
      }

      // Check if folder is a git repo
      const hasGit = await isGitRepo(project.path)
      const mode = hasGit ? "coding" : "cowork"

      // Get fresh git info
      const gitInfo = await getGitRemoteInfo(project.path)

      // Update project with new mode and git info
      const updatedProject = db
        .update(projects)
        .set({
          updatedAt: new Date(),
          mode,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .where(eq(projects.id, input.id))
        .returning()
        .get()

      return updatedProject
    }),

  /**
   * Open folder picker to locate an existing clone of a specific repo
   * Validates that the selected folder matches the expected owner/repo
   */
  locateAndAddProject: publicProcedure
    .input(
      z.object({
        expectedOwner: z.string(),
        expectedRepo: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

      if (!window) {
        return { success: false as const, reason: "no-window" as const }
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: `Locate ${input.expectedOwner}/${input.expectedRepo}`,
        buttonLabel: "Select",
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: "canceled" as const }
      }

      const folderPath = result.filePaths[0]
      const gitInfo = await getGitRemoteInfo(folderPath)

      // Validate it's the correct repo
      if (
        gitInfo.owner !== input.expectedOwner ||
        gitInfo.repo !== input.expectedRepo
      ) {
        return {
          success: false as const,
          reason: "wrong-repo" as const,
          found:
            gitInfo.owner && gitInfo.repo
              ? `${gitInfo.owner}/${gitInfo.repo}`
              : "not a git repository",
        }
      }

      // Create or update project
      const db = getDatabase()
      const existing = db
        .select()
        .from(projects)
        .where(eq(projects.path, folderPath))
        .get()

      if (existing) {
        // Update git info in case it changed
        const updated = db
          .update(projects)
          .set({
            updatedAt: new Date(),
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
          })
          .where(eq(projects.id, existing.id))
          .returning()
          .get()

        return { success: true as const, project: updated }
      }

      const project = db
        .insert(projects)
        .values({
          name: basename(folderPath),
          path: folderPath,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .returning()
        .get()

      return { success: true as const, project }
    }),

  /**
   * Open folder picker to choose where to clone a repository
   */
  pickCloneDestination: publicProcedure
    .input(z.object({ suggestedName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

      if (!window) {
        return { success: false as const, reason: "no-window" as const }
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Default to ~/.hong/repos/
      const homePath = app.getPath("home")
      const defaultPath = join(homePath, ".hong", "repos")
      await mkdir(defaultPath, { recursive: true })

      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
        title: "Choose where to clone",
        defaultPath,
        buttonLabel: "Clone Here",
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: "canceled" as const }
      }

      const targetPath = join(result.filePaths[0], input.suggestedName)
      return { success: true as const, targetPath }
    }),

  /**
   * Upload a custom icon for a project (opens file picker for images)
   */
  uploadIcon: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
      if (!window) return null

      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        title: "Select Project Icon",
        buttonLabel: "Set Icon",
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "svg", "webp", "ico"] },
        ],
      })

      if (result.canceled || !result.filePaths[0]) return null

      const sourcePath = result.filePaths[0]
      const ext = extname(sourcePath)
      const iconsDir = join(app.getPath("userData"), "project-icons")
      await mkdir(iconsDir, { recursive: true })

      const destPath = join(iconsDir, `${input.id}${ext}`)
      await copyFile(sourcePath, destPath)

      const db = getDatabase()
      return db
        .update(projects)
        .set({ iconPath: destPath, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Remove custom icon for a project
   */
  removeIcon: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const project = db.select().from(projects).where(eq(projects.id, input.id)).get()

      if (project?.iconPath && existsSync(project.iconPath)) {
        try { await unlink(project.iconPath) } catch {}
      }

      return db
        .update(projects)
        .set({ iconPath: null, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Create an independent playground project for a new chat.
   * Each chat gets its own directory: ~/.hong/.playground/{nanoid}/
   * This enables users to start chatting immediately without specifying a folder.
   */
  createIndependentPlayground: publicProcedure
    .input(z.object({
      name: z.string().optional(),
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
      const playground = db
        .insert(projects)
        .values({
          name: input?.name || "New Chat",
          path: playgroundPath,
          mode: "cowork", // Use cowork mode for full read/write capability
          isPlayground: true,
        })
        .returning()
        .get()

      return playground
    }),

  /**
   * Migrate a playground project to a regular workspace directory.
   * Moves all files from playground to target path and updates the project.
   */
  migratePlayground: publicProcedure
    .input(z.object({
      projectId: z.string(),
      targetPath: z.string(),
      newName: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get project
      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .get()

      if (!project) {
        throw new Error("Project not found")
      }

      if (!project.isPlayground) {
        throw new Error("Only playground projects can be migrated")
      }

      const sourcePath = project.path
      const targetPath = input.targetPath

      // Validate target path
      if (existsSync(targetPath)) {
        // Check if it's an empty directory
        const contents = await readdir(targetPath)
        if (contents.length > 0) {
          throw new Error("Target directory is not empty")
        }
      } else {
        // Create parent directory if needed
        await mkdir(dirname(targetPath), { recursive: true })
      }

      // Move directory
      try {
        await rename(sourcePath, targetPath)
      } catch (err) {
        // If rename fails (cross-device), try copy and delete
        if ((err as NodeJS.ErrnoException).code === "EXDEV") {
          // For cross-device moves, we'd need to implement recursive copy
          // For now, throw a more helpful error
          throw new Error("Cannot move across different drives. Please choose a location on the same drive.")
        }
        throw err
      }

      // Check if target is a git repo and get git info
      const hasGit = await isGitRepo(targetPath)
      const gitInfo = await getGitRemoteInfo(targetPath)
      const mode = hasGit ? "coding" : "cowork"

      // Update project
      const updatedProject = db
        .update(projects)
        .set({
          name: input.newName || basename(targetPath),
          path: targetPath,
          isPlayground: false,
          mode,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, input.projectId))
        .returning()
        .get()

      // Update worktreePath for all chats under this project
      // and migrate SDK session files so conversations can be resumed
      const projectChats = db
        .select({ id: chats.id, worktreePath: chats.worktreePath })
        .from(chats)
        .where(eq(chats.projectId, input.projectId))
        .all()

      const userDataPath = app.getPath("userData")
      const sanitize = (p: string) => p.replace(/[/.]/g, "-")

      for (const chat of projectChats) {
        if (chat.worktreePath && chat.worktreePath.startsWith(sourcePath)) {
          const newWorktreePath = targetPath + chat.worktreePath.slice(sourcePath.length)
          db.update(chats)
            .set({ worktreePath: newWorktreePath, updatedAt: new Date() })
            .where(eq(chats.id, chat.id))
            .run()

          // Migrate SDK session files from old CWD directory to new CWD directory
          // Session files live at: {userData}/claude-sessions/{subChatId}/projects/{sanitized_cwd}/
          const oldSanitized = sanitize(chat.worktreePath)
          const newSanitized = sanitize(newWorktreePath)

          const chatSubChats = db
            .select({ id: subChats.id })
            .from(subChats)
            .where(eq(subChats.chatId, chat.id))
            .all()

          for (const sc of chatSubChats) {
            const oldDir = join(userDataPath, "claude-sessions", sc.id, "projects", oldSanitized)
            const newDir = join(userDataPath, "claude-sessions", sc.id, "projects", newSanitized)
            try {
              if (existsSync(oldDir) && !existsSync(newDir)) {
                await mkdir(dirname(newDir), { recursive: true })
                await rename(oldDir, newDir)
                console.log(`[migratePlayground] Session dir moved: ${oldSanitized} → ${newSanitized}`)
              }
            } catch (err) {
              console.warn(`[migratePlayground] Failed to move session dir for ${sc.id}:`, err)
              // Non-fatal: conversation will start fresh if session file is missing
            }
          }
        }
      }

      return updatedProject
    }),

  /**
   * Pick a destination folder for migrating a playground
   */
  pickMigrateDestination: publicProcedure
    .input(z.object({ suggestedName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

      if (!window) {
        return { success: false as const, reason: "no-window" as const }
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Default to user's home directory
      const homePath = app.getPath("home")

      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
        title: "Choose where to save your project",
        defaultPath: homePath,
        buttonLabel: "Select Folder",
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: "canceled" as const }
      }

      return { success: true as const, parentDir: result.filePaths[0] }
    }),

  /**
   * Get playground storage info (size, file count)
   */
  getPlaygroundInfo: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()

      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .get()

      if (!project || !project.isPlayground) {
        return null
      }

      // Calculate directory size
      let totalSize = 0
      let fileCount = 0

      async function calculateSize(dirPath: string): Promise<void> {
        try {
          const entries = await readdir(dirPath, { withFileTypes: true })
          for (const entry of entries) {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              await calculateSize(fullPath)
            } else {
              const fileStat = await stat(fullPath)
              totalSize += fileStat.size
              fileCount++
            }
          }
        } catch {
          // Ignore errors (permission issues, etc.)
        }
      }

      await calculateSize(project.path)

      return {
        path: project.path,
        size: totalSize,
        fileCount,
        sizeFormatted: formatBytes(totalSize),
      }
    }),

  /**
   * Delete a playground project and its directory
   */
  deletePlayground: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      const project = db
        .select()
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .get()

      if (!project) {
        throw new Error("Project not found")
      }

      if (!project.isPlayground) {
        throw new Error("Only playground projects can be deleted with this method")
      }

      // Delete the directory
      if (existsSync(project.path)) {
        await rm(project.path, { recursive: true, force: true })
      }

      // Delete from database (cascade will delete chats)
      db.delete(projects).where(eq(projects.id, input.projectId)).run()

      return { success: true }
    }),

  /**
   * Cleanup orphan playground directories
   * Removes directories in ~/.hong/.playground that have no associated project
   */
  cleanupOrphanPlaygrounds: publicProcedure.mutation(async () => {
    const db = getDatabase()
    const homePath = app.getPath("home")
    const playgroundRoot = join(homePath, PLAYGROUND_RELATIVE_PATH)

    if (!existsSync(playgroundRoot)) {
      return { cleaned: 0 }
    }

    // Get all playground projects
    const playgroundProjects = db
      .select()
      .from(projects)
      .where(eq(projects.isPlayground, true))
      .all()

    const projectPaths = new Set(playgroundProjects.map(p => p.path))

    // Scan playground root directory
    const entries = await readdir(playgroundRoot, { withFileTypes: true })
    let cleaned = 0

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirPath = join(playgroundRoot, entry.name)
        if (!projectPaths.has(dirPath)) {
          // Orphan directory, delete it
          try {
            await rm(dirPath, { recursive: true, force: true })
            cleaned++
            console.log(`[Projects] Cleaned orphan playground: ${dirPath}`)
          } catch (err) {
            console.error(`[Projects] Failed to clean orphan playground: ${dirPath}`, err)
          }
        }
      }
    }

    return { cleaned }
  }),
})

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
