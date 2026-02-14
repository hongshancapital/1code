/**
 * usePanelState - Hook for managing panel state in a ChatView instance
 *
 * Provides a unified API for opening, closing, and toggling panels
 * with automatic handling of:
 * - Exclusive groups (mutually exclusive panels)
 * - Display modes (full vs side-peek)
 * - Instance isolation (each ChatView has independent state)
 *
 * Usage:
 *   const { isOpen, open, close, toggle, displayMode, size, setSize } = usePanelState({
 *     chatId: "chat-123",
 *     panelId: "diff",
 *   })
 */

import { useCallback, useMemo } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  panelOpenStateAtomFamily,
  createPanelStateKey,
  getExclusiveGroup,
  getSiblingPanels,
  getPanelsToClose,
  determineDisplayMode,
  type PanelOpenState,
} from "../stores/panel-state-manager"
import { panelRegistry, type PanelConfig, type PanelContext } from "../stores/panel-registry"

// =============================================================================
// Types
// =============================================================================

export interface UsePanelStateOptions {
  /** Chat instance ID (for state isolation) */
  chatId: string
  /** Panel ID from PanelRegistry */
  panelId: string
  /** Optional panel context for availability checks */
  context?: PanelContext
}

export interface UsePanelStateResult {
  /** Whether the panel is currently open */
  isOpen: boolean
  /** Current display mode */
  displayMode: "full" | "side-peek"
  /** Current size in pixels */
  size: number
  /** Panel configuration from registry */
  config: PanelConfig | undefined
  /** Whether the panel is available (passes isAvailable check) */
  isAvailable: boolean

  /** Open the panel */
  open: (mode?: "full" | "side-peek") => void
  /** Close the panel */
  close: () => void
  /** Toggle the panel */
  toggle: (mode?: "full" | "side-peek") => void
  /** Set the panel size */
  setSize: (size: number) => void
  /** Set display mode without changing open state */
  setDisplayMode: (mode: "full" | "side-peek") => void
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function usePanelState({
  chatId,
  panelId,
  context,
}: UsePanelStateOptions): UsePanelStateResult {
  // Get the atom for this specific panel in this chat instance
  const stateKey = createPanelStateKey(chatId, panelId)
  const [state, setState] = useAtom(panelOpenStateAtomFamily(stateKey))

  // Get sibling panel atoms for exclusive group handling
  const siblingKeys = useMemo(() => {
    const siblings = getSiblingPanels(panelId)
    return siblings.map((id) => ({
      id,
      key: createPanelStateKey(chatId, id),
    }))
  }, [chatId, panelId])

  // Get panel config from registry
  const config = useMemo(() => panelRegistry.get(panelId), [panelId])

  // Check availability
  const isAvailable = useMemo(() => {
    if (!config) return false
    if (!config.isAvailable) return true
    if (!context) return true
    return config.isAvailable(context)
  }, [config, context])

  // ---------------------------------------------------------------------------
  // State Setters for Siblings
  // ---------------------------------------------------------------------------

  // We need to close sibling panels when opening in full mode
  // This is a bit tricky with atoms - we'll use a workaround
  const closeSiblings = useCallback(
    (siblingIds: string[]) => {
      // For each sibling that should be closed, we need to update its state
      // We'll do this by accessing the atoms directly through the family
      for (const id of siblingIds) {
        const key = createPanelStateKey(chatId, id)
        const siblingAtom = panelOpenStateAtomFamily(key)
        // We can't use hooks here, so we'll use the atom directly
        // This requires the atom family to be stable (which it is)
        // Note: This is a workaround - ideally we'd use a single atom for all panel states
        const currentState = panelOpenStateAtomFamily(key)
        // Unfortunately, we can't set atoms outside of React hooks easily
        // So we'll handle this in the open callback with setState for now
      }
    },
    [chatId]
  )

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const open = useCallback(
    (mode: "full" | "side-peek" = "full") => {
      if (!isAvailable) return

      setState((prev) => ({
        ...prev,
        isOpen: true,
        displayMode: mode,
      }))

      // Note: Sibling closing is handled at a higher level (usePanelGroup hook)
      // This hook only manages single panel state
    },
    [isAvailable, setState]
  )

  const close = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isOpen: false,
    }))
  }, [setState])

  const toggle = useCallback(
    (mode: "full" | "side-peek" = "full") => {
      if (!isAvailable) return

      setState((prev) => ({
        ...prev,
        isOpen: !prev.isOpen,
        displayMode: mode,
      }))
    },
    [isAvailable, setState]
  )

  const setSize = useCallback(
    (size: number) => {
      // Respect min/max size from config
      let clampedSize = size
      if (config?.minSize) clampedSize = Math.max(clampedSize, config.minSize)
      if (config?.maxSize) clampedSize = Math.min(clampedSize, config.maxSize)

      setState((prev) => ({
        ...prev,
        size: clampedSize,
      }))
    },
    [config, setState]
  )

  const setDisplayMode = useCallback(
    (mode: "full" | "side-peek") => {
      setState((prev) => ({
        ...prev,
        displayMode: mode,
      }))
    },
    [setState]
  )

  return {
    isOpen: state.isOpen,
    displayMode: state.displayMode,
    size: state.size,
    config,
    isAvailable,
    open,
    close,
    toggle,
    setSize,
    setDisplayMode,
  }
}

