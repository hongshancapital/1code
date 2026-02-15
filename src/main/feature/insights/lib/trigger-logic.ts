/**
 * Insight 报告触发逻辑
 * 根据用户打开时间和使用情况智能决定是否生成报告
 */

import { desc, eq, and, gte, lte, sql, or } from "drizzle-orm"
import { getDatabase, insights, modelUsage } from "../../../lib/db"
import type { TriggerCheckResult } from "./types"
import { DAILY_THRESHOLDS, WEEKLY_THRESHOLDS } from "./types"
import { calculateDateRange } from "./stats-calculator"

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const SEVEN_DAYS_MS = 7 * ONE_DAY_MS

/**
 * 检查是否应该生成新报告
 * 触发规则：
 * 1. 如果距离上次报告 >= 7 天，且有足够活动天数，生成周报
 * 2. 如果距离上次报告 >= 1 天，且满足日报阈值，生成日报
 * 3. 否则不生成
 */
export async function checkShouldGenerateReport(): Promise<TriggerCheckResult> {
  const db = getDatabase()
  const now = new Date()

  // 获取最新的已完成报告
  const latestReport = db
    .select()
    .from(insights)
    .where(eq(insights.status, "completed"))
    .orderBy(desc(insights.createdAt))
    .limit(1)
    .get()

  // 检查是否有正在生成的报告
  const inProgressReport = db
    .select()
    .from(insights)
    .where(
      or(
        eq(insights.status, "pending"),
        eq(insights.status, "generating")
      )
    )
    .limit(1)
    .get()

  if (inProgressReport) {
    return {
      shouldGenerate: false,
      reportType: null,
      reason: "已有报告正在生成中",
    }
  }

  const lastReportTime = latestReport?.createdAt
  const timeSinceLastReport = lastReportTime
    ? now.getTime() - lastReportTime.getTime()
    : Infinity

  // 规则 1：距离上次报告 >= 7 天，检查周报条件
  if (timeSinceLastReport >= SEVEN_DAYS_MS) {
    const weeklyCheck = await checkWeeklyReportConditions()
    if (weeklyCheck.shouldGenerate) {
      return weeklyCheck
    }
  }

  // 规则 2：距离上次报告 >= 1 天，检查日报条件
  if (timeSinceLastReport >= ONE_DAY_MS) {
    const dailyCheck = await checkDailyReportConditions()
    if (dailyCheck.shouldGenerate) {
      return dailyCheck
    }
  }

  // 不满足生成条件
  if (timeSinceLastReport < ONE_DAY_MS) {
    return {
      shouldGenerate: false,
      reportType: null,
      reason: "距离上次报告不足 24 小时",
    }
  }

  return {
    shouldGenerate: false,
    reportType: null,
    reason: "使用量不满足最低阈值",
  }
}

/**
 * 检查是否满足日报生成条件
 */
async function checkDailyReportConditions(): Promise<TriggerCheckResult> {
  const db = getDatabase()

  // 计算昨天的日期范围
  const { startDate, endDate, reportDate } = calculateDateRange("daily")

  // 检查该日期是否已有报告
  const existingReport = db
    .select()
    .from(insights)
    .where(
      and(
        eq(insights.reportType, "daily"),
        eq(insights.reportDate, reportDate)
      )
    )
    .limit(1)
    .get()

  if (existingReport) {
    return {
      shouldGenerate: false,
      reportType: null,
      reason: `${reportDate} 日报已存在`,
    }
  }

  // 查询昨天的使用统计
  const stats = db
    .select({
      apiCalls: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${modelUsage.totalTokens}), 0)`,
    })
    .from(modelUsage)
    .where(
      and(
        gte(modelUsage.createdAt, startDate),
        lte(modelUsage.createdAt, endDate)
      )
    )
    .get()

  const apiCalls = stats?.apiCalls ?? 0
  const totalTokens = stats?.totalTokens ?? 0

  const meetsApiCallThreshold = apiCalls >= DAILY_THRESHOLDS.minApiCalls
  const meetsTokenThreshold = totalTokens >= DAILY_THRESHOLDS.minTokens

  if (meetsApiCallThreshold && meetsTokenThreshold) {
    return {
      shouldGenerate: true,
      reportType: "daily",
      reason: `满足日报条件：${apiCalls} 次调用，${totalTokens} tokens`,
    }
  }

  return {
    shouldGenerate: false,
    reportType: null,
    reason: `日报条件不满足：${apiCalls}/${DAILY_THRESHOLDS.minApiCalls} 调用，${totalTokens}/${DAILY_THRESHOLDS.minTokens} tokens`,
  }
}

/**
 * 检查是否满足周报生成条件
 */
async function checkWeeklyReportConditions(): Promise<TriggerCheckResult> {
  const db = getDatabase()

  // 计算上周的日期范围
  const { startDate, endDate, reportDate } = calculateDateRange("weekly")

  // 检查该周是否已有报告
  const existingReport = db
    .select()
    .from(insights)
    .where(
      and(
        eq(insights.reportType, "weekly"),
        eq(insights.reportDate, reportDate)
      )
    )
    .limit(1)
    .get()

  if (existingReport) {
    return {
      shouldGenerate: false,
      reportType: null,
      reason: `${reportDate} 周报已存在`,
    }
  }

  // 查询上周的活跃天数
  const activeDaysResult = db
    .select({
      activeDays: sql<number>`count(distinct date(${modelUsage.createdAt}, 'unixepoch'))`,
    })
    .from(modelUsage)
    .where(
      and(
        gte(modelUsage.createdAt, startDate),
        lte(modelUsage.createdAt, endDate)
      )
    )
    .get()

  const activeDays = activeDaysResult?.activeDays ?? 0

  if (activeDays >= WEEKLY_THRESHOLDS.minActiveDays) {
    return {
      shouldGenerate: true,
      reportType: "weekly",
      reason: `满足周报条件：${activeDays} 天活跃`,
    }
  }

  return {
    shouldGenerate: false,
    reportType: null,
    reason: `周报条件不满足：${activeDays}/${WEEKLY_THRESHOLDS.minActiveDays} 活跃天数`,
  }
}

/**
 * 获取最新的报告（无论类型，包括 completed 和 failed）
 */
export function getLatestReport() {
  const db = getDatabase()

  return db
    .select()
    .from(insights)
    .where(
      or(
        eq(insights.status, "completed"),
        eq(insights.status, "failed")
      )
    )
    .orderBy(desc(insights.createdAt))
    .limit(1)
    .get()
}

/**
 * 获取报告历史列表
 */
export function getReportHistory(limit = 20) {
  const db = getDatabase()

  return db
    .select({
      id: insights.id,
      reportType: insights.reportType,
      reportDate: insights.reportDate,
      status: insights.status,
      createdAt: insights.createdAt,
    })
    .from(insights)
    .orderBy(desc(insights.createdAt))
    .limit(limit)
    .all()
}

/**
 * 获取当前正在处理的报告
 */
export function getPendingOrGeneratingReport() {
  const db = getDatabase()

  return db
    .select()
    .from(insights)
    .where(
      or(
        eq(insights.status, "pending"),
        eq(insights.status, "generating")
      )
    )
    .orderBy(desc(insights.createdAt))
    .limit(1)
    .get()
}
