/**
 * Panel System - Plugin-based panel management
 *
 * Architecture:
 *   PanelRegistry     → 元数据（id, displayModes, group, priority）
 *   PanelStateManager → 运行时状态（isOpen, displayMode, size, 互斥）
 *   usePanel()        → 消费接口（PanelHandle）
 *   PanelDefinition   → 渲染配置（component, useIsAvailable）
 *   PanelsProvider    → 实例生命周期管理 + Context
 *   PanelZone         → 投影区域，根据 position 渲染匹配的 Panel + 容器
 *
 * Usage:
 *   <PanelsProvider panels={builtinPanelDefinitions}>
 *     <div className="flex h-full flex-col">
 *       <div className="flex-1 overflow-hidden flex">
 *         <ChatArea />
 *         <PanelZone position="right" />
 *       </div>
 *       <PanelZone position="bottom" />
 *     </div>
 *     <PanelZone position="overlay" />
 *   </PanelsProvider>
 */

// Registry (config + groups)
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
} from "../../stores/panel-registry"

// State management
export {
  panelIsOpenAtomFamily,
  panelDisplayModeAtomFamily,
  panelSizeAtomFamily,
  getDefaultPanelState,
  type PanelStateValue,
} from "../../stores/panel-state-manager"

// Core hook
export {
  usePanel,
  type PanelHandle,
} from "../../hooks/use-panel-state"

// Renderer components (legacy — PanelGate still used for inline availability checks)
export {
  PanelGate,
  PanelListRenderer,
  usePanelContext,
  type PanelGateProps,
  type PanelListRendererProps,
} from "./panel-renderer"

// Types
export {
  type ZonePosition,
  type PanelRenderProps,
  type PanelDefinition,
  type PanelZoneProps,
} from "./types"

// Provider + Zone
export {
  PanelsProvider,
  usePanelsContext,
  type PanelsProviderProps,
} from "./panels-provider"

export {
  PanelZone,
  displayModeToZone,
} from "./panel-zone"

// Definitions
export { builtinPanelDefinitions } from "./panel-definitions"
