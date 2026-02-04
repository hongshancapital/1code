/**
 * Feature Flags 统一配置
 *
 * 所有功能开关在此统一维护，一目了然
 */

// ============================================
// 环境检测
// ============================================
export const IS_DEV = process.env.NODE_ENV === "development"

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
  /** Kanban 看板功能 */
  kanban: {
    name: "Kanban Board",
    devOnly: true,
    beta: true,
    description: "Visual kanban board for task management",
  },
  /** Offline 模式 */
  offline: {
    name: "Offline Mode",
    devOnly: true,
    beta: true,
    description: "Use local Ollama models when offline",
  },
  // 未来可以在此添加更多功能...
} as const satisfies Record<string, FeatureFlag>

// ============================================
// 判断函数
// ============================================

/**
 * 检查功能是否可用
 * - devOnly 功能在非 dev 模式下始终返回 false
 */
export function isFeatureAvailable(feature: keyof typeof FEATURE_FLAGS): boolean {
  const flag = FEATURE_FLAGS[feature]
  if (flag.devOnly && !IS_DEV) {
    return false
  }
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
