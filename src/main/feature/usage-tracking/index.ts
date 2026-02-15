/**
 * Usage Tracking Extension
 *
 * 将 claude.ts 中 4 处重复的 modelUsage 写入逻辑合并为统一的 recordUsage 函数：
 * - chat:streamComplete → 记录 token 使用（成功路径）
 * - chat:streamError → 记录 token 使用（错误路径）
 */

import type {
  ExtensionModule,
  ExtensionContext,
  CleanupFn,
} from "../../lib/extension/types"
import type {
  ChatStreamCompletePayload,
  ChatStreamErrorPayload,
} from "../../lib/extension/hooks/chat-lifecycle"
import { getDatabase, modelUsage } from "../../lib/db"
import { eq, like } from "drizzle-orm"

/**
 * Unified usage recording function.
 * Consolidates the 4 near-identical db.insert blocks from claude.ts
 * (error per-model, error fallback, success per-model, success fallback).
 */
function recordUsage(
  payload: ChatStreamCompletePayload | ChatStreamErrorPayload,
): void {
  const { metadata, subChatId, chatId, projectId, mode, finalModel } = payload

  if (!projectId) {
    console.warn(
      `[Usage] Skipping usage recording - projectId not found for chat ${chatId}`,
    )
    return
  }

  const db = getDatabase()

  if (
    metadata.modelUsage &&
    Object.keys(metadata.modelUsage).length > 0
  ) {
    // Per-model breakdown from SDK (preferred)
    try {
      const existingUsage = metadata.sdkMessageUuid
        ? db
            .select()
            .from(modelUsage)
            .where(
              like(
                modelUsage.messageUuid,
                `${metadata.sdkMessageUuid}-%`,
              ),
            )
            .get()
        : null

      if (!existingUsage) {
        for (const [model, usage] of Object.entries(
          metadata.modelUsage as Record<
            string,
            {
              inputTokens: number
              outputTokens: number
              costUSD?: number
            }
          >,
        )) {
          const totalTokens = usage.inputTokens + usage.outputTokens
          db.insert(modelUsage)
            .values({
              subChatId,
              chatId,
              projectId,
              model,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens,
              costUsd: usage.costUSD?.toFixed(6),
              sessionId: metadata.sessionId,
              messageUuid: metadata.sdkMessageUuid
                ? `${metadata.sdkMessageUuid}-${model}`
                : undefined,
              mode,
              durationMs: payload.durationMs ?? metadata.durationMs,
            })
            .run()
          console.log(
            `[Usage] Recorded ${model}: ${usage.inputTokens} in, ${usage.outputTokens} out, cost: ${usage.costUSD?.toFixed(4) || "?"}`,
          )
        }
      } else {
        console.log(
          `[Usage] Skipping duplicate: ${metadata.sdkMessageUuid}`,
        )
      }
    } catch (usageErr) {
      console.error(`[Usage] Failed to record per-model usage:`, usageErr)
    }
  } else if (metadata.inputTokens || metadata.outputTokens) {
    // Fallback: aggregate data (no per-model breakdown)
    try {
      const existingUsage = metadata.sdkMessageUuid
        ? db
            .select()
            .from(modelUsage)
            .where(eq(modelUsage.messageUuid, metadata.sdkMessageUuid))
            .get()
        : null

      if (!existingUsage) {
        db.insert(modelUsage)
          .values({
            subChatId,
            chatId,
            projectId,
            model: finalModel || "claude-sonnet-4-20250514",
            inputTokens: metadata.inputTokens || 0,
            outputTokens: metadata.outputTokens || 0,
            totalTokens: metadata.totalTokens || 0,
            costUsd: metadata.totalCostUsd?.toFixed(6),
            sessionId: metadata.sessionId,
            messageUuid: metadata.sdkMessageUuid,
            mode,
            durationMs: payload.durationMs ?? metadata.durationMs,
          })
          .run()
        console.log(
          `[Usage] Recorded (fallback): ${metadata.inputTokens || 0} in, ${metadata.outputTokens || 0} out, cost: ${metadata.totalCostUsd?.toFixed(4) || "?"}`,
        )
      } else {
        console.log(
          `[Usage] Skipping duplicate: ${metadata.sdkMessageUuid}`,
        )
      }
    } catch (usageErr) {
      console.error(`[Usage] Failed to record usage:`, usageErr)
    }
  }
}

class UsageTrackingExtension implements ExtensionModule {
  name = "usage-tracking" as const
  description = "Token usage tracking for model_usage table"

  initialize(ctx: ExtensionContext): CleanupFn {
    // chat:streamComplete — 记录 token 使用（成功路径）
    const offComplete = ctx.hooks.on(
      "chat:streamComplete",
      async (payload) => {
        recordUsage(payload)
      },
      { source: this.name },
    )

    // chat:streamError — 记录 token 使用（错误路径）
    const offError = ctx.hooks.on(
      "chat:streamError",
      async (payload) => {
        recordUsage(payload)
      },
      { source: this.name },
    )

    return () => {
      offComplete()
      offError()
    }
  }
}

export const usageTrackingExtension = new UsageTrackingExtension()
