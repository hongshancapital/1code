import { z } from "zod"
import { router, publicProcedure } from "../index"
import { readdir, stat, readFile, mkdtemp, rm } from "node:fs/promises"
import { join, relative, basename, dirname } from "node:path"
import { tmpdir } from "node:os"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

// Directories to ignore when scanning
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "release",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
  ".turbo",
  ".vercel",
  ".netlify",
  "out",
  ".svelte-kit",
  ".astro",
])

// Files to ignore
const IGNORED_FILES = new Set([
  ".DS_Store",
  "Thumbs.db",
  ".gitkeep",
])

// File extensions to ignore
const IGNORED_EXTENSIONS = new Set([
  ".log",
  ".lock", // We'll handle package-lock.json separately
  ".pyc",
  ".pyo",
  ".class",
  ".o",
  ".obj",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
])

// Lock files to keep (not ignore)
const ALLOWED_LOCK_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
])

// LibreOffice executable paths to try
const LIBREOFFICE_PATHS = [
  "/opt/homebrew/bin/soffice", // macOS Homebrew (Apple Silicon)
  "/usr/local/bin/soffice", // macOS Homebrew (Intel)
  "/Applications/LibreOffice.app/Contents/MacOS/soffice", // macOS app bundle
  "/usr/bin/soffice", // Linux
  "/usr/bin/libreoffice", // Linux alternative
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe", // Windows
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe", // Windows x86
]

/**
 * Find LibreOffice executable
 */
function findLibreOffice(): string | null {
  for (const path of LIBREOFFICE_PATHS) {
    if (existsSync(path)) {
      return path
    }
  }
  return null
}

/**
 * Convert Office document to PDF using LibreOffice
 */
async function convertToPdf(inputPath: string): Promise<string> {
  const soffice = findLibreOffice()
  if (!soffice) {
    throw new Error("LibreOffice not found. Please install LibreOffice to preview Office documents.")
  }

  // Create a temp directory for output
  const tempDir = await mkdtemp(join(tmpdir(), "office-preview-"))

  return new Promise((resolve, reject) => {
    // Use LibreOffice headless mode to convert to PDF
    const args = [
      "--headless",
      "--convert-to", "pdf",
      "--outdir", tempDir,
      inputPath,
    ]

    console.log(`[files] Converting to PDF: ${soffice} ${args.join(" ")}`)

    const process = spawn(soffice, args, {
      timeout: 60000, // 60 second timeout
    })

    let stderr = ""

    process.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    process.on("close", (code) => {
      if (code !== 0) {
        // Clean up temp dir on error
        rm(tempDir, { recursive: true }).catch(() => {})
        reject(new Error(`LibreOffice conversion failed (code ${code}): ${stderr}`))
        return
      }

      // Find the output PDF file
      const inputBasename = basename(inputPath)
      const pdfBasename = inputBasename.replace(/\.[^.]+$/, ".pdf")
      const pdfPath = join(tempDir, pdfBasename)

      if (!existsSync(pdfPath)) {
        rm(tempDir, { recursive: true }).catch(() => {})
        reject(new Error(`PDF output not found: ${pdfPath}`))
        return
      }

      console.log(`[files] PDF created: ${pdfPath}`)
      resolve(pdfPath)
    })

    process.on("error", (err) => {
      rm(tempDir, { recursive: true }).catch(() => {})
      reject(new Error(`Failed to spawn LibreOffice: ${err.message}`))
    })
  })
}

// Cache for converted PDF paths (source path -> pdf path)
const pdfConversionCache = new Map<string, { pdfPath: string; mtime: number }>()

// Entry type for files and folders
interface FileEntry {
  path: string
  type: "file" | "folder"
}

// Cache for file and folder listings
const fileListCache = new Map<string, { entries: FileEntry[]; timestamp: number }>()
const CACHE_TTL = 5000 // 5 seconds

/**
 * Recursively scan a directory and return all file and folder paths
 */
async function scanDirectory(
  rootPath: string,
  currentPath: string = rootPath,
  depth: number = 0,
  maxDepth: number = 15
): Promise<FileEntry[]> {
  if (depth > maxDepth) return []

  const entries: FileEntry[] = []

  try {
    const dirEntries = await readdir(currentPath, { withFileTypes: true })

    for (const entry of dirEntries) {
      const fullPath = join(currentPath, entry.name)
      const relativePath = relative(rootPath, fullPath)

      if (entry.isDirectory()) {
        // Skip ignored directories
        if (IGNORED_DIRS.has(entry.name)) continue
        // Skip hidden directories (except .github, .vscode, etc.)
        if (entry.name.startsWith(".") && !entry.name.startsWith(".github") && !entry.name.startsWith(".vscode")) continue

        // Add the folder itself to results
        entries.push({ path: relativePath, type: "folder" })

        // Recurse into subdirectory
        const subEntries = await scanDirectory(rootPath, fullPath, depth + 1, maxDepth)
        entries.push(...subEntries)
      } else if (entry.isFile()) {
        // Skip ignored files
        if (IGNORED_FILES.has(entry.name)) continue

        // Check extension
        const ext = entry.name.includes(".") ? "." + entry.name.split(".").pop()?.toLowerCase() : ""
        if (IGNORED_EXTENSIONS.has(ext)) {
          // Allow specific lock files
          if (!ALLOWED_LOCK_FILES.has(entry.name)) continue
        }

        entries.push({ path: relativePath, type: "file" })
      }
    }
  } catch (error) {
    // Silently skip directories we can't read
    console.warn(`[files] Could not read directory: ${currentPath}`, error)
  }

  return entries
}

