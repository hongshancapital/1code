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
} from "../../lib/extension/types"
import { memoryHooks } from "../../lib/memory/hooks"
import { setSummaryModelConfig } from "../../lib/memory/summarizer"
import { getDatabase, memorySessions, observations } from "../../lib/db"
import { eq, desc } from "drizzle-orm"
import { memoryRouter } from "../../lib/trpc/routers/memory"

class MemoryExtension implements ExtensionModule {
  name = "memory" as const
  description = "Memory session tracking and context injection"
  router = memoryRouter

  private sessionMap = new Map<string, string>() // subChatId → memorySessionId
  private cleanupFns: Array<() => void> = []

  async initialize(ctx: ExtensionContext): Promise<void> {
    // chat:sessionStart — 创建 memory session + 记录 user prompt
    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:sessionStart",
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
            const sessionId = await memoryHooks.onSessionStart({
              subChatId: payload.subChatId,
              projectId: payload.projectId,
              chatId: payload.chatId,
            })
            if (sessionId) {
              this.sessionMap.set(payload.subChatId, sessionId)
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
      ),
    )

    // chat:toolOutput — 记录工具输出
    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:toolOutput",
        async (payload) => {
          const sessionId = this.sessionMap.get(payload.subChatId)
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
      ),
    )

    // chat:assistantMessage — 记录 AI 回复
    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:assistantMessage",
        async (payload) => {
          const sessionId = this.sessionMap.get(payload.subChatId)
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
      ),
    )

    // chat:sessionEnd — 结束 session
    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:sessionEnd",
        async (payload) => {
          const sessionId = this.sessionMap.get(payload.subChatId)
          if (!sessionId) return

          await memoryHooks.onSessionEnd({
            sessionId,
            subChatId: payload.subChatId,
          })
          this.sessionMap.delete(payload.subChatId)
        },
        { source: this.name },
      ),
    )

    // chat:enhancePrompt — Memory Context 注入（priority=50，在 Browser 之前）
    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:enhancePrompt",
        async (payload) => {
          if (payload.memoryEnabled === false || !payload.projectId)
            return payload

          const memorySection = await buildMemoryContext(
            payload.projectId,
            payload.prompt,
          )
          if (memorySection) {
            return {
              ...payload,
              appendSections: [...payload.appendSections, memorySection],
            }
          }
          return payload
        },
        { source: this.name, priority: 50 },
      ),
    )
  }

  async cleanup(): Promise<void> {
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    this.sessionMap.clear()
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
        const { hybridSearch } = await import("../../lib/memory/hybrid-search")
        const searchResults = await hybridSearch({
          query: userPrompt,
          projectId,
          type: "observations",
          limit: 15,
        })
        relevantObs = searchResults
          .filter((r) => r.type === "observation" && r.score > 0.005)
          .map((r) => ({
            type: (r as any).observationType || r.type,
            title: r.title,
            narrative: r.excerpt,
          }))
      } catch (searchErr) {
        console.warn(
          "[Memory] Hybrid search failed, using recent:",
          searchErr,
        )
      }
    }

    // Fallback: recent observations
    if (relevantObs.length === 0) {
      const recentObs = db
        .select()
        .from(observations)
        .where(eq(observations.projectId, projectId))
        .orderBy(desc(observations.createdAtEpoch))
        .limit(30)
        .all()
      relevantObs = recentObs
        .filter((o) => o.type !== "conversation" && o.type !== "response")
        .slice(0, 15)
        .map((o) => ({
          type: o.type,
          title: o.title,
          narrative: o.narrative,
        }))
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
      return `# Memory Context\nThe following is context from previous sessions with this project:\n\n${content}`
    }
  } catch (err) {
    console.error("[Memory] Failed to generate context:", err)
  }
  return undefined
}

export const memoryExtension = new MemoryExtension()
