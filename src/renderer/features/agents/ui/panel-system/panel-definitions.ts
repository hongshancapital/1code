/**
 * Panel Definitions — 集中注册所有内置 Panel 的渲染配置。
 *
 * 每个 PanelDefinition 链接 PanelRegistry 中的 id 到具体的 React 组件。
 * PanelsProvider 使用这个列表初始化 Panel 实例管理。
 *
 * Legacy Bridge:
 * 大部分 panel 通过 useIsOpen hook 从 legacy atoms 读取开关状态。
 * 这是因为 active-chat.tsx 和 ChatViewHeader 仍通过 legacy atoms 控制面板。
 * Browser 已完全迁移到 panelIsOpenAtomFamily（无需 useIsOpen）。
 * 当其余消费者迁移完毕后，移除所有 useIsOpen hooks。
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
import {
  useDiffIsOpen,
  useTerminalIsOpen,
  usePreviewIsOpen,
  useFileViewerIsOpen,
  useExplorerIsOpen,
  useDetailsIsOpen,
} from "./panels/legacy-open-hooks"
import type { PanelDefinition } from "./types"

/**
 * Built-in panel definitions.
 *
 * PanelConfig 元数据（displayModes, group, priority, size constraints）
 * 已在 panel-registry.ts 的 DEFAULT_PANELS 中声明。
 */
export const builtinPanelDefinitions: PanelDefinition[] = [
  // selfContained: 组件内部有 ResizableSidebar，PanelZone 不套外层容器
  { id: PANEL_IDS.DIFF, component: DiffPanel, useIsAvailable: useDiffAvailability, useIsOpen: useDiffIsOpen, selfContained: true },
  { id: PANEL_IDS.TERMINAL, component: TerminalPanelWrapper, useIsAvailable: useTerminalAvailability, useIsOpen: useTerminalIsOpen, selfContained: true },
  { id: PANEL_IDS.FILE_VIEWER, component: FileViewerPanelWrapper, useIsAvailable: useFileViewerAvailability, useIsOpen: useFileViewerIsOpen, selfContained: true },
  { id: PANEL_IDS.EXPLORER, component: ExplorerPanelWrapper, useIsAvailable: useExplorerAvailability, useIsOpen: useExplorerIsOpen, selfContained: true },
  { id: PANEL_IDS.DETAILS, component: DetailsPanelWrapper, useIsAvailable: useDetailsAvailability, useIsOpen: useDetailsIsOpen, selfContained: true },

  // 非 selfContained: 纯内容组件，PanelZone 提供 ResizableSidebar 容器
  { id: PANEL_IDS.PLAN, component: PlanPanel, useIsAvailable: usePlanAvailability },
  { id: PANEL_IDS.PREVIEW, component: PreviewPanelWrapper, useIsAvailable: usePreviewAvailability, useIsOpen: usePreviewIsOpen },
  { id: PANEL_IDS.BROWSER, component: BrowserPanelWrapper, useIsAvailable: useBrowserAvailability },
]
