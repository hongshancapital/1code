/**
 * PanelZone - Panel 投影区域
 *
 * PanelZone 根据 position 过滤匹配的 Panel，
 * 为每个活跃 Panel 渲染对应的容器（ResizableSidebar / ResizableBottomPanel / Overlay）。
 *
 * 三种渲染路径（基于 PanelDefinition.selfContained）：
 *
 * A) selfContained 面板（Diff/Terminal/FileViewer/Explorer/Details）：
 *    组件内部已自带 ResizableSidebar 等容器和 isOpen/resize 管理。
 *    PanelZone 只做 hookAvailable 门控，不套外层容器。
 *
 * B) 非 selfContained + useIsOpen 面板（Plan/Preview）：
 *    PanelZone 提供 ResizableSidebar 容器，isOpen 来自 legacy hook。
 *    过渡阶段：当消费者迁移完毕后移除 useIsOpen。
 *
 * C) 完全迁移面板（Browser）：
 *    PanelZone 提供完整容器管理，isOpen 来自 panelIsOpenAtomFamily。
 *
 * Usage:
 *   <PanelZone position="right" />
 *   <PanelZone position="bottom" />
 *   <PanelZone position="overlay" />
 */

import { memo, useMemo } from "react"
import { useAtom } from "jotai"
import { panelRegistry, type DisplayMode } from "../../stores/panel-registry"
import { panelSizeAtomFamily } from "../../stores/panel-state-manager"
import { usePanel } from "../../hooks/use-panel-state"
import { usePanelsContext } from "./panels-provider"
import type { PanelDefinition, PanelRenderProps, PanelZoneProps, ZonePosition } from "./types"
import { ResizableSidebar } from "../../../../components/ui/resizable-sidebar"
import { ResizableBottomPanel } from "../../../../components/ui/resizable-bottom-panel"
import { CenterPeekDialog, FullPageView } from "../../../../components/ui/panel-container"

// =============================================================================
// DisplayMode ↔ ZonePosition Mapping
// =============================================================================

/**
 * Map a DisplayMode to its corresponding ZonePosition.
 *   side-peek   → "right"
 *   bottom      → "bottom"
 *   center-peek → "overlay"
 *   full-page   → "overlay"
 */
export function displayModeToZone(mode: DisplayMode): ZonePosition {
  switch (mode) {
    case "side-peek":
      return "right"
    case "bottom":
      return "bottom"
    case "center-peek":
    case "full-page":
      return "overlay"
    default:
      return "right"
  }
}

/**
 * Check if a panel's current displayMode matches a given zone position.
 */
function displayModeMatchesZone(mode: DisplayMode, zone: ZonePosition): boolean {
  return displayModeToZone(mode) === zone
}

/**
 * Check if a PanelConfig has any displayMode that maps to a given zone.
 */
function panelSupportsZone(panelId: string, zone: ZonePosition): boolean {
  const config = panelRegistry.get(panelId)
  if (!config) return false
  const modes = config.displayModes ?? ["side-peek"]
  return modes.some((m) => displayModeToZone(m) === zone)
}

// =============================================================================
// PanelZone
// =============================================================================

/**
 * PanelZone — 投影区域组件。
 *
 * 过滤 PanelsProvider 中 displayModes 能映射到此 zone 的 Panel，
 * 为每个 Panel 渲染一个 PanelZoneSlot。
 *
 * 同一时刻，一个 Panel 只在一个 zone 中活跃（displayMode 是单值），
 * 所以虽然 Terminal 的 Slot 同时存在于 right 和 bottom zone，
 * 但只有匹配当前 displayMode 的那个会渲染内容。
 */
export const PanelZone = memo(function PanelZone({
  position,
  className,
}: PanelZoneProps) {
  const { definitions } = usePanelsContext()

  // 过滤支持此 zone 的 Panel，按 priority 排序
  const matchingDefs = useMemo(() => {
    return Array.from(definitions.values())
      .filter((def) => panelSupportsZone(def.id, position))
      .sort((a, b) => {
        const configA = panelRegistry.get(a.id)
        const configB = panelRegistry.get(b.id)
        return (configA?.priority ?? 999) - (configB?.priority ?? 999)
      })
  }, [definitions, position])

  return (
    <>
      {matchingDefs.map((def) => (
        <PanelZoneSlot
          key={def.id}
          definition={def}
          zonePosition={position}
          className={className}
        />
      ))}
    </>
  )
})

// =============================================================================
// PanelZoneSlot — 单个 Panel 在 Zone 中的渲染
// =============================================================================

interface PanelZoneSlotProps {
  definition: PanelDefinition
  zonePosition: ZonePosition
  className?: string
}