/**
 * Get cached entry list or scan directory
 */
async function getEntryList(projectPath: string): Promise<FileEntry[]> {
  const cached = fileListCache.get(projectPath)
  const now = Date.now()

  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.entries
  }

  const entries = await scanDirectory(projectPath)
  fileListCache.set(projectPath, { entries, timestamp: now })

  return entries
}

/**
 * Filter and sort entries (files and folders) by query
 */
function filterEntries(
  entries: FileEntry[],
  query: string,
  limit: number
): Array<{ id: string; label: string; path: string; repository: string; type: "file" | "folder" }> {
  const queryLower = query.toLowerCase()

  // Filter entries that match the query
  let filtered = entries
  if (query) {
    filtered = entries.filter((entry) => {
      const name = basename(entry.path).toLowerCase()
      const pathLower = entry.path.toLowerCase()
      return name.includes(queryLower) || pathLower.includes(queryLower)
    })
  }

  // Sort by relevance (exact match > starts with > shorter match > contains > alphabetical)
  // Files and folders are treated equally
  filtered.sort((a, b) => {
    const aName = basename(a.path).toLowerCase()
    const bName = basename(b.path).toLowerCase()

    if (query) {
      // Priority 1: Exact name match
      const aExact = aName === queryLower
      const bExact = bName === queryLower
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1

      // Priority 2: Name starts with query
      const aStarts = aName.startsWith(queryLower)
      const bStarts = bName.startsWith(queryLower)
      if (aStarts && !bStarts) return -1
      if (!aStarts && bStarts) return 1
      
      // Priority 3: If both start with query, shorter name = better match
      if (aStarts && bStarts) {
        if (aName.length !== bName.length) {
          return aName.length - bName.length
        }
      }

      // Priority 4: Name contains query (but doesn't start with it)
      const aContains = aName.includes(queryLower)
      const bContains = bName.includes(queryLower)
      if (aContains && !bContains) return -1
      if (!aContains && bContains) return 1
    }

    // Alphabetical by name
    return aName.localeCompare(bName)
  })

  // Limit results
  const limited = filtered.slice(0, Math.min(limit, 200))

  // Map to expected format with type
  return limited.map((entry) => ({
    id: `${entry.type}:local:${entry.path}`,
    label: basename(entry.path),
    path: entry.path,
    repository: "local",
    type: entry.type,
  }))
}

