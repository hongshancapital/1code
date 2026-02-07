/**
 * Project Feature Configuration
 *
 * Controls which features (widgets, tools) are enabled for a project.
 * Each project has a mode ("cowork" | "coding") that determines defaults,
 * and users can override individual features.
 */

export type ProjectMode = "chat" | "cowork" | "coding"

/**
 * Playground constants for Chat mode
 * The playground project runs in a fixed directory: ~/.hong/.playground
 */
export const PLAYGROUND_DIR_NAME = ".playground"
export const PLAYGROUND_PARENT_DIR = ".hong"
export const PLAYGROUND_PROJECT_NAME = "Chat Playground"

/**
 * Get the playground directory path relative to home
 * Use with path.join(homePath, PLAYGROUND_RELATIVE_PATH)
 */
export const PLAYGROUND_RELATIVE_PATH = `${PLAYGROUND_PARENT_DIR}/${PLAYGROUND_DIR_NAME}`

export type WidgetId =
  | "usage"
  | "info"
  | "todo"
  | "plan"
  | "terminal"
  | "diff"
  | "artifacts"
  | "explorer"
  | "background-tasks"
  | "mcp"
  | "skills"

/**
 * Stored in projects.featureConfig as JSON string
 */
export interface ProjectFeatureConfig {
  widgets?: { [K in WidgetId]?: boolean }
  tools?: { [toolId: string]: boolean }
}

/**
 * Feature default values per mode
 */
export interface FeatureDefault {
  label: string
  defaultInCoding: boolean
  defaultInCowork: boolean
}

/**
 * Widget feature defaults
 */
export const WIDGET_DEFAULTS: Record<WidgetId, FeatureDefault> = {
  usage: { label: "Usage", defaultInCoding: true, defaultInCowork: true },
  info: { label: "Workspace", defaultInCoding: true, defaultInCowork: true },
  todo: { label: "Tasks", defaultInCoding: true, defaultInCowork: true },
  plan: { label: "Plan", defaultInCoding: true, defaultInCowork: true },
  terminal: { label: "Terminal", defaultInCoding: false, defaultInCowork: false },
  diff: { label: "Changes", defaultInCoding: true, defaultInCowork: false },
  artifacts: { label: "Artifacts", defaultInCoding: false, defaultInCowork: true },
  explorer: { label: "Explorer", defaultInCoding: true, defaultInCowork: true },
  "background-tasks": { label: "Background Tasks", defaultInCoding: true, defaultInCowork: false },
  mcp: { label: "MCP Servers", defaultInCoding: true, defaultInCowork: true },
  skills: { label: "Skills", defaultInCoding: true, defaultInCowork: true },
}

/**
 * Git-related widgets that are NEVER available in chat/cowork mode.
 * This constraint cannot be overridden by user configuration.
 * Note: "info" widget is NOT included here because it also shows
 * non-git information (e.g., playground type, migration options).
 */
export const GIT_RELATED_WIDGETS: Set<WidgetId> = new Set([
  "terminal", // Can execute git commands
  "diff",     // Git diff viewer
])

/**
 * Widgets disabled in chat mode (most widgets, as chat is purely conversational)
 * Note: todo, plan, mcp, skills are available in chat mode
 * Note: artifacts is enabled in chat mode to show generated files
 */
export const CHAT_DISABLED_WIDGETS: Set<WidgetId> = new Set([
  "info",
  "terminal",
  "diff",
  "explorer",
  "background-tasks",
])

/**
 * Widgets that are NEVER available in cowork mode (non-git related).
 */
export const COWORK_DISABLED_WIDGETS: Set<WidgetId> = new Set([
  "background-tasks", // Not needed in cowork mode
])

/**
 * Widgets that are NEVER available in coding mode.
 * Artifacts is replaced by diff functionality in coding mode.
 */
export const CODING_DISABLED_WIDGETS: Set<WidgetId> = new Set([
  "artifacts", // Use diff instead in coding mode
])

