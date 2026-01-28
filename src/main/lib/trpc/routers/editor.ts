import { z } from "zod"
import { router, publicProcedure } from "../index"
import { exec, spawn } from "node:child_process"
import { promisify } from "node:util"
import * as os from "node:os"
import * as path from "node:path"

const execAsync = promisify(exec)

// ============================================================================
// Types
// ============================================================================

type Platform = "darwin" | "win32" | "linux"

interface EditorInfo {
  id: string
  name: string
  command: string
  installed: boolean
  path: string | null
  version: string | null
}

interface EditorDefinition {
  id: string
  name: string
  commands: Record<Platform, string>
  versionArg: string
  // For line:column goto support
  gotoFormat: "vscode" | "zed" | "sublime" | "jetbrains"
}

// ============================================================================
// Editor Definitions
// ============================================================================

const SUPPORTED_EDITORS: EditorDefinition[] = [
  {
    id: "code",
    name: "VS Code",
    commands: { darwin: "code", win32: "code.cmd", linux: "code" },
    versionArg: "--version",
    gotoFormat: "vscode",
  },
  {
    id: "cursor",
    name: "Cursor",
    commands: { darwin: "cursor", win32: "cursor.cmd", linux: "cursor" },
    versionArg: "--version",
    gotoFormat: "vscode",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    commands: { darwin: "windsurf", win32: "windsurf.cmd", linux: "windsurf" },
    versionArg: "--version",
    gotoFormat: "vscode",
  },
  {
    id: "agy",
    name: "Antigravity",
    commands: { darwin: "agy", win32: "agy.cmd", linux: "agy" },
    versionArg: "--version",
    gotoFormat: "vscode", // VS Code fork
  },
  {
    id: "zed",
    name: "Zed",
    commands: { darwin: "zed", win32: "zed.exe", linux: "zed" },
    versionArg: "--version",
    gotoFormat: "zed",
  },
  {
    id: "subl",
    name: "Sublime Text",
    commands: { darwin: "subl", win32: "subl.exe", linux: "subl" },
    versionArg: "--version",
    gotoFormat: "sublime",
  },
  {
    id: "idea",
    name: "IntelliJ IDEA",
    commands: { darwin: "idea", win32: "idea64.exe", linux: "idea.sh" },
    versionArg: "--version",
    gotoFormat: "jetbrains",
  },
  {
    id: "webstorm",
    name: "WebStorm",
    commands: { darwin: "webstorm", win32: "webstorm64.exe", linux: "webstorm.sh" },
    versionArg: "--version",
    gotoFormat: "jetbrains",
  },
]

// Cache for editor detection
let editorCache: { data: EditorInfo[]; timestamp: number } | null = null
const CACHE_TTL = 60000 // 1 minute

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the current platform
 */
function getPlatform(): Platform {
  const platform = process.platform
  if (platform === "darwin" || platform === "win32" || platform === "linux") {
    return platform
  }
  // Default to linux for other Unix-like systems
  return "linux"
}

/**
 * Execute command with timeout and return stdout
 */
