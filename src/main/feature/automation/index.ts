/**
 * Automation Extension
 *
 * Cron 触发 + AI 执行 + Inbox Actions。
 */

import type {
  ExtensionModule,
  ExtensionContext,
  CleanupFn,
} from "../../lib/extension/types"
import { automationsRouter } from "./router"
import { AutomationEngine } from "./lib/engine"
import { createLogger } from "../../lib/logger"

const automationExtensionLog = createLogger("AutomationExtension")


class AutomationExtension implements ExtensionModule {
  name = "automations" as const
  description = "Cron-triggered AI workflows with inbox actions"
  router = automationsRouter

  initialize(_ctx: ExtensionContext): CleanupFn {
    // AutomationEngine 初始化（原在 src/main/index.ts 中手动调用）
    AutomationEngine.getInstance()
      .initialize()
      .catch((err) => {
        automationExtensionLog.error("init failed:", err)
      })

    return () => {
      AutomationEngine.getInstance().cleanup()
    }
  }
}

export const automationExtension = new AutomationExtension()
