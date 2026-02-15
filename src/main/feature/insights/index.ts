/**
 * Insights Extension
 *
 * 将 Insights（AI 使用报告和分析）功能封装为 Extension。
 * 实现文件保留在 lib/insights/，此处为轻量 wrapper 提供 router。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { insightsRouter } from "../../lib/trpc/routers/insights"

class InsightsExtension implements ExtensionModule {
  name = "insights" as const
  description = "AI-generated usage reports and analytics"
  router = insightsRouter
}

export const insightsExtension = new InsightsExtension()
