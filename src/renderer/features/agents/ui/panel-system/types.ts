/**
 * Panel System Types
 *
 * Core type definitions for the PanelsProvider + PanelZone architecture.
 */

import type { ComponentType } from "react"
import type { DisplayMode } from "../../stores/panel-registry"

// =============================================================================
// Zone Position
// =============================================================================

/**
 * Physical areas where panels can be rendered.
 *
 * Mapping from DisplayMode → ZonePosition:
 *   side-peek   → "right"
 *   bottom      → "bottom"
 *   center-peek → "overlay"
 *   full-page   → "overlay"
 */
export type ZonePosition = "right" | "bottom" | "overlay"

// =============================================================================
// Panel Render Props
// =============================================================================

/**
 * Props passed to every Panel component by PanelZone.
 *
 * Intentionally slim — panels only sense what they need:
 *   - Where they are (displayMode)
 *   - How big they are (size, read-only)
 *   - How to close themselves (onClose)
 *   - How to switch display mode (onDisplayModeChange)
 *
 * Everything else (container, resize, mutual exclusion) is handled by PanelZone.
 */
export interface PanelRenderProps {
  /** Current display mode — determines which zone the panel is rendered in */
  displayMode: DisplayMode

  /** Current size in pixels (width for side-peek, height for bottom). Read-only — resize is managed by PanelZone. */
  size: number

  /** Request to close this panel */
  onClose: () => void

  /** Request to switch display mode (e.g., side-peek → bottom) */
  onDisplayModeChange: (mode: DisplayMode) => void
}

// =============================================================================
// Panel Definition
// =============================================================================

/**
 * Registration entry for a panel in PanelsProvider.
 *
 * Complements PanelConfig (registry metadata) with rendering info:
 *   - PanelConfig = behavior (displayModes, group, priority, minSize/maxSize)
 *   - PanelDefinition = rendering (component, runtime availability)
 */
export interface PanelDefinition {
  /** Must match a registered PANEL_IDS key */
  id: string

  /** Panel component — receives PanelRenderProps */
  component: ComponentType<PanelRenderProps>

  /**
   * Runtime availability check hook.
   * Called as a React hook inside PanelZoneSlot.
   * Return false to prevent the panel from rendering (even if isOpen is true).
   *
   * Use this for conditions that depend on React hooks (atoms, stores, queries).
   * For static conditions, use PanelConfig.isAvailable instead.
   */
  useIsAvailable?: () => boolean
}

// =============================================================================
// Panel Zone Props
// =============================================================================

export interface PanelZoneProps {
  /** Which physical area this zone represents */
  position: ZonePosition

  /** Additional className for the zone container (passed to individual panel containers) */
  className?: string
}
