/**
 * PanelStateManager — Re-export from @/features/panel-system
 *
 * 实际实现已迁移到 src/renderer/features/panel-system/stores/panel-state-manager.ts。
 * 此文件保留为 re-export hub，确保现有导入路径向后兼容。
 */
export {
  panelIsOpenAtomFamily,
  panelDisplayModeAtomFamily,
  panelSizeAtomFamily,
  getDefaultPanelState,
  createOpenPanelAction,
  createClosePanelAction,
  createTogglePanelAction,
  LEGACY_ATOM_MAPPING,
  LEGACY_SIZE_MAPPING,
  LEGACY_DISPLAY_MODE_MAPPING,
  type PanelStateValue,
  type ClosedStackEntry,
} from "../../panel-system/stores/panel-state-manager"
