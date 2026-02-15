/**
 * Insights tRPC Router
 * 提供 Insight 报告的 API 接口
 */

import { eq } from "drizzle-orm"
import { safeStorage } from "electron"
import { z } from "zod"
import { getDatabase, insights, claudeCodeCredentials } from "../../lib/db"
import { getEnv } from "../../lib/env"
import { publicProcedure, router } from "../../lib/trpc/index"
import {
  checkShouldGenerateReport,
  getLatestReport,
  getReportHistory,
  getPendingOrGeneratingReport,
  calculateStats,
  calculateDateRange,
  exportChatData,
  cleanupDataDir,
  cleanupOldDataDirs,
  generateInsightReport,
} from "./lib"
import type { InsightStats, InsightReport } from "./lib"
import { createLogger } from "../../lib/logger"

const insightsLog = createLogger("Insights")


/**
 * 认证配置类型（从前端传入）
 */
interface AuthConfig {
  type: "oauth" | "litellm" | "apikey" | "custom"
  token?: string
  baseUrl?: string
  model?: string
}

/**
 * 从数据库获取 Claude Code OAuth token（与 claude.ts 中相同逻辑）
 */
function getClaudeCodeToken(): string | null {
  try {
    const db = getDatabase()
    const cred = db
      .select()
      .from(claudeCodeCredentials)
      .where(eq(claudeCodeCredentials.id, "default"))
      .get()

    if (!cred?.oauthToken) {
      insightsLog.info("No Claude Code credentials found")
      return null
    }

    // 解密 token
    try {
      const buffer = Buffer.from(cred.oauthToken, "base64")
      return safeStorage.decryptString(buffer)
    } catch {
      // 如果解密失败，可能是未加密的旧格式
      return cred.oauthToken
    }
  } catch (error) {
    insightsLog.error("Error getting Claude Code token:", error)
    return null
  }
}

/**
 * 根据前端传入的认证类型，构建完整的认证配置
 * @param authType 前端传入的认证类型
 * @param customConfig 前端传入的自定义配置（用于 custom 和 litellm 模式）
 */
function buildAuthConfig(
  authType: "oauth" | "litellm" | "apikey" | "custom",
  customConfig?: { token?: string; baseUrl?: string; model?: string }
): AuthConfig | null {
  const env = getEnv()

  switch (authType) {
    case "oauth": {
      // Claude Code OAuth
      const oauthToken = getClaudeCodeToken()
      if (!oauthToken) {
        insightsLog.error("OAuth selected but no token found")
        return null
      }
      insightsLog.info("Using Claude Code OAuth auth")
      return { type: "oauth", token: oauthToken }
    }

    case "litellm": {
      // LiteLLM - 优先使用前端传入的配置，其次使用环境变量
      const baseUrl = customConfig?.baseUrl || env.MAIN_VITE_LITELLM_BASE_URL
      const apiKey = customConfig?.token || env.MAIN_VITE_LITELLM_API_KEY
      if (!baseUrl) {
        insightsLog.error("LiteLLM selected but no base URL configured")
        return null
      }
      insightsLog.info("Using LiteLLM auth, baseUrl:", baseUrl)
      return {
        type: "litellm",
        token: apiKey || "litellm",
        baseUrl: baseUrl.replace(/\/+$/, ""),
        model: customConfig?.model,
      }
    }

    case "apikey": {
      // API Key - 从环境变量获取
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        insightsLog.error("API Key selected but not found in env")
        return null
      }
      insightsLog.info("Using ANTHROPIC_API_KEY from env")
      return {
        type: "apikey",
        token: apiKey,
        baseUrl: process.env.ANTHROPIC_BASE_URL,
      }
    }

    case "custom": {
      // Custom - 从前端传入的配置
      if (!customConfig?.token || !customConfig?.baseUrl) {
        insightsLog.error("Custom selected but config incomplete")
        return null
      }
      insightsLog.info("Using custom auth config")
      return {
        type: "custom",
        token: customConfig.token,
        baseUrl: customConfig.baseUrl,
        model: customConfig.model,
      }
    }

    default:
      return null
  }
}

