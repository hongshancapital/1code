/**
 * Feature Flags 统一配置
 *
 * 所有功能开关在此统一维护，一目了然
 */

import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// ============================================
// 环境检测
// ============================================
export const IS_DEV = process.env.NODE_ENV === "development"

// ============================================
// Beta 功能用户设置
// ============================================

// Beta 功能开关 - 用户可以启用/禁用 beta 功能
// 使用 atomWithStorage 持久化到 localStorage
export const betaFeaturesAtom = atomWithStorage<Record<string, boolean>>("hong-beta-features", {})

// 检查 beta 功能是否启用（需要用户手动开启）
export function isBetaFeatureEnabled(feature: keyof typeof FEATURE_FLAGS): boolean {
  // dev 模式下所有 beta 功能默认启用
  if (IS_DEV) return true

  // 非 dev 模式从 localStorage 读取用户设置
  // 默认返回 false（功能关闭）
  return false
}

// ============================================
// Feature Flags 定义
// ============================================

interface FeatureFlag {
  /** 功能名称 */
  name: string
  /** 是否仅 dev 模式可用 */
  devOnly: boolean
  /** 是否为 beta 功能（需要用户手动开启） */
  beta: boolean
  /** 功能描述 */
  description: string
}

export const FEATURE_FLAGS = {
  /** Automations & Inbox 功能 */
  automations: {
    name: "Automations & Inbox",
    devOnly: true,   // 仅 dev 模式
    beta: true,      // beta 功能
    description: "Background automations and inbox for scheduled tasks",
  },
  /** Offline 模式 */
  offline: {
    name: "Offline Mode",
    devOnly: true,
    beta: true,
    description: "Use local Ollama models when offline",
  },
  /** Browser 浏览器功能 */
  browser: {
    name: "Browser",
    devOnly: false,  // 生产环境可用
    beta: true,      // beta 功能
    description: "Built-in browser for AI-driven web automation",
  },
  /** Voice Input 语音输入功能 */
  voiceInput: {
    name: "Voice Input",
    devOnly: true,   // 仅 dev 模式可开启（调试中）
    beta: true,      // beta 功能
    description: "Voice input for chat using local whisper or OpenAI Whisper API",
  },
  // 未来可以在此添加更多功能...
} as const satisfies Record<string, FeatureFlag>

// ============================================
// 判断函数
// ============================================

/**
 * 检查功能是否可用（非组件版本）
 * - devOnly 功能在非 dev 模式下始终返回 false
 * - beta 功能需要用户手动启用
 * 注意：在 React 组件中使用 useIsFeatureAvailable hook 版本
 */
export function isFeatureAvailable(feature: keyof typeof FEATURE_FLAGS): boolean {
  const flag = FEATURE_FLAGS[feature]
  if (flag.devOnly && !IS_DEV) {
    return false
  }
  // beta 功能需要用户手动启用（在组件中检查）
  return true
}

/**
 * 检查功能是否为 dev only
 */
export function isDevOnlyFeature(feature: keyof typeof FEATURE_FLAGS): boolean {
  return FEATURE_FLAGS[feature].devOnly
}

/**
 * 检查功能是否为 beta
 */
export function isBetaFeature(feature: keyof typeof FEATURE_FLAGS): boolean {
  return FEATURE_FLAGS[feature].beta
}
