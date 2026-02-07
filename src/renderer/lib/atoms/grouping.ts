import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// ============================================
// GROUPING TYPES
// ============================================

export type WorkspaceGroupMode = "none" | "folder" | "tag" | "type"
export type SubChatGroupMode = "none" | "tag"

// ============================================
// GROUPING VIEW ATOMS
// ============================================

/**
 * Whether workspace grouped view is enabled
 * Default: false (disabled)
 */
export const workspaceGroupedViewAtom = atomWithStorage<boolean>(
  "agents:workspace-grouped-view",
  false,
  undefined,
  { getOnInit: true },
)

/**
 * Whether subchat grouped view is enabled
 * Default: false (disabled)
 */
export const subChatGroupedViewAtom = atomWithStorage<boolean>(
  "agents:subchat-grouped-view",
  false,
  undefined,
  { getOnInit: true },
)

// ============================================
// GROUPING MODE ATOMS
// ============================================

/**
 * Workspace grouping mode when grouped view is enabled
 * "type" - group by type (Workspaces vs Chats/Playgrounds)
 * "folder" - group by project folder path
 * "tag" - group by workspace tags
 */
export const workspaceGroupModeAtom = atomWithStorage<WorkspaceGroupMode>(
  "agents:workspace-group-mode",
  "type", // Default to type grouping (Workspaces vs Chats)
  undefined,
  { getOnInit: true },
)

/**
 * SubChat grouping mode when grouped view is enabled
 * Only "tag" mode is supported for subchats
 */
export const subChatGroupModeAtom = atomWithStorage<SubChatGroupMode>(
  "agents:subchat-group-mode",
  "tag",
  undefined,
  { getOnInit: true },
)

// ============================================
// COLLAPSED GROUPS ATOMS
// ============================================

// Custom storage for Set<string>
const setStorage = {
  getItem: (key: string, initialValue: Set<string>) => {
    try {
      const stored = localStorage.getItem(key)
      return stored ? new Set(JSON.parse(stored) as string[]) : initialValue
    } catch {
      return initialValue
    }
  },
  setItem: (key: string, value: Set<string>) => {
    localStorage.setItem(key, JSON.stringify([...value]))
  },
  removeItem: (key: string) => {
    localStorage.removeItem(key)
  },
}

/**
 * Set of collapsed group IDs for workspace sidebar
 */
export const workspaceCollapsedGroupsAtom = atomWithStorage<Set<string>>(
  "agents:workspace-collapsed-groups",
  new Set(),
  setStorage,
  { getOnInit: true },
)

/**
 * Set of collapsed group IDs for subchat sidebar
 */
export const subChatCollapsedGroupsAtom = atomWithStorage<Set<string>>(
  "agents:subchat-collapsed-groups",
  new Set(),
  setStorage,
  { getOnInit: true },
)

// ============================================
// MANAGE TAGS DIALOG ATOM
// ============================================

/**
 * Whether the manage tags dialog is open
 */
export const manageTagsDialogOpenAtom = atom<boolean>(false)