/**
 * Widgets that are always enabled and cannot be toggled by user.
 * These widgets are mandatory in both modes.
 */
export const ALWAYS_ENABLED_WIDGETS: Set<WidgetId> = new Set([
  "plan", // Plan is always available, not user-configurable
])

/**
 * Check if a widget feature is enabled based on mode and user override
 */
export function isWidgetEnabled(
  widgetId: WidgetId,
  projectMode: ProjectMode,
  userOverride?: boolean
): boolean {
  // Hard constraint: Always-enabled widgets are always on (plan)
  if (ALWAYS_ENABLED_WIDGETS.has(widgetId)) {
    return true
  }

  // Hard constraint: Chat mode only allows todo and plan widgets
  if (projectMode === "chat" && CHAT_DISABLED_WIDGETS.has(widgetId)) {
    return false
  }

  // Hard constraint: Git-related widgets are NEVER available in cowork mode
  if (projectMode === "cowork" && GIT_RELATED_WIDGETS.has(widgetId)) {
    return false
  }

  // Hard constraint: Cowork-disabled widgets (non-git) are NEVER available in cowork mode
  if (projectMode === "cowork" && COWORK_DISABLED_WIDGETS.has(widgetId)) {
    return false
  }

  // Hard constraint: Artifacts is NEVER available in coding mode (use diff instead)
  if (projectMode === "coding" && CODING_DISABLED_WIDGETS.has(widgetId)) {
    return false
  }

  if (userOverride !== undefined) return userOverride
  const defaults = WIDGET_DEFAULTS[widgetId]
  // Chat mode uses cowork defaults (simplified)
  return projectMode === "coding"
    ? defaults.defaultInCoding
    : defaults.defaultInCowork
}

/**
 * Check if a widget can be toggled by user (not locked by mode constraints)
 */
export function isWidgetConfigurable(
  widgetId: WidgetId,
  projectMode: ProjectMode
): boolean {
  // Always-enabled widgets cannot be toggled
  if (ALWAYS_ENABLED_WIDGETS.has(widgetId)) {
    return false
  }

  // Chat mode has very limited configurability
  if (projectMode === "chat" && CHAT_DISABLED_WIDGETS.has(widgetId)) {
    return false
  }

  // Mode-locked widgets cannot be toggled
  if (projectMode === "cowork" && GIT_RELATED_WIDGETS.has(widgetId)) {
    return false
  }
  if (projectMode === "cowork" && COWORK_DISABLED_WIDGETS.has(widgetId)) {
    return false
  }
  if (projectMode === "coding" && CODING_DISABLED_WIDGETS.has(widgetId)) {
    return false
  }

  return true
}

/**
 * Compute all enabled widgets for a project
 */
export function computeEnabledWidgets(
  mode: ProjectMode,
  featureConfig: ProjectFeatureConfig | null
): Set<WidgetId> {
  const enabled = new Set<WidgetId>()
  for (const widgetId of Object.keys(WIDGET_DEFAULTS) as WidgetId[]) {
    if (isWidgetEnabled(widgetId, mode, featureConfig?.widgets?.[widgetId])) {
      enabled.add(widgetId)
    }
  }
  return enabled
}

/**
 * Get default visible widgets for a mode (for initial widget visibility)
 */
export function getDefaultVisibleWidgets(mode: ProjectMode): WidgetId[] {
  return (Object.keys(WIDGET_DEFAULTS) as WidgetId[]).filter((widgetId) =>
    isWidgetEnabled(widgetId, mode, undefined)
  )
}

/**
 * Parse feature config from JSON string (from database)
 */
export function parseFeatureConfig(
  json: string | null | undefined
): ProjectFeatureConfig | null {
  if (!json) return null
  try {
    return JSON.parse(json) as ProjectFeatureConfig
  } catch {
    return null
  }
}
