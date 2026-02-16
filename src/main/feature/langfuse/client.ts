/**
 * Langfuse Extension - SDK Client Wrapper
 */

import Langfuse from "langfuse"
import type { LangfuseConfig } from "./types"
import type {
  CreateGenerationBody,
  CreateSpanBody,
} from "langfuse-core"

let langfuseInstance: Langfuse | null = null

/**
 * Langfuse SDK 客户端封装
 * 提供类型安全的 API，幂等初始化
 */
export class LangfuseClient {
  private client: Langfuse | null = null

  /**
   * 初始化 Langfuse 客户端（幂等）
   */
  async init(config: LangfuseConfig): Promise<void> {
    if (langfuseInstance) {
      this.client = langfuseInstance
      return
    }

    this.client = new Langfuse({
      publicKey: config.publicKey,
      secretKey: config.secretKey,
      baseUrl: config.baseUrl,
      flushAt: 15, // 15 条记录批量上传
      flushInterval: 10000, // 10 秒自动刷新
    })

    langfuseInstance = this.client
  }

  /**
   * 创建 Trace（会话级容器）
   */
  createTrace(input: {
    id?: string
    name: string
    userId?: string
    metadata?: Record<string, unknown>
    tags?: string[]
  }): string {
    if (!this.client) {
      throw new Error("Langfuse client not initialized")
    }

    const trace = this.client.trace({
      id: input.id,
      name: input.name,
      userId: input.userId,
      metadata: input.metadata,
      tags: input.tags,
    })

    return trace.id
  }

  /**
   * 创建 Generation（AI 输出，含 token 统计）
   */
  createGeneration(input: {
    traceId: string
    name: string
    model: string
    input: unknown
    output?: unknown
    usage?: {
      input: number
      output: number
      total: number
    }
    metadata?: Record<string, unknown>
    startTime: Date
    endTime?: Date
    level?: "DEFAULT" | "ERROR"
  }): string {
    if (!this.client) {
      throw new Error("Langfuse client not initialized")
    }

    const trace = this.client.trace({ id: input.traceId })

    const generationBody: CreateGenerationBody = {
      name: input.name,
      model: input.model,
      input: input.input,
      output: input.output,
      usage: input.usage
        ? {
            input: input.usage.input,
            output: input.usage.output,
            total: input.usage.total,
          }
        : undefined,
      metadata: input.metadata,
      startTime: input.startTime,
      endTime: input.endTime || new Date(),
      level: input.level || "DEFAULT",
    }

    const generation = trace.generation(generationBody)

    return generation.id
  }

  /**
   * 创建 Span（工具调用）
   */
  createSpan(input: {
    traceId: string
    name: string
    input: unknown
    output?: unknown
    metadata?: Record<string, unknown>
    startTime: Date
    endTime?: Date
    level?: "DEFAULT" | "ERROR"
  }): string {
    if (!this.client) {
      throw new Error("Langfuse client not initialized")
    }

    const trace = this.client.trace({ id: input.traceId })

    const spanBody: CreateSpanBody = {
      name: input.name,
      input: input.input,
      output: input.output,
      metadata: input.metadata,
      startTime: input.startTime,
      endTime: input.endTime || new Date(),
      level: input.level || "DEFAULT",
    }

    const span = trace.span(spanBody)

    return span.id
  }

  /**
   * 更新 Trace
   */
  updateTrace(input: {
    traceId: string
    output?: unknown
    metadata?: Record<string, unknown>
  }): void {
    if (!this.client) {
      throw new Error("Langfuse client not initialized")
    }

    const trace = this.client.trace({ id: input.traceId })
    trace.update({
      output: input.output,
      metadata: input.metadata,
    })
  }

  /**
   * 强制上传所有待发送数据
   */
  async flush(): Promise<void> {
    if (!this.client) return

    await this.client.flushAsync()
  }

  /**
   * 关闭客户端
   */
  async shutdown(): Promise<void> {
    if (!this.client) return

    await this.client.shutdownAsync()
    langfuseInstance = null
    this.client = null
  }

  /**
   * 检查客户端是否已初始化
   */
  isInitialized(): boolean {
    return this.client !== null
  }
}
