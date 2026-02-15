/**
 * Panel System — Agents 侧入口
 *
 * 框架层已迁移到 @/features/panel-system，此文件统一 re-export：
 * - 从 @/features/panel-system 导出纯框架层 API
 * - 从当前目录导出依赖 agents context 的组件（PanelRenderer, PanelZone）
 */

// ── 框架层（from @/features/panel-system） ──
export {
  // Registry
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

  // State Manager
  panelIsOpenAtomFamily,
  panelDisplayModeAtomFamily,
  panelSizeAtomFamily,
  getDefaultPanelState,
  createOpenPanelAction,
  createClosePanelAction,
  createTogglePanelAction,
  type PanelStateValue,

  // Types
  type ZonePosition,
  type PanelRenderProps,
  type PanelDefinition,
  type PanelZoneProps,

  // Provider
  PanelsProvider,
  usePanelsContext,
  type PanelsProviderProps,
} from "../../../panel-system"

// ── Agents 侧组件（依赖 agents context） ──

// Core hook (depends on ChatInstanceContext)
export {
  usePanel,
  type PanelHandle,
} from "../../hooks/use-panel-state"

// Renderer (depends on ChatCapabilities/ProjectMode/Platform contexts)
export {
  PanelGate,
  PanelListRenderer,
  usePanelContext,
  type PanelGateProps,
  type PanelListRendererProps,
} from "./panel-renderer"

// Zone (depends on usePanel → ChatInstanceContext)
export {
  PanelZone,
  displayModeToZone,
} from "./panel-zone"

// Definitions (connects panel registry to concrete panel components)
export { builtinPanelDefinitions } from "./panel-definitions"
