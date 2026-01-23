"use client"

import { useAtom, type WritableAtom } from "jotai"
import { AnimatePresence, motion } from "motion/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"

interface ResizableBottomPanelProps {
  isOpen: boolean
  onClose: () => void
  heightAtom: WritableAtom<number, [number], void>
  minHeight?: number
  maxHeight?: number
  animationDuration?: number
  children: React.ReactNode
  className?: string
  initialHeight?: number | string
  exitHeight?: number | string
  /** Custom styles for the panel container */
  style?: React.CSSProperties
}

const DEFAULT_MIN_HEIGHT = 100
const DEFAULT_MAX_HEIGHT = 600
const DEFAULT_ANIMATION_DURATION = 0 // Disabled for performance
const EXTENDED_HOVER_AREA_HEIGHT = 8

export function ResizableBottomPanel({
  isOpen,
  onClose,
  heightAtom,
  minHeight = DEFAULT_MIN_HEIGHT,
  maxHeight = DEFAULT_MAX_HEIGHT,
  animationDuration = DEFAULT_ANIMATION_DURATION,
  children,
  className = "",
  initialHeight = 0,
  exitHeight = 0,
  style,
}: ResizableBottomPanelProps) {
  const [panelHeight, setPanelHeight] = useAtom(heightAtom)

  // Track if this is the first open to avoid initial animation when already open
  const hasOpenedOnce = useRef(false)
  const wasOpenRef = useRef(false)
  const [shouldAnimate, setShouldAnimate] = useState(!isOpen)

  // Resize handle state
  const [isResizing, setIsResizing] = useState(false)
  const resizeHandleRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Local height state for smooth resizing (avoids localStorage sync during resize)
  const [localHeight, setLocalHeight] = useState<number | null>(null)

  // Use local height during resize, otherwise use persisted height
  const currentHeight = localHeight ?? panelHeight

  useEffect(() => {
    // When panel closes, reset hasOpenedOnce so animation plays on next open
    if (!isOpen && wasOpenRef.current) {
      hasOpenedOnce.current = false
      setShouldAnimate(true)
      // Clear local height when panel closes
      setLocalHeight(null)
    }
    wasOpenRef.current = isOpen

    // Mark as opened after animation completes
    if (isOpen && !hasOpenedOnce.current) {
      const timer = setTimeout(
        () => {
          hasOpenedOnce.current = true
          setShouldAnimate(false)
        },
        animationDuration * 1000 + 50,
      )
      return () => clearTimeout(timer)
    } else if (isOpen && hasOpenedOnce.current) {
      // Already opened before, don't animate
      setShouldAnimate(false)
    }
  }, [isOpen, animationDuration])

  const handleClose = useCallback(() => {
    // Reset resizing state synchronously so exit animation sees the final height
    flushSync(() => {
      if (isResizing) {
        setIsResizing(false)
      }
      if (localHeight !== null) {
        setLocalHeight(null)
      }
    })
    // Ensure animation is enabled when closing
    setShouldAnimate(true)
    // Close panel - this will trigger exit animation via AnimatePresence
    onClose()
  }, [onClose, isResizing, localHeight])

  // Handle resize interactions
  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      const startY = event.clientY
      const startHeight = panelHeight
      const pointerId = event.pointerId
      let hasMoved = false
      let currentLocalHeight: number | null = null

      const handleElement =
        resizeHandleRef.current ?? (event.currentTarget as HTMLElement)

      const clampHeight = (height: number) =>
        Math.max(minHeight, Math.min(maxHeight, height))

      handleElement.setPointerCapture?.(pointerId)
      setIsResizing(true)

      const updateHeight = (clientY: number) => {
        // Moving up (negative delta) increases height
        const delta = startY - clientY
        const newHeight = clampHeight(startHeight + delta)
        currentLocalHeight = newHeight
        // Use local state for smooth real-time updates during resize
        setLocalHeight(newHeight)
      }

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        const delta = Math.abs(startY - pointerEvent.clientY)
        if (!hasMoved && delta >= 3) {
          hasMoved = true
        }

        if (hasMoved) {
          // Update height immediately for real-time resize
          updateHeight(pointerEvent.clientY)
        }
      }

      const finishResize = (pointerEvent?: PointerEvent) => {
        if (handleElement.hasPointerCapture?.(pointerId)) {
          handleElement.releasePointerCapture(pointerId)
        }

        document.removeEventListener("pointermove", handlePointerMove)
        document.removeEventListener("pointerup", handlePointerUp)
        document.removeEventListener("pointercancel", handlePointerCancel)
        setIsResizing(false)

        if (hasMoved && pointerEvent) {
          const delta = startY - pointerEvent.clientY
          const finalHeight = clampHeight(startHeight + delta)
          // Save final height to persisted atom (triggers localStorage sync)
          setPanelHeight(finalHeight)
          // Clear local height to use persisted value
          setLocalHeight(null)
        } else {
          // If no pointer event but resize was happening, save current local height
          if (currentLocalHeight !== null) {
            setPanelHeight(currentLocalHeight)
            setLocalHeight(null)
          }
        }
      }

      const handlePointerUp = (pointerEvent: PointerEvent) => {
        finishResize(pointerEvent)
      }

      const handlePointerCancel = () => {
        finishResize()
      }

      document.addEventListener("pointermove", handlePointerMove)
      document.addEventListener("pointerup", handlePointerUp, { once: true })
      document.addEventListener("pointercancel", handlePointerCancel, {
        once: true,
      })
    },
    [panelHeight, setPanelHeight, minHeight, maxHeight],
  )

  // Resize handle style (top edge)
  const resizeHandleStyle = useMemo(() => {
    return {
      top: "0px",
      left: "0px",
      right: "0px",
      height: "4px",
      marginTop: "-2px",
    }
  }, [])

  const extendedHoverAreaStyle = useMemo(() => {
    return {
      height: `${EXTENDED_HOVER_AREA_HEIGHT}px`,
      top: "0px",
      left: "0px",
      right: "0px",
    }
  }, [])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={
            !shouldAnimate
              ? {
                  height: currentHeight,
                  opacity: 1,
                }
              : {
                  height: initialHeight,
                  opacity: 0,
                }
          }
          animate={{
            height: currentHeight,
            opacity: 1,
          }}
          exit={{
            height: exitHeight,
            opacity: 0,
          }}
          transition={{
            duration: isResizing ? 0 : animationDuration,
            ease: [0.4, 0, 0.2, 1],
          }}
          className={`bg-transparent flex flex-col text-xs w-full relative flex-shrink-0 ${className}`}
          style={{ minHeight: minHeight, overflow: "hidden", ...style }}
        >
          {/* Extended hover area */}
          <div
            data-extended-hover-area
            className="absolute cursor-row-resize"
            style={{
              ...extendedHoverAreaStyle,
              pointerEvents: isResizing ? "none" : "auto",
              zIndex: isResizing ? 5 : 10,
            }}
            onPointerDown={handleResizePointerDown}
          />

          {/* Resize Handle */}
          <div
            ref={resizeHandleRef}
            onPointerDown={handleResizePointerDown}
            className="absolute cursor-row-resize z-10"
            style={resizeHandleStyle}
          />

          {/* Children content */}
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
