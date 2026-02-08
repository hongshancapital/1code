"use client"

import { memo, useCallback, useRef, useState, useEffect } from "react"
import { useAtom } from "jotai"
import { GripHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { widgetHeightAtomFamily, WIDGET_REGISTRY, type WidgetId, type WidgetResizeConfig } from "../atoms"

interface ResizableWidgetCardProps {
  widgetId: WidgetId
  subChatId: string
  children: React.ReactNode
  className?: string
}

/**
 * Wrapper component that adds vertical resize capability to widgets.
 * Only renders resize handle if the widget has resize config in WIDGET_REGISTRY.
 * Height is persisted per sub-chat, so each sub-chat can have its own widget heights.
 */
export const ResizableWidgetCard = memo(function ResizableWidgetCard({
  widgetId,
  subChatId,
  children,
  className,
}: ResizableWidgetCardProps) {
  const config = WIDGET_REGISTRY.find((w) => w.id === widgetId)
  const resizeConfig = config?.resize

  // If no resize config, just render children directly
  if (!resizeConfig) {
    return <>{children}</>
  }

  return (
    <ResizableContent
      widgetId={widgetId}
      subChatId={subChatId}
      resizeConfig={resizeConfig}
      className={className}
    >
      {children}
    </ResizableContent>
  )
})

interface ResizableContentProps {
  widgetId: WidgetId
  subChatId: string
  resizeConfig: WidgetResizeConfig
  children: React.ReactNode
  className?: string
}

const ResizableContent = memo(function ResizableContent({
  widgetId,
  subChatId,
  resizeConfig,
  children,
  className,
}: ResizableContentProps) {
  const [height, setHeight] = useAtom(
    widgetHeightAtomFamily({ subChatId, widgetId })
  )
  const [isResizing, setIsResizing] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)
  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      startYRef.current = e.clientY
      startHeightRef.current = height
    },
    [height]
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!isMountedRef.current) return
      const deltaY = e.clientY - startYRef.current
      let newHeight = startHeightRef.current + deltaY

      // Apply constraints
      newHeight = Math.max(resizeConfig.minHeight, newHeight)
      if (resizeConfig.maxHeight !== undefined) {
        newHeight = Math.min(resizeConfig.maxHeight, newHeight)
      }

      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      if (!isMountedRef.current) return
      setIsResizing(false)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [isResizing, resizeConfig.minHeight, resizeConfig.maxHeight, setHeight])

  return (
    <div
      ref={containerRef}
      className={cn("relative", className)}
      style={{ height }}
    >
      {/* Content fills available space */}
      <div className="h-full overflow-hidden">{children}</div>

      {/* Resize handle at bottom */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize group/resize",
          "flex items-center justify-center",
          "hover:bg-accent/50 transition-colors",
          isResizing && "bg-accent/50"
        )}
      >
        <GripHorizontal
          className={cn(
            "h-3 w-6 text-muted-foreground/30",
            "group-hover/resize:text-muted-foreground/60 transition-colors",
            isResizing && "text-muted-foreground/60"
          )}
        />
      </div>
    </div>
  )
})