// =============================================================================
// Panel Group Hook - Manages Exclusive Groups
// =============================================================================

export interface UsePanelGroupOptions {
  /** Chat instance ID */
  chatId: string
  /** Panel IDs in this group */
  panelIds: string[]
  /** Optional panel context */
  context?: PanelContext
}

export interface UsePanelGroupResult {
  /** Map of panel states by ID */
  panels: Map<string, UsePanelStateResult>
  /** IDs of currently open panels */
  openPanelIds: string[]
  /** Open a panel (handles exclusive closing) */
  openPanel: (panelId: string, mode?: "full" | "side-peek") => void
  /** Close a panel */
  closePanel: (panelId: string) => void
  /** Toggle a panel */
  togglePanel: (panelId: string, mode?: "full" | "side-peek") => void
  /** Close all panels in the group */
  closeAll: () => void
}

/**
 * Hook for managing a group of panels with exclusive behavior
 */
export function usePanelGroup({
  chatId,
  panelIds,
  context,
}: UsePanelGroupOptions): UsePanelGroupResult {
  // Get state for each panel
  const panelStates = panelIds.map((panelId) => ({
    panelId,
    ...usePanelState({ chatId, panelId, context }),
  }))

  const panels = useMemo(() => {
    const map = new Map<string, UsePanelStateResult>()
    for (const state of panelStates) {
      const { panelId, ...rest } = state
      map.set(panelId, rest)
    }
    return map
  }, [panelStates])

  const openPanelIds = useMemo(
    () => panelStates.filter((p) => p.isOpen).map((p) => p.panelId),
    [panelStates]
  )

  const openPanel = useCallback(
    (panelId: string, mode: "full" | "side-peek" = "full") => {
      const panelState = panels.get(panelId)
      if (!panelState) return

      // Close siblings based on mode
      const currentOpen = new Set(openPanelIds)
      const toClose = getPanelsToClose(panelId, currentOpen, mode)

      for (const siblingId of toClose) {
        const sibling = panels.get(siblingId)
        sibling?.close()
      }

      panelState.open(mode)
    },
    [panels, openPanelIds]
  )

  const closePanel = useCallback(
    (panelId: string) => {
      const panelState = panels.get(panelId)
      panelState?.close()
    },
    [panels]
  )

  const togglePanel = useCallback(
    (panelId: string, mode: "full" | "side-peek" = "full") => {
      const panelState = panels.get(panelId)
      if (!panelState) return

      if (panelState.isOpen) {
        panelState.close()
      } else {
        openPanel(panelId, mode)
      }
    },
    [panels, openPanel]
  )

  const closeAll = useCallback(() => {
    for (const panelState of panels.values()) {
      panelState.close()
    }
  }, [panels])

  return {
    panels,
    openPanelIds,
    openPanel,
    closePanel,
    togglePanel,
    closeAll,
  }
}

// =============================================================================
// Right Sidebar Hook - Convenience for common use case
// =============================================================================

const RIGHT_SIDEBAR_PANELS = ["diff", "plan", "preview", "browser", "file-viewer", "details"]

export interface UseRightSidebarOptions {
  chatId: string
  context?: PanelContext
}

/**
 * Convenience hook for managing right sidebar panels
 */
export function useRightSidebar(options: UseRightSidebarOptions): UsePanelGroupResult {
  return usePanelGroup({
    chatId: options.chatId,
    panelIds: RIGHT_SIDEBAR_PANELS,
    context: options.context,
  })
}
