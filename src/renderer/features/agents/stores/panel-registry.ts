/**
 * PanelRegistry — Re-export from @/features/panel-system
 *
 * 实际实现已迁移到 src/renderer/features/panel-system/stores/panel-registry.ts。
 * 此文件保留为 re-export hub，确保现有导入路径向后兼容。
 */
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
} from "../../panel-system/stores/panel-registry"
