import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// ============================================================================
// Cowork Mode Toggle
// ============================================================================

// Master switch for Cowork mode (persisted)
// When true, CoworkLayout is used instead of AgentsLayout
export const isCoworkModeAtom = atomWithStorage<boolean>(
  "cowork:enabled",
  true, // Default to Cowork mode
  undefined,
  { getOnInit: true },
)

// ============================================================================
// Right Panel State (Tasks + Files)
// ============================================================================

// Right panel width (persisted)
export const coworkRightPanelWidthAtom = atomWithStorage<number>(
  "cowork:rightPanelWidth",
  320,
  undefined,
  { getOnInit: true },
)

// Right panel open state (persisted)
export const coworkRightPanelOpenAtom = atomWithStorage<boolean>(
  "cowork:rightPanelOpen",
  true,
  undefined,
  { getOnInit: true },
)

// ============================================================================
// Section Collapse State
// ============================================================================

// Task section expanded state (null = auto, true = expanded, false = collapsed)
// Auto mode: collapsed when no tasks, expanded when has tasks
export const taskSectionExpandedAtom = atom<boolean | null>(null)

// Deliverables section expanded state (null = auto, true = expanded, false = collapsed)
// Auto mode: collapsed when no deliverables, expanded when has deliverables
export const deliverablesSectionExpandedAtom = atom<boolean | null>(null)

// ============================================================================
// File Tree State
// ============================================================================

// Expanded folder paths in file tree (not persisted - resets on reload)
export const fileTreeExpandedPathsAtom = atom<Set<string>>(new Set<string>())

// Selected file in file tree (for highlighting)
export const fileTreeSelectedPathAtom = atom<string | null>(null)

// Search query in file tree
export const fileTreeSearchQueryAtom = atom<string>("")

// ============================================================================
// Deliverables State (per sub-chat)
// ============================================================================

export interface Deliverable {
  path: string
  description?: string
  status: "created" | "modified" | "deleted"
  timestamp: number
}

// All deliverables storage - keyed by subChatId
const allDeliverablesStorageAtom = atom<Record<string, Deliverable[]>>({})

// atomFamily to get/set deliverables per subChatId
import { atomFamily } from "jotai/utils"

export const deliverablesAtomFamily = atomFamily((subChatId: string) =>
  atom(
    (get) => get(allDeliverablesStorageAtom)[subChatId] ?? [],
    (get, set, newDeliverables: Deliverable[]) => {
      const current = get(allDeliverablesStorageAtom)
      set(allDeliverablesStorageAtom, { ...current, [subChatId]: newDeliverables })
    }
  )
)

// ============================================================================
// File Preview State
// ============================================================================

export type FilePreviewDisplayMode = "dialog" | "side-peek" | "full-page"

// Display mode for file preview (persisted)
export const filePreviewDisplayModeAtom = atomWithStorage<FilePreviewDisplayMode>(
  "cowork:filePreviewDisplayMode",
  "dialog",
  undefined,
  { getOnInit: true }
)

// Current preview file path (null = closed)
export const filePreviewPathAtom = atom<string | null>(null)

// File preview dialog open state (derived from path)
export const filePreviewOpenAtom = atom(
  (get) => get(filePreviewPathAtom) !== null,
  (get, set, open: boolean) => {
    if (!open) {
      set(filePreviewPathAtom, null)
    }
  }
)
