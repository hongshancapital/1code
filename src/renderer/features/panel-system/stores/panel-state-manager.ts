/**
 * PanelStateManager - 统一面板状态管理
 *
 * 解决的问题:
 * 1. 每个 ChatView 实例有独立的面板状态 (isOpen, size, displayMode)
 * 2. 同一 PanelGroup 内的 side-peek 面板自动互斥
 * 3. 关闭当前面板时恢复上一个被自动关闭的面板
 * 4. 统一 open/close/toggle API，替代散落的 atom 管理
 *
 * 设计理念:
 * - PanelRegistry 管理配置（静态元数据 + group 分配）
 * - PanelStateManager 管理运行时状态（动态 open/close/size/displayMode）
 * - 使用 Jotai atom 实现每 chat 隔离
 * - 互斥逻辑在 open action 内主动执行，而非 useEffect 监听
 */

import { atom } from "jotai"
import { atomFamily, atomWithStorage } from "jotai/utils"
import { atomWithWindowStorage } from "../../../lib/window-storage"
import {
  type DisplayMode,
  type PanelConfig,
  type PanelGroupConfig,
  panelRegistry,
  getPanelGroup,
  PANEL_GROUP_IDS,
  PANEL_IDS,
} from "./panel-registry"

// =============================================================================
// Types
// =============================================================================

/**
 * Per-panel runtime state value
 */
export interface PanelStateValue {
  isOpen: boolean
  displayMode: DisplayMode
  size: number
}

/**
 * Stack entry for restoration after mutual exclusion auto-close
 */
export interface ClosedStackEntry {
  panelId: string
  displayMode: DisplayMode
}

// =============================================================================
// Default State Helpers
// =============================================================================

/**
 * Get default state for a panel from its config
 */
export function getDefaultPanelState(panelId: string): PanelStateValue {
  const config = panelRegistry.get(panelId)
  return {
    isOpen: config?.defaultOpen ?? false,
    displayMode: config?.defaultDisplayMode ?? config?.displayModes?.[0] ?? "side-peek",
    size: config?.defaultSize ?? 400,
  }
}

// =============================================================================
// Panel State Atoms (per-panel, per-chat)
// =============================================================================

// Open state — window-scoped storage (per chatId, per panelId)
// Key format: "panel:{panelId}"
// Value format: Record<chatId, boolean>

const panelOpenStorageAtomFamily = atomFamily((panelId: string) =>
  atomWithWindowStorage<Record<string, boolean>>(
    `panel:${panelId}:open`,
    {},
    { getOnInit: true },
  )
)

// Display mode — persisted globally per panel (not per-chat, because user preference)
const panelDisplayModeStorageAtomFamily = atomFamily((panelId: string) =>
  atomWithStorage<DisplayMode>(
    `panel:${panelId}:displayMode`,
    getDefaultPanelState(panelId).displayMode,
    undefined,
    { getOnInit: true },
  )
)

// Size — persisted per panel per subChat (different subchat tabs can have different panel widths)
const panelSizeStorageAtomFamily = atomFamily(
  ({ panelId, subChatId }: { panelId: string; subChatId: string }) =>
    atomWithStorage<number>(
      subChatId
        ? `panel:${panelId}:size:${subChatId}`
        : `panel:${panelId}:size`,
      getDefaultPanelState(panelId).size,
      undefined,
      { getOnInit: true },
    ),
  (a, b) => a.panelId === b.panelId && a.subChatId === b.subChatId,
)

// Runtime open state — for non-side-peek modes (dialog/fullscreen should not auto-restore on page load)
const panelOpenRuntimeAtomFamily = atomFamily((_panelId: string) =>
  atom<Record<string, boolean>>({})
)

// =============================================================================
// Panel State Atom Family — unified read/write per (chatId, panelId)
// =============================================================================

/**
 * Get/set panel open state for a specific chat.
 * For side-peek mode: reads from persisted storage (survives page reload).
 * For center-peek/full-page: reads from runtime state only (doesn't auto-restore).
 */
