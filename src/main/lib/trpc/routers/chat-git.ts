/**
 * Chat Git Operations Router
 * Handles git diff, PR operations, worktree status, and commit message generation
 */

import { eq } from "drizzle-orm"
import * as fs from "fs/promises"
import * as path from "path"
import simpleGit from "simple-git"
import { z } from "zod"
import { chats, getDatabase } from "../../db"
import { getDeviceInfo } from "../../device-id"
import {
  fetchGitHubPRStatus,
  getWorktreeDiff,
} from "../../git"
import { computeContentHash, gitCache } from "../../git/cache"
import { splitUnifiedDiffByFile } from "../../git/diff-parser"
import { execWithShellEnv } from "../../git/shell-env"
import { publicProcedure, router } from "../index"

export const chatGitRouter = router({
  /**
   * Get git diff for a chat's worktree
   */
  getDiff: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        return { diff: null, error: "No worktree path" }
      }

      const result = await getWorktreeDiff(
        chat.worktreePath,
        chat.baseBranch ?? undefined,
      )

      if (!result.success) {
        return { diff: null, error: result.error }
      }

      return { diff: result.diff || "" }
    }),

  /**
   * Get parsed diff with prefetched file contents
   * This endpoint does all diff parsing on the server side to avoid blocking UI
   * Uses GitCache for instant responses when diff hasn't changed
   */
  getParsedDiff: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        return {
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
          fileContents: {},
          error: "No worktree path",
        }
      }

      // 1. Get raw diff (only uncommitted changes - don't show branch diff after commit)
      const result = await getWorktreeDiff(
        chat.worktreePath,
        chat.baseBranch ?? undefined,
        { onlyUncommitted: true },
      )

      if (!result.success) {
        return {
          files: [],
          totalAdditions: 0,
          totalDeletions: 0,
          fileContents: {},
          error: result.error,
        }
      }

      // 2. Check cache using diff hash
      const diffHash = computeContentHash(result.diff || "")
      type ParsedDiffResponse = {
        files: ReturnType<typeof splitUnifiedDiffByFile>
        totalAdditions: number
        totalDeletions: number
        fileContents: Record<string, string>
      }
      const cached = gitCache.getParsedDiff<ParsedDiffResponse>(chat.worktreePath, diffHash)
      if (cached) {
        return cached
      }

      // 3. Parse diff into files
      const files = splitUnifiedDiffByFile(result.diff || "")

      // 4. Calculate totals
      const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0)
      const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0)

      // 5. Prefetch file contents (first 20 files, non-deleted, non-binary)
      const MAX_PREFETCH = 20
      const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

      const filesToFetch = files
        .filter((f) => !f.isBinary && !f.isDeletedFile)
        .slice(0, MAX_PREFETCH)
        .map((f) => ({
          key: f.key,
          filePath: f.newPath !== "/dev/null" ? f.newPath : f.oldPath,
        }))
        .filter((f) => f.filePath && f.filePath !== "/dev/null")

      const fileContents: Record<string, string> = {}

      // Read files in parallel
      await Promise.all(
        filesToFetch.map(async ({ key, filePath }) => {
          try {
            const fullPath = path.join(chat.worktreePath!, filePath)

            // Check file size first
            const stats = await fs.stat(fullPath)
            if (stats.size > MAX_FILE_SIZE) {
              return // Skip large files
            }

            const content = await fs.readFile(fullPath, "utf-8")

            // Quick binary check (NUL bytes in first 8KB)
            const checkLength = Math.min(content.length, 8192)
            for (let i = 0; i < checkLength; i++) {
              if (content.charCodeAt(i) === 0) {
                return // Skip binary files
              }
            }

            fileContents[key] = content
          } catch {
            // File might not exist or be unreadable - skip
          }
        }),
      )

      const response: ParsedDiffResponse = {
        files,
        totalAdditions,
        totalDeletions,
        fileContents,
      }

      // 6. Store in cache
      gitCache.setParsedDiff(chat.worktreePath, diffHash, response)
      return response
    }),

  /**
   * Generate a commit message using AI based on the diff
   * @param chatId - The chat ID to get worktree path from
   * @param filePaths - Optional list of file paths to generate message for (if not provided, uses all changed files)
   */
  generateCommitMessage: publicProcedure
    .input(z.object({
      chatId: z.string(),
      filePaths: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        throw new Error("No worktree path")
      }

      // Get the diff to understand what changed
      const result = await getWorktreeDiff(
        chat.worktreePath,
        chat.baseBranch ?? undefined,
      )

      if (!result.success || !result.diff) {
        throw new Error("Failed to get diff")
      }

      // Parse diff to get file list
      let files = splitUnifiedDiffByFile(result.diff)

      // Filter to only selected files if filePaths provided
      if (input.filePaths && input.filePaths.length > 0) {
        const selectedPaths = new Set(input.filePaths)
        files = files.filter((f) => {
          const filePath = f.newPath !== "/dev/null" ? f.newPath : f.oldPath
          // Match by exact path or by path suffix (handle different path formats)
          return selectedPaths.has(filePath) ||
            [...selectedPaths].some(sp => filePath.endsWith(sp) || sp.endsWith(filePath))
        })
        console.log(`[generateCommitMessage] Filtered ${files.length} files from ${input.filePaths.length} selected paths`)
      }

      if (files.length === 0) {
        throw new Error("No changes to commit")
      }

      // Build filtered diff text for API (only selected files)
      const filteredDiff = files.map(f => f.diffText).join('\n')

      // Call web API to generate commit message
      try {
        const deviceInfo = getDeviceInfo()
        // Use localhost in dev, production otherwise
        const apiUrl = process.env.NODE_ENV === "development" ? "http://localhost:3000" : "https://cowork.hongshan.com"

        const response = await fetch(
          `${apiUrl}/api/agents/generate-commit-message`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-device-id": deviceInfo.deviceId,
              "x-device-platform": deviceInfo.platform,
              "x-app-version": deviceInfo.appVersion,
            },
            body: JSON.stringify({
              diff: filteredDiff.slice(0, 10000), // Limit diff size, use filtered diff
              fileCount: files.length,
              additions: files.reduce((sum, f) => sum + f.additions, 0),
              deletions: files.reduce((sum, f) => sum + f.deletions, 0),
            }),
          },
        )

        if (response.ok) {
          const data = await response.json()
          if (data.message) {
            return { message: data.message }
          }
          console.warn("[generateCommitMessage] API returned ok but no message in response")
        } else {
          console.warn(`[generateCommitMessage] API returned ${response.status}`)
        }
      } catch (error) {
        console.warn(`[generateCommitMessage] API call failed: ${error instanceof Error ? error.message : String(error)}`)
      }

      // Fallback: Generate commit message with conventional commits style
      const fileNames = files.map((f) => {
        const filePath = f.newPath !== "/dev/null" ? f.newPath : f.oldPath
        // Note: Git diff paths always use forward slashes
        return path.posix.basename(filePath) || filePath
      })

      // Detect commit type from file changes
      const hasNewFiles = files.some((f) => f.oldPath === "/dev/null")
      const hasDeletedFiles = files.some((f) => f.newPath === "/dev/null")
      const hasOnlyDeletions = files.every((f) => f.additions === 0 && f.deletions > 0)

      // Detect type from file paths
      const allPaths = files.map((f) => f.newPath !== "/dev/null" ? f.newPath : f.oldPath)
      const hasTestFiles = allPaths.some((p) => p.includes("test") || p.includes("spec"))
      const hasDocFiles = allPaths.some((p) => p.endsWith(".md") || p.includes("doc"))
      const hasConfigFiles = allPaths.some((p) =>
        p.includes("config") ||
        p.endsWith(".json") ||
        p.endsWith(".yaml") ||
        p.endsWith(".yml") ||
        p.endsWith(".toml")
      )

      // Determine commit type prefix
      let prefix = "chore"
      if (hasNewFiles && !hasDeletedFiles) {
        prefix = "feat"
      } else if (hasOnlyDeletions) {
        prefix = "chore"
      } else if (hasTestFiles && !hasDocFiles && !hasConfigFiles) {
        prefix = "test"
      } else if (hasDocFiles && !hasTestFiles && !hasConfigFiles) {
        prefix = "docs"
      } else if (allPaths.some((p) => p.includes("fix") || p.includes("bug"))) {
        prefix = "fix"
      } else if (files.length > 0 && files.every((f) => f.additions > 0 || f.deletions > 0)) {
        // Default to fix for modifications (most common case)
        prefix = "fix"
      }

      const uniqueFileNames = [...new Set(fileNames)]
      let message: string

      if (uniqueFileNames.length === 1) {
        message = `${prefix}: update ${uniqueFileNames[0]}`
      } else if (uniqueFileNames.length <= 3) {
        message = `${prefix}: update ${uniqueFileNames.join(", ")}`
      } else {
        message = `${prefix}: update ${uniqueFileNames.length} files`
      }

      console.log("[generateCommitMessage] Generated fallback message:", message)
      return { message }
    }),

  /**
   * Get PR context for message generation (branch info, uncommitted changes, etc.)
   */
  getPrContext: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        return null
      }

      try {
        const git = simpleGit(chat.worktreePath)
        const status = await git.status()

        // Check if upstream exists
        let hasUpstream = false
        try {
          const tracking = await git.raw([
            "rev-parse",
            "--abbrev-ref",
            "@{upstream}",
          ])
          hasUpstream = !!tracking.trim()
        } catch {
          hasUpstream = false
        }

        return {
          branch: chat.branch || status.current || "unknown",
          baseBranch: chat.baseBranch || "main",
          uncommittedCount: status.files.length,
          hasUpstream,
        }
      } catch (error) {
        console.error("[getPrContext] Error:", error)
        return null
      }
    }),

  /**
   * Update PR info after Claude creates a PR
   */
  updatePrInfo: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        prUrl: z.string(),
        prNumber: z.number(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const result = db
        .update(chats)
        .set({
          prUrl: input.prUrl,
          prNumber: input.prNumber,
          updatedAt: new Date(),
        })
        .where(eq(chats.id, input.chatId))
        .returning()
        .get()

      return result
    }),

  /**
   * Get PR status from GitHub (via gh CLI)
   */
  getPrStatus: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath) {
        return null
      }

      return await fetchGitHubPRStatus(chat.worktreePath)
    }),

  /**
   * Merge PR via gh CLI
   * First checks if PR is mergeable, returns helpful error if conflicts exist
   */
  mergePr: publicProcedure
    .input(
      z.object({
        chatId: z.string(),
        method: z.enum(["merge", "squash", "rebase"]).default("squash"),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      if (!chat?.worktreePath || !chat?.prNumber) {
        throw new Error("No PR to merge")
      }

      // Check PR mergeability before attempting merge
      const prStatus = await fetchGitHubPRStatus(chat.worktreePath)
      if (prStatus?.pr?.mergeable === "CONFLICTING") {
        throw new Error(
          "MERGE_CONFLICT: This PR has merge conflicts with the base branch. " +
          "Please sync your branch with the latest changes from main to resolve conflicts."
        )
      }

      try {
        await execWithShellEnv(
          "gh",
          [
            "pr",
            "merge",
            String(chat.prNumber),
            `--${input.method}`,
            "--delete-branch",
          ],
          { cwd: chat.worktreePath },
        )
        return { success: true }
      } catch (error) {
        console.error("[mergePr] Error:", error)
        const errorMsg = error instanceof Error ? error.message : "Failed to merge PR"

        // Check for conflict-related error messages from gh CLI
        if (
          errorMsg.includes("not mergeable") ||
          errorMsg.includes("merge conflict") ||
          errorMsg.includes("cannot be cleanly created") ||
          errorMsg.includes("CONFLICTING")
        ) {
          throw new Error(
            "MERGE_CONFLICT: This PR has merge conflicts with the base branch. " +
            "Please sync your branch with the latest changes from main to resolve conflicts."
          )
        }

        throw new Error(errorMsg)
      }
    }),

  /**
   * Get worktree status for archive dialog
   * Returns whether workspace has a worktree and uncommitted changes count
   */
  getWorktreeStatus: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const chat = db
        .select()
        .from(chats)
        .where(eq(chats.id, input.chatId))
        .get()

      // No worktree if no branch (local mode)
      if (!chat?.worktreePath || !chat?.branch) {
        return { hasWorktree: false, uncommittedCount: 0 }
      }

      try {
        const git = simpleGit(chat.worktreePath)
        const status = await git.status()

        return {
          hasWorktree: true,
          uncommittedCount: status.files.length,
        }
      } catch (error) {
        // Worktree path doesn't exist or git error
        console.warn("[getWorktreeStatus] Error checking worktree:", error)
        return { hasWorktree: false, uncommittedCount: 0 }
      }
    }),
})
