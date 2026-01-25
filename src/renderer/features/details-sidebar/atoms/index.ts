import { atom } from "jotai"
import { atomFamily, atomWithStorage } from "jotai/utils"
import { atomWithWindowStorage } from "../../../lib/window-storage"
import type { LucideIcon } from "lucide-react"
import { Box, FileText, Terminal, FileDiff, ListTodo, Package, FolderTree } from "lucide-react"

// ============================================================================
// Project Mode Types
// ============================================================================

export type ProjectMode = "cowork" | "coding"

// ============================================================================
// Widget System Types & Registry
// ============================================================================

export type WidgetId = "info" | "todo" | "plan" | "terminal" | "diff" | "artifacts" | "explorer"

export interface WidgetConfig {
  id: WidgetId
  label: string
  icon: LucideIcon
  canExpand: boolean // true = can open as separate sidebar
  defaultVisibleInCoding: boolean  // default for coding mode
  defaultVisibleInCowork: boolean  // default for cowork mode
}

export const WIDGET_REGISTRY: WidgetConfig[] = [
  // Coding mode widgets (Git workflow focused)
  { id: "info", label: "Workspace", icon: Box, canExpand: false, defaultVisibleInCoding: true, defaultVisibleInCowork: false },
  { id: "todo", label: "Tasks", icon: ListTodo, canExpand: false, defaultVisibleInCoding: true, defaultVisibleInCowork: true },
  { id: "plan", label: "Plan", icon: FileText, canExpand: true, defaultVisibleInCoding: true, defaultVisibleInCowork: false },
  { id: "terminal", label: "Terminal", icon: Terminal, canExpand: true, defaultVisibleInCoding: false, defaultVisibleInCowork: false },
  { id: "diff", label: "Changes", icon: FileDiff, canExpand: true, defaultVisibleInCoding: true, defaultVisibleInCowork: false },
  // Cowork mode widgets (file focused)
  { id: "artifacts", label: "Artifacts", icon: Package, canExpand: false, defaultVisibleInCoding: false, defaultVisibleInCowork: true },
  { id: "explorer", label: "Explorer", icon: FolderTree, canExpand: true, defaultVisibleInCoding: false, defaultVisibleInCowork: true },
]

// Helper to get default visible widgets by mode
export function getDefaultVisibleWidgets(mode: ProjectMode): WidgetId[] {
  return WIDGET_REGISTRY
    .filter((w) => mode === "coding" ? w.defaultVisibleInCoding : w.defaultVisibleInCowork)
    .map((w) => w.id)
}

// Legacy default (for backward compatibility)
const DEFAULT_VISIBLE_WIDGETS: WidgetId[] = getDefaultVisibleWidgets("coding")

// Default widget order (all widgets)
const DEFAULT_WIDGET_ORDER: WidgetId[] = WIDGET_REGISTRY.map((w) => w.id)

// ============================================================================
// Widget Visibility (per workspace)
// ============================================================================

const widgetVisibilityStorageAtom = atomWithStorage<Record<string, WidgetId[]>>(
  "overview:widgetVisibility",
  {},
  undefined,
  { getOnInit: true },
)

export const widgetVisibilityAtomFamily = atomFamily((workspaceId: string) =>
  atom(
    (get) =>
      get(widgetVisibilityStorageAtom)[workspaceId] ?? DEFAULT_VISIBLE_WIDGETS,
    (get, set, visibleWidgets: WidgetId[]) => {
      const current = get(widgetVisibilityStorageAtom)
      set(widgetVisibilityStorageAtom, {
        ...current,
        [workspaceId]: visibleWidgets,
      })
    },
  ),
)

// ============================================================================
// Widget Order (per workspace) - controls display order of all widgets
// ============================================================================

const widgetOrderStorageAtom = atomWithStorage<Record<string, WidgetId[]>>(
  "overview:widgetOrder",
  {},
  undefined,
  { getOnInit: true },
)

