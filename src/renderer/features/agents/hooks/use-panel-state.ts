/**
 * usePanel - 统一面板控制 Hook
 *
 * 核心消费接口：传入 panelId → 获得响应式状态 + 互斥安全的 actions。
 *
 * Usage:
 *   const panel = usePanel("diff")
 *   panel.open()     // 自动关闭同组冲突 panel
 *   panel.close()    // 自动恢复被自动关闭的 panel
 *   panel.toggle()
 *   panel.setDisplayMode("center-peek")
 *   panel.setSize(600)
 *
 * 互斥逻辑内置于 open()/close() 中，不再需要外部 useSidebarMutualExclusion。
 */

import { useCallback, useMemo } from "react"
import { useAtom, useSetAtom } from "jotai"
import {
  panelIsOpenAtomFamily,
  panelDisplayModeAtomFamily,
  panelSizeAtomFamily,
  createOpenPanelAction,
  createClosePanelAction,
  createTogglePanelAction,
} from "../stores/panel-state-manager"
import {
  panelRegistry,
  type PanelConfig,
  type DisplayMode,
} from "../stores/panel-registry"
import { usePanelContext } from "../ui/panel-system/panel-renderer"
import { useChatInstanceSafe } from "../context/chat-instance-context"
import { createLogger } from "../../../lib/logger"

const usePanelGroupLog = createLogger("usePanelGroup")
const useRightSidebarLog = createLogger("useRightSidebar")


// =============================================================================
// Types
// =============================================================================

export interface PanelHandle {
  /** Panel configuration from registry (undefined if unregistered) */
  config: PanelConfig | undefined

  /** Whether the panel passes availability checks for current context */
  isAvailable: boolean

  /** Whether the panel is currently open */
  isOpen: boolean

  /** Current display mode (side-peek, center-peek, full-page, bottom) */
  displayMode: DisplayMode

  /** Current size in pixels (width or height depending on position) */
  size: number

  /**
   * Open the panel.
   * In exclusive groups: auto-closes conflicting side-peek panels and remembers them.
   */
  open: () => void

  /**
   * Close the panel.
   * In exclusive groups with restoreOnClose: auto-restores previously auto-closed panels.
   */
  close: () => void

  /** Toggle open/close */
  toggle: () => void

  /** Change display mode (does NOT change open state) */
  setDisplayMode: (mode: DisplayMode) => void

  /** Change panel size in pixels */
  setSize: (size: number) => void
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Core hook for panel management.
 * Reads chatId from ChatInstanceContext — must be used within a ChatInstanceProvider.
 *
 * Falls back to a no-op handle when:
 * - ChatInstanceContext is missing (outside ChatView)
 * - panelId is not registered in PanelRegistry
 */
export function usePanel(panelId: string, subChatId?: string): PanelHandle {
  const chatInstance = useChatInstanceSafe()
  const chatId = chatInstance?.chatId ?? ""
  const panelContext = usePanelContext()

  // Config from registry
  const config = useMemo(() => panelRegistry.get(panelId), [panelId])

  // Availability check
  const isAvailable = useMemo(() => {
    if (!config) return false
    if (!config.isAvailable) return true
    return config.isAvailable(panelContext)
  }, [config, panelContext])

  // Reactive state
  const [isOpen] = useAtom(
    panelIsOpenAtomFamily({ chatId, panelId })
  )
  const [displayMode, setDisplayModeRaw] = useAtom(
    panelDisplayModeAtomFamily(panelId)
  )
  // Size scoped per subChatId — different subchat tabs can have different panel widths
  const resolvedSubChatId = subChatId ?? ""
  const sizeAtomKey = useMemo(
    () => ({ panelId, subChatId: resolvedSubChatId }),
    [panelId, resolvedSubChatId],
  )
  const [size, setSizeRaw] = useAtom(panelSizeAtomFamily(sizeAtomKey))

  // Action atoms (created per render — they're cheap write-only atoms)
  const openAction = useMemo(
    () => createOpenPanelAction(panelId, chatId),
    [panelId, chatId]
  )
  const closeAction = useMemo(
    () => createClosePanelAction(panelId, chatId),
    [panelId, chatId]
  )
  const toggleAction = useMemo(
    () => createTogglePanelAction(panelId, chatId),
    [panelId, chatId]
  )

  const dispatchOpen = useSetAtom(openAction)
  const dispatchClose = useSetAtom(closeAction)
  const dispatchToggle = useSetAtom(toggleAction)

  // Stable action callbacks
  const open = useCallback(() => {
    if (!isAvailable || !chatId) return
    dispatchOpen()
  }, [isAvailable, chatId, dispatchOpen])

  const close = useCallback(() => {
    if (!chatId) return
    dispatchClose()
  }, [chatId, dispatchClose])

  const toggle = useCallback(() => {
    if (!isAvailable || !chatId) return
    dispatchToggle()
  }, [isAvailable, chatId, dispatchToggle])

  const setDisplayMode = useCallback(
    (mode: DisplayMode) => {
      // Validate mode is supported by this panel
      const supported = config?.displayModes ?? ["side-peek"]
      if (!supported.includes(mode)) return
      setDisplayModeRaw(mode)
    },
    [config, setDisplayModeRaw]
  )

  const setSize = useCallback(
    (newSize: number) => {
      let clamped = newSize
      if (config?.minSize) clamped = Math.max(clamped, config.minSize)
      if (config?.maxSize) clamped = Math.min(clamped, config.maxSize)
      setSizeRaw(clamped)
    },
    [config, setSizeRaw]
  )

  return {
    config,
    isAvailable,
    isOpen: isAvailable ? isOpen : false, // force closed when unavailable
    displayMode,
    size,
    open,
    close,
    toggle,
    setDisplayMode,
    setSize,
  }
}

// =============================================================================
// Re-exports for backwards compatibility (to be removed after migration)
// =============================================================================

/** @deprecated Use usePanel() instead */
export const usePanelState = usePanel

/** @deprecated Mutual exclusion is now handled internally by usePanel().open() */
export function usePanelGroup() {
  usePanelGroupLog.warn("Deprecated. Use usePanel() instead.")
  return null
}

/** @deprecated Use usePanel() instead */
export function useRightSidebar() {
  useRightSidebarLog.warn("Deprecated. Use usePanel() instead.")
  return null
}

// Legacy type re-exports for index.ts compatibility
export type UsePanelStateOptions = { chatId: string; panelId: string }
export type UsePanelStateResult = PanelHandle
export type UsePanelGroupOptions = { chatId: string; panelIds: string[] }
export type UsePanelGroupResult = null
export type UseRightSidebarOptions = { chatId: string }
