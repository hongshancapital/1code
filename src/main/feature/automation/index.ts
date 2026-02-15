/**
 * Automation Extension
 *
 * 将 Automations 功能（Cron 触发 + AI 执行 + Inbox Actions）封装为 Extension。
 * 实现文件保留在 lib/automation/，此处为轻量 wrapper 提供 router 和生命周期管理。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { automationsRouter } from "../../lib/trpc/routers/automations"

class AutomationExtension implements ExtensionModule {
  name = "automations" as const
  description = "Cron-triggered AI workflows with inbox actions"
  router = automationsRouter
}

export const automationExtension = new AutomationExtension()
