/**
 * TerminalPanelWrapper — 自治的 Terminal 面板组件
 *
 * Terminal 支持两种 displayMode：
 * - side-peek → PanelZone "right"（TerminalSidebar 内部已有 ResizableSidebar）
 * - bottom → PanelZone "bottom"（TerminalBottomPanelContent）
 *
 * 根据 displayMode 渲染不同内容。
 * 注意：TerminalSidebar 内部自带 ResizableSidebar，
 * 所以 side-peek 模式下 PanelZone 不应再提供外部容器。
 */

import { memo, useCallback } from "react"
import { useChatInstance } from "../../../context/chat-instance-context"
import { usePlatform } from "../../../../../contexts/PlatformContext"
import { TerminalSidebar, TerminalBottomPanelContent } from "../../../../terminal/terminal-sidebar"
import type { PanelRenderProps } from "../types"

// =============================================================================
// Availability Hook
// =============================================================================

export function useTerminalAvailability(): boolean {
  const { worktreePath } = useChatInstance()
  const { isDesktop } = usePlatform()
  return isDesktop && !!worktreePath
}

// =============================================================================
// TerminalPanelWrapper Component
// =============================================================================

export const TerminalPanelWrapper = memo(function TerminalPanelWrapper({
  displayMode,
  onClose,
}: PanelRenderProps) {
  const { chatId, worktreePath } = useChatInstance()

  if (!worktreePath) return null

  // Bottom mode renders content only (PanelZone provides ResizableBottomPanel)
  if (displayMode === "bottom") {
    return (
      <TerminalBottomPanelContent
        chatId={chatId}
        cwd={worktreePath}
        workspaceId={chatId}
        onClose={onClose}
      />
    )
  }

  // Side-peek mode: TerminalSidebar has its own ResizableSidebar internally
  // So this renders the full terminal sidebar with its own container
  return (
    <TerminalSidebar
      chatId={chatId}
      cwd={worktreePath}
      workspaceId={chatId}
    />
  )
})
