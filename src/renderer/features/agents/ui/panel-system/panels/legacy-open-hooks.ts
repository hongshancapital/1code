/**
 * Legacy Open State Hooks
 *
 * Bridge hooks that read panel open state from legacy atoms.
 * Used by PanelZoneSlot (via PanelDefinition.useIsOpen) to determine
 * panel visibility while active-chat.tsx still manages state through
 * legacy atoms and useSidebarMutualExclusion.
 *
 * Once all consumers migrate to usePanel(), these hooks can be removed.
 */

import { useCallback, useLayoutEffect, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useChatInstanceSafe } from "../../../context/chat-instance-context"
import { useAgentSubChatStore } from "../../../stores/sub-chat-store"
import {
  diffSidebarOpenAtomFamily,
  planSidebarOpenAtomFamily,
  explorerPanelOpenAtomFamily,
  fileViewerOpenAtomFamily,
  agentsPreviewSidebarOpenAtom,
} from "../../../atoms"
import {
  terminalSidebarOpenAtomFamily,
  terminalDisplayModeAtom,
} from "../../../../terminal/atoms"
import {
  detailsSidebarOpenAtom,
} from "../../../../details-sidebar/atoms"
import { panelDisplayModeAtomFamily } from "../../../stores/panel-state-manager"
import { PANEL_IDS } from "../../../stores/panel-registry"

// =============================================================================
// Diff Panel
// =============================================================================

export function useDiffIsOpen(): { isOpen: boolean; close: () => void } {
  const chatInstance = useChatInstanceSafe()
  const chatId = chatInstance?.chatId ?? ""
  const diffAtom = useMemo(() => diffSidebarOpenAtomFamily(chatId), [chatId])
  const [isOpen, setIsOpen] = useAtom(diffAtom)

  const close = useCallback(() => setIsOpen(false), [setIsOpen])
  return { isOpen, close }
}

// =============================================================================
// Plan Panel
// =============================================================================

export function usePlanIsOpen(): { isOpen: boolean; close: () => void } {
  const activeSubChatId = useAgentSubChatStore((s) => s.activeSubChatId)
  const planAtom = useMemo(
    () => planSidebarOpenAtomFamily(activeSubChatId || ""),
    [activeSubChatId],
  )
  const [isOpen, setIsOpen] = useAtom(planAtom)

  const close = useCallback(() => setIsOpen(false), [setIsOpen])
  return { isOpen, close }
}

// =============================================================================
// Terminal Panel
// =============================================================================

export function useTerminalIsOpen(): { isOpen: boolean; close: () => void } {
  const chatInstance = useChatInstanceSafe()
  const chatId = chatInstance?.chatId ?? ""
  const terminalAtom = useMemo(
    () => terminalSidebarOpenAtomFamily(chatId),
    [chatId],
  )
  const [isOpen, setIsOpen] = useAtom(terminalAtom)

  // 同步 legacy terminalDisplayModeAtom → panel system panelDisplayModeAtomFamily
  // 用 useLayoutEffect 确保在 paint 前同步，避免一帧的 zone 不匹配
  const legacyDisplayMode = useAtomValue(terminalDisplayModeAtom)
  const setPanelDisplayMode = useSetAtom(panelDisplayModeAtomFamily(PANEL_IDS.TERMINAL))
  useLayoutEffect(() => {
    setPanelDisplayMode(legacyDisplayMode)
  }, [legacyDisplayMode, setPanelDisplayMode])

  const close = useCallback(() => setIsOpen(false), [setIsOpen])
  return { isOpen, close }
}

// =============================================================================
// Preview Panel
// =============================================================================

export function usePreviewIsOpen(): { isOpen: boolean; close: () => void } {
  const [isOpen, setIsOpen] = useAtom(agentsPreviewSidebarOpenAtom)

  const close = useCallback(() => setIsOpen(false), [setIsOpen])
  return { isOpen, close }
}

// =============================================================================
// File Viewer Panel
// =============================================================================

export function useFileViewerIsOpen(): { isOpen: boolean; close: () => void } {
  const chatInstance = useChatInstanceSafe()
  const chatId = chatInstance?.chatId ?? ""
  const fileViewerAtom = useMemo(
    () => fileViewerOpenAtomFamily(chatId),
    [chatId],
  )
  const [filePath, setFilePath] = useAtom(fileViewerAtom)

  const close = useCallback(() => setFilePath(null), [setFilePath])
  return { isOpen: filePath !== null, close }
}

// =============================================================================
// Explorer Panel
// =============================================================================

export function useExplorerIsOpen(): { isOpen: boolean; close: () => void } {
  const chatInstance = useChatInstanceSafe()
  const chatId = chatInstance?.chatId ?? ""
  const explorerAtom = useMemo(
    () => explorerPanelOpenAtomFamily(chatId),
    [chatId],
  )
  const [isOpen, setIsOpen] = useAtom(explorerAtom)

  const close = useCallback(() => setIsOpen(false), [setIsOpen])
  return { isOpen, close }
}

// =============================================================================
// Details Panel
// =============================================================================

export function useDetailsIsOpen(): { isOpen: boolean; close: () => void } {
  const [isOpen, setIsOpen] = useAtom(detailsSidebarOpenAtom)

  const close = useCallback(() => setIsOpen(false), [setIsOpen])
  return { isOpen, close }
}
