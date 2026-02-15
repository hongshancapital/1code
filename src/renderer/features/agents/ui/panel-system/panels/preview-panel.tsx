/**
 * PreviewPanelWrapper — 自治的 Preview 面板组件
 *
 * 从 Context/Atom 获取 sandbox 信息，渲染 AgentPreview。
 * 容器（ResizableSidebar）由 PanelZone 管理。
 * 仅在 sandbox 模式下可用。
 */

import { memo } from "react"
import { useChatInstance } from "../../../context/chat-instance-context"
import { AgentPreview } from "../../agent-preview"
import type { PanelRenderProps } from "../types"

// =============================================================================
// Availability Hook
// =============================================================================

export function usePreviewAvailability(): boolean {
  const { agentChat, sandboxId } = useChatInstance()
  const meta = agentChat?.meta as {
    sandboxConfig?: { port?: number }
    isQuickSetup?: boolean
  } | null
  const isQuickSetup = meta?.isQuickSetup || !meta?.sandboxConfig?.port
  return !!(sandboxId && !isQuickSetup && meta?.sandboxConfig?.port)
}

// =============================================================================
// PreviewPanelWrapper Component
// =============================================================================

export const PreviewPanelWrapper = memo(function PreviewPanelWrapper(
  props: PanelRenderProps,
) {
  const { chatId, agentChat, sandboxId } = useChatInstance()

  const meta = agentChat?.meta as {
    sandboxConfig?: { port?: number }
    repository?: { owner: string; name: string } | string
  } | null

  const previewPort = meta?.sandboxConfig?.port ?? 3000
  const repository =
    meta?.repository && typeof meta.repository === "object"
      ? `${meta.repository.owner}/${meta.repository.name}`
      : typeof meta?.repository === "string"
        ? meta.repository
        : undefined

  if (!sandboxId) return null

  return (
    <AgentPreview
      chatId={chatId}
      sandboxId={sandboxId}
      port={previewPort}
      repository={repository}
      hideHeader={false}
      onClose={props.onClose}
    />
  )
})
