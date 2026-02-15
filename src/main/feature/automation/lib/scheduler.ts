import cron, { type ScheduledTask } from "node-cron"
import { eq } from "drizzle-orm"
import { getDatabase, automations } from "../../../lib/db"
import type { AutomationEngine } from "./engine"
import { createLogger } from "../../../lib/logger"

const schedulerLog = createLogger("Scheduler")


/**
 * 定时任务调度服务
 */
export class SchedulerService {
  private tasks = new Map<string, ScheduledTask[]>()
  private engine: AutomationEngine | null = null

  setEngine(engine: AutomationEngine): void {
    this.engine = engine
  }

  /**
   * 注册 cron 触发器
   */
  registerCronTrigger(
    automationId: string,
    expression: string,
    _strict: boolean,
  ): void {
    const task = cron.schedule(
      expression,
      async () => {
        schedulerLog.info(`Cron triggered: ${automationId}`)

        if (!this.engine) {
          schedulerLog.error("Engine not set")
          return
        }

        await this.engine.executeAutomation(automationId, {
          triggeredBy: "cron",
          triggerData: { expression, timestamp: new Date() },
        })
      },
      {
        timezone: "Asia/Shanghai",
      },
    )

    task.start()

    const existing = this.tasks.get(automationId) || []
    existing.push(task)
    this.tasks.set(automationId, existing)
  }

  /**
   * 取消注册
   */
  unregisterAutomation(automationId: string): void {
    const tasks = this.tasks.get(automationId)
    if (tasks) {
      tasks.forEach((t) => t.stop())
      this.tasks.delete(automationId)
    }
  }

  /**
   * 启动时检查错过的任务（仅非严格模式）
   */
  async checkMissedTasks(): Promise<void> {
    if (!this.engine) {
      schedulerLog.error("Engine not set for missed tasks check")
      return
    }

    const db = getDatabase()
    const now = new Date()

    const allAutomations = await db
      .select()
      .from(automations)
      .where(eq(automations.isEnabled, true))
      .all()

    for (const automation of allAutomations) {
      const triggers = JSON.parse(automation.triggers) as Array<{
        type: string
        config: { expression: string; strict: boolean }
      }>

      for (const trigger of triggers) {
        if (trigger.type !== "cron") continue
        if (trigger.config.strict) continue // 严格模式不补偿

        // 检查是否需要触发
        if (
          this.shouldTriggerMissed(
            trigger.config.expression,
            automation.lastTriggeredAt,
            now,
          )
        ) {
          schedulerLog.info(`Triggering missed task: ${automation.id}`)

          await this.engine.executeAutomation(automation.id, {
            triggeredBy: "startup-missed",
            triggerData: {
              reason: "missed-task",
              expression: trigger.config.expression,
            },
          })
        }
      }
    }
  }

  /**
   * 判断是否应该触发错过的任务
   */
  private shouldTriggerMissed(
    _expression: string,
    lastTriggeredAt: Date | null,
    now: Date,
  ): boolean {
    if (!lastTriggeredAt) return true

    // 简单实现：如果距离上次触发超过1天，则触发
    const oneDayMs = 24 * 60 * 60 * 1000
    return now.getTime() - lastTriggeredAt.getTime() > oneDayMs
  }

  /**
   * 清理所有任务
   */
  cleanup(): void {
    for (const tasks of this.tasks.values()) {
      tasks.forEach((t) => t.stop())
    }
    this.tasks.clear()
  }
}
