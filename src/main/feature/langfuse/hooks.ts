/**
 * Langfuse Extension - Hook Handlers
 */

import type { LangfuseClient } from "./client"
import type { TraceContext } from "./types"
import {
  sanitizeOutput,
  calculateTokenCost,
  extractModelFromMetadata,
  mergePrompts,
  mergeAssistantTexts,
} from "./utils"
import type { Logger } from "../../lib/logger"

/**
 * Hook 处理逻辑封装
 * 维护 traceMap，处理各个生命周期事件
 */
export class LangfuseHooks {
  private traceMap = new Map<string, TraceContext>()

  constructor(
    private client: LangfuseClient,
    private logger: Logger
  ) {}

  /**
   * SessionStart - 创建 Trace
   */
  async onSessionStart(payload: {
    subChatId: string
    projectId: string
    mode: "plan" | "agent"
    initialPrompt?: string
  }): Promise<void> {
    const { subChatId, projectId, mode, initialPrompt } = payload

    try {
      const traceId = this.client.createTrace({
        id: subChatId,
        name: `Claude ${mode} Session`,
        metadata: {
          projectId,
          mode,
          platform: "hong-desktop",
        },
        tags: [mode, "claude-code"],
      })

      const context: TraceContext = {
        traceId,
        subChatId,
        projectId,
        mode,
        prompts: initialPrompt ? [initialPrompt] : [],
        assistantTexts: [],
        startTime: new Date(),
      }

      this.traceMap.set(subChatId, context)

      this.logger.debug(`[Langfuse] Trace created: ${traceId}`)
    } catch (error) {
      this.logger.error(
        "[Langfuse] Error creating trace:",
        error
      )
    }
  }

  /**
   * UserPrompt - 累积用户输入
   */
  async onUserPrompt(payload: {
    subChatId: string
    prompt: string
  }): Promise<void> {
    const { subChatId, prompt } = payload
    const context = this.traceMap.get(subChatId)

    if (!context) {
      this.logger.warn(
        `[Langfuse] No trace found for subChatId: ${subChatId}`
      )
      return
    }

    try {
      context.prompts.push(prompt)
      this.logger.debug(
        `[Langfuse] User prompt added to trace ${context.traceId}`
      )
    } catch (error) {
      this.logger.error(
        "[Langfuse] Error handling user prompt:",
        error
      )
    }
  }

  /**
   * ToolOutput - 创建 Span（工具调用）
   */
  async onToolOutput(payload: {
    subChatId: string
    toolName: string
    input: unknown
    output: unknown
    startTime: Date
    endTime?: Date
    error?: string
  }): Promise<void> {
    const {
      subChatId,
      toolName,
      input,
      output,
      startTime,
      endTime,
      error,
    } = payload
    const context = this.traceMap.get(subChatId)

    if (!context) {
      this.logger.warn(
        `[Langfuse] No trace found for subChatId: ${subChatId}`
      )
      return
    }

    try {
      const sanitizedOutput = sanitizeOutput(output)

      this.client.createSpan({
        traceId: context.traceId,
        name: toolName,
        input: input,
        output: error ? { error } : sanitizedOutput,
        metadata: {
          toolName,
          hasError: Boolean(error),
        },
        startTime,
        endTime: endTime || new Date(),
        level: error ? "ERROR" : "DEFAULT",
      })

      this.logger.debug(
        `[Langfuse] Span created for tool: ${toolName}`
      )
    } catch (error) {
      this.logger.error(
        "[Langfuse] Error creating span:",
        error
      )
    }
  }

  /**
   * AssistantMessage - 累积 AI 输出文本
   */
  async onAssistantMessage(payload: {
    subChatId: string
    text: string
  }): Promise<void> {
    const { subChatId, text } = payload
    const context = this.traceMap.get(subChatId)

    if (!context) {
      this.logger.warn(
        `[Langfuse] No trace found for subChatId: ${subChatId}`
      )
      return
    }

    try {
      context.assistantTexts.push(text)
      this.logger.debug(
        `[Langfuse] Assistant text added to trace ${context.traceId}`
      )
    } catch (error) {
      this.logger.error(
        "[Langfuse] Error handling assistant message:",
        error
      )
    }
  }

