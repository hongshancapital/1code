/**
 * Langfuse Extension - Utility Functions
 */

import type { TruncatedOutput } from "./types"

const MAX_OUTPUT_SIZE = 10 * 1024 // 10KB

/**
 * Anthropic 模型定价（美元/百万 token）
 * https://www.anthropic.com/pricing
 */
const MODEL_PRICING: Record<
  string,
  { input: number; output: number }
> = {
  "claude-opus-4-5": { input: 15, output: 75 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-sonnet-3-5": { input: 3, output: 15 },
  "claude-haiku-3-5": { input: 0.8, output: 4 },
  "claude-3-5-sonnet": { input: 3, output: 15 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
  "claude-3-opus": { input: 15, output: 75 },
  "claude-3-sonnet": { input: 3, output: 15 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
}

/**
 * 截断大输出内容
 */
export function sanitizeOutput(
  data: unknown
): string | TruncatedOutput {
  const str = typeof data === "string" ? data : JSON.stringify(data, null, 2)

  if (str.length <= MAX_OUTPUT_SIZE) {
    return str
  }

  return {
    _truncated: true,
    _originalLength: str.length,
    preview: str.slice(0, MAX_OUTPUT_SIZE) + "...[truncated]",
  }
}

/**
 * 计算 token 成本（美元）
 */
export function calculateTokenCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const normalizedModel = normalizeModelName(model)
  const pricing = MODEL_PRICING[normalizedModel]

  if (!pricing) {
    return null
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input
  const outputCost = (outputTokens / 1_000_000) * pricing.output

  return inputCost + outputCost
}

/**
 * 标准化模型名称（去除日期后缀）
 */
function normalizeModelName(model: string): string {
  return model.replace(/-\d{8}$/, "")
}

/**
 * 从 metadata 提取实际使用的模型
 */
export function extractModelFromMetadata(
  metadata?: Record<string, unknown>
): string {
  if (!metadata) return "unknown"

  if (typeof metadata.model === "string") {
    return metadata.model
  }

  return "unknown"
}

/**
 * 安全解析 JSON
 */
export function safeJsonParse<T = unknown>(
  str: string,
  fallback: T
): T {
  try {
    return JSON.parse(str) as T
  } catch {
    return fallback
  }
}

/**
 * 合并用户 prompts 为单个字符串
 */
export function mergePrompts(prompts: string[]): string {
  return prompts.join("\n\n---\n\n")
}

/**
 * 合并 assistant texts 为单个字符串
 */
export function mergeAssistantTexts(texts: string[]): string {
  return texts.join("\n\n")
}
