import { atom } from "jotai"
import { atomFamily, atomWithStorage } from "jotai/utils"
import { atomWithWindowStorage } from "../../../lib/window-storage"
import type { LucideIcon } from "lucide-react"
import { Box, FileText, Terminal, FileDiff, ListTodo, Package, FolderTree, Cpu, Sparkles, Activity } from "lucide-react"
import { OriginalMCPIcon } from "../../../components/ui/icons"
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

export interface WidgetResizeConfig {
  minHeight: number
  maxHeight?: number
  defaultHeight: number
}

export interface WidgetConfig {
  id: WidgetId
  label: string
  icon: LucideIcon
  canExpand: boolean // true = can open as separate sidebar
  resize?: WidgetResizeConfig // optional resize configuration (draggable)
  maxHeight?: number // fixed max height (content scrolls if exceeded, not draggable)
}

export const WIDGET_REGISTRY: WidgetConfig[] = [
  // Usage widget (subscription usage, always first)
  { id: "usage", label: WIDGET_DEFAULTS.usage.label, icon: Activity, canExpand: false },
  // Coding mode widgets (Git workflow focused)
  { id: "info", label: WIDGET_DEFAULTS.info.label, icon: Box, canExpand: false },
  { id: "todo", label: WIDGET_DEFAULTS.todo.label, icon: ListTodo, canExpand: false },
  { id: "plan", label: WIDGET_DEFAULTS.plan.label, icon: FileText, canExpand: true },
  { id: "terminal", label: WIDGET_DEFAULTS.terminal.label, icon: Terminal, canExpand: true },
  { id: "diff", label: WIDGET_DEFAULTS.diff.label, icon: FileDiff, canExpand: true },
  // Cowork mode widgets (file focused)
  {
    id: "artifacts",
    label: WIDGET_DEFAULTS.artifacts.label,
    icon: Package,
    canExpand: false,
    resize: { minHeight: 100, maxHeight: 400, defaultHeight: 200 },
  },
  {
    id: "explorer",
    label: WIDGET_DEFAULTS.explorer.label,
    icon: FolderTree,
    canExpand: true,
    resize: { minHeight: 150, maxHeight: 600, defaultHeight: 350 },
  },
  // Background tasks (available in both modes)
  { id: "background-tasks", label: WIDGET_DEFAULTS["background-tasks"].label, icon: Cpu, canExpand: false },
  // MCP Servers (from main)
  { id: "mcp", label: "MCP Servers", icon: OriginalMCPIcon as unknown as LucideIcon, canExpand: false, maxHeight: 300 },
  // Skills (available in all modes)
  { id: "skills", label: WIDGET_DEFAULTS.skills.label, icon: Sparkles, canExpand: false, maxHeight: 300 },
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

// Track known widgets per workspace - widgets that have been seen (either on or off)
// This allows us to distinguish between:
// 1. User turned off a widget intentionally → don't re-enable
// 2. New widget was added to the system → auto-enable if it's a default
const knownWidgetsStorageAtom = atomWithStorage<Record<string, WidgetId[]>>(
  "overview:knownWidgets",
  {},
  undefined,
  { getOnInit: true },
)

export const widgetVisibilityAtomFamily = atomFamily((workspaceId: string) =>
  atom(
    (get) => {
      const stored = get(widgetVisibilityStorageAtom)[workspaceId]
      const knownWidgets = get(knownWidgetsStorageAtom)[workspaceId] ?? []

      if (!stored) {
        // No stored preference - use defaults
        return [...new Set(DEFAULT_VISIBLE_WIDGETS)].filter((id) =>
          WIDGET_REGISTRY.some((w) => w.id === id)
        )
      }

      // Only add new widgets that:
      // 1. Are in defaults (should be visible by default)
      // 2. Are NOT in knownWidgets (user hasn't seen them before)
      // This prevents re-enabling widgets that user intentionally turned off
      const trulyNewWidgets = DEFAULT_VISIBLE_WIDGETS.filter(
        (id) => !stored.includes(id) && !knownWidgets.includes(id)
      )
      const merged = [...stored, ...trulyNewWidgets]
      return [...new Set(merged)].filter((id) =>
        WIDGET_REGISTRY.some((w) => w.id === id)
      )
    },
    (get, set, visibleWidgets: WidgetId[]) => {
      const currentVisibility = get(widgetVisibilityStorageAtom)
      const currentKnown = get(knownWidgetsStorageAtom)

      // Get all known widgets for this workspace
      const existingKnown = currentKnown[workspaceId] ?? []

      // Update known widgets: all widgets in the registry should be marked as known
      // once user has interacted with the visibility settings
      const allWidgetIds = WIDGET_REGISTRY.map((w) => w.id)
      const newKnown = [...new Set([...existingKnown, ...allWidgetIds])]

      // Deduplicate on write
      set(widgetVisibilityStorageAtom, {
        ...currentVisibility,
        [workspaceId]: [...new Set(visibleWidgets)],
      })

      // Update known widgets
      set(knownWidgetsStorageAtom, {
        ...currentKnown,
        [workspaceId]: newKnown,
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
      if (!stored) {
        return [...new Set(DEFAULT_WIDGET_ORDER)].filter((id) =>
          WIDGET_REGISTRY.some((w) => w.id === id)
        )
      }
      // Append any newly registered widgets that are missing from stored order
      // This ensures new widgets get a position in the order for existing workspaces
      const missingWidgets = DEFAULT_WIDGET_ORDER.filter(
        (id) => !stored.includes(id)
      )
      const merged = [...stored, ...missingWidgets]
      return [...new Set(merged)].filter((id) =>
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
// Widget Height (per sub-chat, persisted)
// ============================================================================

// Storage atom for widget heights: { subChatId: { widgetId: height } }
const widgetHeightStorageAtom = atomWithStorage<Record<string, Record<WidgetId, number>>>(
  "overview:widgetHeights",
  {},
  undefined,
  { getOnInit: true },
)

// Get default height for a widget from registry
function getDefaultWidgetHeight(widgetId: WidgetId): number {
  const config = WIDGET_REGISTRY.find((w) => w.id === widgetId)
  return config?.resize?.defaultHeight ?? 200
}

// Atom family for per-subChat, per-widget height
export const widgetHeightAtomFamily = atomFamily(
  ({ subChatId, widgetId }: { subChatId: string; widgetId: WidgetId }) =>
    atom(
      (get) => {
        const stored = get(widgetHeightStorageAtom)[subChatId]?.[widgetId]
        return stored ?? getDefaultWidgetHeight(widgetId)
      },
      (get, set, height: number) => {
        const current = get(widgetHeightStorageAtom)
        const subChatHeights = current[subChatId] ?? {}
        set(widgetHeightStorageAtom, {
          ...current,
          [subChatId]: {
            ...subChatHeights,
            [widgetId]: height,
          },
        })
      },
    ),
  // Custom equality function for the key
  (a, b) => a.subChatId === b.subChatId && a.widgetId === b.widgetId,
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

// Details "sticky" mode: 用户在 Plan/Terminal/Browser 打开时手动重新打开了 Details
// 一旦设置，后续打开 Plan/Terminal/Browser 不再自动关闭 Details，两者共存
export const detailsStickyAtom = atomWithStorage<boolean>(
  "overview:detailsSticky",
  false,
  undefined,
  { getOnInit: true },
)

// Section types for the overview sidebar
export type OverviewSection = "info" | "plan" | "terminal" | "diff" | "artifacts" | "explorer"

// Default expanded sections
const DEFAULT_EXPANDED_SECTIONS: OverviewSection[] = ["info", "plan", "terminal"]

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
