/**
 * PanelStateManager - 实例隔离的面板状态管理
 *
 * 解决的问题:
 * 1. 每个 ChatView 实例有独立的面板状态
 * 2. 同一互斥组内的面板自动互斥
 * 3. 统一的 open/close/toggle API
 *
 * 设计理念:
 * - 与 PanelRegistry 配合使用
 * - PanelRegistry 管理配置（静态）
 * - PanelStateManager 管理状态（动态）
 * - 使用 Jotai atomFamily 实现实例隔离
 */

import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import type { PanelConfig } from "./panel-registry"

// =============================================================================
// Types
// =============================================================================

export interface PanelOpenState {
  isOpen: boolean
  /** Display mode: "full" = full sidebar, "side-peek" = narrow peek */
  displayMode: "full" | "side-peek"
  /** Size in pixels (if resizable) */
  size: number
}

export interface ExclusiveGroupConfig {
  /** Group ID (e.g., "right-sidebar", "bottom-panel") */
  id: string
  /** Panel IDs in this group */
  panelIds: string[]
  /** Allow multiple panels to be open in side-peek mode */
  allowSidePeek?: boolean
  /** Maximum panels open simultaneously (default: 1) */
  maxOpen?: number
}

// =============================================================================
// Exclusive Group Definitions
// =============================================================================

/**
 * Pre-defined exclusive groups
 * Panels in the same group will close each other when opened
 */
export const EXCLUSIVE_GROUPS: ExclusiveGroupConfig[] = [
  {
    id: "right-sidebar",
    panelIds: ["diff", "plan", "preview", "browser", "file-viewer", "details"],
    allowSidePeek: true,
    maxOpen: 2, // Allow 2 panels in side-peek mode
  },
  {
    id: "bottom-panel",
    panelIds: ["terminal"],
    maxOpen: 1,
  },
  {
    id: "left-sidebar",
    panelIds: ["explorer"],
    maxOpen: 1,
  },
]

/**
 * Get exclusive group for a panel
 */
export function getExclusiveGroup(panelId: string): ExclusiveGroupConfig | undefined {
  return EXCLUSIVE_GROUPS.find((g) => g.panelIds.includes(panelId))
}

/**
 * Get sibling panels in the same exclusive group
 */
export function getSiblingPanels(panelId: string): string[] {
  const group = getExclusiveGroup(panelId)
  if (!group) return []
  return group.panelIds.filter((id) => id !== panelId)
}

// =============================================================================
// Atom Factory Functions
// =============================================================================

/**
 * Create a unique key for panel state atom
 * Format: `${chatId}:${panelId}`
 */
export function createPanelStateKey(chatId: string, panelId: string): string {
  return `${chatId}:${panelId}`
}

/**
 * Default panel state factory
 */
function createDefaultPanelState(panelConfig?: PanelConfig): PanelOpenState {
  return {
    isOpen: panelConfig?.defaultOpen ?? false,
    displayMode: "full",
    size: panelConfig?.defaultSize ?? 400,
  }
}

/**
 * Panel state atom family - stores open/size state per panel per chat instance
 *
 * Key format: `${chatId}:${panelId}`
 *
 * This ensures each ChatView instance has its own panel states,
 * supporting multiple ChatView instances without state conflicts.
 */
export const panelOpenStateAtomFamily = atomFamily((key: string) =>
  atom<PanelOpenState>({
    isOpen: false,
    displayMode: "full",
    size: 400,
  })
)

/**
 * Get all panel state atoms for a specific chat instance
 * Useful for bulk operations like closing all panels
 */
export function getPanelStatesForChat(
  chatId: string,
  panelIds: string[]
): Map<string, ReturnType<typeof panelOpenStateAtomFamily>> {
  const result = new Map<string, ReturnType<typeof panelOpenStateAtomFamily>>()
  for (const panelId of panelIds) {
    const key = createPanelStateKey(chatId, panelId)
    result.set(panelId, panelOpenStateAtomFamily(key))
  }
  return result
}

