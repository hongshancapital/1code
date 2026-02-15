/**
 * PanelZone - Panel 投影区域
 *
 * PanelZone 根据 position 过滤匹配的 Panel，
 * 为每个活跃 Panel 渲染对应的容器（ResizableSidebar / ResizableBottomPanel / Overlay）。
 *
 * Panel 组件本身不关心容器和 resize — 这些由 PanelZone 外部管理。
 * Panel 只接收 PanelRenderProps（displayMode, size, onClose, onDisplayModeChange）。
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
 * PanelZoneSlot — 单个 Panel 的容器路由。
 *
 * 职责：
 * - 调用 usePanel() 获取状态
 * - 调用 useIsAvailable() 检查运行时可用性
 * - 计算 isActive = isOpen && isAvailable && displayMode 匹配 zone
 * - 根据 zone 选择容器（ResizableSidebar / ResizableBottomPanel / Overlay）
 * - 构建 PanelRenderProps 传给 Panel 组件
 * - keepMounted panel 使用 CSS 隐藏而非 unmount
 *
 * Resize 由容器管理，Panel 组件只读取 size。
 */
const PanelZoneSlot = memo(function PanelZoneSlot({
  definition,
  zonePosition,
  className,
}: PanelZoneSlotProps) {
  const panel = usePanel(definition.id)

  // 运行时可用性（依赖 hooks）
  const hookAvailable = definition.useIsAvailable ? definition.useIsAvailable() : true

  // Legacy bridge: 如果 definition 提供了 useIsOpen，使用它代替 panelIsOpenAtomFamily。
  // 这允许仍在使用 legacy atoms 的 panel 逐步迁移。
  const legacyState = definition.useIsOpen ? definition.useIsOpen() : null
  const isOpen = legacyState ? legacyState.isOpen : panel.isOpen
  const closePanel = legacyState ? legacyState.close : panel.close

  // isActive = panel 打开 + 可用 + displayMode 匹配当前 zone
  const isActive =
    isOpen &&
    hookAvailable &&
    displayModeMatchesZone(panel.displayMode, zonePosition)

  // Size atom — 由 Zone 容器管理 resize，Panel 只读
  const sizeAtom = useMemo(
    () => panelSizeAtomFamily({ panelId: definition.id, subChatId: "" }),
    [definition.id],
  )
  const [size] = useAtom(sizeAtom)

  // keepMounted 从 PanelConfig 读取
  const keepMounted = panel.config?.keepMounted ?? false

  // Panel 组件的 props — 只含 Panel 需要感知的信息
  const renderProps: PanelRenderProps = useMemo(
    () => ({
      displayMode: panel.displayMode,
      size,
      onClose: closePanel,
      onDisplayModeChange: panel.setDisplayMode,
    }),
    [panel.displayMode, size, closePanel, panel.setDisplayMode],
  )

  const Component = definition.component

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
