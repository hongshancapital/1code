/**
 * BrowserPanelWrapper — 自治的 Browser 面板组件
 *
 * 从 Context/Atom/Hook 获取所有业务数据。
 * 容器（ResizableSidebar + keepMounted）由 PanelZone 管理。
 *
 * 性能优化：BrowserSidebar 含 webview（~1900 行），mount/unmount 开销极大。
 * PanelZone 使用 keepMounted 模式保持 webview 常驻。
 */

import { memo, useCallback, useMemo } from "react"
import { useAtom, useSetAtom } from "jotai"
import { useChatInstance } from "../../../context/chat-instance-context"
import { BrowserPanel as BrowserPanelInner } from "../../../../browser-sidebar"
import {
  browserPendingScreenshotAtomFamily,
  browserActiveAtomFamily,
} from "../../../../browser-sidebar/atoms"
import { betaBrowserEnabledAtom } from "../../../../../lib/atoms"
import type { PanelRenderProps } from "../types"

// =============================================================================
// Availability Hook
// =============================================================================

export function useBrowserAvailability(): boolean {
  const [enabled] = useAtom(betaBrowserEnabledAtom)
  return enabled
}

// =============================================================================
// BrowserPanelWrapper Component
// =============================================================================

export const BrowserPanelWrapper = memo(function BrowserPanelWrapper(
  props: PanelRenderProps,
) {
  const { chatId, agentChat } = useChatInstance()

  const browserActiveAtom = useMemo(
    () => browserActiveAtomFamily(chatId),
    [chatId],
  )
  const setBrowserActive = useSetAtom(browserActiveAtom)

  // ── Screenshot state ──
  const browserPendingScreenshotAtom = useMemo(
    () => browserPendingScreenshotAtomFamily(chatId),
    [chatId],
  )
  const setBrowserPendingScreenshot = useSetAtom(browserPendingScreenshotAtom)

  // ── Handlers ──
  const handleCollapse = useCallback(() => {
    props.onClose()
  }, [props.onClose])

  const handleClose = useCallback(() => {
    props.onClose()
    setBrowserActive(false)
  }, [props.onClose, setBrowserActive])

  const handleScreenshot = useCallback(
    (imageData: string) => {
      setBrowserPendingScreenshot(imageData)
    },
    [setBrowserPendingScreenshot],
  )

  const projectId = (agentChat as any)?.projectId || chatId

  return (
    <BrowserPanelInner
      chatId={chatId}
      projectId={projectId}
      onCollapse={handleCollapse}
      onClose={handleClose}
      onScreenshot={handleScreenshot}
    />
  )
})
