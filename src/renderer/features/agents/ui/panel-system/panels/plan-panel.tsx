/**
 * PlanPanel — 自治的 Plan 面板组件
 *
 * 从 Context/Atom/Store 获取所有业务数据，不依赖 ChatView 传入 props。
 * 容器（ResizableSidebar）由 PanelZone 管理。
 *
 * 职责：
 * - 自动探测当前 subchat 的 plan 路径
 * - 渲染 AgentPlanSidebar 内容
 * - 处理 "Build Plan" 审批
 * - 处理 review comments 提交
 */

import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { toast } from "sonner"
import { useAgentSubChatStore } from "../../../stores/sub-chat-store"
import { useChatInstance } from "../../../context/chat-instance-context"
import { useDocumentComments } from "../../../hooks/use-document-comments"
import { usePanel } from "../../../hooks/use-panel-state"
import { PANEL_IDS } from "../../../stores/panel-registry"
import {
  currentPlanPathAtomFamily,
  pendingBuildPlanSubChatIdAtom,
  planEditRefetchTriggerAtomFamily,
  pendingReviewMessageAtom,
  subChatModeAtomFamily,
} from "../../../atoms"
import { defaultAgentModeAtom } from "../../../../../lib/atoms"
import { isPlanFile } from "../../agent-tool-utils"
import { AgentPlanSidebar } from "../../agent-plan-sidebar"
import type { PanelRenderProps } from "../types"
import type { AgentMode } from "../../../atoms"

// =============================================================================
// useIsAvailable — 运行时可用性 hook
// =============================================================================

/**
 * Plan panel 可用性：必须有活跃 subchat 且存在 plan 路径。
 * 在 PanelDefinition 的 useIsAvailable 中使用。
 */
export function usePlanAvailability(): boolean {
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  const currentPlanPath = useAtomValue(
    currentPlanPathAtomFamily(activeSubChatId || ""),
  )
  return !!activeSubChatId && !!currentPlanPath
}

// =============================================================================
// PlanPanel Component
// =============================================================================

