/**
 * ExplorerPanelWrapper — 自治的 Explorer 面板组件
 *
 * ExplorerPanel 内部已有 PanelContainer 容器路由。
 */

import { memo, useCallback, useMemo } from "react"
import { useAtom } from "jotai"
import { useChatInstance } from "../../../context/chat-instance-context"
import { usePlatform } from "../../../../../contexts/PlatformContext"
import { explorerPanelOpenAtomFamily } from "../../../atoms"
import { ExplorerPanel as ExplorerPanelInner } from "../../../../details-sidebar/sections/explorer-panel"
import type { PanelRenderProps } from "../types"

// =============================================================================
// Availability Hook
// =============================================================================

export function useExplorerAvailability(): boolean {
  const { worktreePath } = useChatInstance()
  const { isDesktop } = usePlatform()
  return isDesktop && !!worktreePath
}

// =============================================================================
// ExplorerPanelWrapper Component
// =============================================================================

export const ExplorerPanelWrapper = memo(function ExplorerPanelWrapper({
  onClose,
}: PanelRenderProps) {
  const { chatId, worktreePath } = useChatInstance()

  const explorerOpenAtom = useMemo(
    () => explorerPanelOpenAtomFamily(chatId),
    [chatId],
  )
  const [isOpen] = useAtom(explorerOpenAtom)

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  if (!worktreePath) return null

  // ExplorerPanelInner has its own PanelContainer routing
  return (
    <ExplorerPanelInner
      chatId={chatId}
      worktreePath={worktreePath}
      isOpen={isOpen}
      onClose={handleClose}
    />
  )
})