// =============================================================================
// Panel State Actions
// =============================================================================

/**
 * Action types for panel state changes
 * These can be used with a reducer pattern or directly
 */
export type PanelStateAction =
  | { type: "open"; panelId: string; displayMode?: "full" | "side-peek" }
  | { type: "close"; panelId: string }
  | { type: "toggle"; panelId: string; displayMode?: "full" | "side-peek" }
  | { type: "setSize"; panelId: string; size: number }
  | { type: "closeGroup"; groupId: string }
  | { type: "closeAll" }

/**
 * Create open panel action
 */
export function openPanel(
  panelId: string,
  displayMode: "full" | "side-peek" = "full"
): PanelStateAction {
  return { type: "open", panelId, displayMode }
}

/**
 * Create close panel action
 */
export function closePanel(panelId: string): PanelStateAction {
  return { type: "close", panelId }
}

/**
 * Create toggle panel action
 */
export function togglePanel(
  panelId: string,
  displayMode: "full" | "side-peek" = "full"
): PanelStateAction {
  return { type: "toggle", panelId, displayMode }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Check if opening a panel would exceed the group's maxOpen limit
 */
export function wouldExceedMaxOpen(
  panelId: string,
  currentOpenPanels: Set<string>
): boolean {
  const group = getExclusiveGroup(panelId)
  if (!group) return false

  const maxOpen = group.maxOpen ?? 1
  const openInGroup = Array.from(currentOpenPanels).filter((id) =>
    group.panelIds.includes(id)
  )

  return openInGroup.length >= maxOpen
}

/**
 * Get panels to close when opening a new panel (for exclusive groups)
 */
export function getPanelsToClose(
  panelId: string,
  currentOpenPanels: Set<string>,
  displayMode: "full" | "side-peek" = "full"
): string[] {
  const group = getExclusiveGroup(panelId)
  if (!group) return []

  const maxOpen = group.maxOpen ?? 1

  // In full mode or if side-peek is not allowed, close all siblings
  if (displayMode === "full" || !group.allowSidePeek) {
    return getSiblingPanels(panelId).filter((id) => currentOpenPanels.has(id))
  }

  // In side-peek mode, only close if exceeding maxOpen
  const openInGroup = group.panelIds.filter(
    (id) => currentOpenPanels.has(id) && id !== panelId
  )

  if (openInGroup.length < maxOpen) {
    return [] // Room for one more
  }

  // Close the oldest (first in array) to make room
  return [openInGroup[0]]
}

/**
 * Determine display mode based on how many panels are open
 */
export function determineDisplayMode(
  panelId: string,
  currentOpenPanels: Set<string>
): "full" | "side-peek" {
  const group = getExclusiveGroup(panelId)
  if (!group || !group.allowSidePeek) return "full"

  // If another panel in the group is already open, use side-peek
  const othersOpen = group.panelIds.filter(
    (id) => currentOpenPanels.has(id) && id !== panelId
  )

  return othersOpen.length > 0 ? "side-peek" : "full"
}

// =============================================================================
// Migration Helper
// =============================================================================

/**
 * Map old sidebar atom names to new panel IDs
 * For gradual migration from scattered atoms to unified panel system
 */
export const LEGACY_ATOM_MAPPING: Record<string, string> = {
  isDiffSidebarOpen: "diff",
  isPlanSidebarOpen: "plan",
  isPreviewSidebarOpen: "preview",
  isTerminalSidebarOpen: "terminal",
  isBrowserSidebarOpen: "browser",
  isFileViewerOpen: "file-viewer",
  isExplorerPanelOpen: "explorer",
  isDetailsSidebarOpen: "details",
}

/**
 * Get legacy atom name for a panel ID
 */
export function getLegacyAtomName(panelId: string): string | undefined {
  for (const [atomName, id] of Object.entries(LEGACY_ATOM_MAPPING)) {
    if (id === panelId) return atomName
  }
  return undefined
}