/**
 * PanelZoneSlot — 单个 Panel 在 Zone 中的渲染。
 *
 * 三种渲染路径（基于 definition.selfContained）：
 *
 * A) selfContained 面板（Diff/Terminal/FileViewer/Explorer/Details）：
 *    组件内部已自带 ResizableSidebar 等容器和 isOpen/resize 管理。
 *    PanelZoneSlot 只做 hookAvailable 门控 — 可用时直接渲染组件，
 *    不套任何外层容器，避免双重 ResizableSidebar 嵌套。
 *    仅在 "right" zone 渲染（这些面板的 displayMode 由内部管理）。
 *
 * B) 非 selfContained + useIsOpen 面板（Plan/Preview）：
 *    PanelZone 提供 ResizableSidebar 容器，isOpen 来自 legacy hook。
 *    Panel 是纯内容组件，不含自己的 ResizableSidebar。
 *
 * C) 完全迁移面板（Browser，无 useIsOpen）：
 *    PanelZone 提供完整的容器管理，
 *    通过 panelIsOpenAtomFamily 控制 isOpen，panel.displayMode 决定 zone 匹配。
 */
const PanelZoneSlot = memo(function PanelZoneSlot({
  definition,
  zonePosition,
  className,
}: PanelZoneSlotProps) {
  const panel = usePanel(definition.id)

  // 运行时可用性（依赖 hooks）— 所有 hooks 必须无条件调用
  const hookAvailable = definition.useIsAvailable ? definition.useIsAvailable() : true

  // Legacy bridge hook — 必须无条件调用（React hooks 规则）
  const legacyState = definition.useIsOpen ? definition.useIsOpen() : null

  // Size atom — 由 Zone 容器管理 resize（非 selfContained 面板使用，但必须无条件调用）
  const sizeAtom = useMemo(
    () => panelSizeAtomFamily({ panelId: definition.id, subChatId: "" }),
    [definition.id],
  )
  const [size] = useAtom(sizeAtom)

  // close 来源：有 legacy hook 时用 legacy，否则用 panel.close
  const closePanel = legacyState ? legacyState.close : panel.close

  // Panel 组件的 props
  const renderProps: PanelRenderProps = useMemo(
    () => ({
      displayMode: panel.displayMode,
      size: definition.selfContained ? panel.size : size,
      onClose: closePanel,
      onDisplayModeChange: panel.setDisplayMode,
    }),
    [panel.displayMode, panel.size, definition.selfContained, size, closePanel, panel.setDisplayMode],
  )

  const Component = definition.component

  // ═══════════════════════════════════════════════════════════════════════════
  // 路径 A: selfContained 面板 + right zone + displayMode 匹配
  // 组件内部已自带 ResizableSidebar 等容器和 isOpen/resize 管理。
  // PanelZone 只做 hookAvailable + displayMode 门控，不套外层容器。
  // 当 displayMode 不匹配 right（如 Terminal 切到 bottom），
  // 则跳过路径 A，让 bottom zone 的路径 B/C 来渲染。
  // ═══════════════════════════════════════════════════════════════════════════
  if (definition.selfContained && zonePosition === "right") {
    if (!hookAvailable) return null
    if (!displayModeMatchesZone(panel.displayMode, "right")) return null
    return <Component {...renderProps} />
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 路径 B & C: 需要 PanelZone 提供容器的情况
  //   - 非 selfContained 面板（Plan/Preview/Browser）
  //   - selfContained 面板在非 right zone（如 Terminal 在 bottom zone）
  //
  // isOpen 来源：
  //   - 有 useIsOpen（legacy bridge）→ legacyState.isOpen
  //   - 无 useIsOpen（完全迁移）→ panel.isOpen
  // ═══════════════════════════════════════════════════════════════════════════

  const isOpen = legacyState ? legacyState.isOpen : panel.isOpen

  // isActive = panel 打开 + 可用 + displayMode 匹配当前 zone
  const isActive =
    isOpen &&
    hookAvailable &&
    displayModeMatchesZone(panel.displayMode, zonePosition)

  const keepMounted = panel.config?.keepMounted ?? false

  // ── right zone → ResizableSidebar ──
  if (zonePosition === "right") {
    return (
      <ResizableSidebar
        isOpen={isActive}
        onClose={closePanel}
        widthAtom={sizeAtom}
        minWidth={panel.config?.minSize ?? 300}
        maxWidth={panel.config?.maxSize ?? 800}
        side="right"
        animationDuration={0}
        initialWidth={0}
        exitWidth={0}
        showResizeTooltip
        keepMounted={keepMounted}
        className={`bg-tl-background border-l ${className ?? ""}`}
        style={{ borderLeftWidth: "0.5px" }}
      >
        <Component {...renderProps} />
      </ResizableSidebar>
    )
  }

  // ── bottom zone → ResizableBottomPanel ──
  if (zonePosition === "bottom") {
    return (
      <ResizableBottomPanel
        isOpen={isActive}
        onClose={closePanel}
        heightAtom={sizeAtom}
        minHeight={panel.config?.minSize ?? 150}
        maxHeight={panel.config?.maxSize ?? 500}
        showResizeTooltip
        className={className}
      >
        <Component {...renderProps} />
      </ResizableBottomPanel>
    )
  }

  // ── overlay zone → CenterPeekDialog or FullPageView ──
  if (zonePosition === "overlay") {
    if (panel.displayMode === "full-page") {
      return (
        <FullPageView isOpen={isActive} onClose={closePanel}>
          <Component {...renderProps} />
        </FullPageView>
      )
    }
    // center-peek (default overlay)
    return (
      <CenterPeekDialog isOpen={isActive} onClose={closePanel}>
        <Component {...renderProps} />
      </CenterPeekDialog>
    )
  }

  return null
})
