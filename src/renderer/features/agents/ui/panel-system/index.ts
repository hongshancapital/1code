/**
 * Panel System - Plugin-based panel management
 *
 * This module provides a flexible panel registration and rendering system
 * that allows panels to be dynamically added, removed, and conditionally shown.
 *
 * Key components:
 * - PanelRegistry: Singleton registry for panel configurations
 * - PanelGate: Conditional rendering based on panel availability
 * - PanelListRenderer: Render all available panels for a position
 * - usePanelContext: Build context for availability checks
 */

// Registry
export {
  panelRegistry,
  PANEL_IDS,
  DEFAULT_PANELS,
  initializeDefaultPanels,
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
} from "../../stores/panel-registry"

// Renderer components
export {
  PanelGate,
  PanelListRenderer,
  usePanelContext,
  type PanelGateProps,
  type PanelListRendererProps,
} from "./panel-renderer"
