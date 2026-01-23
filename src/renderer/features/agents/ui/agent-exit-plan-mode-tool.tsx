"use client"

import { memo } from "react"
import { ChatMarkdownRenderer } from "../../../components/chat-markdown-renderer"
import { areToolPropsEqual } from "./agent-tool-utils"

interface ExitPlanModeToolPart {
  type: string
  state: string
  input?: Record<string, unknown>
  output?: {
    plan?: string
  }
}

interface AgentExitPlanModeToolProps {
  part: ExitPlanModeToolPart
  chatStatus?: string
}

export const AgentExitPlanModeTool = memo(function AgentExitPlanModeTool({
  part,
}: AgentExitPlanModeToolProps) {
  // Get plan text from output.plan
  const planText = typeof part.output?.plan === "string" ? part.output.plan : ""

  if (!planText) {
    return null
  }

  return (
    <div
      className="mx-2 mt-3 rounded-lg overflow-hidden border border-plan-mode/30"
      data-plan-section="true"
    >
      {/* Plan 标签头部 - 使用 plan-mode 颜色 */}
      <div className="bg-plan-mode/15 px-3 py-1.5 border-b border-plan-mode/20">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-plan-mode">
          Plan
        </span>
      </div>
      {/* Plan 内容区域 - 淡色背景 */}
      <div className="bg-plan-mode/5 px-3 py-2">
        <ChatMarkdownRenderer content={planText} size="sm" />
      </div>
    </div>
  )
}, areToolPropsEqual)
