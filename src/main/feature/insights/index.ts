/**
 * Insights Extension
 *
 * AI 使用报告和分析。
 */

import type { ExtensionModule } from "../../lib/extension/types"
import { insightsRouter } from "./router"

class InsightsExtension implements ExtensionModule {
  name = "insights" as const
  description = "AI-generated usage reports and analytics"
  router = insightsRouter
}

export const insightsExtension = new InsightsExtension()
