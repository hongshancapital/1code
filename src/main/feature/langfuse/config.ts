/**
 * Langfuse Extension - Configuration Module
 */

import type { LangfuseConfig } from "./types"

const DEFAULT_LANGFUSE_HOST = "https://cloud.langfuse.com"

/**
 * 从环境变量加载 Langfuse 配置
 */
export function loadLangfuseConfig(): LangfuseConfig | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY
  const secretKey = process.env.LANGFUSE_SECRET_KEY
  const baseUrl = process.env.LANGFUSE_HOST || DEFAULT_LANGFUSE_HOST

  if (!publicKey || !secretKey) {
    return null
  }

  return {
    publicKey: publicKey.trim(),
    secretKey: secretKey.trim(),
    baseUrl: baseUrl.trim(),
    enabled: true,
  }
}

/**
 * 检查 Langfuse 配置是否完整且启用
 */
export function isLangfuseEnabled(config: LangfuseConfig | null): boolean {
  if (!config) return false
  return (
    config.enabled &&
    Boolean(config.publicKey) &&
    Boolean(config.secretKey)
  )
}

/**
 * 验证配置合法性
 */
export function validateConfig(config: LangfuseConfig | null): {
  valid: boolean
  error?: string
} {
  if (!config) {
    return {
      valid: false,
      error: "Missing LANGFUSE_PUBLIC_KEY or LANGFUSE_SECRET_KEY environment variables",
    }
  }

  if (!config.publicKey.startsWith("pk-lf-")) {
    return {
      valid: false,
      error: "Invalid LANGFUSE_PUBLIC_KEY format (should start with pk-lf-)",
    }
  }

  if (!config.secretKey.startsWith("sk-lf-")) {
    return {
      valid: false,
      error: "Invalid LANGFUSE_SECRET_KEY format (should start with sk-lf-)",
    }
  }

  return { valid: true }
}
