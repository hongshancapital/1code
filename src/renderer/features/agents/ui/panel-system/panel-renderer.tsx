/**
 * PanelRenderer - 根据 PanelRegistry 动态渲染面板
 *
 * 这个组件读取 PanelRegistry 和 Context，动态决定渲染哪些面板。
 * 采用 Gate Pattern：先检查面板可用性，再渲染面板内容。
 *
 * Usage:
 *   <PanelRenderer position="right">
 *     {(panel) => <MyPanelContent panelId={panel.id} />}
 *   </PanelRenderer>
 */

import { memo, useMemo, type ReactNode } from "react"
import {
  panelRegistry,
  usePanelsByPosition,
  type PanelConfig,
  type PanelContext,
  type PanelPosition,
} from "../../stores/panel-registry"
import { useChatCapabilitiesSafe } from "../../context/chat-capabilities-context"
import { useProjectModeSafe } from "../../context/project-mode-context"
import { usePlatform } from "../../../../contexts/PlatformContext"

// ============================================================================
// Panel Context Builder
// ============================================================================

/**
 * Build PanelContext from various Context providers
 */
export function usePanelContext(): PanelContext {
  const capabilities = useChatCapabilitiesSafe()
  const projectMode = useProjectModeSafe()
  const platform = usePlatform()

  return useMemo<PanelContext>(
    () => ({
      // Capabilities (with fallbacks for when outside provider)
      hideGitFeatures: capabilities?.hideGitFeatures ?? false,
      canOpenDiff: capabilities?.canOpenDiff ?? true,
      canOpenTerminal: capabilities?.canOpenTerminal ?? true,
      canOpenPreview: capabilities?.canOpenPreview ?? false,
      isRemoteChat: capabilities?.isRemoteChat ?? false,
      isSandboxMode: capabilities?.isSandboxMode ?? false,

      // Project mode
      projectMode: projectMode?.projectMode ?? "cowork",
      enabledWidgets: projectMode?.enabledWidgets ?? new Set(),

      // Platform
      isDesktop: platform.isDesktop,
    }),
    [capabilities, projectMode, platform.isDesktop]
  )
}

// ============================================================================
// Panel Gate Component
// ============================================================================

export interface PanelGateProps {
  /** Panel ID to check */
  panelId: string

  /** Children to render when panel is available */
  children: ReactNode

  /** Fallback when panel is not available */
  fallback?: ReactNode
}

/**
 * PanelGate - Conditionally render children based on panel availability
 *
 * Usage:
 *   <PanelGate panelId="diff">
 *     <DiffSidebar />
 *   </PanelGate>
 */
export const PanelGate = memo(function PanelGate({
  panelId,
  children,
  fallback = null,
}: PanelGateProps) {
  const context = usePanelContext()
  const isAvailable = panelRegistry.isAvailable(panelId, context)

  if (!isAvailable) {
    return <>{fallback}</>
  }

  return <>{children}</>
})

// ============================================================================
// Panel List Renderer
// ============================================================================

export interface PanelListRendererProps {
  /** Position to filter panels */
  position: PanelPosition

  /** Render function for each available panel */
  children: (panel: PanelConfig, index: number) => ReactNode

  /** Optional wrapper for the list */
  wrapper?: (children: ReactNode) => ReactNode
}

/**
 * PanelListRenderer - Render all available panels for a position
 *
 * Usage:
 *   <PanelListRenderer position="right">
 *     {(panel) => (
 *       <PanelWrapper key={panel.id} config={panel}>
 *         {getPanelContent(panel.id)}
 *       </PanelWrapper>
 *     )}
 *   </PanelListRenderer>
 */
export const PanelListRenderer = memo(function PanelListRenderer({
  position,
  children,
  wrapper,
}: PanelListRendererProps) {
  const allPanels = usePanelsByPosition(position)
  const context = usePanelContext()

  // Filter to available panels
  const availablePanels = useMemo(
    () =>
      allPanels.filter((panel) => {
        if (!panel.isAvailable) return true
        return panel.isAvailable(context)
      }),
    [allPanels, context]
  )

  const content = availablePanels.map((panel, index) => children(panel, index))

  if (wrapper) {
    return <>{wrapper(content)}</>
  }

  return <>{content}</>
})

// ============================================================================
// Exports
// ============================================================================

export { type PanelConfig, type PanelContext, type PanelPosition }
