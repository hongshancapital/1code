import { eq } from "drizzle-orm"
import {
  getDatabase,
  automations,
  automationExecutions,
  chats,
  subChats,
} from "../../../lib/db"
import { SchedulerService } from "./scheduler"
import { INBOX_PROJECT_ID } from "./inbox-project"
import type { TriggerData, TriggerConfig } from "./types"
import type {
  ClaudeEngine} from "../../../lib/claude";
import {
  createAutomationEngine as createClaudeAutomationEngine,
  AutomationPromptStrategy,
  createAutomationPolicy,
  createBufferChannel,
} from "../../../lib/claude"
import type { AuthManager } from "../../../auth-manager"

/**
 * 自动化执行引擎（单例）
 *
 * 使用 Claude Agent SDK (通过 ClaudeEngine) 执行 AI 任务
 * 支持 Tools, Skills, MCP Servers
 */
export class AutomationEngine {
  private static instance: AutomationEngine
  public scheduler = new SchedulerService()
  private claudeEngine: ClaudeEngine | null = null
  private authManager: AuthManager | null = null

  private constructor() {
    this.scheduler.setEngine(this)
  }

  static getInstance(): AutomationEngine {
    if (!this.instance) {
      this.instance = new AutomationEngine()
    }
    return this.instance
  }

  /**
   * 设置 AuthManager (用于 MCP 认证)
   */
  setAuthManager(authManager: AuthManager): void {
    this.authManager = authManager
  }

  /**
   * 初始化引擎（应用启动时调用）
   *
   * @param _apiKey - 已废弃，不再使用。现在使用 OAuth 认证。
   */
  async initialize(_apiKey?: string): Promise<void> {
    // 创建 Claude Engine (使用 Claude Agent SDK)
    this.claudeEngine = createClaudeAutomationEngine()

    const db = getDatabase()
    const allAutomations = await db
      .select()
      .from(automations)
      .where(eq(automations.isEnabled, true))
      .all()

    // 注册所有启用的自动化触发器
    for (const automation of allAutomations) {
      await this.registerTriggers(
        automation.id,
        JSON.parse(automation.triggers),
      )
    }

    // 检查错过的任务
    await this.scheduler.checkMissedTasks()

    console.log(
      `[AutomationEngine] Initialized with ${allAutomations.length} automations (using Claude Agent SDK)`,
    )
  }

  /**
   * 注册触发器
   */
  async registerTriggers(
    automationId: string,
    triggers: TriggerConfig[],
  ): Promise<void> {
    for (const trigger of triggers) {
      if (trigger.type === "cron") {
        this.scheduler.registerCronTrigger(
          automationId,
          trigger.config.expression,
          trigger.config.strict || false,
        )
      }
      // 其他触发器类型后续实现
    }
  }

  /**
   * 执行自动化
   */
  async executeAutomation(
    automationId: string,
    triggerData: TriggerData,
  ): Promise<string> {
    const db = getDatabase()
    const startTime = Date.now()

    // 1. 创建执行记录
    const [execution] = await db
      .insert(automationExecutions)
      .values({
        automationId,
        triggeredBy: triggerData.triggeredBy,
        triggerData: JSON.stringify(triggerData.triggerData || {}),
        status: "running",
      })
      .returning()

    try {
      // 2. 加载自动化配置
      const automation = await db
        .select()
        .from(automations)
        .where(eq(automations.id, automationId))
        .get()

      if (!automation) {
        throw new Error("Automation not found")
      }

      // 3. 调用 Claude AI
      let claudeResponse = { text: "No AI processing" }
      if (this.claudeEngine && automation.agentPrompt) {
        claudeResponse = await this.invokeClaude(automation)
      }

      // 4. 执行 Actions
      const actionResults = await this.executeActions(
        automation,
        claudeResponse,
        execution.id,
      )

      // 5. 更新执行状态
      await db
        .update(automationExecutions)
        .set({
          status: "success",
          result: JSON.stringify({ claudeResponse, actionResults }),
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        })
        .where(eq(automationExecutions.id, execution.id))

      // 6. 更新自动化统计
      await db
        .update(automations)
        .set({
          lastTriggeredAt: new Date(),
          totalExecutions: (automation.totalExecutions ?? 0) + 1,
          successfulExecutions: (automation.successfulExecutions ?? 0) + 1,
          updatedAt: new Date(),
        })
        .where(eq(automations.id, automationId))

      return execution.id
    } catch (error) {
      // 失败处理
      await db
        .update(automationExecutions)
        .set({
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        })
        .where(eq(automationExecutions.id, execution.id))

      const automation = await db
        .select()
        .from(automations)
        .where(eq(automations.id, automationId))
        .get()

      if (automation) {
        await db
          .update(automations)
          .set({
            totalExecutions: (automation.totalExecutions ?? 0) + 1,
            failedExecutions: (automation.failedExecutions ?? 0) + 1,
            updatedAt: new Date(),
          })
          .where(eq(automations.id, automationId))
      }

      throw error
    }
  }

  /**
   * 调用 Claude AI (使用 Claude Agent SDK)
   */
  private async invokeClaude(automation: any): Promise<{ text: string }> {
    if (!this.claudeEngine) {
      return { text: automation.agentPrompt }
    }

    // 创建输出缓冲区收集结果
    const outputBuffer = createBufferChannel()

    // 使用 ClaudeEngine 执行
    const result = await this.claudeEngine.runToCompletion({
      prompt: automation.agentPrompt,
      promptStrategy: AutomationPromptStrategy,
      context: {
        cwd: process.cwd(), // Automation 通常不需要特定工作目录
        includeBuiltin: true,
        includePlugins: false, // Automation 默认不加载插件 MCP
      },
      configOverride: automation.configOverride,
      policy: createAutomationPolicy(),
      outputChannel: outputBuffer,
      authManager: this.authManager || undefined,
      model: automation.modelId,
    })

    return { text: result.text }
  }

  /**
   * 执行 Actions
   */
  private async executeActions(
    automation: any,
    claudeResponse: any,
    executionId: string,
  ): Promise<any[]> {
    const actions = JSON.parse(automation.actions)
    const results = []

    for (const action of actions) {
      if (action.type === "inbox") {
        const result = await this.createInboxMessage(
          automation,
          claudeResponse,
          executionId,
        )
        results.push(result)
      }
      // 其他执行器后续实现
    }

    return results
  }

  /**
   * 创建 Inbox 消息
   */
  private async createInboxMessage(
    automation: any,
    claudeResponse: any,
    executionId: string,
  ): Promise<any> {
    const db = getDatabase()

    // 1. 创建 Chat
    const [chat] = await db
      .insert(chats)
      .values({
        name: `${automation.name} - ${new Date().toLocaleString()}`,
        projectId: INBOX_PROJECT_ID,
      })
      .returning()

    // 2. 创建 SubChat（包含 AI 响应）
    const messages = JSON.stringify([
      {
        id: `msg-${Date.now()}`,
        role: "assistant",
        parts: [{ type: "text", text: claudeResponse.text }],
      },
    ])

    await db.insert(subChats).values({
      chatId: chat.id,
      messages,
      mode: "agent",
    })

    // 3. 关联到执行记录
    await db
      .update(automationExecutions)
      .set({
        inboxChatId: chat.id,
      })
      .where(eq(automationExecutions.id, executionId))

    return { chatId: chat.id }
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.scheduler.cleanup()
  }
}
