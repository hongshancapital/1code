/**
 * PanelRegistry — 面板注册系统
 *
 * 参考 ChatRegistry 的设计理念，提供插件化的面板管理：
 * - 面板可动态注册/注销
 * - 每个面板有可用性检测（isAvailable）
 * - 支持面板分组（sidebar、bottom、floating）
 * - 支持面板优先级排序
 *
 * 和 Linux 设备驱动注册表类似：注册表本身不含业务逻辑，
 * 只负责维护面板元数据。渲染逻辑由 React 组件根据注册信息动态生成。
 */

import { atom } from "jotai"
import type { ComponentType, ReactNode } from "react"

// ============================================================================
// Types
// ============================================================================

/**
 * Panel position types
 */
export type PanelPosition = "left" | "right" | "bottom" | "floating"

/**
 * Panel metadata
 */
export interface PanelConfig {
  /** Unique panel identifier */
  id: string

  /** Display name for UI */
  name: string

  /** Icon component (Lucide icon) */
  icon?: ComponentType<{ className?: string }>

  /** Position in layout */
  position: PanelPosition

  /** Sort order within position group (lower = first) */
  priority: number

  /** Default width/height (depending on position) */
  defaultSize?: number

  /** Minimum size */
  minSize?: number

  /** Maximum size */
  maxSize?: number

  /**
   * Availability checker - called with context to determine if panel should be shown
   * Return false to hide the panel entirely (e.g., diff panel when hideGitFeatures=true)
   */
  isAvailable?: (context: PanelContext) => boolean

  /**
   * Initial open state
   */
  defaultOpen?: boolean

  /**
   * Whether the panel can be resized
   */
  resizable?: boolean

  /**
   * Whether the panel can be collapsed
   */
  collapsible?: boolean

  /**
   * Keyboard shortcut to toggle (e.g., "Cmd+D")
   */
  shortcut?: string
}

/**
 * Context passed to panel availability checkers
 */
export interface PanelContext {
  // From ChatCapabilitiesContext
  hideGitFeatures: boolean
  canOpenDiff: boolean
  canOpenTerminal: boolean
  canOpenPreview: boolean
  isRemoteChat: boolean
  isSandboxMode: boolean

  // From ProjectModeContext
  projectMode: string
  enabledWidgets: Set<string>

  // From PlatformContext
  isDesktop: boolean
}

/**
 * Panel state (runtime state, not config)
 */
export interface PanelState {
  isOpen: boolean
  size: number
  isCollapsed?: boolean
}

// ============================================================================
// Registry Class
// ============================================================================

class PanelRegistryClass {
  private panels = new Map<string, PanelConfig>()
  private listeners = new Set<() => void>()

  // ── Registration ──

  /**
   * Register a panel configuration
   */
  register(config: PanelConfig): void {
    if (this.panels.has(config.id)) {
      console.warn(`[PanelRegistry] Panel "${config.id}" already registered, updating`)
    }
    this.panels.set(config.id, config)
    this.notifyListeners()
  }

  /**
   * Unregister a panel
   */
  unregister(id: string): void {
    if (this.panels.delete(id)) {
      this.notifyListeners()
    }
  }

  // ── Queries ──

  /**
   * Get panel config by ID
   */
  get(id: string): PanelConfig | undefined {
    return this.panels.get(id)
  }

  /**
   * Get all registered panels
   */
  getAll(): PanelConfig[] {
    return Array.from(this.panels.values())
  }

  /**
   * Get panels by position, sorted by priority
   */
  getByPosition(position: PanelPosition): PanelConfig[] {
    return this.getAll()
      .filter((p) => p.position === position)
      .sort((a, b) => a.priority - b.priority)
  }

  /**
   * Get available panels for a given context
   */
  getAvailable(context: PanelContext): PanelConfig[] {
    return this.getAll().filter((p) => {
      if (!p.isAvailable) return true
      return p.isAvailable(context)
    })
  }

  /**
   * Get available panels by position
   */
  getAvailableByPosition(position: PanelPosition, context: PanelContext): PanelConfig[] {
    return this.getAvailable(context)
      .filter((p) => p.position === position)
      .sort((a, b) => a.priority - b.priority)
  }

  /**
   * Check if a panel is available
   */
  isAvailable(id: string, context: PanelContext): boolean {
    const panel = this.panels.get(id)
    if (!panel) return false
    if (!panel.isAvailable) return true
    return panel.isAvailable(context)
  }

  // ── Subscription ──

  /**
   * Subscribe to registry changes
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  // ── Utilities ──

  /**
   * Clear all panels (for testing or reset)
   */
  clear(): void {
    this.panels.clear()
    this.notifyListeners()
  }
}

// Singleton instance
export const panelRegistry = new PanelRegistryClass()

// ============================================================================
// Built-in Panel Definitions
// ============================================================================

/**
 * Built-in panel IDs (constants to avoid typos)
 */