export const panelIsOpenAtomFamily = atomFamily(
  ({ chatId, panelId }: { chatId: string; panelId: string }) =>
    atom(
      (get) => {
        const displayMode = get(panelDisplayModeStorageAtomFamily(panelId))
        const runtimeOpen = get(panelOpenRuntimeAtomFamily(panelId))[chatId]

        // Runtime value takes priority (user explicitly opened/closed in this session)
        if (runtimeOpen !== undefined) {
          return runtimeOpen
        }

        // For initial load: only restore persisted state for side-peek mode
        if (displayMode !== "side-peek") {
          return false
        }
        return get(panelOpenStorageAtomFamily(panelId))[chatId] ?? false
      },
      (get, set, isOpen: boolean) => {
        // Update runtime state
        const currentRuntime = get(panelOpenRuntimeAtomFamily(panelId))
        set(panelOpenRuntimeAtomFamily(panelId), { ...currentRuntime, [chatId]: isOpen })

        // Also persist
        const current = get(panelOpenStorageAtomFamily(panelId))
        set(panelOpenStorageAtomFamily(panelId), { ...current, [chatId]: isOpen })
      },
    ),
  (a, b) => a.chatId === b.chatId && a.panelId === b.panelId,
)

/**
 * Get/set display mode for a panel (global, not per-chat)
 */
export const panelDisplayModeAtomFamily = atomFamily(
  (panelId: string) =>
    atom(
      (get) => get(panelDisplayModeStorageAtomFamily(panelId)),
      (get, set, mode: DisplayMode) => {
        set(panelDisplayModeStorageAtomFamily(panelId), mode)
      },
    ),
)

/**
 * Get/set size for a panel, scoped per subChatId.
 * Different subchat tabs can have different panel widths/heights.
 * When subChatId is empty string, falls back to a global default.
 */
export const panelSizeAtomFamily = atomFamily(
  ({ panelId, subChatId }: { panelId: string; subChatId: string }) =>
    atom(
      (get) => get(panelSizeStorageAtomFamily({ panelId, subChatId })),
      (get, set, size: number) => {
        set(panelSizeStorageAtomFamily({ panelId, subChatId }), size)
      },
    ),
  (a, b) => a.panelId === b.panelId && a.subChatId === b.subChatId,
)

// =============================================================================
// Mutual Exclusion — Closed Stack (per group, per chat)
// =============================================================================

/**
 * Stack of auto-closed panels for restoration.
 * When panel A opens and auto-closes panel B (same group, side-peek),
 * B is pushed onto the stack. When A closes, B is restored.
 *
 * Key: `${chatId}:${groupId}`
 */
const closedStackAtomFamily = atomFamily(
  ({ chatId, groupId }: { chatId: string; groupId: string }) =>
    atom<ClosedStackEntry[]>([]),
  (a, b) => a.chatId === b.chatId && a.groupId === b.groupId,
)

// =============================================================================
// Panel Actions — Open / Close / Toggle with mutual exclusion
// =============================================================================

/**
 * Open a panel with automatic mutual exclusion handling.
 *
 * When opening a side-peek panel in an exclusive group:
 * 1. Find conflicting side-peek panels in the same group
 * 2. Push them onto the closed stack (for later restoration)
 * 3. Close them
 * 4. Open the requested panel
 */
export function createOpenPanelAction(panelId: string, chatId: string) {
  return atom(null, (get, set) => {
    const config = panelRegistry.get(panelId)
    if (!config) return

    const groupId = config.group ?? PANEL_GROUP_IDS.DEFAULT
    const group = getPanelGroup(groupId)
    const currentDisplayMode = get(panelDisplayModeAtomFamily(panelId))

    // Only apply mutual exclusion for side-peek mode in exclusive groups
    if (group.exclusive && currentDisplayMode === "side-peek") {
      const allPanelsInGroup = panelRegistry.getByGroup(groupId)
      const conflicting: ClosedStackEntry[] = []

      for (const p of allPanelsInGroup) {
        if (p.id === panelId) continue
        const pIsOpen = get(panelIsOpenAtomFamily({ chatId, panelId: p.id }))
        const pDisplayMode = get(panelDisplayModeAtomFamily(p.id))

        if (pIsOpen && pDisplayMode === "side-peek") {
          conflicting.push({ panelId: p.id, displayMode: pDisplayMode })
          // Close conflicting panel
          set(panelIsOpenAtomFamily({ chatId, panelId: p.id }), false)
        }
      }

      // Push conflicting panels onto restoration stack
      if (conflicting.length > 0 && group.restoreOnClose) {
        set(closedStackAtomFamily({ chatId, groupId }), conflicting)
      }
    }

    // Open the requested panel
    set(panelIsOpenAtomFamily({ chatId, panelId }), true)
  })
}

