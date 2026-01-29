import { atom } from "jotai"
import { atomFamily, atomWithStorage } from "jotai/utils"
import { atomWithWindowStorage } from "../../../lib/window-storage"
import type { LucideIcon } from "lucide-react"
import { Box, FileText, Terminal, FileDiff, ListTodo, Package, FolderTree, Cpu } from "lucide-react"
import {
  type WidgetId,
  type ProjectMode,
  WIDGET_DEFAULTS,
  getDefaultVisibleWidgets,
} from "../../../../shared/feature-config"

// Re-export types from shared
export type { WidgetId, ProjectMode }
export { getDefaultVisibleWidgets }

// ============================================================================
// Widget System Types & Registry
// ============================================================================

export interface WidgetConfig {
  id: WidgetId
  label: string
  icon: LucideIcon
  canExpand: boolean // true = can open as separate sidebar
}

export const WIDGET_REGISTRY: WidgetConfig[] = [
  // Coding mode widgets (Git workflow focused)
  { id: "info", label: WIDGET_DEFAULTS.info.label, icon: Box, canExpand: false },
  { id: "todo", label: WIDGET_DEFAULTS.todo.label, icon: ListTodo, canExpand: false },
  { id: "plan", label: WIDGET_DEFAULTS.plan.label, icon: FileText, canExpand: true },
  { id: "terminal", label: WIDGET_DEFAULTS.terminal.label, icon: Terminal, canExpand: true },
  { id: "diff", label: WIDGET_DEFAULTS.diff.label, icon: FileDiff, canExpand: true },
  // Cowork mode widgets (file focused)
  { id: "artifacts", label: WIDGET_DEFAULTS.artifacts.label, icon: Package, canExpand: false },
  { id: "explorer", label: WIDGET_DEFAULTS.explorer.label, icon: FolderTree, canExpand: true },
  // Background tasks (available in both modes)
  { id: "background-tasks", label: WIDGET_DEFAULTS["background-tasks"].label, icon: Cpu, canExpand: false },
]

// Default visible widgets (merge both modes to ensure widgets show when enabled)
// The actual filtering is done by enabledWidgets based on project mode
const DEFAULT_VISIBLE_WIDGETS: WidgetId[] = [
  ...new Set([
    ...getDefaultVisibleWidgets("coding"),
    ...getDefaultVisibleWidgets("cowork"),
  ]),
]

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
    (get) => {
      const stored = get(widgetVisibilityStorageAtom)[workspaceId]
      // Deduplicate and validate against registry
      const visibility = stored ?? DEFAULT_VISIBLE_WIDGETS
      return [...new Set(visibility)].filter((id) =>
        WIDGET_REGISTRY.some((w) => w.id === id)
      )
    },
    (get, set, visibleWidgets: WidgetId[]) => {
      const current = get(widgetVisibilityStorageAtom)
      // Deduplicate on write
      set(widgetVisibilityStorageAtom, {
        ...current,
        [workspaceId]: [...new Set(visibleWidgets)],
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
    (get) => {
      const stored = get(widgetOrderStorageAtom)[workspaceId]
      // Deduplicate and validate against registry
      const order = stored ?? DEFAULT_WIDGET_ORDER
      return [...new Set(order)].filter((id) =>
        WIDGET_REGISTRY.some((w) => w.id === id)
      )
    },
    (get, set, widgetOrder: WidgetId[]) => {
      const current = get(widgetOrderStorageAtom)
      // Deduplicate on write
      set(widgetOrderStorageAtom, {
        ...current,
        [workspaceId]: [...new Set(widgetOrder)],
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
