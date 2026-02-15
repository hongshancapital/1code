import { z } from "zod"
import { eq, desc } from "drizzle-orm"
import { router, publicProcedure } from "../../lib/trpc/index"
import {
  getDatabase,
  automations,
  automationExecutions,
  chats,
} from "../../lib/db"
import { AutomationEngine } from "./lib/engine"
import { INBOX_PROJECT_ID } from "./lib/inbox-project"

export const automationsRouter = router({
  /**
   * 列出所有自动化
   */
  list: publicProcedure.query(async () => {
    const db = getDatabase()
    return await db
      .select()
      .from(automations)
      .orderBy(desc(automations.createdAt))
      .all()
  }),

  /**
   * 创建自动化
   */
  create: publicProcedure
    .input(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        triggers: z.array(z.any()),
        agentPrompt: z.string(),
        skills: z.array(z.string()).optional(),
        actions: z.array(z.any()),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      const [automation] = await db
        .insert(automations)
        .values({
          ...input,
          triggers: JSON.stringify(input.triggers),
          skills: JSON.stringify(input.skills || []),
          actions: JSON.stringify(input.actions),
        })
        .returning()

      // 注册触发器
      await AutomationEngine.getInstance().registerTriggers(
        automation.id,
        input.triggers,
      )

      return automation
    }),

  /**
   * 更新自动化
   */
  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        isEnabled: z.boolean().optional(),
        triggers: z.array(z.any()).optional(),
        agentPrompt: z.string().optional(),
        actions: z.array(z.any()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const { id, ...updates } = input

      const updateData: any = { ...updates, updatedAt: new Date() }
      if (updates.triggers)
        updateData.triggers = JSON.stringify(updates.triggers)
      if (updates.actions) updateData.actions = JSON.stringify(updates.actions)

      const result = await db
        .update(automations)
        .set(updateData)
        .where(eq(automations.id, id))
        .returning()
        .get()

      // 重新注册触发器
      if (updates.triggers || updates.isEnabled !== undefined) {
        const engine = AutomationEngine.getInstance()
        engine.scheduler.unregisterAutomation(id)

        if (updates.isEnabled !== false) {
          await engine.registerTriggers(
            id,
            updates.triggers || JSON.parse(result.triggers),
          )
        }
      }

      return result
    }),

  /**
   * 删除自动化
   */
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // 取消注册触发器
      AutomationEngine.getInstance().scheduler.unregisterAutomation(input.id)

      return await db
        .delete(automations)
        .where(eq(automations.id, input.id))
        .returning()
        .get()
    }),

  /**
   * 获取 Inbox 消息列表
   */
  getInboxChats: publicProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input }) => {
      const db = getDatabase()

      // 查询 Inbox 项目下的所有 chats
      const inboxChats = await db
        .select()
        .from(chats)
        .where(eq(chats.projectId, INBOX_PROJECT_ID))
        .orderBy(desc(chats.createdAt))
        .limit(input.limit)
        .all()

      // 关联执行信息
      const chatsWithExecution = await Promise.all(
        inboxChats.map(async (chat) => {
          const execution = await db
            .select()
            .from(automationExecutions)
            .where(eq(automationExecutions.inboxChatId, chat.id))
            .get()

          const automation = execution
            ? await db
                .select()
                .from(automations)
                .where(eq(automations.id, execution.automationId))
                .get()
            : null

          return {
            id: chat.id,
            executionId: execution?.id || "",
            name: chat.name || "Untitled",
            createdAt: chat.createdAt,
            automationId: automation?.id || "",
            automationName: automation?.name || "Unknown",
            externalUrl: null,
            status: execution?.status || "unknown",
            isRead: false, // 暂时默认未读
          }
        }),
      )

      return { chats: chatsWithExecution }
    }),

  /**
   * 获取执行历史
   */
  listExecutions: publicProcedure
    .input(
      z.object({
        automationId: z.string().optional(),
        limit: z.number().default(20),
      }),
    )
    .query(async ({ input }) => {
      const db = getDatabase()

      let query = db.select().from(automationExecutions)

      if (input.automationId) {
        query = query.where(
          eq(automationExecutions.automationId, input.automationId),
        ) as any
      }

      return await query
        .orderBy(desc(automationExecutions.startedAt))
        .limit(input.limit)
        .all()
    }),

  /**
   * 手动触发自动化
   */
  trigger: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const executionId = await AutomationEngine.getInstance().executeAutomation(
        input.id,
        {
          triggeredBy: "manual",
          triggerData: { timestamp: new Date() },
        },
      )

      return { executionId }
    }),
})