async function execWithTimeout(
  command: string,
  timeoutMs = 5000
): Promise<string | null> {
  try {
    const { stdout } = await execAsync(command, { timeout: timeoutMs })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Detect a single editor
 */
async function detectEditor(definition: EditorDefinition): Promise<EditorInfo> {
  const platform = getPlatform()
  const command = definition.commands[platform]
  const whichCmd = platform === "win32" ? "where" : "which"

  const editorPath = await execWithTimeout(`${whichCmd} ${command}`)
  if (!editorPath) {
    return {
      id: definition.id,
      name: definition.name,
      command,
      installed: false,
      path: null,
      version: null,
    }
  }

  // Get version
  const versionOutput = await execWithTimeout(`${command} ${definition.versionArg}`)
  // Parse version (usually first line or contains x.x.x format)
  const version = versionOutput?.match(/\d+\.\d+\.\d+/)?.[0] ?? null

  return {
    id: definition.id,
    name: definition.name,
    command,
    installed: true,
    path: editorPath.split("\n")[0], // Take first result on Windows
    version,
  }
}

/**
 * Build command arguments for opening with line/column
 */
function buildGotoArgs(
  definition: EditorDefinition,
  filePath: string,
  line?: number,
  column?: number
): string[] {
  if (!line) {
    return [filePath]
  }

  switch (definition.gotoFormat) {
    case "vscode":
      // VS Code/Cursor/Windsurf/Antigravity: --goto file:line:column
      const gotoPath = column ? `${filePath}:${line}:${column}` : `${filePath}:${line}`
      return ["--goto", gotoPath]

    case "zed":
      // Zed: file:line
      return [`${filePath}:${line}`]

    case "sublime":
      // Sublime Text: file:line:column
      const sublPath = column ? `${filePath}:${line}:${column}` : `${filePath}:${line}`
      return [sublPath]

    case "jetbrains":
      // IntelliJ/WebStorm: --line line file
      return ["--line", String(line), filePath]

    default:
      return [filePath]
  }
}

// ============================================================================
// Router
// ============================================================================

export const editorRouter = router({
  /**
   * Detect all installed editors
   */
  detectEditors: publicProcedure.query(async (): Promise<EditorInfo[]> => {
    // Check cache
    if (editorCache && Date.now() - editorCache.timestamp < CACHE_TTL) {
      return editorCache.data
    }

    // Detect all editors in parallel
    const results = await Promise.all(
      SUPPORTED_EDITORS.map((def) => detectEditor(def))
    )

    // Update cache
    editorCache = { data: results, timestamp: Date.now() }

    return results
  }),

  /**
   * Force refresh editor detection
   */
  refreshEditors: publicProcedure.mutation(async (): Promise<EditorInfo[]> => {
    // Clear cache
    editorCache = null

    // Detect all editors in parallel
    const results = await Promise.all(
      SUPPORTED_EDITORS.map((def) => detectEditor(def))
    )

    // Update cache
    editorCache = { data: results, timestamp: Date.now() }

    return results
  }),

  /**
   * Open a file or directory with the specified editor
   */
  openWithEditor: publicProcedure
    .input(
      z.object({
        path: z.string(), // File or directory path
        editorId: z.string().optional(), // Editor ID (optional, auto-detect if empty)
        customArgs: z.string().optional(), // Custom arguments
        line: z.number().optional(), // Jump to line (files only)
        column: z.number().optional(), // Jump to column (files only)
      })
    )
    .mutation(async ({ input }) => {
      const { path: targetPath, editorId, customArgs, line, column } = input
      const platform = getPlatform()

      // Expand ~ path
      const expandedPath =
        targetPath.startsWith("~/") || targetPath === "~"
          ? path.join(os.homedir(), targetPath.slice(1))
          : targetPath

      // Determine which editor to use
      let editorCommand: string
      let editorDefinition: EditorDefinition | undefined

      if (editorId) {
        // Use specified editor
        editorDefinition = SUPPORTED_EDITORS.find((e) => e.id === editorId)
        if (!editorDefinition) {
          throw new Error(`Unknown editor: ${editorId}`)
        }
        editorCommand = editorDefinition.commands[platform]
      } else {
        // Auto-detect first available editor
        const detected =
          editorCache?.data ??
          (await Promise.all(SUPPORTED_EDITORS.map((def) => detectEditor(def))))
        const firstInstalled = detected.find((e) => e.installed)

        if (!firstInstalled) {
          // Fallback to system default
          const fallbackCommands: Record<Platform, string> = {
            darwin: "open",
            win32: "start",
            linux: "xdg-open",
          }
          editorCommand = fallbackCommands[platform]
        } else {
          editorCommand = firstInstalled.command
          editorDefinition = SUPPORTED_EDITORS.find((e) => e.id === firstInstalled.id)
        }
      }

      // Build arguments
      const args: string[] = []

      // Add custom arguments
      if (customArgs) {
        args.push(...customArgs.split(" ").filter(Boolean))
      }

      // Add path with optional line/column
      if (editorDefinition && line) {
        args.push(...buildGotoArgs(editorDefinition, expandedPath, line, column))
      } else {
        args.push(expandedPath)
      }

      try {
        const child = spawn(editorCommand, args, {
          detached: true,
          stdio: "ignore",
          // Windows needs shell: true to execute .cmd files
          ...(platform === "win32" && { shell: true }),
        })
        child.unref()

        return { success: true, editor: editorCommand }
      } catch (error) {
        throw new Error(
          `Failed to open editor: ${error instanceof Error ? error.message : "Unknown error"}`
        )
      }
    }),

  /**
   * Get the list of supported editors (for UI display)
   */
  getSupportedEditors: publicProcedure.query(() => {
    return SUPPORTED_EDITORS.map((e) => ({
      id: e.id,
      name: e.name,
    }))
  }),
})