export const PANEL_IDS = {
  DIFF: "diff",
  PLAN: "plan",
  PREVIEW: "preview",
  TERMINAL: "terminal",
  BROWSER: "browser",
  FILE_VIEWER: "file-viewer",
  EXPLORER: "explorer",
  DETAILS: "details",
  CHANGES: "changes",
} as const

export type PanelId = (typeof PANEL_IDS)[keyof typeof PANEL_IDS]

/**
 * Default panel configurations
 * These are registered at app startup
 */
export const DEFAULT_PANELS: PanelConfig[] = [
  {
    id: PANEL_IDS.DIFF,
    name: "Diff",
    position: "right",
    priority: 10,
    defaultSize: 500,
    minSize: 300,
    maxSize: 800,
    resizable: true,
    collapsible: true,
    shortcut: "Cmd+D",
    isAvailable: (ctx) => !ctx.hideGitFeatures && ctx.canOpenDiff,
  },
  {
    id: PANEL_IDS.PLAN,
    name: "Plan",
    position: "right",
    priority: 20,
    defaultSize: 400,
    minSize: 300,
    maxSize: 600,
    resizable: true,
    collapsible: true,
  },
  {
    id: PANEL_IDS.PREVIEW,
    name: "Preview",
    position: "right",
    priority: 30,
    defaultSize: 400,
    minSize: 300,
    maxSize: 800,
    resizable: true,
    isAvailable: (ctx) => ctx.canOpenPreview,
  },
  {
    id: PANEL_IDS.TERMINAL,
    name: "Terminal",
    position: "bottom",
    priority: 10,
    defaultSize: 300,
    minSize: 150,
    maxSize: 500,
    resizable: true,
    collapsible: true,
    isAvailable: (ctx) => ctx.isDesktop && ctx.canOpenTerminal,
  },
  {
    id: PANEL_IDS.BROWSER,
    name: "Browser",
    position: "right",
    priority: 40,
    defaultSize: 500,
    minSize: 400,
    maxSize: 1000,
    resizable: true,
  },
  {
    id: PANEL_IDS.FILE_VIEWER,
    name: "File Viewer",
    position: "right",
    priority: 50,
    defaultSize: 500,
    minSize: 300,
    maxSize: 800,
    resizable: true,
  },
  {
    id: PANEL_IDS.EXPLORER,
    name: "Explorer",
    position: "left",
    priority: 10,
    defaultSize: 280,
    minSize: 200,
    maxSize: 400,
    resizable: true,
    collapsible: true,
    isAvailable: (ctx) => ctx.isDesktop,
  },
  {
    id: PANEL_IDS.DETAILS,
    name: "Details",
    position: "right",
    priority: 100,
    defaultSize: 320,
    minSize: 280,
    maxSize: 500,
    resizable: true,
  },
]

/**
 * Initialize default panels
 * Call this at app startup
 */
export function initializeDefaultPanels(): void {
  DEFAULT_PANELS.forEach((panel) => {
    panelRegistry.register(panel)
  })
}

// ============================================================================
// Jotai Atoms for Panel State
// ============================================================================

/**
 * Atom to trigger re-renders when registry changes
 */
export const panelRegistryVersionAtom = atom(0)

/**
 * Panel state atom family - stores open/size state per panel per chat
 * Key format: `${chatId}:${panelId}`
 */
export const panelStateAtomFamily = (key: string) =>
  atom<PanelState>({
    isOpen: false,
    size: 0,
  })

// ============================================================================
// React Hooks
// ============================================================================

import { useAtomValue, useSetAtom } from "jotai"
import { useEffect, useState, useMemo, useCallback } from "react"

/**
 * Hook to get all panels (subscribes to registry changes)
 */
export function usePanels(): PanelConfig[] {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    return panelRegistry.subscribe(() => setVersion((v) => v + 1))
  }, [])

  return useMemo(() => panelRegistry.getAll(), [version])
}

/**
 * Hook to get panels by position
 */
export function usePanelsByPosition(position: PanelPosition): PanelConfig[] {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    return panelRegistry.subscribe(() => setVersion((v) => v + 1))
  }, [])

  return useMemo(
    () => panelRegistry.getByPosition(position),
    [position, version]
  )
}

/**
 * Hook to get available panels with context
 */
export function useAvailablePanels(context: PanelContext): PanelConfig[] {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    return panelRegistry.subscribe(() => setVersion((v) => v + 1))
  }, [])

  return useMemo(
    () => panelRegistry.getAvailable(context),
    [context, version]
  )
}

/**
 * Hook to check if a specific panel is available
 */
export function usePanelAvailable(panelId: string, context: PanelContext): boolean {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    return panelRegistry.subscribe(() => setVersion((v) => v + 1))
  }, [])

  return useMemo(
    () => panelRegistry.isAvailable(panelId, context),
    [panelId, context, version]
  )
}
