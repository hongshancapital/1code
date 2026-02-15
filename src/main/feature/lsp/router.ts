/**
 * LSP tRPC Router
 *
 * Provides Language Server Protocol functionality through tRPC
 */

import { z } from "zod"
import { router, publicProcedure } from "../../lib/trpc/index"
import { observable } from "@trpc/server/observable"
import { lspManager } from "./lib/manager"

// Input schemas
const sessionIdSchema = z.string()
const filePathSchema = z.string()
const positionSchema = z.object({
  line: z.number().int().positive(),
  offset: z.number().int().positive(),
})

const configSchema = z.object({
  language: z.enum(["typescript", "javascript"]),
  backend: z.enum(["tsserver", "tsgo"]).default("tsserver"),
  customPath: z.string().optional(),
})

export const lspRouter = router({
  /**
   * Start LSP server for a project
   */
  start: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        projectPath: z.string(),
        config: configSchema,
      })
    )
    .mutation(async ({ input }) => {
      await lspManager.startServer({
        sessionId: input.sessionId,
        projectPath: input.projectPath,
        config: input.config,
      })
      return { success: true }
    }),

  /**
   * Stop LSP server
   */
  stop: publicProcedure
    .input(z.object({ sessionId: sessionIdSchema }))
    .mutation(async ({ input }) => {
      await lspManager.stopServer(input.sessionId)
      return { success: true }
    }),

  /**
   * Check if session is alive
   */
  isAlive: publicProcedure
    .input(z.object({ sessionId: sessionIdSchema }))
    .query(({ input }) => {
      return { alive: lspManager.isSessionAlive(input.sessionId) }
    }),

  /**
   * Open a file in LSP server
   */
  openFile: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
        content: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await lspManager.openFile(input.sessionId, input.filePath, input.content)
      return { success: true }
    }),

  /**
   * Update file content
   */
  updateFile: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
        content: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await lspManager.updateFile(
        input.sessionId,
        input.filePath,
        input.content
      )
      return { success: true }
    }),

  /**
   * Close file in LSP server
   */
  closeFile: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
      })
    )
    .mutation(async ({ input }) => {
      await lspManager.closeFile(input.sessionId, input.filePath)
      return { success: true }
    }),

  /**
   * Get completions at position
   */
  completions: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
        position: positionSchema,
      })
    )
    .query(async ({ input }) => {
      const completions = await lspManager.getCompletions(
        input.sessionId,
        input.filePath,
        input.position.line,
        input.position.offset
      )
      return { completions }
    }),

  /**
   * Get completion entry details
   */
  completionDetails: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
        position: positionSchema,
        entryNames: z.array(z.string()),
      })
    )
    .query(async ({ input }) => {
      const details = await lspManager.getCompletionDetails(
        input.sessionId,
        input.filePath,
        input.position.line,
        input.position.offset,
        input.entryNames
      )
      return { details }
    }),

  /**
   * Get quick info (hover) at position
   */
  quickInfo: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
        position: positionSchema,
      })
    )
    .query(async ({ input }) => {
      const info = await lspManager.getQuickInfo(
        input.sessionId,
        input.filePath,
        input.position.line,
        input.position.offset
      )
      return { info }
    }),

  /**
   * Get diagnostics for file
   */
  diagnostics: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
      })
    )
    .query(async ({ input }) => {
      const diagnostics = await lspManager.getDiagnostics(
        input.sessionId,
        input.filePath
      )
      return { diagnostics }
    }),

  /**
   * Get definition at position
   */
  definition: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
        position: positionSchema,
      })
    )
    .query(async ({ input }) => {
      const definitions = await lspManager.getDefinition(
        input.sessionId,
        input.filePath,
        input.position.line,
        input.position.offset
      )
      return { definitions }
    }),

  /**
   * Get references at position
   */
  references: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
        position: positionSchema,
      })
    )
    .query(async ({ input }) => {
      const references = await lspManager.getReferences(
        input.sessionId,
        input.filePath,
        input.position.line,
        input.position.offset
      )
      return { references }
    }),

  /**
   * Get signature help at position
   */
  signatureHelp: publicProcedure
    .input(
      z.object({
        sessionId: sessionIdSchema,
        filePath: filePathSchema,
        position: positionSchema,
      })
    )
    .query(async ({ input }) => {
      const help = await lspManager.getSignatureHelp(
        input.sessionId,
        input.filePath,
        input.position.line,
        input.position.offset
      )
      return { help }
    }),

  /**
   * Subscribe to LSP events (diagnostics, etc.)
   */
  events: publicProcedure
    .input(z.object({ sessionId: sessionIdSchema }))
    .subscription(({ input }) => {
      return observable<{ type: string; data: any }>((emit) => {
        const eventHandler = (event: any) => {
          emit.next({ type: "event", data: event })
        }

        const diagnosticsHandler = (data: any) => {
          emit.next({ type: "diagnostics", data })
        }

        const exitHandler = (code: number) => {
          emit.next({ type: "exit", data: { code } })
          emit.complete()
        }

        const errorHandler = (error: Error) => {
          emit.next({ type: "error", data: { message: error.message } })
        }

        lspManager.on(`event:${input.sessionId}`, eventHandler)
        lspManager.on(`diagnostics:${input.sessionId}`, diagnosticsHandler)
        lspManager.on(`exit:${input.sessionId}`, exitHandler)
        lspManager.on(`error:${input.sessionId}`, errorHandler)

        return () => {
          lspManager.off(`event:${input.sessionId}`, eventHandler)
          lspManager.off(`diagnostics:${input.sessionId}`, diagnosticsHandler)
          lspManager.off(`exit:${input.sessionId}`, exitHandler)
          lspManager.off(`error:${input.sessionId}`, errorHandler)
        }
      })
    }),
})
