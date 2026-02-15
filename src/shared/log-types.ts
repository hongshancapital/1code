export type LogLevel = "error" | "warn" | "info" | "verbose" | "debug" | "silly"

export interface LogEntry {
  timestamp: string // ISO 8601
  level: LogLevel
  scope: string // 模块标识, e.g. "App", "Claude", "Git"
  message: string
  data?: unknown[]
  process: "main" | "renderer"
}

export interface LogQueryParams {
  level?: LogLevel
  scope?: string
  search?: string
  limit?: number
}

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4,
  silly: 5,
}
