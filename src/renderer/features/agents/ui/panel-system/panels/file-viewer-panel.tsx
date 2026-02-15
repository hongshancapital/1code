/**
 * FileViewerPanelWrapper — 自治的 FileViewer 面板组件
 *
 * 从 atom 获取当前打开的文件路径和显示模式。
 * FileViewerPanel 内部已有容器路由（side-peek/center-peek/full-page）。
 */

import { memo, useCallback, useMemo } from "react"
import { useAtom } from "jotai"
import { useChatInstance } from "../../../context/chat-instance-context"
import {
  fileViewerOpenAtomFamily,
  fileViewerDisplayModeAtom,
} from "../../../atoms"
import { FileViewerPanel as FileViewerPanelInner } from "../../../components/file-viewer-panel"
import type { PanelRenderProps } from "../types"

// =============================================================================
// Availability Hook
// =============================================================================

export function useFileViewerAvailability(): boolean {
  const { chatId } = useChatInstance()
  const fileViewerAtom = useMemo(
    () => fileViewerOpenAtomFamily(chatId),
    [chatId],
  )
  const [filePath] = useAtom(fileViewerAtom)
  return !!filePath
}

// =============================================================================
// FileViewerPanelWrapper Component
// =============================================================================

export const FileViewerPanelWrapper = memo(function FileViewerPanelWrapper(
  _props: PanelRenderProps,
) {
  const { chatId, worktreePath } = useChatInstance()

  const fileViewerAtom = useMemo(
    () => fileViewerOpenAtomFamily(chatId),
    [chatId],
  )
  const [filePath, setFilePath] = useAtom(fileViewerAtom)
  const [fileViewerDisplayMode] = useAtom(fileViewerDisplayModeAtom)

  const handleClose = useCallback(() => {
    setFilePath(null)
  }, [setFilePath])

  if (!filePath) return null

  // FileViewerPanelInner has its own container routing (side-peek/center-peek/full-page)
  return (
    <FileViewerPanelInner
      filePath={filePath}
      projectPath={worktreePath}
      displayMode={fileViewerDisplayMode}
      isMobileFullscreen={false}
      onClose={handleClose}
    />
  )
})
