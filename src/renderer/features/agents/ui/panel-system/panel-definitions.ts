/**
 * Panel Definitions — 集中注册所有内置 Panel 的渲染配置。
 *
 * 每个 PanelDefinition 链接 PanelRegistry 中的 id 到具体的 React 组件。
 * PanelsProvider 使用这个列表初始化 Panel 实例管理。
 *
 * Usage:
 *   import { builtinPanelDefinitions } from "./panel-definitions"
 *   <PanelsProvider panels={builtinPanelDefinitions}>
 */

import { PANEL_IDS } from "../../stores/panel-registry"
import { PlanPanel, usePlanAvailability } from "./panels/plan-panel"
import { DiffPanel, useDiffAvailability } from "./panels/diff-panel"
import { BrowserPanelWrapper, useBrowserAvailability } from "./panels/browser-panel-wrapper"
import { PreviewPanelWrapper, usePreviewAvailability } from "./panels/preview-panel"
import { TerminalPanelWrapper, useTerminalAvailability } from "./panels/terminal-panel"
import { FileViewerPanelWrapper, useFileViewerAvailability } from "./panels/file-viewer-panel"
import { ExplorerPanelWrapper, useExplorerAvailability } from "./panels/explorer-panel"
import { DetailsPanelWrapper, useDetailsAvailability } from "./panels/details-panel"
import type { PanelDefinition } from "./types"

/**
 * Built-in panel definitions.
 *
 * PanelConfig 元数据（displayModes, group, priority, size constraints）
 * 已在 panel-registry.ts 的 DEFAULT_PANELS 中声明。
 */
export const builtinPanelDefinitions: PanelDefinition[] = [
  { id: PANEL_IDS.DIFF, component: DiffPanel, useIsAvailable: useDiffAvailability },
  { id: PANEL_IDS.PLAN, component: PlanPanel, useIsAvailable: usePlanAvailability },
  { id: PANEL_IDS.PREVIEW, component: PreviewPanelWrapper, useIsAvailable: usePreviewAvailability },
  { id: PANEL_IDS.TERMINAL, component: TerminalPanelWrapper, useIsAvailable: useTerminalAvailability },
  { id: PANEL_IDS.BROWSER, component: BrowserPanelWrapper, useIsAvailable: useBrowserAvailability },
  { id: PANEL_IDS.FILE_VIEWER, component: FileViewerPanelWrapper, useIsAvailable: useFileViewerAvailability },
  { id: PANEL_IDS.EXPLORER, component: ExplorerPanelWrapper, useIsAvailable: useExplorerAvailability },
  { id: PANEL_IDS.DETAILS, component: DetailsPanelWrapper, useIsAvailable: useDetailsAvailability },
]
