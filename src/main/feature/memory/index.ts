/**
 * Memory Extension
 *
 * 将 claude.ts 中的 Memory 相关硬编码逻辑迁移为 Hook 注入：
 * - chat:sessionStart → 创建 memory session + 记录 user prompt
 * - chat:toolOutput → 记录工具输出为 observation
 * - chat:assistantMessage → 记录 AI 回复
 * - chat:sessionEnd → 结束 session + 生成 summary
 * - chat:enhancePrompt → 注入 Memory Context 到 system prompt
 */

import type {
  ExtensionModule,
  ExtensionContext,
  CleanupFn,
} from "../../lib/extension/types"
import { ChatHook } from "../../lib/extension/hooks/chat-lifecycle"
import { memoryHooks } from "./lib/hooks"
import { setSummaryModelConfig } from "./lib/summarizer"
import { isModelDownloaded, ensureModelDownloaded } from "./lib/embeddings"
import { getDatabase, memorySessions, observations } from "../../lib/db"
import { eq, desc } from "drizzle-orm"
import { memoryRouter } from "./router"
import { createLogger } from "../../lib/logger"

const memoryLog = createLogger("Memory")


class MemoryExtension implements ExtensionModule {
  name = "memory" as const
  description = "Memory session tracking and context injection"
  router = memoryRouter

  private sessionMap = new Map<string, string>() // subChatId → memorySessionId

  initialize(ctx: ExtensionContext): CleanupFn {
    const sessionMap = this.sessionMap

    // chat:sessionStart — 创建 memory session + 记录 user prompt
    const offSessionStart = ctx.hooks.on(
      ChatHook.SessionStart,
      async (payload) => {
        if (!payload.projectId || payload.memoryRecordingEnabled === false)
          return

        // 配置 summary model
        try {
          if (payload.summaryProviderId && payload.summaryModelId) {
            setSummaryModelConfig({
              providerId: payload.summaryProviderId,
              modelId: payload.summaryModelId,
            })
          } else {
            setSummaryModelConfig(null)
          }
        } catch {
          // Summarizer not available, continue with rule-based
        }

        try {
          // 防止并发竞态：如果已有进行中的 session，先结束它
          const existingSessionId = sessionMap.get(payload.subChatId)
          if (existingSessionId) {
            try {
              await memoryHooks.onSessionEnd({
                sessionId: existingSessionId,
                subChatId: payload.subChatId,
              })
            } catch {
              // 旧 session 清理失败不阻塞新 session 创建
            }
            sessionMap.delete(payload.subChatId)
          }

          const sessionId = await memoryHooks.onSessionStart({
            subChatId: payload.subChatId,
            projectId: payload.projectId,
            chatId: payload.chatId,
          })
          if (sessionId) {
            sessionMap.set(payload.subChatId, sessionId)
            await memoryHooks.onUserPrompt({
              sessionId,
              prompt: payload.prompt,
              promptNumber: payload.promptNumber,
            })
          }
        } catch (err) {
          ctx.error(
            "[Memory] Hook error (onSessionStart/onUserPrompt):",
            err,
          )
        }
      },
      { source: this.name },
    )

    // chat:toolOutput — 记录工具输出
    const offToolOutput = ctx.hooks.on(
      ChatHook.ToolOutput,
      async (payload) => {
        const sessionId = sessionMap.get(payload.subChatId)
        if (!sessionId || !payload.projectId) return

        await memoryHooks.onToolOutput({
          sessionId,
          projectId: payload.projectId,
          toolName: payload.toolName,
          toolInput: payload.toolInput,
          toolOutput: payload.toolOutput,
          toolCallId: payload.toolCallId,
          promptNumber: payload.promptNumber,
        })
      },
      { source: this.name },
    )

    // chat:assistantMessage — 记录 AI 回复
    const offAssistantMessage = ctx.hooks.on(
      ChatHook.AssistantMessage,
      async (payload) => {
        const sessionId = sessionMap.get(payload.subChatId)
        if (!sessionId || !payload.projectId) return

        await memoryHooks.onAssistantMessage({
          sessionId,
          projectId: payload.projectId,
          text: payload.text,
          messageId: payload.messageId,
          promptNumber: payload.promptNumber,
        })
      },
      { source: this.name },
    )

    // chat:sessionEnd — 结束 session
    const offSessionEnd = ctx.hooks.on(
      ChatHook.SessionEnd,
      async (payload) => {
        const sessionId = sessionMap.get(payload.subChatId)
        if (!sessionId) return

        await memoryHooks.onSessionEnd({
          sessionId,
          subChatId: payload.subChatId,
        })
        sessionMap.delete(payload.subChatId)
      },
      { source: this.name },
    )

    // chat:enhancePrompt — Memory Context 注入（priority=50，在 Browser 之前）
    const offEnhancePrompt = ctx.hooks.on(
      ChatHook.EnhancePrompt,
      async (payload) => {
        if (payload.memoryEnabled === false || !payload.projectId)
          return payload

        try {
          // 给整个 buildMemoryContext 加超时保护（15秒），防止卡死整个 chat 流程
          const ENHANCE_TIMEOUT_MS = 15_000
          const contextPromise = buildMemoryContext(
            payload.projectId,
            payload.prompt,
          )
          const timeoutPromise = new Promise<undefined>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Memory context build timed out")),
              ENHANCE_TIMEOUT_MS,
            )
            if (timer.unref) timer.unref()
          })

          const memorySection = await Promise.race([contextPromise, timeoutPromise])
          if (memorySection) {
            return {
              ...payload,
              appendSections: [...payload.appendSections, memorySection],
            }
          }
        } catch (err) {
          memoryLog.warn("[EnhancePrompt] Failed to build memory context, skipping:", err)
        }

