"use client"

import type { WritableAtom } from "jotai"
import { ResizableSidebar } from "../resizable-sidebar"
import { CenterPeekDialog } from "./center-peek-dialog"
import { FullPageView } from "./full-page-view"
import type { PanelDisplayMode } from "./types"
import { createLogger } from "../../../lib/logger"

const log = createLogger("panelContainer")


interface PanelContainerProps {
  /** Whether the panel is open */
  isOpen: boolean
  /** Close handler */
  onClose: () => void
  /** Current display mode */
  displayMode: PanelDisplayMode
  /** Panel content */
  children: React.ReactNode
  /** Jotai atom for sidebar width (required for side-peek mode) */
  widthAtom?: WritableAtom<number, [number], void>
  /** Minimum width for sidebar mode */
  minWidth?: number
  /** Maximum width for sidebar mode */
  maxWidth?: number
  /** Side for sidebar mode */
  side?: "left" | "right"
  /** Additional class name for sidebar container */
  className?: string
  /** Custom styles for sidebar container */
  style?: React.CSSProperties
}

export function PanelContainer({
  isOpen,
  onClose,
  displayMode,
  children,
  widthAtom,
  minWidth = 300,
  maxWidth = 800,
  side = "right",
  className = "",
  style,
}: PanelContainerProps) {
  if (displayMode === "side-peek") {
    if (!widthAtom) {
      log.warn("PanelContainer: widthAtom is required for side-peek mode")
      return null
    }
    return (
      <ResizableSidebar
        isOpen={isOpen}
        onClose={onClose}
        widthAtom={widthAtom}
        side={side}
        minWidth={minWidth}
        maxWidth={maxWidth}
        className={className}
        style={{ borderLeftWidth: side === "right" ? "0.5px" : undefined, overflow: "hidden", ...style }}
      >
        {children}
      </ResizableSidebar>
    )
  }

  if (displayMode === "center-peek") {
    return (
      <CenterPeekDialog isOpen={isOpen} onClose={onClose}>
        {children}
      </CenterPeekDialog>
    )
  }

  if (displayMode === "full-page") {
    return (
      <FullPageView isOpen={isOpen} onClose={onClose}>
        {children}
      </FullPageView>
    )
  }

  return null
}