export const PlanPanel = memo(function PlanPanel(
  props: PanelRenderProps,
) {
  // ── 从 Context 获取身份信息 ──
  const { chatId, agentSubChats } = useChatInstance()
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)

  // ── Plan 路径探测 ──
  const currentPlanPathAtom = useMemo(
    () => currentPlanPathAtomFamily(activeSubChatId || ""),
    [activeSubChatId],
  )
  const [currentPlanPath, setCurrentPlanPath] = useAtom(currentPlanPathAtom)

  // Auto-detect plan path from active sub-chat messages.
  // Only runs when currentPlanPath is not already set (to avoid overwriting
  // a path that was set by agent-plan-file-tool or details-panel).
  useEffect(() => {
    // Skip if path is already set by an external consumer
    if (currentPlanPath) return

    if (!agentSubChats || agentSubChats.length === 0 || !activeSubChatId) {
      return
    }

    const activeSubChat = agentSubChats.find(
      (sc) => sc.id === activeSubChatId,
    )
    if (!activeSubChat) {
      return
    }

    let lastPlanPath: string | null = null
    type MessageLike = {
      role?: string
      parts?: Array<{
        type?: string
        input?: { file_path?: string }
      }>
    }
    const messages = (
      Array.isArray(activeSubChat.messages) ? activeSubChat.messages : []
    ) as MessageLike[]
    for (const msg of messages) {
      if (msg.role !== "assistant") continue
      const parts = msg.parts || []
      for (const part of parts) {
        if (
          part.type === "tool-Write" &&
          part.input?.file_path &&
          isPlanFile(part.input.file_path)
        ) {
          lastPlanPath = part.input.file_path
        }
      }
    }

    if (lastPlanPath) {
      setCurrentPlanPath(lastPlanPath)
    }
  }, [agentSubChats, activeSubChatId, currentPlanPath, setCurrentPlanPath])

  // Auto-close when switching to subchat without plan
  const prevSubChatIdRef = useRef(activeSubChatId)
  useEffect(() => {
    if (prevSubChatIdRef.current !== activeSubChatId) {
      if (!currentPlanPath) {
        props.onClose()
      }
      prevSubChatIdRef.current = activeSubChatId
    }
  }, [activeSubChatId, currentPlanPath, props.onClose])

  // ── Agent mode ──
  const subChatModeAtom = useMemo(
    () => subChatModeAtomFamily(activeSubChatId || ""),
    [activeSubChatId],
  )
  const [subChatMode] = useAtom(subChatModeAtom)
  const defaultMode = useAtomValue(defaultAgentModeAtom)
  const currentMode: AgentMode = activeSubChatId ? subChatMode : defaultMode

  // ── Plan refetch trigger ──
  const planEditRefetchAtom = useMemo(
    () => planEditRefetchTriggerAtomFamily(activeSubChatId || ""),
    [activeSubChatId],
  )
  const planEditRefetchTrigger = useAtomValue(planEditRefetchAtom)

  // ── Build Plan handler ──
  const setPendingBuildPlanSubChatId = useSetAtom(
    pendingBuildPlanSubChatIdAtom,
  )
  const handleApprovePlan = useCallback(() => {
    const freshActiveSubChatId =
      useAgentSubChatStore.getState().activeSubChatId
    if (freshActiveSubChatId) {
      setPendingBuildPlanSubChatId(freshActiveSubChatId)
    }
  }, [setPendingBuildPlanSubChatId])

  // ── Submit Review handler（自治实现）──
  const { comments: reviewComments, commentsByDocument, clearComments } =
    useDocumentComments(activeSubChatId || "")
  const setPendingReviewMessage = useSetAtom(pendingReviewMessageAtom)
  const diffPanel = usePanel(PANEL_IDS.DIFF)

  const handleSubmitReview = useCallback(
    (summary: string) => {
      if (reviewComments.length === 0) {
        toast.error("No comments to submit")
        return
      }
      const messageParts: string[] = []
      messageParts.push("## Review\n")
      if (summary.trim()) {
        messageParts.push(`### Summary\n${summary.trim()}\n`)
        messageParts.push("\n### Comments\n")
      }
      for (const [path, docComments] of Object.entries(commentsByDocument)) {
        for (const comment of docComments) {
          const fileName = path.split("/").pop() || path
          const lineRange = comment.anchor.lineStart
            ? comment.anchor.lineEnd &&
              comment.anchor.lineEnd !== comment.anchor.lineStart
              ? `:L${comment.anchor.lineStart}-${comment.anchor.lineEnd}`
              : `:L${comment.anchor.lineStart}`
            : ""
          messageParts.push(`\n**${fileName}${lineRange}**\n`)
          const quoteText = comment.anchor.selectedText.slice(0, 100)
          const truncated =
            comment.anchor.selectedText.length > 100 ? "..." : ""
          messageParts.push(`\n> ${quoteText}${truncated}\n`)
          messageParts.push(`\n${comment.content}\n`)
        }
      }
      const message = messageParts.join("")
      setPendingReviewMessage(message)
      clearComments()
      props.onClose()
      diffPanel.close()
    },
    [
      reviewComments,
      commentsByDocument,
      clearComments,
      setPendingReviewMessage,
      props.onClose,
      diffPanel,
    ],
  )

  // ── Render ──
  if (!currentPlanPath || !activeSubChatId) return null

  return (
    <AgentPlanSidebar
      chatId={chatId}
      subChatId={activeSubChatId}
      planPath={currentPlanPath}
      onClose={props.onClose}
      onBuildPlan={handleApprovePlan}
      refetchTrigger={planEditRefetchTrigger}
      mode={currentMode}
      onSubmitReview={handleSubmitReview}
    />
  )
})
