/**
 * Unified Logger — Main Process
 *
 * Based on electron-log v5. Provides:
 * - File transport with rotation (5MB) and gzip archive (90d retention)
 * - Console transport with timestamp/level/scope formatting
 * - Sentry transport (error → captureMessage, warn → breadcrumb)
 * - Ring buffer transport for UI log panel (2000 entries)
 *
 * Usage:
 *   import { createLogger } from '../lib/logger'
 *   const log = createLogger('ModuleName')
 *   log.info("something happened", extraData)
 */

import log from "electron-log/main"
import { app } from "electron"
import { EventEmitter } from "events"
import { createReadStream, createWriteStream, readdirSync, renameSync, statSync, unlinkSync, mkdirSync, existsSync } from "fs"
import { createGzip } from "zlib"
import { join, basename, dirname } from "path"
import { pipeline } from "stream/promises"
import type { LogEntry, LogLevel, LogQueryParams } from "../../shared/log-types"
import { LOG_LEVEL_PRIORITY } from "../../shared/log-types"

// ---------------------------------------------------------------------------
// Safe JSON stringify — handles Error objects, circular refs, BigInt, etc.
// ---------------------------------------------------------------------------

function safeJsonStringify(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`
  }
  try {
    const seen = new WeakSet()
    return JSON.stringify(value, (_key, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack }
      }
      if (typeof v === "bigint") {
        return v.toString()
      }
      if (typeof v === "object" && v !== null) {
        if (seen.has(v)) return "[Circular]"
        seen.add(v)
      }
      return v
    })
  } catch {
    return String(value)
  }
}

// ---------------------------------------------------------------------------
// Ring buffer for UI log panel
// ---------------------------------------------------------------------------

const RING_BUFFER_SIZE = 2000
const ringBuffer: LogEntry[] = []
let ringBufferIndex = 0 // write cursor for circular overwrite

export const logEmitter = new EventEmitter()
logEmitter.setMaxListeners(50) // allow many UI subscribers

function pushToRingBuffer(entry: LogEntry): void {
  if (ringBuffer.length < RING_BUFFER_SIZE) {
    ringBuffer.push(entry)
  } else {
    ringBuffer[ringBufferIndex] = entry
  }
  ringBufferIndex = (ringBufferIndex + 1) % RING_BUFFER_SIZE
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the logger. Must be called AFTER Sentry.init() and BEFORE
 * any other application logic.
 */
export function initializeLogger(): void {
  // -- File transport (daily log files) --
  log.transports.file.level = "info" // debug 级别不写入文件
  log.transports.file.maxSize = 5 * 1024 * 1024 // 5MB per file
  log.transports.file.format =
    "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}]{scope} {text}"

  // Daily file naming: main-2026-02-16.log
  const todayStr = () => new Date().toISOString().slice(0, 10)
  log.transports.file.resolvePathFn = (variables) => {
    const dir = join(variables.libraryDefaultDir, variables.appName || "Hong")
    return join(dir, `main-${todayStr()}.log`)
  }

  // When a daily file exceeds 5MB, archive with sequence suffix
  log.transports.file.archiveLogFn = (oldLogFile) => {
    const date = todayStr()
    // Find next available sequence number
    const dir = join(oldLogFile.path, "..")
    let seq = 1
    let newPath: string
    do {
      newPath = join(dir, `main-${date}-${seq}.log`)
      seq++
    } while (existsSync(newPath))
    try {
      renameSync(oldLogFile.path, newPath)
    } catch {
      // If rename fails, let electron-log handle it
    }
  }

  // -- Console transport --
  log.transports.console.format =
    "[{h}:{i}:{s}.{ms}] [{level}]{scope} {text}"

  // Guard against EIO errors when stdout/stderr pipe is broken.
  // Without this, a write failure triggers uncaughtException → log.error → writeFn → EIO → infinite loop.
  const originalWriteFn = log.transports.console.writeFn
  let consoleWriteSuppressed = false
  log.transports.console.writeFn = (msg: any) => {
    if (consoleWriteSuppressed) return
    try {
      originalWriteFn(msg)
    } catch {
      consoleWriteSuppressed = true
    }
  }

  // -- Sentry transport (custom) --
  const sentryTransport = (message: log.LogMessage) => {
    // Only forward in production
    if (!app.isPackaged) return

    const level = message.level as LogLevel
    if (level !== "error" && level !== "warn") return

    const text = message.data
      .map((d: unknown) => (typeof d === "string" ? d : safeJsonStringify(d)))
      .join(" ")

    const scope = message.scope || ""

    // Lazy import to avoid circular dependencies / early init issues
    import("@sentry/electron/main").then((Sentry) => {
      if (level === "error") {
        Sentry.captureMessage(text, {
          level: "error",
          tags: { logScope: scope },
        })
      } else {
        // warn → breadcrumb only (avoids alert storms)
        Sentry.addBreadcrumb({
          message: text,
          level: "warning",
          category: scope || "app",
        })
      }
    }).catch(() => {
      // Sentry not available, ignore
    })
  }
  ;(sentryTransport as any).level = "warn"
  log.transports.sentry = sentryTransport as any

  // -- Ring buffer transport (custom) --
  const bufferTransport = (message: log.LogMessage) => {
    const entry: LogEntry = {
      timestamp: message.date.toISOString(),
      level: message.level as LogLevel,
      scope: message.scope || "",
      message: message.data
        .map((d: unknown) => (typeof d === "string" ? d : safeJsonStringify(d)))
        .join(" "),
      data: message.data.length > 1 ? message.data.slice(1) : undefined,
      process: "main",
    }
    pushToRingBuffer(entry)
    logEmitter.emit("log", entry)
  }
  ;(bufferTransport as any).level = "debug"
  log.transports.ringBuffer = bufferTransport as any

  // Run archive cleanup in background
  archiveOldLogs().catch(() => {
    // Non-critical, swallow errors
  })
}

/**
 * Create a scoped logger for a specific module.
 *
 *   const log = createLogger('Git')
 *   log.info('clone completed')
 *   // → [14:32:01.234] [info] (Git) clone completed
 */
export function createLogger(scope: string): log.LogFunctions {
  return log.scope(scope)
}

/**
 * Default (unscoped) logger instance.
 */
export const logger = log

// ---------------------------------------------------------------------------
// Ring buffer query
// ---------------------------------------------------------------------------

export function queryLogs(params: LogQueryParams = {}): LogEntry[] {
  const { level, scope, search, limit = 200 } = params

  // Reconstruct ordered array from circular buffer
  let ordered: LogEntry[]
  if (ringBuffer.length < RING_BUFFER_SIZE) {
    ordered = ringBuffer
  } else {
    ordered = [
      ...ringBuffer.slice(ringBufferIndex),
      ...ringBuffer.slice(0, ringBufferIndex),
    ]
  }

  let filtered = ordered

  if (level) {
    const maxPriority = LOG_LEVEL_PRIORITY[level]
    filtered = filtered.filter(
      (e) => LOG_LEVEL_PRIORITY[e.level] <= maxPriority,
    )
  }

  if (scope) {
    const lowerScope = scope.toLowerCase()
    filtered = filtered.filter((e) =>
      e.scope.toLowerCase().includes(lowerScope),
    )
  }

  if (search) {
    const lowerSearch = search.toLowerCase()
    filtered = filtered.filter((e) =>
      e.message.toLowerCase().includes(lowerSearch),
    )
  }

  // Return last N entries (most recent)
  return filtered.slice(-limit)
}

export function clearRingBuffer(): void {
  ringBuffer.length = 0
  ringBufferIndex = 0
}

// ---------------------------------------------------------------------------
// File path helpers
// ---------------------------------------------------------------------------

export function getLogFilePath(): string {
  return log.transports.file.getFile().path
}

export function getLogDirectory(): string {
  return dirname(getLogFilePath())
}

export function getLogFiles(): Array<{ name: string; path: string; size: number; mtime: string }> {
  const dir = getLogDirectory()
  const archiveDir = join(dir, "archive")
  const result: Array<{ name: string; path: string; size: number; mtime: string }> = []

  try {
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".log")) continue
      const filePath = join(dir, file)
      try {
        const st = statSync(filePath)
        result.push({
          name: file,
          path: filePath,
          size: st.size,
          mtime: st.mtime.toISOString(),
        })
      } catch {
        // skip inaccessible
      }
    }
  } catch {
    // dir doesn't exist yet
  }

  // Include archive directory
  try {
    if (existsSync(archiveDir)) {
      for (const file of readdirSync(archiveDir)) {
        if (!file.endsWith(".log.gz")) continue
        const filePath = join(archiveDir, file)
        try {
          const st = statSync(filePath)
          result.push({
            name: `archive/${file}`,
            path: filePath,
            size: st.size,
            mtime: st.mtime.toISOString(),
          })
        } catch {
          // skip
        }
      }
    }
  } catch {
    // archive dir doesn't exist
  }

  return result.sort((a, b) => b.mtime.localeCompare(a.mtime))
}

// ---------------------------------------------------------------------------
// Archive / cleanup logic
// ---------------------------------------------------------------------------

const ARCHIVE_AFTER_DAYS = 7
const DELETE_ARCHIVE_AFTER_DAYS = 90

/**
 * Archive old log files:
 * - Files older than 7 days → gzip compress into archive/ directory
 * - Compressed archives older than 90 days → delete
 *
 * Runs asynchronously at startup, non-blocking.
 */
async function archiveOldLogs(): Promise<void> {
  const dir = getLogDirectory()
  const archiveDir = join(dir, "archive")

  const now = Date.now()
  const archiveThreshold = ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000
  const deleteThreshold = DELETE_ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000

  // Phase 1: Compress old .log files
  try {
    const files = readdirSync(dir)
    for (const file of files) {
      if (!file.endsWith(".log")) continue
      // Skip the active log file
      const activeFile = basename(getLogFilePath())
      if (file === activeFile) continue

      const filePath = join(dir, file)
      try {
        const st = statSync(filePath)
        const age = now - st.mtime.getTime()

        if (age > archiveThreshold) {
          // Compress to archive/
          mkdirSync(archiveDir, { recursive: true })

          // Derive monthly archive name from file's mtime
          const month = st.mtime.toISOString().slice(0, 7) // yyyy-MM
          const archivePath = join(archiveDir, `${month}.log.gz`)

          // Append to existing gz or create new
          // For simplicity: compress each file individually with date prefix
          const gzPath = join(archiveDir, `${file}.gz`)

          if (!existsSync(gzPath)) {
            const source = createReadStream(filePath)
            const destination = createWriteStream(gzPath)
            const gzip = createGzip()
            await pipeline(source, gzip, destination)
          }

          // Remove original
          unlinkSync(filePath)
        }
      } catch {
        // Skip files we can't process
      }
    }
  } catch {
    // Directory might not exist yet
  }

  // Phase 2: Delete old compressed archives
  try {
    if (existsSync(archiveDir)) {
      const archives = readdirSync(archiveDir)
      for (const file of archives) {
        if (!file.endsWith(".log.gz")) continue
        const filePath = join(archiveDir, file)
        try {
          const st = statSync(filePath)
          const age = now - st.mtime.getTime()
          if (age > deleteThreshold) {
            unlinkSync(filePath)
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // archive dir doesn't exist
  }
}
