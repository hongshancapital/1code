/**
 * PanelsProvider - Panel 实例生命周期管理
 *
 * 管理 PanelDefinition 集合，通过 Context 向下传递。
 * PanelZone 从这个 Context 读取需要渲染的 Panel 定义。
 *
 * Usage:
 *   <PanelsProvider panels={builtinPanelDefinitions}>
 *     <ChatArea />
 *     <PanelZone position="right" />
 *     <PanelZone position="bottom" />
 *     <PanelZone position="overlay" />
 *   </PanelsProvider>
 */

import { createContext, memo, useContext, useMemo, type ReactNode } from "react"
import type { PanelDefinition } from "./types"

// =============================================================================
// Context
// =============================================================================

interface PanelsContextValue {
  /** PanelDefinition lookup by id */
  definitions: Map<string, PanelDefinition>
}

const PanelsContext = createContext<PanelsContextValue | null>(null)

/**
 * Access the PanelsContext — must be used within PanelsProvider.
 * Throws if used outside provider (developer error).
 */
export function usePanelsContext(): PanelsContextValue {
  const ctx = useContext(PanelsContext)
  if (!ctx) {
    throw new Error("[usePanelsContext] Must be used within <PanelsProvider>")
  }
  return ctx
}

// =============================================================================
// Provider
// =============================================================================

export interface PanelsProviderProps {
  /** Panel definitions to manage */
  panels: PanelDefinition[]

  children: ReactNode
}

/**
 * PanelsProvider — 管理 Panel 实例的生命周期。
 *
 * 将 PanelDefinition[] 转为 Map 存入 Context，
 * PanelZone 从中读取并渲染匹配当前 zone 的 Panel。
 */
export const PanelsProvider = memo(function PanelsProvider({
  panels,
  children,
}: PanelsProviderProps) {
  const definitions = useMemo(
    () => new Map(panels.map((p) => [p.id, p])),
    [panels],
  )

  const value = useMemo<PanelsContextValue>(
    () => ({ definitions }),
    [definitions],
  )

  return (
    <PanelsContext.Provider value={value}>
      {children}
    </PanelsContext.Provider>
  )
})
