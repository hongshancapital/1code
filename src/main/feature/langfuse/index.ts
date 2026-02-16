/**
 * Langfuse Extension - Main Entry
 *
 * 提供 Claude 会话的 Langfuse 可观测性支持
 * 仅当环境变量配置完整时启用，异步非阻塞处理
 */

import type {
  ExtensionModule,
  ExtensionContext,
  CleanupFn,
} from "../../lib/extension/types"
import { ChatHook } from "../../lib/extension/hooks/chat-lifecycle"
import { LangfuseClient } from "./client"
import { LangfuseHooks } from "./hooks"
import {
  loadLangfuseConfig,
  isLangfuseEnabled,
  validateConfig,
} from "./config"
import { createLogger } from "../../lib/logger"

const log = createLogger("langfuse")

class LangfuseExtension implements ExtensionModule {
  name = "langfuse"
  description = "Langfuse observability for Claude sessions"

  async initialize(ctx: ExtensionContext): Promise<CleanupFn> {
    log.info("[Langfuse] Initializing extension...")

    const config = loadLangfuseConfig()

    if (!config || !isLangfuseEnabled(config)) {
      log.info(
        "[Langfuse] Extension disabled (missing environment variables)"
      )
      return () => {}
    }

    const validation = validateConfig(config)
    if (!validation.valid) {
      log.error(`[Langfuse] Config validation failed: ${validation.error}`)
      return () => {}
    }

    const client = new LangfuseClient()

    try {
      await client.init(config)
      log.info(
        `[Langfuse] Client initialized (baseUrl: ${config.baseUrl})`
      )
    } catch (error) {
      log.error("[Langfuse] Client initialization failed:", error)
      return () => {}
    }

    const hooks = new LangfuseHooks(client, log)

    const offSessionStart = ctx.hooks.on(
      ChatHook.SessionStart,
      async (payload) => {
        hooks
          .onSessionStart({
            subChatId: payload.subChatId,
            projectId: payload.projectId,
            mode: payload.mode,
            initialPrompt: payload.prompt,
          })
          .catch((err) => {
            log.error("[Langfuse] SessionStart error:", err)
          })
      },
      { source: this.name }
    )

    const offUserPrompt = ctx.hooks.on(
      ChatHook.UserPrompt,
      async (payload) => {
        hooks
          .onUserPrompt({
            subChatId: payload.subChatId,
            prompt: payload.prompt || "",
          })
          .catch((err) => {
            log.error("[Langfuse] UserPrompt error:", err)
          })
      },
      { source: this.name }
    )

    const offToolOutput = ctx.hooks.on(
      ChatHook.ToolOutput,
      async (payload) => {
        hooks
          .onToolOutput({
            subChatId: payload.subChatId,
            toolName: payload.toolName,
            input: payload.toolInput,
            output: payload.toolOutput,
            startTime: new Date(),
            endTime: undefined,
            error: undefined,
          })
          .catch((err) => {
            log.error("[Langfuse] ToolOutput error:", err)
          })
      },
      { source: this.name }
    )

    const offAssistantMessage = ctx.hooks.on(
      ChatHook.AssistantMessage,
      async (payload) => {
        hooks
          .onAssistantMessage({
            subChatId: payload.subChatId,
            text: payload.text || "",
          })
          .catch((err) => {
            log.error("[Langfuse] AssistantMessage error:", err)
          })
      },
      { source: this.name }
    )

    const offStreamComplete = ctx.hooks.on(
      ChatHook.StreamComplete,
      async (payload) => {
        const usage = payload.metadata?.modelUsage
          ? {
              inputTokens: payload.metadata.modelUsage.inputTokens || 0,
              outputTokens: payload.metadata.modelUsage.outputTokens || 0,
            }
          : undefined

        hooks
          .onStreamComplete({
            subChatId: payload.subChatId,
            metadata: payload.metadata,
            usage,
          })
          .catch((err) => {
            log.error("[Langfuse] StreamComplete error:", err)
          })
      },
      { source: this.name }
    )

    const offStreamError = ctx.hooks.on(
      ChatHook.StreamError,
      async (payload) => {
        hooks
          .onStreamError({
            subChatId: payload.subChatId,
            error: payload.error?.message || "Unknown error",
            metadata: payload.metadata,
          })
          .catch((err) => {
            log.error("[Langfuse] StreamError error:", err)
          })
      },
      { source: this.name }
    )

    const offSessionEnd = ctx.hooks.on(
      ChatHook.SessionEnd,
      async (payload) => {
        hooks
          .onSessionEnd({
            subChatId: payload.subChatId,
            output: undefined,
          })
          .catch((err) => {
            log.error("[Langfuse] SessionEnd error:", err)
          })
      },
      { source: this.name }
    )

    const offCleanup = ctx.hooks.on(
      ChatHook.Cleanup,
      async (payload) => {
        hooks
          .onCleanup({
            subChatId: payload.subChatId,
          })
          .catch((err) => {
            log.error("[Langfuse] Cleanup error:", err)
          })
      },
      { source: this.name }
    )

    log.info("[Langfuse] Extension initialized successfully")

    return async () => {
      log.info("[Langfuse] Shutting down extension...")

      offSessionStart()
      offUserPrompt()
      offToolOutput()
      offAssistantMessage()
      offStreamComplete()
      offStreamError()
      offSessionEnd()
      offCleanup()

      hooks.clearAll()

      try {
        await client.flush()
        log.info("[Langfuse] Data flushed")
      } catch (error) {
        log.error("[Langfuse] Flush error:", error)
      }

      try {
        await client.shutdown()
        log.info("[Langfuse] Client shut down")
      } catch (error) {
        log.error("[Langfuse] Shutdown error:", error)
      }
    }
  }
}

export const langfuseExtension = new LangfuseExtension()
