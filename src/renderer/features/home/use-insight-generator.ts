/**
 * Insight 报告生成 Hook
 * 在应用启动时检查并触发报告生成
 */

import { useEffect, useCallback, useRef } from "react"
import { useAtomValue } from "jotai"
import { trpc } from "../../lib/trpc"
import {
  billingMethodAtom,
  customClaudeConfigAtom,
  litellmSelectedModelAtom,
} from "../../lib/atoms"
import { createLogger } from "../../lib/logger"

const insightLog = createLogger("Insight")


interface UseInsightGeneratorOptions {
  /** 是否在挂载时自动检查触发条件 */
  autoCheck?: boolean
  /** 触发检查的延迟（毫秒） */
  checkDelay?: number
}

/**
 * 根据用户的 billingMethod 设置，返回对应的认证类型
 */
function getAuthTypeFromBillingMethod(
  billingMethod: string | null
): "oauth" | "litellm" | "apikey" | "custom" {
  switch (billingMethod) {
    case "claude-subscription":
      return "oauth"
    case "litellm":
      return "litellm"
    case "api-key":
      return "apikey"
    case "custom-model":
      return "custom"
    default:
      // 默认使用 OAuth
      return "oauth"
  }
}

export function useInsightGenerator(options: UseInsightGeneratorOptions = {}) {
  const { autoCheck = true, checkDelay = 2000 } = options
  const hasCheckedRef = useRef(false)

  // 用户的模型设置
  const billingMethod = useAtomValue(billingMethodAtom)
  const customClaudeConfig = useAtomValue(customClaudeConfigAtom)
  const litellmSelectedModel = useAtomValue(litellmSelectedModelAtom)

  // 检查触发条件
  const { data: triggerResult, refetch: recheckTrigger } =
    trpc.insights.checkTrigger.useQuery(undefined, {
      enabled: false, // 手动触发
    })

  // 开始生成
  const startGenerationMutation = trpc.insights.startGeneration.useMutation()

  // 执行 AI 生成
  const generateMutation = trpc.insights.generate.useMutation()

  // 获取最新报告
  const { data: latestReport, refetch: refetchLatest } =
    trpc.insights.getLatest.useQuery()

  // 获取 pending 报告
  const { data: pendingReport, refetch: refetchPending } =
    trpc.insights.getPending.useQuery()

  // utils
  const utils = trpc.useUtils()

  /**
   * 完整的报告生成流程
   */
  const generateReport = useCallback(
    async (reportType: "daily" | "weekly") => {
      try {
        // 1. 开始生成（创建记录、计算统计、导出数据）
        const startResult = await startGenerationMutation.mutateAsync({
          reportType,
        })

        if (!startResult.success || !startResult.report) {
          insightLog.warn("Start generation failed:", startResult.error)
          return null
        }

        // 2. 构建认证配置
        const authType = getAuthTypeFromBillingMethod(billingMethod)
        const customConfig =
          authType === "custom"
            ? {
                token: customClaudeConfig.token,
                baseUrl: customClaudeConfig.baseUrl,
                model: customClaudeConfig.model,
              }
            : authType === "litellm"
              ? { model: litellmSelectedModel }
              : undefined

        insightLog.info("Using auth type:", authType)

        // 3. 执行 AI 生成
        const generateResult = await generateMutation.mutateAsync({
          reportId: startResult.report.id,
          authType,
          customConfig,
        })

        // 4. 刷新数据
        await Promise.all([
          utils.insights.getLatest.invalidate(),
          utils.insights.getPending.invalidate(),
          utils.insights.getHistory.invalidate(),
        ])

        return generateResult
      } catch (error) {
        insightLog.error("Generation error:", error)
        throw error
      }
    },
    [
      startGenerationMutation,
      generateMutation,
      utils,
      billingMethod,
      customClaudeConfig,
      litellmSelectedModel,
    ]
  )

  /**
   * 检查并自动生成
   */
  const checkAndGenerate = useCallback(async () => {
    try {
      insightLog.info("Starting trigger check...")
      const result = await recheckTrigger()
      insightLog.info("Trigger check raw result:", result)
      const checkResult = result.data

      if (!checkResult) {
        insightLog.info("No trigger check result returned (data is undefined)")
        return
      }

      insightLog.info("Trigger check result:", JSON.stringify(checkResult))

      if (checkResult.shouldGenerate && checkResult.reportType) {
        insightLog.info(
          `[Insight] Triggering ${checkResult.reportType} report generation...`
        )
        await generateReport(checkResult.reportType)
        insightLog.info("Report generation completed")
      } else {
        insightLog.info(`Skip generation - reason: ${checkResult.reason || "unknown"}`)
      }
    } catch (error) {
      insightLog.error("Check and generate error:", error)
    }
  }, [recheckTrigger, generateReport])

  // 自动检查（仅在首次挂载时）
  useEffect(() => {
    if (!autoCheck || hasCheckedRef.current) return

    const timer = setTimeout(() => {
      hasCheckedRef.current = true
      checkAndGenerate()
    }, checkDelay)

    return () => clearTimeout(timer)
  }, [autoCheck, checkDelay, checkAndGenerate])

  return {
    // 状态
    triggerResult,
    latestReport,
    pendingReport,
    isGenerating:
      startGenerationMutation.isPending || generateMutation.isPending,
    error: startGenerationMutation.error || generateMutation.error,

    // 方法
    checkAndGenerate,
    generateReport,
    recheckTrigger,
    refetchLatest,
    refetchPending,
  }
}
