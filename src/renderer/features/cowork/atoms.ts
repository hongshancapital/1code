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

// Artifacts section expanded state (null = auto, true = expanded, false = collapsed)
// Auto mode: collapsed when no artifacts, expanded when has artifacts
export const artifactsSectionExpandedAtom = atom<boolean | null>(null)

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
// Artifacts State (per chat - all sub-chats share the same artifacts)
// ============================================================================

// Context information for an artifact (files read, URLs visited)
export interface ArtifactContext {
  type: "file" | "url"
  // File context
  filePath?: string
  toolType?: "Read" | "Glob" | "Grep"
  // URL context
  url?: string
  title?: string
}

export interface Artifact {
  path: string
  description?: string
  status: "created" | "modified" | "deleted"
  timestamp: number
  contexts?: ArtifactContext[]
}

// All artifacts storage - keyed by chatId (persisted to localStorage)
import { atomFamily } from "jotai/utils"

const allArtifactsStorageAtom = atomWithStorage<Record<string, Artifact[]>>(
  "cowork:artifacts",
  {},
  undefined,
  { getOnInit: true }
)

// atomFamily to get/set artifacts per chatId
// Supports both direct value and updater function: setArtifacts(newArr) or setArtifacts(prev => newArr)
type ArtifactsSetter = Artifact[] | ((prev: Artifact[]) => Artifact[])

export const artifactsAtomFamily = atomFamily((chatId: string) =>
  atom(
    (get) => get(allArtifactsStorageAtom)[chatId] ?? [],
    (get, set, update: ArtifactsSetter) => {
      const current = get(allArtifactsStorageAtom)
      const prevArtifacts = current[chatId] ?? []
      // Support both direct value and updater function
      const newArtifacts = typeof update === "function" ? update(prevArtifacts) : update
      console.log("[Artifacts] Setting artifacts for chatId:", chatId, "count:", newArtifacts.length)
      set(allArtifactsStorageAtom, { ...current, [chatId]: newArtifacts })
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
