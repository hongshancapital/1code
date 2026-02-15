/**
 * 自动化引擎模块导出
 *
 * 使用方式：
 * ```typescript
 * import { AutomationEngine, ensureInboxProject, INBOX_PROJECT_ID } from './automation'
 *
 * // 初始化
 * await ensureInboxProject()
 * await AutomationEngine.getInstance().initialize(apiKey)
 *
 * // 执行自动化
 * await AutomationEngine.getInstance().executeAutomation(automationId, {
 *   triggeredBy: 'manual',
 *   triggerData: { timestamp: new Date() }
 * })
 *
 * // 清理
 * AutomationEngine.getInstance().cleanup()
 * ```
 */

export { AutomationEngine } from "./engine"
export { SchedulerService } from "./scheduler"
export { ensureInboxProject, INBOX_PROJECT_ID } from "./inbox-project"
export type {
  TriggerData,
  TriggerConfig,
  ActionConfig,
} from "./types"