  /**
   * StreamComplete - 创建 Generation（流成功）
   */
  async onStreamComplete(payload: {
    subChatId: string
    metadata?: Record<string, unknown>
    usage?: {
      inputTokens: number
      outputTokens: number
    }
  }): Promise<void> {
    const { subChatId, metadata, usage } = payload
    const context = this.traceMap.get(subChatId)

    if (!context) {
      this.logger.warn(
        `[Langfuse] No trace found for subChatId: ${subChatId}`
      )
      return
    }

    try {
      const model = extractModelFromMetadata(metadata)
      const inputText = mergePrompts(context.prompts)
      const outputText = mergeAssistantTexts(context.assistantTexts)

      const usageData = usage
        ? {
            input: usage.inputTokens,
            output: usage.outputTokens,
            total: usage.inputTokens + usage.outputTokens,
          }
        : undefined

      let cost: number | null = null
      if (usage) {
        cost = calculateTokenCost(
          model,
          usage.inputTokens,
          usage.outputTokens
        )
      }

      this.client.createGeneration({
        traceId: context.traceId,
        name: "Claude Response",
        model,
        input: inputText,
        output: outputText,
        usage: usageData,
        metadata: {
          ...metadata,
          cost: cost !== null ? `$${cost.toFixed(6)}` : undefined,
        },
        startTime: context.startTime,
        endTime: new Date(),
        level: "DEFAULT",
      })

      this.logger.debug(
        `[Langfuse] Generation created for trace ${context.traceId}`
      )
    } catch (error) {
      this.logger.error(
        "[Langfuse] Error creating generation:",
        error
      )
    }
  }

  /**
   * StreamError - 创建 Generation（流出错）
   */
  async onStreamError(payload: {
    subChatId: string
    error: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const { subChatId, error, metadata } = payload
    const context = this.traceMap.get(subChatId)

    if (!context) {
      this.logger.warn(
        `[Langfuse] No trace found for subChatId: ${subChatId}`
      )
      return
    }

    try {
      const model = extractModelFromMetadata(metadata)
      const inputText = mergePrompts(context.prompts)

      this.client.createGeneration({
        traceId: context.traceId,
        name: "Claude Response (Error)",
        model,
        input: inputText,
        output: { error },
        metadata: {
          ...metadata,
          hasError: true,
        },
        startTime: context.startTime,
        endTime: new Date(),
        level: "ERROR",
      })

      this.logger.debug(
        `[Langfuse] Error generation created for trace ${context.traceId}`
      )
    } catch (err) {
      this.logger.error(
        "[Langfuse] Error creating error generation:",
        err
      )
    }
  }

  /**
   * SessionEnd - 完成 Trace
   */
  async onSessionEnd(payload: {
    subChatId: string
    output?: unknown
  }): Promise<void> {
    const { subChatId, output } = payload
    const context = this.traceMap.get(subChatId)

    if (!context) {
      this.logger.warn(
        `[Langfuse] No trace found for subChatId: ${subChatId}`
      )
      return
    }

    try {
      this.client.updateTrace({
        traceId: context.traceId,
        output: output || { completed: true },
        metadata: {
          endTime: new Date().toISOString(),
        },
      })

      this.logger.debug(
        `[Langfuse] Trace completed: ${context.traceId}`
      )
    } catch (error) {
      this.logger.error(
        "[Langfuse] Error completing trace:",
        error
      )
    }
  }

  /**
   * Cleanup - 清空 traceMap
   */
  async onCleanup(payload: { subChatId: string }): Promise<void> {
    const { subChatId } = payload

    try {
      const deleted = this.traceMap.delete(subChatId)
      if (deleted) {
        this.logger.debug(
          `[Langfuse] Trace context cleaned up for ${subChatId}`
        )
      }
    } catch (error) {
      this.logger.error(
        "[Langfuse] Error cleaning up trace:",
        error
      )
    }
  }

  /**
   * 获取当前活跃的 trace 数量（用于调试）
   */
  getActiveTracesCount(): number {
    return this.traceMap.size
  }

  /**
   * 清空所有 trace（用于 Extension 关闭）
   */
  clearAll(): void {
    this.traceMap.clear()
    this.logger.debug("[Langfuse] All traces cleared")
  }
}
