import { z } from "zod"
import { publicProcedure, router } from "../index"
import {
  activeSessions,
  pendingToolApprovals,
  clearPendingApprovals,
} from "./claude"

export const sessionRouter = router({
  /**
   * Cancel active session
   */
  cancel: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(({ input }) => {
      const controller = activeSessions.get(input.subChatId);
      if (controller) {
        controller.abort();
        activeSessions.delete(input.subChatId);
        clearPendingApprovals("Session cancelled.", input.subChatId);
      }

      return { cancelled: !!controller };
    }),

  /**
   * Check if session is active
   */
  isActive: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .query(({ input }) => activeSessions.has(input.subChatId)),

  respondToolApproval: publicProcedure
    .input(
      z.object({
        toolUseId: z.string(),
        approved: z.boolean(),
        message: z.string().optional(),
        updatedInput: z.unknown().optional(),
      }),
    )
    .mutation(({ input }) => {
      const pending = pendingToolApprovals.get(input.toolUseId);
      if (!pending) {
        return { ok: false };
      }
      pending.resolve({
        approved: input.approved,
        message: input.message,
        updatedInput: input.updatedInput,
      });
      pendingToolApprovals.delete(input.toolUseId);
      return { ok: true };
    }),
})
