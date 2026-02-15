/**
 * Insight 报告相关类型定义
 */

// 报告类型
export type ReportType = "daily" | "weekly"

// 报告状态
export type InsightStatus = "pending" | "generating" | "completed" | "failed"

// 统计数据结构 (程序计算)
export interface InsightStats {
  // 时间范围
  period: {
    start: string // ISO date string
    end: string // ISO date string
    type: ReportType
  }

  // Token 使用统计
  usage: {
    totalTokens: number
    inputTokens: number
    outputTokens: number
    totalCostUsd: number
    apiCalls: number
  }

  // 活动统计
  activity: {
    activeDays: number // 周报特有，日报为 1
    peakHour: number // 最活跃小时 (0-23)
    sessionsCount: number // 会话数
    chatsCount: number // 聊天数
  }

  // 模型使用分布
  modelUsage: Array<{
    model: string
    tokens: number
    calls: number
    percentage: number
  }>

  // 项目使用分布
  projectUsage: Array<{
    projectId: string
    projectName: string
    tokens: number
    calls: number
    percentage: number
  }>

  // 模式分布 (plan vs agent)
  modeUsage: {
    plan: { tokens: number; calls: number }
    agent: { tokens: number; calls: number }
  }

  // 趋势数据 (用于图表)
  trend: Array<{
    label: string // 小时 (日报) 或 日期 (周报)
    tokens: number
    calls: number
  }>
}

// 完整报告结构 (API 返回)
export interface InsightReport {
  id: string
  reportType: ReportType
  reportDate: string
  stats: InsightStats
  // AI 生成的内容
  summary: string | null // 1-2 句话摘要，直接展示在卡片上
  reportHtml: string | null // 详细 HTML 报告，弹窗展示
  reportMarkdown: string | null // 完整原始输出（兼容保留）
  status: InsightStatus
  error?: string
  dataDir?: string
  createdAt: Date
  updatedAt: Date
}

// 触发检查结果
export interface TriggerCheckResult {
  shouldGenerate: boolean
  reportType: ReportType | null
  reason: string
}

// 日报阈值配置
export const DAILY_THRESHOLDS = {
  minApiCalls: 10,
  minTokens: 10000,
} as const

// 周报阈值配置
export const WEEKLY_THRESHOLDS = {
  minActiveDays: 3,
} as const