export const widgetOrderAtomFamily = atomFamily((workspaceId: string) =>
  atom(
    (get) =>
      get(widgetOrderStorageAtom)[workspaceId] ?? DEFAULT_WIDGET_ORDER,
    (get, set, widgetOrder: WidgetId[]) => {
      const current = get(widgetOrderStorageAtom)
      set(widgetOrderStorageAtom, {
        ...current,
        [workspaceId]: widgetOrder,
      })
    },
  ),
)

// ============================================================================
// Expanded Widget State (per workspace, runtime only - not persisted)
// ============================================================================

// Which widget is currently expanded as a separate sidebar
// null = no widget expanded
const expandedWidgetStorageAtom = atom<Record<string, WidgetId | null>>({})

export const expandedWidgetAtomFamily = atomFamily((workspaceId: string) =>
  atom(
    (get) => get(expandedWidgetStorageAtom)[workspaceId] ?? null,
    (get, set, expandedWidget: WidgetId | null) => {
      const current = get(expandedWidgetStorageAtom)
      set(expandedWidgetStorageAtom, {
        ...current,
        [workspaceId]: expandedWidget,
      })
    },
  ),
)

// Expanded widget sidebar width
export const expandedWidgetSidebarWidthAtom = atomWithStorage<number>(
  "overview:expandedWidgetWidth",
  500,
  undefined,
  { getOnInit: true },
)

// ============================================================================
// Feature Flag & Sidebar State
// ============================================================================

// Feature flag for unified vs separate sidebars (for future toggle)
export const unifiedSidebarEnabledAtom = atomWithStorage<boolean>(
  "overview:unifiedEnabled",
  true, // Enable by default
  undefined,
  { getOnInit: true },
)

// Details sidebar open state (per-window, persisted)
export const detailsSidebarOpenAtom = atomWithWindowStorage<boolean>(
  "overview:sidebarOpen",
  false,
  { getOnInit: true },
)

// Section types for the overview sidebar
export type OverviewSection = "info" | "plan" | "terminal" | "diff" | "artifacts" | "explorer"

// Default expanded sections
const DEFAULT_EXPANDED_SECTIONS: OverviewSection[] = ["info", "plan", "terminal"]

// Default expanded sections for cowork mode
const DEFAULT_COWORK_EXPANDED_SECTIONS: OverviewSection[] = ["artifacts", "explorer"]

// Section expand states (per workspace) - stores array of expanded section IDs
const sectionExpandStorageAtom = atomWithStorage<
  Record<string, OverviewSection[]>
>("overview:expandedSections", {}, undefined, { getOnInit: true })

export const expandedSectionsAtomFamily = atomFamily((workspaceId: string) =>
  atom(
    (get) =>
      get(sectionExpandStorageAtom)[workspaceId] ?? DEFAULT_EXPANDED_SECTIONS,
    (get, set, expandedSections: OverviewSection[]) => {
      const current = get(sectionExpandStorageAtom)
      set(sectionExpandStorageAtom, {
        ...current,
        [workspaceId]: expandedSections,
      })
    },
  ),
)

// Unified sidebar width (persisted)
export const detailsSidebarWidthAtom = atomWithStorage<number>(
  "overview:sidebarWidth",
  500,
  undefined,
  { getOnInit: true },
)

// Focused section for "focus mode" (when a section needs more space like Diff)
// null = normal mode, section name = focused mode
export const focusedSectionAtom = atom<OverviewSection | null>(null)

// ============================================================================
// Plan Content Cache (per workspace) - prevents flashing loading states
// ============================================================================

export interface PlanContentCache {
  content: string
  planPath: string
  // Track if content is ready (file loaded successfully)
  isReady: boolean
}

// Runtime cache for plan content per workspace (not persisted)
const planContentCacheStorageAtom = atom<Record<string, PlanContentCache | null>>({})

export const planContentCacheAtomFamily = atomFamily((chatId: string) =>
  atom(
    (get) => get(planContentCacheStorageAtom)[chatId] ?? null,
    (get, set, cache: PlanContentCache | null) => {
      const current = get(planContentCacheStorageAtom)
      set(planContentCacheStorageAtom, {
        ...current,
        [chatId]: cache,
      })
    },
  ),
)
