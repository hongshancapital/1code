/**
 * Browser tRPC Router
 * Exposes browser operations to renderer via tRPC
 */

import { observable } from "@trpc/server/observable"
import { z } from "zod"
import { browserManager } from "../../browser"
import type { BrowserOperationType, CursorPosition, RecentAction } from "../../browser"
import { publicProcedure, router } from "../index"

export const browserRouter = router({
  /** Check if browser is ready */
  isReady: publicProcedure.query(() => {
    return browserManager.isReady
  }),

  /** Get current browser state */
  state: publicProcedure.query(() => {
    return {
      isReady: browserManager.isReady,
      isOperating: browserManager.isOperating,
      currentUrl: browserManager.currentUrl,
      recentActions: browserManager.recentActions,
    }
  }),

  /** Execute a browser operation (used internally by MCP server) */
  execute: publicProcedure
    .input(z.object({
      type: z.string() as z.ZodType<BrowserOperationType>,
      params: z.record(z.unknown()),
      timeout: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      return browserManager.execute(input.type, input.params, input.timeout)
    }),

  /** Subscribe to browser events */
  events: publicProcedure.subscription(() => {
    return observable<{
      type: "ready" | "urlChanged" | "operationStart" | "operationEnd" | "cursorPosition"
      data: unknown
    }>((emit) => {
      const handlers = {
        ready: (ready: boolean) => emit.next({ type: "ready", data: ready }),
        urlChanged: (url: string) => emit.next({ type: "urlChanged", data: url }),
        operationStart: (data: { type: BrowserOperationType; params: unknown }) =>
          emit.next({ type: "operationStart", data }),
        operationEnd: (data: { type: BrowserOperationType; params: unknown; success: boolean }) =>
          emit.next({ type: "operationEnd", data }),
        cursorPosition: (position: CursorPosition) =>
          emit.next({ type: "cursorPosition", data: position }),
      }

      browserManager.on("ready", handlers.ready)
      browserManager.on("urlChanged", handlers.urlChanged)
      browserManager.on("operationStart", handlers.operationStart)
      browserManager.on("operationEnd", handlers.operationEnd)
      browserManager.on("cursorPosition", handlers.cursorPosition)

      return () => {
        browserManager.off("ready", handlers.ready)
        browserManager.off("urlChanged", handlers.urlChanged)
        browserManager.off("operationStart", handlers.operationStart)
        browserManager.off("operationEnd", handlers.operationEnd)
        browserManager.off("cursorPosition", handlers.cursorPosition)
      }
    })
  }),

  /** Get recent actions for status bar */
  recentActions: publicProcedure.query((): readonly RecentAction[] => {
    return browserManager.recentActions
  }),
})
