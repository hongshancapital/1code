/**
 * Panel System — 独立 Feature
 *
 * 提供插件化的面板管理框架：
 *   PanelRegistry     → 元数据（id, displayModes, group, priority）
 *   PanelStateManager → 运行时状态（isOpen, displayMode, size, 互斥）
 *   PanelsProvider    → 实例生命周期管理 + Context
 *   PanelDefinition   → 渲染配置（component, useIsAvailable）
 *
 * 此 feature 只包含纯框架层代码，不依赖任何 agents-specific context。
 * 具体面板实现、PanelZone（依赖 usePanel → ChatInstanceContext）、
 * PanelRenderer（依赖 capabilities/projectMode context）保留在 agents 侧。
 */

// ── Registry ──
export {
  panelRegistry,
  PANEL_IDS,
  PANEL_GROUP_IDS,
  PANEL_GROUPS,
  DEFAULT_PANELS,
  initializeDefaultPanels,
  getPanelGroup,
  panelRegistryVersionAtom,
  panelStateAtomFamily,
  usePanels,
  usePanelsByPosition,
  useAvailablePanels,
  usePanelAvailable,
  type PanelConfig,
  type PanelContext,
  type PanelPosition,
  type PanelState,
  type PanelId,
  type DisplayMode,
  type PanelGroupConfig,
} from "./stores/panel-registry"

// ── State Manager ──
export {
  panelIsOpenAtomFamily,
  panelDisplayModeAtomFamily,
  panelSizeAtomFamily,
  getDefaultPanelState,
  createOpenPanelAction,
  createClosePanelAction,
  createTogglePanelAction,
  type PanelStateValue,
  type ClosedStackEntry,
  LEGACY_ATOM_MAPPING,
  LEGACY_SIZE_MAPPING,
  LEGACY_DISPLAY_MODE_MAPPING,
} from "./stores/panel-state-manager"

// ── Types ──
export {
  type ZonePosition,
  type PanelRenderProps,
  type PanelDefinition,
  type PanelZoneProps,
} from "./types"

// ── Provider ──
export {
  PanelsProvider,
  usePanelsContext,
  type PanelsProviderProps,
} from "./panels-provider"
