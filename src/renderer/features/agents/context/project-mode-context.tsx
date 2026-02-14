/**
 * ProjectModeContext - Project mode and widget configuration
 *
 * This context provides:
 * 1. Current project mode (chat/cowork/coding)
 * 2. Enabled widgets based on mode and user config
 * 3. Widget visibility helpers
 *
 * Usage:
 *   const { projectMode, isWidgetEnabled, enabledWidgets } = useProjectMode()
 *
 * Note: This context depends on ChatInstanceContext for project data.
 */

import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
  type ReactNode,
} from "react"
import { useSetAtom } from "jotai"
import {
  type ProjectMode,
  type WidgetId,
  type ProjectFeatureConfig,
  parseFeatureConfig,
  computeEnabledWidgets,
  isWidgetEnabled as checkWidgetEnabled,
  isWidgetConfigurable as checkWidgetConfigurable,
  GIT_RELATED_WIDGETS,
  CHAT_DISABLED_WIDGETS,
  COWORK_DISABLED_WIDGETS,
  CODING_DISABLED_WIDGETS,
} from "../../../../shared/feature-config"
import { currentProjectModeAtom, enabledWidgetsAtom } from "../atoms"
import { useChatInstance } from "./chat-instance-context"

// ============================================================================
// Types
// ============================================================================

export interface ProjectModeContextValue {
  // Current mode
  projectMode: ProjectMode

  // Widget system
  enabledWidgets: Set<WidgetId>
  isWidgetEnabled: (widgetId: WidgetId) => boolean
  isWidgetConfigurable: (widgetId: WidgetId) => boolean

  // Feature config (project-level overrides)
  featureConfig: ProjectFeatureConfig | null

  // Mode-derived restrictions
  disabledWidgetsForMode: Set<WidgetId>
  isGitRelatedWidget: (widgetId: WidgetId) => boolean

  // Convenience flags
  hideGitWidgets: boolean // True if git widgets are disabled in current mode
}

// ============================================================================
// Context
// ============================================================================

const ProjectModeContext = createContext<ProjectModeContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

export interface ProjectModeProviderProps {
  children: ReactNode
}

export function ProjectModeProvider({ children }: ProjectModeProviderProps) {
  // Get project data from ChatInstanceContext
  const { project, agentChat, isPlayground } = useChatInstance()

  // Setters for global atoms (for backward compatibility)
  const setCurrentProjectMode = useSetAtom(currentProjectModeAtom)
  const setEnabledWidgets = useSetAtom(enabledWidgetsAtom)

  // Determine project mode
  const projectMode: ProjectMode = useMemo(() => {
    // Playground projects are always in chat mode
    if (isPlayground) return "chat"
    // Use project mode if available, default to cowork
    return project?.mode ?? "cowork"
  }, [project?.mode, isPlayground])

  // Parse feature config
  const featureConfig = useMemo(() => {
    return parseFeatureConfig(project?.featureConfig)
  }, [project?.featureConfig])

  // Compute enabled widgets
  const enabledWidgets = useMemo(() => {
    return computeEnabledWidgets(projectMode, featureConfig)
  }, [projectMode, featureConfig])

  // Compute disabled widgets for current mode
  const disabledWidgetsForMode = useMemo(() => {
    const disabled = new Set<WidgetId>()

    if (projectMode === "chat") {
      CHAT_DISABLED_WIDGETS.forEach((w) => disabled.add(w))
    }

    if (projectMode === "cowork") {
      GIT_RELATED_WIDGETS.forEach((w) => disabled.add(w))
      COWORK_DISABLED_WIDGETS.forEach((w) => disabled.add(w))
    }

    if (projectMode === "coding") {
      CODING_DISABLED_WIDGETS.forEach((w) => disabled.add(w))
    }

    return disabled
  }, [projectMode])

  // Sync to global atoms (for backward compatibility)
  useEffect(() => {
    if (agentChat) {
      setCurrentProjectMode(projectMode)
    }
  }, [agentChat, projectMode, setCurrentProjectMode])

  useEffect(() => {
    setEnabledWidgets(enabledWidgets)
  }, [enabledWidgets, setEnabledWidgets])

  // Helper functions
  const isWidgetEnabled = useCallback(
    (widgetId: WidgetId) => {
      return checkWidgetEnabled(widgetId, projectMode, featureConfig?.widgets?.[widgetId])
    },
    [projectMode, featureConfig]
  )

  const isWidgetConfigurable = useCallback(
    (widgetId: WidgetId) => {
      return checkWidgetConfigurable(widgetId, projectMode)
    },
    [projectMode]
  )

  const isGitRelatedWidget = useCallback((widgetId: WidgetId) => {
    return GIT_RELATED_WIDGETS.has(widgetId)
  }, [])

  const hideGitWidgets = projectMode === "cowork" || projectMode === "chat"

  const value = useMemo<ProjectModeContextValue>(
    () => ({
      projectMode,
      enabledWidgets,
      isWidgetEnabled,
      isWidgetConfigurable,
      featureConfig,
      disabledWidgetsForMode,
      isGitRelatedWidget,
      hideGitWidgets,
    }),
    [
      projectMode,
      enabledWidgets,
      isWidgetEnabled,
      isWidgetConfigurable,
      featureConfig,
      disabledWidgetsForMode,
      isGitRelatedWidget,
      hideGitWidgets,
    ]
  )

  return (
    <ProjectModeContext.Provider value={value}>
      {children}
    </ProjectModeContext.Provider>
  )
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Access project mode context
 * @throws Error if used outside ProjectModeProvider
 */
export function useProjectMode(): ProjectModeContextValue {
  const context = useContext(ProjectModeContext)
  if (!context) {
    throw new Error("useProjectMode must be used within a ProjectModeProvider")
  }
  return context
}

/**
 * Access project mode context safely (returns null if outside provider)
 */
export function useProjectModeSafe(): ProjectModeContextValue | null {
  return useContext(ProjectModeContext)
}

/**
 * Check if a widget is enabled
 */
export function useWidgetEnabled(widgetId: WidgetId): boolean {
  const { isWidgetEnabled } = useProjectMode()
  return isWidgetEnabled(widgetId)
}

/**
 * Get all enabled widgets
 */
export function useEnabledWidgets(): Set<WidgetId> {
  const { enabledWidgets } = useProjectMode()
  return enabledWidgets
}

/**
 * Check if git widgets should be hidden
 */
export function useHideGitWidgets(): boolean {
  const { hideGitWidgets } = useProjectMode()
  return hideGitWidgets
}

// Re-export types
export { type ProjectMode, type WidgetId, type ProjectFeatureConfig }