export const insightsRouter = router({
  /**
   * 检查是否应该生成新报告
   * 在应用启动或窗口获得焦点时调用
   */
  checkTrigger: publicProcedure.query(async () => {
    try {
      const result = await checkShouldGenerateReport()
      insightsLog.info("[Insights Router] checkTrigger result:", result)
      return result
    } catch (error) {
      insightsLog.error("[Insights Router] checkTrigger error:", error)
      return {
        shouldGenerate: false,
        reportType: null,
        reason: `检查失败: ${error instanceof Error ? error.message : "未知错误"}`,
      }
    }
  }),

  /**
   * 开始生成报告
   * 创建 pending 状态的记录，计算统计数据，导出聊天数据
   */
  startGeneration: publicProcedure
    .input(
      z.object({
        reportType: z.enum(["daily", "weekly"]),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const { reportType } = input

      // 计算日期范围
      const { startDate, endDate, reportDate } = calculateDateRange(reportType)

      // 检查是否已有该日期的报告
      const existing = db
        .select()
        .from(insights)
        .where(
          eq(insights.reportType, reportType)
        )
        .all()
        .find((r) => r.reportDate === reportDate)

      if (existing) {
        return { success: false, error: "该报告已存在", report: existing }
      }

      // 计算统计数据
      const stats = await calculateStats(startDate, endDate, reportType)

      // 导出聊天数据到临时目录
      const exportResult = await exportChatData(
        startDate,
        endDate,
        reportType,
        reportDate,
        stats
      )

      // 创建 pending 状态的报告记录
      const newReport = db
        .insert(insights)
        .values({
          reportType,
          reportDate,
          statsJson: JSON.stringify(stats),
          status: "pending",
          dataDir: exportResult.dataDir,
        })
        .returning()
        .get()

      return {
        success: true,
        report: newReport,
        dataDir: exportResult.dataDir,
        stats,
      }
    }),

  /**
   * 更新报告状态为 generating
   */
  setGenerating: publicProcedure
    .input(z.object({ reportId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabase()

      return db
        .update(insights)
        .set({
          status: "generating",
          updatedAt: new Date(),
        })
        .where(eq(insights.id, input.reportId))
        .returning()
        .get()
    }),

  /**
   * 完成报告生成
   * 保存 AI 生成的 Markdown 内容
   */
  completeGeneration: publicProcedure
    .input(
      z.object({
        reportId: z.string(),
        reportMarkdown: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // 获取报告以获取 dataDir
      const report = db
        .select()
        .from(insights)
        .where(eq(insights.id, input.reportId))
        .get()

      // 清理临时数据目录
      if (report?.dataDir) {
        await cleanupDataDir(report.dataDir)
      }

      return db
        .update(insights)
        .set({
          reportMarkdown: input.reportMarkdown,
          status: "completed",
          dataDir: null, // 清除 dataDir 引用
          updatedAt: new Date(),
        })
        .where(eq(insights.id, input.reportId))
        .returning()
        .get()
    }),

  /**
   * 标记报告生成失败
   */
  failGeneration: publicProcedure
    .input(
      z.object({
        reportId: z.string(),
        error: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // 获取报告以获取 dataDir
      const report = db
        .select()
        .from(insights)
        .where(eq(insights.id, input.reportId))
        .get()

      // 清理临时数据目录
      if (report?.dataDir) {
        await cleanupDataDir(report.dataDir)
      }

      return db
        .update(insights)
        .set({
          error: input.error,
          status: "failed",
          dataDir: null,
          updatedAt: new Date(),
        })
        .where(eq(insights.id, input.reportId))
        .returning()
        .get()
    }),

  /**
   * 获取最新的已完成报告
   */
  getLatest: publicProcedure.query(() => {
    const report = getLatestReport()
    if (!report) return null

    return {
      ...report,
      stats: JSON.parse(report.statsJson) as InsightStats,
    } as InsightReport
  }),

  /**
   * 获取当前正在处理的报告
   */
  getPending: publicProcedure.query(() => {
    const report = getPendingOrGeneratingReport()
    if (!report) return null

    return {
      ...report,
      stats: JSON.parse(report.statsJson) as InsightStats,
    } as InsightReport
  }),

  /**
   * 获取指定报告详情
   */
  getById: publicProcedure
    .input(z.object({ reportId: z.string() }))
    .query(({ input }) => {
      const db = getDatabase()

      const report = db
        .select()
        .from(insights)
        .where(eq(insights.id, input.reportId))
        .get()

      if (!report) return null

      return {
        ...report,
        stats: JSON.parse(report.statsJson) as InsightStats,
      } as InsightReport
    }),

  /**
   * 获取报告历史列表
   */
  getHistory: publicProcedure
    .input(
      z.object({
        limit: z.number().default(20),
      })
    )
    .query(({ input }) => {
      return getReportHistory(input.limit)
    }),

  /**
   * 清理旧的数据导出目录
   */
  cleanupOldData: publicProcedure
    .input(z.object({ daysToKeep: z.number().default(7) }))
    .mutation(async ({ input }) => {
      await cleanupOldDataDirs(input.daysToKeep)
      return { success: true }
    }),

  /**
   * 手动触发生成报告（用于测试或用户手动刷新）
   */
  manualGenerate: publicProcedure
    .input(
      z.object({
        reportType: z.enum(["daily", "weekly"]),
        targetDate: z.string().optional(), // YYYY-MM-DD
      })
    )
    .mutation(async ({ input }) => {
      insightsLog.info("========================================")
      insightsLog.info("manualGenerate STARTED with:", input)
      insightsLog.info("========================================")

      const db = getDatabase()
      const { reportType, targetDate } = input

      // 计算日期范围
      const { startDate, endDate, reportDate } = calculateDateRange(
        reportType,
        targetDate
      )
      insightsLog.info("Date range:", { startDate, endDate, reportDate })

      // 检查是否已有该日期的报告
      const existing = db
        .select()
        .from(insights)
        .where(eq(insights.reportType, reportType))
        .all()
        .find((r) => r.reportDate === reportDate)

      if (existing) {
        insightsLog.info("Existing report found:", existing.id, existing.status)
        // 如果已存在但失败，允许重新生成
        if (existing.status === "failed") {
          insightsLog.info("Deleting failed report to regenerate")
          await db.delete(insights).where(eq(insights.id, existing.id))
        } else {
          insightsLog.info("Report already exists, skipping")
          return { success: false, error: "该报告已存在", report: existing }
        }
      }

      // 计算统计数据
      insightsLog.info("Calculating stats...")
      const stats = await calculateStats(startDate, endDate, reportType)
      insightsLog.info("Stats calculated:", {
        totalTokens: stats.usage.totalTokens,
        apiCalls: stats.usage.apiCalls,
      })

      // 导出聊天数据
      insightsLog.info("Exporting chat data...")
      const exportResult = await exportChatData(
        startDate,
        endDate,
        reportType,
        reportDate,
        stats
      )
      insightsLog.info("Chat data exported to:", exportResult.dataDir)

      // 创建报告记录
      insightsLog.info("Creating report record...")
      const newReport = db
        .insert(insights)
        .values({
          reportType,
          reportDate,
          statsJson: JSON.stringify(stats),
          status: "pending",
          dataDir: exportResult.dataDir,
        })
        .returning()
        .get()
      insightsLog.info("Report record created:", newReport.id)

      return {
        success: true,
        report: newReport,
        dataDir: exportResult.dataDir,
        stats,
      }
    }),

  /**
   * 执行 AI 报告生成
   * 调用 Claude API 生成 Markdown 报告
   */
  generate: publicProcedure
    .input(
      z.object({
        reportId: z.string(),
        // 前端传入的认证类型和配置
        authType: z.enum(["oauth", "litellm", "apikey", "custom"]),
        customConfig: z
          .object({
            token: z.string().optional(),
            baseUrl: z.string().optional(),
            model: z.string().optional(),
          })
          .optional(),
        // 用户个性化信息
        userProfile: z
          .object({
            preferredName: z.string().max(50).optional(),
            personalPreferences: z.string().max(1000).optional(),
          })
          .optional(),
        // 语言设置
        language: z.enum(["zh", "en", "system"]).optional(),
      })
    )
    .mutation(async ({ input }) => {
      insightsLog.info("========================================")
      insightsLog.info("generate mutation STARTED for report:", input.reportId)
      insightsLog.info("Auth type:", input.authType)
      insightsLog.info("User profile:", input.userProfile)
      insightsLog.info("Language:", input.language)
      insightsLog.info("========================================")
      const db = getDatabase()

      // 先更新状态为 generating，让 UI 能看到进度
      try {
        db.update(insights)
          .set({
            status: "generating",
            error: JSON.stringify({ step: "initializing", detail: "正在回顾你的工作..." }),
            updatedAt: new Date(),
          })
          .where(eq(insights.id, input.reportId))
          .run()
        insightsLog.info("Status updated to generating")
      } catch (err) {
        insightsLog.error("Failed to update status:", err)
      }

      try {
        // 根据前端传入的认证类型构建配置
        insightsLog.info("Building auth config for type:", input.authType)
        const authConfig = buildAuthConfig(input.authType, input.customConfig)
        if (!authConfig) {
          insightsLog.error("Failed to build auth config")
          throw new Error("认证配置无效。请检查您的设置。")
        }
        insightsLog.info("Auth config built:", authConfig.type)

        // 构建用户配置
        const userConfig = {
          preferredName: input.userProfile?.preferredName,
          personalPreferences: input.userProfile?.personalPreferences,
          language: input.language || "zh",
        }

        // 生成报告（传递认证配置和用户配置）
        const result = await generateInsightReport(input.reportId, authConfig, userConfig)
        insightsLog.info("Report generated, summary:", result.summary?.slice(0, 50))

        return {
          success: true,
          summary: result.summary,
          reportHtml: result.reportHtml,
          reportMarkdown: result.reportMarkdown,
        }
      } catch (error) {
        insightsLog.error("Generation error:", error)
        // 更新为失败状态
        db.update(insights)
          .set({
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            updatedAt: new Date(),
          })
          .where(eq(insights.id, input.reportId))
          .run()
        throw error
      }
    }),
})
