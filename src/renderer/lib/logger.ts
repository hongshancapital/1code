/**
 * Unified Logger — Renderer Process
 *
 * Lightweight console wrapper with formatted output.
 * No electron-log IPC overhead — logs stay in DevTools console.
 *
 * Usage:
 *   import { createLogger } from '../lib/logger'
 *   const log = createLogger('ChatView')
 *   log.info("message loaded", count)
 */

import type { LogLevel } from "../../shared/log-types"
import { LOG_LEVEL_PRIORITY } from "../../shared/log-types"

let currentLevel: LogLevel = import.meta.env.DEV ? "debug" : "info"

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[currentLevel]
}

function formatPrefix(level: LogLevel, scope: string): string {
  const time = new Date().toISOString().slice(11, 23) // HH:mm:ss.SSS
  return `[${time}] [${level}] (${scope})`
}

export interface ScopedLogFunctions {
  error: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  verbose: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
  /** Alias for info */
  log: (...args: unknown[]) => void
}

export function createLogger(scope: string): ScopedLogFunctions {
  return {
    error: (...args: unknown[]) => {
      if (shouldLog("error")) console.error(formatPrefix("error", scope), ...args)
    },
    warn: (...args: unknown[]) => {
      if (shouldLog("warn")) console.warn(formatPrefix("warn", scope), ...args)
    },
    info: (...args: unknown[]) => {
      if (shouldLog("info")) console.log(formatPrefix("info", scope), ...args)
    },
    verbose: (...args: unknown[]) => {
      if (shouldLog("verbose")) console.debug(formatPrefix("verbose", scope), ...args)
    },
    debug: (...args: unknown[]) => {
      if (shouldLog("debug")) console.debug(formatPrefix("debug", scope), ...args)
    },
    log: (...args: unknown[]) => {
      if (shouldLog("info")) console.log(formatPrefix("info", scope), ...args)
    },
  }
}

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}
