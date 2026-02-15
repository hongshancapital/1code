import { z } from "zod"
import { shell } from "electron"
import { router, publicProcedure } from "../index"
import { observable } from "@trpc/server/observable"
import {
  logEmitter,
  queryLogs,
  clearRingBuffer,
  getLogDirectory,
  getLogFiles,
} from "../../logger"
import type { LogEntry } from "../../../../shared/log-types"
import { LOG_LEVEL_PRIORITY } from "../../../../shared/log-types"

const logLevelSchema = z.enum([
  "error",
  "warn",
  "info",
  "verbose",
  "debug",
  "silly",
])

export const loggerRouter = router({
  /** Query ring buffer for historical log entries */
  query: publicProcedure
    .input(
      z
        .object({
          level: logLevelSchema.optional(),
          scope: z.string().optional(),
          search: z.string().optional(),
          limit: z.number().default(200),
        })
        .optional(),
    )
    .query(({ input }) => queryLogs(input ?? {})),

  /** Real-time log subscription via tRPC subscription */
  subscribe: publicProcedure
    .input(
      z
        .object({
          level: logLevelSchema.optional(),
          scope: z.string().optional(),
        })
        .optional(),
    )
    .subscription(({ input }) => {
      return observable<LogEntry>((emit) => {
        const handler = (entry: LogEntry) => {
          if (
            input?.level &&
            LOG_LEVEL_PRIORITY[entry.level] >
              LOG_LEVEL_PRIORITY[input.level]
          ) {
            return
          }
          if (
            input?.scope &&
            !entry.scope.toLowerCase().includes(input.scope.toLowerCase())
          ) {
            return
          }
          emit.next(entry)
        }
        logEmitter.on("log", handler)
        return () => {
          logEmitter.off("log", handler)
        }
      })
    }),

  /** Get log directory path */
  getLogPath: publicProcedure.query(() => getLogDirectory()),

  /** List all log files (current + archived) */
  getLogFiles: publicProcedure.query(() => getLogFiles()),

  /** Clear the in-memory ring buffer */
  clearBuffer: publicProcedure.mutation(() => {
    clearRingBuffer()
    return { cleared: true }
  }),

  /** Open log directory in system file manager */
  openLogFolder: publicProcedure.mutation(() => {
    const dir = getLogDirectory()
    shell.openPath(dir)
    return { path: dir }
  }),
})
