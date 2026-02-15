import { and, desc, eq, gte, lte, sql } from "drizzle-orm"
import { z } from "zod"
import { getDatabase, modelUsage, projects, chats, subChats, anthropicAccounts, anthropicSettings } from "../../db"
import { decryptToken } from "../../crypto"
import { publicProcedure, router } from "../index"
import { createLogger } from "../../logger"

const usageLog = createLogger("Usage")


// Date range schema for filtering
const dateRangeSchema = z.object({
  startDate: z.string().optional(), // ISO date string, e.g., "2024-01-01"
  endDate: z.string().optional(),
})

export const usageRouter = router({
  /**
   * Record a single usage entry (called internally by claude.ts)
   */
  record: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        projectId: z.string(),
        model: z.string(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        totalTokens: z.number(),
        costUsd: z.number().optional(),
        sessionId: z.string().optional(),
        messageUuid: z.string().optional(),
        mode: z.enum(["plan", "agent"]).optional(),
        source: z.enum(["chat", "memory", "automation"]).optional(),
        durationMs: z.number().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()

      // Check for duplicate by messageUuid
      if (input.messageUuid) {
        const existing = db
          .select()
          .from(modelUsage)
          .where(eq(modelUsage.messageUuid, input.messageUuid))
          .get()

        if (existing) {
          usageLog.info(`Skipping duplicate record: ${input.messageUuid}`)
          return existing
        }
      }

      return db
        .insert(modelUsage)
        .values({
          subChatId: input.subChatId,
          chatId: input.chatId,
          projectId: input.projectId,
          model: input.model,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          totalTokens: input.totalTokens,
          costUsd: input.costUsd?.toFixed(6),
          sessionId: input.sessionId,
          messageUuid: input.messageUuid,
          mode: input.mode,
          source: input.source,
          durationMs: input.durationMs,
        })
        .returning()
        .get()
    }),

  /**
   * Get usage summary (for settings page quick view)
   */
  getSummary: publicProcedure.query(() => {
    const db = getDatabase()
    const now = new Date()

    // Today start
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    // Week start (Monday)
    const weekStart = new Date(todayStart)
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7))
    // Month start
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Today usage
    const todayUsage = db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${modelUsage.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${modelUsage.outputTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(cast(${modelUsage.costUsd} as real)), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)
      .where(gte(modelUsage.createdAt, todayStart))
      .get()

    // Week usage
    const weekUsage = db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${modelUsage.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${modelUsage.outputTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(cast(${modelUsage.costUsd} as real)), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)
      .where(gte(modelUsage.createdAt, weekStart))
      .get()

    // Month usage
    const monthUsage = db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${modelUsage.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${modelUsage.outputTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(cast(${modelUsage.costUsd} as real)), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)
      .where(gte(modelUsage.createdAt, monthStart))
      .get()

    // Total usage
    const totalUsage = db
      .select({
        totalInputTokens: sql<number>`coalesce(sum(${modelUsage.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${modelUsage.outputTokens}), 0)`,
        totalTokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`,
        totalCostUsd: sql<number>`coalesce(sum(cast(${modelUsage.costUsd} as real)), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)
      .get()

    return {
      today: todayUsage,
      week: weekUsage,
      month: monthUsage,
      total: totalUsage,
    }
  }),

  /**
   * Get daily activity for heatmap (last 365 days)
   * Returns array of { date, count, totalTokens, totalCostUsd } for contribution graph
   */
  getDailyActivity: publicProcedure.query(() => {
    const db = getDatabase()
    const now = new Date()
    const yearAgo = new Date(now)
    yearAgo.setFullYear(yearAgo.getFullYear() - 1)

    return db
      .select({
        date: sql<string>`date(${modelUsage.createdAt}, 'unixepoch')`.as("date"),
        count: sql<number>`count(*)`,
        totalTokens: sql<number>`sum(${modelUsage.totalTokens})`,
        totalCostUsd: sql<number>`coalesce(sum(cast(${modelUsage.costUsd} as real)), 0)`,
      })
      .from(modelUsage)
      .where(gte(modelUsage.createdAt, yearAgo))
      .groupBy(sql`date(${modelUsage.createdAt}, 'unixepoch')`)
      .orderBy(sql`date`)
      .all()
  }),

  /**
   * Get usage grouped by date
   */
  getByDate: publicProcedure.input(dateRangeSchema).query(({ input }) => {
    const db = getDatabase()

    const conditions = []
    if (input.startDate) {
      conditions.push(gte(modelUsage.createdAt, new Date(input.startDate)))
    }
    if (input.endDate) {
      const endDate = new Date(input.endDate)
      endDate.setDate(endDate.getDate() + 1)
      conditions.push(lte(modelUsage.createdAt, endDate))
    }

    const baseQuery = db
      .select({
        date: sql<string>`date(${modelUsage.createdAt}, 'unixepoch')`.as(
          "date",
        ),
        totalInputTokens: sql<number>`sum(${modelUsage.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${modelUsage.outputTokens})`,
        totalTokens: sql<number>`sum(${modelUsage.totalTokens})`,
        totalCostUsd: sql<number>`sum(cast(${modelUsage.costUsd} as real))`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)

    const query =
      conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery

    return query
      .groupBy(sql`date(${modelUsage.createdAt}, 'unixepoch')`)
      .orderBy(desc(sql`date`))
      .all()
  }),

  /**
   * Get usage grouped by model
   */
  getByModel: publicProcedure.input(dateRangeSchema).query(({ input }) => {
    const db = getDatabase()

    const conditions = []
    if (input.startDate) {
      conditions.push(gte(modelUsage.createdAt, new Date(input.startDate)))
    }
    if (input.endDate) {
      const endDate = new Date(input.endDate)
      endDate.setDate(endDate.getDate() + 1)
      conditions.push(lte(modelUsage.createdAt, endDate))
    }

    const baseQuery = db
      .select({
        model: modelUsage.model,
        totalInputTokens: sql<number>`sum(${modelUsage.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${modelUsage.outputTokens})`,
        totalTokens: sql<number>`sum(${modelUsage.totalTokens})`,
        totalCostUsd: sql<number>`sum(cast(${modelUsage.costUsd} as real))`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)

    const query =
      conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery

    return query
      .groupBy(modelUsage.model)
      .orderBy(desc(sql`sum(${modelUsage.totalTokens})`))
      .all()
  }),

  /**
   * Get usage grouped by source
   */
  getBySource: publicProcedure.input(dateRangeSchema).query(({ input }) => {
    const db = getDatabase()

    const conditions = []
    if (input.startDate) {
      conditions.push(gte(modelUsage.createdAt, new Date(input.startDate)))
    }
    if (input.endDate) {
      const endDate = new Date(input.endDate)
      endDate.setDate(endDate.getDate() + 1)
      conditions.push(lte(modelUsage.createdAt, endDate))
    }

    const baseQuery = db
      .select({
        // Handle NULL source as 'chat' for legacy data
        source: sql<string>`coalesce(${modelUsage.source}, 'chat')`,
        totalInputTokens: sql<number>`sum(${modelUsage.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${modelUsage.outputTokens})`,
        totalTokens: sql<number>`sum(${modelUsage.totalTokens})`,
        totalCostUsd: sql<number>`sum(cast(${modelUsage.costUsd} as real))`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)

    const query =
      conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery

    return query
      .groupBy(sql`coalesce(${modelUsage.source}, 'chat')`)
      .orderBy(desc(sql`sum(${modelUsage.totalTokens})`))
      .all()
  }),

  /**
   * Get usage grouped by project
   */
  getByProject: publicProcedure.input(dateRangeSchema).query(({ input }) => {
    const db = getDatabase()

    const conditions = []
    if (input.startDate) {
      conditions.push(gte(modelUsage.createdAt, new Date(input.startDate)))
    }
    if (input.endDate) {
      const endDate = new Date(input.endDate)
      endDate.setDate(endDate.getDate() + 1)
      conditions.push(lte(modelUsage.createdAt, endDate))
    }

    const baseQuery = db
      .select({
        projectId: modelUsage.projectId,
        projectName: projects.name,
        totalInputTokens: sql<number>`sum(${modelUsage.inputTokens})`,
        totalOutputTokens: sql<number>`sum(${modelUsage.outputTokens})`,
        totalTokens: sql<number>`sum(${modelUsage.totalTokens})`,
        totalCostUsd: sql<number>`sum(cast(${modelUsage.costUsd} as real))`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)
      .leftJoin(projects, eq(modelUsage.projectId, projects.id))

    const query =
      conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery

    return query
      .groupBy(modelUsage.projectId)
      .orderBy(desc(sql`sum(${modelUsage.totalTokens})`))
      .all()
  }),

  /**
   * Get usage grouped by subchat
   */
  getBySubChat: publicProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        chatId: z.string().optional(),
        ...dateRangeSchema.shape,
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()

      const conditions = []
      if (input.projectId) {
        conditions.push(eq(modelUsage.projectId, input.projectId))
      }
      if (input.chatId) {
        conditions.push(eq(modelUsage.chatId, input.chatId))
      }
      if (input.startDate) {
        conditions.push(gte(modelUsage.createdAt, new Date(input.startDate)))
      }
      if (input.endDate) {
        const endDate = new Date(input.endDate)
        endDate.setDate(endDate.getDate() + 1)
        conditions.push(lte(modelUsage.createdAt, endDate))
      }

      const baseQuery = db
        .select({
          subChatId: modelUsage.subChatId,
          subChatName: subChats.name,
          chatId: modelUsage.chatId,
          chatName: chats.name,
          projectName: projects.name,
          totalInputTokens: sql<number>`sum(${modelUsage.inputTokens})`,
          totalOutputTokens: sql<number>`sum(${modelUsage.outputTokens})`,
          totalTokens: sql<number>`sum(${modelUsage.totalTokens})`,
          totalCostUsd: sql<number>`sum(cast(${modelUsage.costUsd} as real))`,
          count: sql<number>`count(*)`,
        })
        .from(modelUsage)
        .leftJoin(subChats, eq(modelUsage.subChatId, subChats.id))
        .leftJoin(chats, eq(modelUsage.chatId, chats.id))
        .leftJoin(projects, eq(modelUsage.projectId, projects.id))

      const query =
        conditions.length > 0
          ? baseQuery.where(and(...conditions))
          : baseQuery

      return query
        .groupBy(modelUsage.subChatId)
        .orderBy(desc(sql`sum(${modelUsage.totalTokens})`))
        .all()
    }),

  /**
   * Get yesterday's usage grouped by hour (for bar chart)
   */
  getYesterdayHourly: publicProcedure.query(() => {
    const db = getDatabase()
    const now = new Date()

    // Yesterday's start and end (using local time)
    const yesterdayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const yesterdayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    return db
      .select({
        hour: sql<string>`strftime('%H', datetime(${modelUsage.createdAt}, 'unixepoch', 'localtime'))`.as("hour"),
        totalTokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`,
        inputTokens: sql<number>`coalesce(sum(${modelUsage.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${modelUsage.outputTokens}), 0)`,
        count: sql<number>`count(*)`,
      })
      .from(modelUsage)
      .where(and(
        gte(modelUsage.createdAt, yesterdayStart),
        lte(modelUsage.createdAt, yesterdayEnd)
      ))
      .groupBy(sql`strftime('%H', datetime(${modelUsage.createdAt}, 'unixepoch', 'localtime'))`)
      .orderBy(sql`hour`)
      .all()
  }),

  /**
   * Get recent usage records (paginated)
   */
  getRecent: publicProcedure
    .input(
      z.object({
        limit: z.number().default(50),
        offset: z.number().default(0),
      }),
    )
    .query(({ input }) => {
      const db = getDatabase()

      return db
        .select({
          id: modelUsage.id,
          model: modelUsage.model,
          inputTokens: modelUsage.inputTokens,
          outputTokens: modelUsage.outputTokens,
          totalTokens: modelUsage.totalTokens,
          costUsd: modelUsage.costUsd,
          mode: modelUsage.mode,
          durationMs: modelUsage.durationMs,
          createdAt: modelUsage.createdAt,
          subChatName: subChats.name,
          chatName: chats.name,
          projectName: projects.name,
        })
        .from(modelUsage)
        .leftJoin(subChats, eq(modelUsage.subChatId, subChats.id))
        .leftJoin(chats, eq(modelUsage.chatId, chats.id))
        .leftJoin(projects, eq(modelUsage.projectId, projects.id))
        .orderBy(desc(modelUsage.createdAt))
        .limit(input.limit)
        .offset(input.offset)
        .all()
    }),

  /**
   * Get Anthropic subscription usage (rate limits) via OAuth API
   * Returns five_hour, seven_day, seven_day_sonnet limits with reset times
   */
  getAnthropicUsage: publicProcedure.query(async () => {
    const db = getDatabase()

    // Get active account
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()

    if (!settings?.activeAccountId) {
      return { error: "no_active_account", data: null }
    }

    const account = db
      .select()
      .from(anthropicAccounts)
      .where(eq(anthropicAccounts.id, settings.activeAccountId))
      .get()

    if (!account) {
      return { error: "account_not_found", data: null }
    }

    let token: string
    try {
      token = decryptToken(account.oauthToken)
    } catch {
      return { error: "decrypt_failed", data: null }
    }

    // Call Anthropic Usage API
    try {
      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      })

      if (!response.ok) {
        return { error: `api_error_${response.status}`, data: null }
      }

      const data = await response.json()
      return { error: null, data }
    } catch (err) {
      usageLog.error("Anthropic usage API error:", err)
      return { error: "network_error", data: null }
    }
  }),
})