export const filesRouter = router({
  /**
   * Search files and folders in a local project directory
   */
  search: publicProcedure
    .input(
      z.object({
        projectPath: z.string(),
        query: z.string().default(""),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const { projectPath, query, limit } = input

      if (!projectPath) {
        return []
      }

      try {
        // Verify the path exists and is a directory
        const pathStat = await stat(projectPath)
        if (!pathStat.isDirectory()) {
          console.warn(`[files] Not a directory: ${projectPath}`)
          return []
        }

        // Get entry list (cached or fresh scan)
        const entries = await getEntryList(projectPath)
        
        // Debug: log folder count
        const folderCount = entries.filter(e => e.type === "folder").length
        const fileCount = entries.filter(e => e.type === "file").length
        console.log(`[files] Scanned ${projectPath}: ${folderCount} folders, ${fileCount} files`)

        // Filter and sort by query
        const results = filterEntries(entries, query, limit)
        console.log(`[files] Query "${query}": returning ${results.length} results, folders: ${results.filter(r => r.type === "folder").length}`)
        return results
      } catch (error) {
        console.error(`[files] Error searching files:`, error)
        return []
      }
    }),

  /**
   * Clear the file cache for a project (useful when files change)
   */
  clearCache: publicProcedure
    .input(z.object({ projectPath: z.string() }))
    .mutation(({ input }) => {
      fileListCache.delete(input.projectPath)
      return { success: true }
    }),

  /**
   * List contents of a specific directory (non-recursive, for lazy loading)
   */
  listDirectory: publicProcedure
    .input(
      z.object({
        projectPath: z.string(),
        relativePath: z.string().default(""),
      })
    )
    .query(async ({ input }) => {
      const { projectPath, relativePath } = input

      if (!projectPath) {
        return []
      }

      try {
        const targetPath = relativePath ? join(projectPath, relativePath) : projectPath

        // Verify the path exists and is a directory
        const pathStat = await stat(targetPath)
        if (!pathStat.isDirectory()) {
          console.warn(`[files] Not a directory: ${targetPath}`)
          return []
        }

        const dirEntries = await readdir(targetPath, { withFileTypes: true })
        const results: Array<{ name: string; path: string; type: "file" | "folder" }> = []

        for (const entry of dirEntries) {
          const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name

          if (entry.isDirectory()) {
            // Skip ignored directories
            if (IGNORED_DIRS.has(entry.name)) continue
            // Skip hidden directories (except .github, .vscode, etc.)
            if (entry.name.startsWith(".") && !entry.name.startsWith(".github") && !entry.name.startsWith(".vscode")) continue

            results.push({
              name: entry.name,
              path: entryRelativePath,
              type: "folder",
            })
          } else if (entry.isFile()) {
            // Skip ignored files
            if (IGNORED_FILES.has(entry.name)) continue

            // Check extension
            const ext = entry.name.includes(".") ? "." + entry.name.split(".").pop()?.toLowerCase() : ""
            if (IGNORED_EXTENSIONS.has(ext)) {
              // Allow specific lock files
              if (!ALLOWED_LOCK_FILES.has(entry.name)) continue
            }

            results.push({
              name: entry.name,
              path: entryRelativePath,
              type: "file",
            })
          }
        }

        // Sort: folders first, then alphabetically
        results.sort((a, b) => {
          if (a.type !== b.type) {
            return a.type === "folder" ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

        return results
      } catch (error) {
        console.error(`[files] Error listing directory:`, error)
        return []
      }
    }),

  /**
   * Read file content (for preview)
   */
  readFile: publicProcedure
    .input(
      z.object({
        path: z.string(),
        maxSize: z.number().default(1024 * 1024), // 1MB default max
      })
    )
    .query(async ({ input }) => {
      const { path: filePath, maxSize } = input

      try {
        // Check file exists and get size
        const fileStat = await stat(filePath)

        if (!fileStat.isFile()) {
          throw new Error("Not a file")
        }

        if (fileStat.size > maxSize) {
          throw new Error(`File too large (${Math.round(fileStat.size / 1024)}KB > ${Math.round(maxSize / 1024)}KB limit)`)
        }

        // Read file content
        const content = await readFile(filePath, "utf-8")
        return content
      } catch (error) {
        console.error(`[files] Error reading file:`, error)
        throw error
      }
    }),

  /**
   * Read binary file as base64 (for images, PDFs, etc.)
   */
  readBinaryFile: publicProcedure
    .input(
      z.object({
        path: z.string(),
        maxSize: z.number().default(10 * 1024 * 1024), // 10MB default max for binary files
      })
    )
    .query(async ({ input }) => {
      const { path: filePath, maxSize } = input

      try {
        // Check file exists and get size
        const fileStat = await stat(filePath)

        if (!fileStat.isFile()) {
          throw new Error("Not a file")
        }

        if (fileStat.size > maxSize) {
          throw new Error(`File too large (${Math.round(fileStat.size / 1024)}KB > ${Math.round(maxSize / 1024)}KB limit)`)
        }

        // Read file as buffer and convert to base64
        const buffer = await readFile(filePath)
        const base64 = buffer.toString("base64")

        // Determine MIME type from extension
        const ext = filePath.split(".").pop()?.toLowerCase() || ""
        const mimeTypes: Record<string, string> = {
          // Images
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          svg: "image/svg+xml",
          ico: "image/x-icon",
          bmp: "image/bmp",
          avif: "image/avif",
          // Documents
          pdf: "application/pdf",
        }
        const mimeType = mimeTypes[ext] || "application/octet-stream"

        return {
          base64,
          mimeType,
          size: fileStat.size,
        }
      } catch (error) {
        console.error(`[files] Error reading binary file:`, error)
        throw error
      }
    }),

  /**
   * Convert Office document (pptx, docx, xlsx) to PDF for preview
   * Returns the path to the converted PDF file
   */
  convertToPdf: publicProcedure
    .input(
      z.object({
        path: z.string(),
      })
    )
    .query(async ({ input }) => {
      const { path: filePath } = input

      try {
        // Check file exists and get mtime
        const fileStat = await stat(filePath)
        if (!fileStat.isFile()) {
          throw new Error("Not a file")
        }

        const mtime = fileStat.mtimeMs

        // Check cache
        const cached = pdfConversionCache.get(filePath)
        if (cached && cached.mtime === mtime && existsSync(cached.pdfPath)) {
          console.log(`[files] Using cached PDF: ${cached.pdfPath}`)
          return { pdfPath: cached.pdfPath }
        }

        // Convert to PDF
        const pdfPath = await convertToPdf(filePath)

        // Update cache
        pdfConversionCache.set(filePath, { pdfPath, mtime })

        return { pdfPath }
      } catch (error) {
        console.error(`[files] Error converting to PDF:`, error)
        throw error
      }
    }),

  /**
   * Check if LibreOffice is available
   */
  checkLibreOffice: publicProcedure.query(() => {
    const path = findLibreOffice()
    return {
      available: path !== null,
      path,
    }
  }),
})
