/**
 * 统计数据计算器
 * 从 model_usage 表计算 Insight 所需的统计数据
 */

import { and, gte, lte, sql, eq } from "drizzle-orm"
import { getDatabase, modelUsage, projects } from "../db"
import type { InsightStats, ReportType } from "./types"

/**
 * 计算指定日期范围的统计数据
 */
export async function calculateStats(
  startDate: Date,
  endDate: Date,
  reportType: ReportType
): Promise<InsightStats> {
  const db = getDatabase()

  // 基础使用统计
  const usageStats = db
    .select({
      totalTokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`,
      inputTokens: sql<number>`coalesce(sum(${modelUsage.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${modelUsage.outputTokens}), 0)`,
      totalCostUsd: sql<number>`coalesce(sum(cast(${modelUsage.costUsd} as real)), 0)`,
      apiCalls: sql<number>`count(*)`,
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
    .get()

  // 活动统计 - 活跃天数
  const activeDaysResult = db
    .select({
      activeDays: sql<number>`count(distinct date(${modelUsage.createdAt}, 'unixepoch'))`,
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
    .get()

  // 活动统计 - 最活跃小时
  const hourlyStats = db
    .select({
      hour: sql<number>`cast(strftime('%H', datetime(${modelUsage.createdAt}, 'unixepoch', 'localtime')) as integer)`,
      count: sql<number>`count(*)`,
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
    .groupBy(sql`strftime('%H', datetime(${modelUsage.createdAt}, 'unixepoch', 'localtime'))`)
    .orderBy(sql`count(*) desc`)
    .all()

  const peakHour = hourlyStats[0]?.hour ?? 0

  // 会话数和聊天数
  const sessionStats = db
    .select({
      sessionsCount: sql<number>`count(distinct ${modelUsage.sessionId})`,
      chatsCount: sql<number>`count(distinct ${modelUsage.chatId})`,
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
    .get()

  // 模型使用分布
  const modelStats = db
    .select({
      model: modelUsage.model,
      tokens: sql<number>`sum(${modelUsage.totalTokens})`,
      calls: sql<number>`count(*)`,
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
    .groupBy(modelUsage.model)
    .orderBy(sql`sum(${modelUsage.totalTokens}) desc`)
    .all()

  const totalTokens = usageStats?.totalTokens ?? 0
  const modelUsageList = modelStats.map((m) => ({
    model: m.model,
    tokens: m.tokens,
    calls: m.calls,
    percentage: totalTokens > 0 ? (m.tokens / totalTokens) * 100 : 0,
  }))

  // 项目使用分布
  const projectStats = db
    .select({
      projectId: modelUsage.projectId,
      projectName: projects.name,
      tokens: sql<number>`sum(${modelUsage.totalTokens})`,
      calls: sql<number>`count(*)`,
    })
    .from(modelUsage)
    .leftJoin(projects, eq(modelUsage.projectId, projects.id))
    .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
    .groupBy(modelUsage.projectId)
    .orderBy(sql`sum(${modelUsage.totalTokens}) desc`)
    .all()

  const projectUsageList = projectStats.map((p) => ({
    projectId: p.projectId,
    projectName: p.projectName ?? "Unknown",
    tokens: p.tokens,
    calls: p.calls,
    percentage: totalTokens > 0 ? (p.tokens / totalTokens) * 100 : 0,
  }))

  // 模式分布
  const modeStats = db
    .select({
      mode: modelUsage.mode,
      tokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(modelUsage)
    .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
    .groupBy(modelUsage.mode)
    .all()

  const planMode = modeStats.find((m) => m.mode === "plan") ?? { tokens: 0, calls: 0 }
  const agentMode = modeStats.find((m) => m.mode === "agent") ?? { tokens: 0, calls: 0 }

  // 趋势数据
  const trendData =
    reportType === "daily"
      ? // 日报：按小时
        db
          .select({
            label: sql<string>`strftime('%H', datetime(${modelUsage.createdAt}, 'unixepoch', 'localtime'))`.as("label"),
            tokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`.as("tokens"),
            calls: sql<number>`count(*)`.as("calls"),
          })
          .from(modelUsage)
          .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
          .groupBy(sql`strftime('%H', datetime(${modelUsage.createdAt}, 'unixepoch', 'localtime'))`)
          .orderBy(sql`1`) // Order by first column (label)
          .all()
      : // 周报：按日期
        db
          .select({
            label: sql<string>`date(${modelUsage.createdAt}, 'unixepoch')`.as("label"),
            tokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`.as("tokens"),
            calls: sql<number>`count(*)`.as("calls"),
          })
          .from(modelUsage)
          .where(and(gte(modelUsage.createdAt, startDate), lte(modelUsage.createdAt, endDate)))
          .groupBy(sql`date(${modelUsage.createdAt}, 'unixepoch')`)
          .orderBy(sql`1`) // Order by first column (label)
          .all()

  return {
    period: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      type: reportType,
    },
    usage: {
      totalTokens: usageStats?.totalTokens ?? 0,
      inputTokens: usageStats?.inputTokens ?? 0,
      outputTokens: usageStats?.outputTokens ?? 0,
      totalCostUsd: usageStats?.totalCostUsd ?? 0,
      apiCalls: usageStats?.apiCalls ?? 0,
    },
    activity: {
      activeDays: activeDaysResult?.activeDays ?? 0,
      peakHour,
      sessionsCount: sessionStats?.sessionsCount ?? 0,
      chatsCount: sessionStats?.chatsCount ?? 0,
    },
    modelUsage: modelUsageList,
    projectUsage: projectUsageList,
    modeUsage: {
      plan: { tokens: planMode.tokens, calls: planMode.calls },
      agent: { tokens: agentMode.tokens, calls: agentMode.calls },
    },
    trend: trendData,
  }
}

/**
 * 计算日期范围
 */
export function calculateDateRange(
  reportType: ReportType,
  targetDate?: string
): { startDate: Date; endDate: Date; reportDate: string } {
  const now = new Date()

  if (reportType === "daily") {
    // 默认昨天
    const date = targetDate ? new Date(targetDate) : new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000 - 1)

    return {
      startDate,
      endDate,
      reportDate: startDate.toISOString().split("T")[0],
    }
  } else {
    // 周报：默认上周 (周一到周日)
    const date = targetDate ? new Date(targetDate) : now
    const dayOfWeek = date.getDay()
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1

    // 上周一
    const lastMonday = new Date(date)
    lastMonday.setDate(date.getDate() - diff - 7)
    const startDate = new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate())

    // 上周日
    const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)

    return {
      startDate,
      endDate,
      reportDate: startDate.toISOString().split("T")[0],
    }
  }
}
