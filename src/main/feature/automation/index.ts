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

class AutomationExtension implements ExtensionModule {
  name = "automations" as const
  description = "Cron-triggered AI workflows with inbox actions"
  router = automationsRouter

  initialize(_ctx: ExtensionContext): CleanupFn {
    // AutomationEngine 初始化（原在 src/main/index.ts 中手动调用）
    AutomationEngine.getInstance()
      .initialize()
      .catch((err) => {
        console.error("[AutomationExtension] init failed:", err)
      })

    return () => {
      AutomationEngine.getInstance().cleanup()
    }
  }
}

export const automationExtension = new AutomationExtension()