/**
 * Close a panel with automatic restoration of previously auto-closed panels.
 */
export function createClosePanelAction(panelId: string, chatId: string) {
  return atom(null, (get, set) => {
    const config = panelRegistry.get(panelId)
    if (!config) return

    const groupId = config.group ?? PANEL_GROUP_IDS.DEFAULT
    const group = getPanelGroup(groupId)

    // Close the panel
    set(panelIsOpenAtomFamily({ chatId, panelId }), false)

    // Restore previously auto-closed panels
    if (group.restoreOnClose) {
      const stack = get(closedStackAtomFamily({ chatId, groupId }))
      if (stack.length > 0) {
        // Restore all panels from stack
        for (const entry of stack) {
          set(panelIsOpenAtomFamily({ chatId, panelId: entry.panelId }), true)
        }
        // Clear the stack
        set(closedStackAtomFamily({ chatId, groupId }), [])
      }
    }
  })
}

/**
 * Toggle a panel (open if closed, close if open)
 */
export function createTogglePanelAction(panelId: string, chatId: string) {
  return atom(null, (get, set) => {
    const isOpen = get(panelIsOpenAtomFamily({ chatId, panelId }))
    if (isOpen) {
      set(createClosePanelAction(panelId, chatId))
    } else {
      set(createOpenPanelAction(panelId, chatId))
    }
  })
}

// =============================================================================
// Legacy Atom Mapping (for gradual migration)
// =============================================================================

/**
 * Maps old scattered atom storage keys to panel IDs.
 * Used for one-time migration when unified system is first loaded.
 */
export const LEGACY_ATOM_MAPPING: Record<string, { panelId: string; storageKey: string }> = {
  diff: { panelId: PANEL_IDS.DIFF, storageKey: "agents:diffSidebarOpen" },
  plan: { panelId: PANEL_IDS.PLAN, storageKey: "agents:planSidebarOpen" },
  terminal: { panelId: PANEL_IDS.TERMINAL, storageKey: "terminal-sidebar-open-by-chat" },
  details: { panelId: PANEL_IDS.DETAILS, storageKey: "overview:sidebarOpen" },
  browser: { panelId: PANEL_IDS.BROWSER, storageKey: "" }, // runtime only
  preview: { panelId: PANEL_IDS.PREVIEW, storageKey: "agents-preview-sidebar-open" },
  explorer: { panelId: PANEL_IDS.EXPLORER, storageKey: "agents:explorerPanelOpen" },
  fileViewer: { panelId: PANEL_IDS.FILE_VIEWER, storageKey: "" }, // runtime only
}

export const LEGACY_SIZE_MAPPING: Record<string, { panelId: string; storageKey: string; defaultSize: number }> = {
  diff: { panelId: PANEL_IDS.DIFF, storageKey: "agents-diff-sidebar-width", defaultSize: 800 },
  plan: { panelId: PANEL_IDS.PLAN, storageKey: "agents-plan-sidebar-width", defaultSize: 500 },
  terminal: { panelId: PANEL_IDS.TERMINAL, storageKey: "terminal-sidebar-width", defaultSize: 500 },
  details: { panelId: PANEL_IDS.DETAILS, storageKey: "overview:sidebarWidth", defaultSize: 500 },
  browser: { panelId: PANEL_IDS.BROWSER, storageKey: "agents-browser-sidebar-width", defaultSize: 480 },
  preview: { panelId: PANEL_IDS.PREVIEW, storageKey: "agents-preview-sidebar-width", defaultSize: 500 },
  explorer: { panelId: PANEL_IDS.EXPLORER, storageKey: "agents-explorer-sidebar-width", defaultSize: 350 },
  fileViewer: { panelId: PANEL_IDS.FILE_VIEWER, storageKey: "agents:fileViewerSidebarWidth", defaultSize: 500 },
}

export const LEGACY_DISPLAY_MODE_MAPPING: Record<string, { panelId: string; storageKey: string }> = {
  diff: { panelId: PANEL_IDS.DIFF, storageKey: "agents:diffViewDisplayMode" },
  terminal: { panelId: PANEL_IDS.TERMINAL, storageKey: "terminal-display-mode" },
  explorer: { panelId: PANEL_IDS.EXPLORER, storageKey: "agents:explorerDisplayMode" },
  fileViewer: { panelId: PANEL_IDS.FILE_VIEWER, storageKey: "agents:fileViewerDisplayMode" },
}
