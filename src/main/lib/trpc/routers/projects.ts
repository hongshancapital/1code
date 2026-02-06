import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, projects } from "../../db"
import { eq, desc } from "drizzle-orm"
import { dialog, BrowserWindow, app } from "electron"
import { basename, join } from "path"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { existsSync } from "node:fs"
import { mkdir, copyFile, unlink } from "node:fs/promises"
import { extname } from "node:path"
import { getGitRemoteInfo, isGitRepo } from "../../git"
import { track as sensorsTrack } from "../../sensors-analytics"
import { getLaunchDirectory } from "../../cli"
import { PLAYGROUND_RELATIVE_PATH, PLAYGROUND_PROJECT_NAME } from "../../../../shared/feature-config"

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
      if (input?.includePlayground) {
        return all
      }
      // Filter out playground project
      return all.filter((p) => !p.isPlayground)
    }),

  /**
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

      // Track project opened
      sensorsTrack("project_opened", {
        project_id: updatedProject!.id,
        has_git_remote: !!gitInfo.remoteUrl,
      })

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

    // Track project opened
    sensorsTrack("project_opened", {
      id: newProject!.id,
      hasGitRemote: !!gitInfo.remoteUrl,
    })

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
          sensorsTrack("project_opened", {
            project_id: existing.id,
            has_git_remote: !!existing.gitRemoteUrl,
          })
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

        sensorsTrack("project_opened", {
          id: newProject!.id,
          hasGitRemote: !!gitInfo.remoteUrl,
        })
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

      sensorsTrack("project_opened", {
        project_id: newProject!.id,
        has_git_remote: !!gitInfo.remoteUrl,
      })

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

      // Track project opened
      if (updatedProject) {
        sensorsTrack("project_opened", {
          id: updatedProject.id,
          hasGitRemote: !!gitInfo.remoteUrl,
        })
      }

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
})
