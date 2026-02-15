/**
 * TerminalPanelWrapper — 自治的 Terminal 面板组件
 *
 * Terminal 支持两种 displayMode：
 * - side-peek → PanelZone "right"（TerminalSidebar 内部已有 ResizableSidebar）
 * - bottom → PanelZone "bottom"（TerminalBottomPanelContent）
 *
 * displayMode 来源：legacy terminalDisplayModeAtom（用户可通过 UI 切换）。
 * TerminalSidebar 内部也读这个 atom，两端必须统一，否则会出现
 * side-peek mode 渲染了 TerminalSidebar 但它内部读到 bottom 返回 null 的问题。
 */

import { memo } from "react"
import { useAtomValue } from "jotai"
import { useChatInstance } from "../../../context/chat-instance-context"
import { usePlatform } from "../../../../../contexts/PlatformContext"
import { TerminalSidebar, TerminalBottomPanelContent } from "../../../../terminal/terminal-sidebar"
import { terminalDisplayModeAtom } from "../../../../terminal/atoms"
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
  onClose,
}: PanelRenderProps) {
  const { chatId, worktreePath } = useChatInstance()
  const legacyDisplayMode = useAtomValue(terminalDisplayModeAtom)

  if (!worktreePath) return null

  // Bottom mode renders content only (PanelZone provides ResizableBottomPanel)
  if (legacyDisplayMode === "bottom") {
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
  return (
    <TerminalSidebar
      chatId={chatId}
      cwd={worktreePath}
      workspaceId={chatId}
    />
  )
})