        return payload
      },
      { source: this.name, priority: 50 },
    )

    // 异步检查并预加载 embedding 模型（不阻塞启动）
    setTimeout(() => {
      if (!isModelDownloaded()) {
        memoryLog.info("Embedding model not found, starting background download...")
      } else {
        memoryLog.info("Embedding model found, preloading pipeline...")
      }
      ensureModelDownloaded().catch((err) => {
        memoryLog.warn("Background model preload failed (will retry on demand):", err)
      })
    }, 5_000) // 延迟 5 秒，等其他启动任务完成

    return () => {
      offSessionStart()
      offToolOutput()
      offAssistantMessage()
      offSessionEnd()
      offEnhancePrompt()
      sessionMap.clear()
    }
  }
}

/**
 * Build memory context markdown for system prompt injection.
 * Migrated from claude.ts L2397-2501.
 */
async function buildMemoryContext(
  projectId: string,
  prompt?: string,
): Promise<string | undefined> {
  try {
    const db = getDatabase()

    // Recent session summaries (stable context)
    const memorySess = db
      .select()
      .from(memorySessions)
      .where(eq(memorySessions.projectId, projectId))
      .orderBy(desc(memorySessions.startedAtEpoch))
      .limit(5)
      .all()

    // Hybrid search for semantically relevant observations
    let relevantObs: Array<{
      type: string
      title: string | null
      narrative: string | null
    }> = []

    const userPrompt = prompt?.trim()
    if (userPrompt && userPrompt.length > 5) {
      try {
        // 检查 vector store 是否就绪，避免首次初始化时阻塞
        const { isVectorStoreReady } = await import("./lib/vector-store")

        if (!isVectorStoreReady()) {
          memoryLog.info("[Memory] Vector store not ready, skipping hybrid search (will use recent fallback)")
        } else {
          const { hybridSearch } = await import("./lib/hybrid-search")

          // 给 hybridSearch 加超时保护，防止 vector store 初始化阻塞
          const SEARCH_TIMEOUT_MS = 10_000
          const searchPromise = hybridSearch({
            query: userPrompt,
            projectId,
            type: "observations",
            limit: 15,
          })
          const timeoutPromise = new Promise<never>((_, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Hybrid search timed out")),
              SEARCH_TIMEOUT_MS,
            )
            if (timer.unref) timer.unref()
          })

          const searchResults = await Promise.race([searchPromise, timeoutPromise])
          relevantObs = searchResults
            .filter((r) => r.type === "observation" && r.score > 0.005)
            .map((r) => ({
              type: (r as any).observationType || r.type,
              title: r.title,
              narrative: r.excerpt,
            }))

          memoryLog.info(
            `[Memory] Hybrid search completed - Found ${searchResults.length} results, filtered to ${relevantObs.length} relevant observations`,
          )
        }
      } catch (searchErr) {
        memoryLog.warn(
          "[Memory] Hybrid search failed, using recent:",
          searchErr,
        )
      }
    }

    // Fallback: recent observations（优先非对话类，不够则补充对话类）
    if (relevantObs.length === 0) {
      const recentObs = db
        .select()
        .from(observations)
        .where(eq(observations.projectId, projectId))
        .orderBy(desc(observations.createdAtEpoch))
        .limit(30)
        .all()

      // 优先取有价值的非对话类 observation
      const valuable = recentObs.filter(
        (o) => o.type !== "conversation" && o.type !== "response",
      )
      // 如果非对话类不足 5 条，补充对话类
      const fallbackObs =
        valuable.length >= 5
          ? valuable.slice(0, 15)
          : [...valuable, ...recentObs.filter((o) => !valuable.includes(o))].slice(0, 15)

      relevantObs = fallbackObs.map((o) => ({
        type: o.type,
        title: o.title,
        narrative: o.narrative,
      }))

      memoryLog.info(
        `[Memory] Using recent fallback - Total: ${recentObs.length}, Valuable: ${valuable.length}, Selected: ${relevantObs.length}`,
      )
    }

    // Build context markdown
    const lines: string[] = []
    if (memorySess.length > 0) {
      lines.push("## Recent Sessions\n")
      for (const session of memorySess) {
        if (session.summaryRequest) {
          lines.push(`- **${session.summaryRequest}**`)
          if (session.summaryLearned) {
            lines.push(`  - Learned: ${session.summaryLearned}`)
          }
          if (session.summaryCompleted) {
            lines.push(`  - Completed: ${session.summaryCompleted}`)
          }
        }
      }
      lines.push("")
    }
    if (relevantObs.length > 0) {
      lines.push("## Recent Observations\n")
      for (const o of relevantObs) {
        lines.push(`- [${o.type}] ${o.title}`)
        if (o.narrative) {
          lines.push(`  > ${o.narrative.slice(0, 200)}`)
        }
      }
    }

    const content = lines.join("\n")
    if (content.trim()) {
      const memorySection = `# Memory Context\nThe following is context from previous sessions with this project:\n\n${content}`

      // 调试信息：输出 build 的内容
      memoryLog.info(
        `[Memory Context] Built successfully - Sessions: ${memorySess.length}, Observations: ${relevantObs.length}`,
      )
      memoryLog.debug("[Memory Context] Content:\n" + memorySection)

      return memorySection
    }

    memoryLog.info("[Memory Context] No content to inject (no sessions or observations found)")
  } catch (err) {
    memoryLog.error("Failed to generate context:", err)
  }
  return undefined
}

export const memoryExtension = new MemoryExtension()
