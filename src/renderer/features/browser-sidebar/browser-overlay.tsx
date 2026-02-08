/**
 * Browser Overlay Component v2
 * AI operation visualization with professional cursor animation
 * Lock mode: blocks all user interaction until manually unlocked
 *
 * Features:
 * - Inset box-shadow glow border (single element, no clipping issues)
 * - Mirrored ↗️ cursor with "AI" label
 * - Click press animation (scale down → up)
 * - Refined status bar with minimal chrome
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { useAtomValue } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import {
  browserCurrentActionAtom,
  browserRecentActionsAtom,
  browserCursorPositionAtom,
} from "./atoms"
import { cn } from "@/lib/utils"
import { Unlock } from "lucide-react"
import { useTranslation } from "react-i18next"

interface BrowserOverlayProps {
  active: boolean
  locked?: boolean
  onUnlock?: () => void
  webviewRef?: React.RefObject<Electron.WebviewTag | null>
}

export function BrowserOverlay({
  active,
  locked = false,
  onUnlock,
  webviewRef,
}: BrowserOverlayProps) {
  const currentAction = useAtomValue(browserCurrentActionAtom)
  const recentActions = useAtomValue(browserRecentActionsAtom)
  const cursorPosition = useAtomValue(browserCursorPositionAtom)
  // Track user's mouse position when locked — so the AI cursor follows the user
  const [userMouse, setUserMouse] = useState<{ x: number; y: number } | null>(null)
  const overlayNodeRef = useRef<HTMLDivElement | null>(null)

  // When locked, start tracking user mouse immediately and set initial position to center
  useEffect(() => {
    if (!locked) {
      setUserMouse(null)
      return
    }
    // Initialize cursor at center of overlay so it's visible immediately
    const node = overlayNodeRef.current
    if (node) {
      const rect = node.getBoundingClientRect()
      setUserMouse({ x: rect.width / 2, y: rect.height / 2 })
    }
  }, [locked])

  // Mouse move tracking via useEffect (not callback ref) — properly cleans up
  useEffect(() => {
    const node = overlayNodeRef.current
    if (!node || !locked) return
    const handler = (e: MouseEvent) => {
      const rect = node.getBoundingClientRect()
      setUserMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    }
    node.addEventListener("mousemove", handler)
    return () => node.removeEventListener("mousemove", handler)
  }, [locked])

  /**
   * Convert screen (client/viewport) coordinates to overlay-local coordinates
   * using DOMMatrix inverse. This correctly handles any CSS transforms,
   * status bar offsets, and nested positioning.
   */
  const screenToLocal = useCallback((screenX: number, screenY: number): { x: number; y: number } => {
    const el = overlayNodeRef.current
    if (!el) return { x: screenX, y: screenY }

    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    const matrix = new DOMMatrix(style.transform)

    // Viewport-relative coordinates
    const vx = screenX - rect.x
    const vy = screenY - rect.y

    // Apply inverse matrix for CSS transform compensation
    const inv = matrix.inverse()
    const pt = inv.transformPoint(new DOMPoint(vx, vy))

    return { x: pt.x, y: pt.y }
  }, [])

  // Decide which cursor position to show:
  // - AI operation cursor (from atom) is in screen coordinates — convert via DOMMatrix inverse
  // - User mouse when locked is already in overlay-local space
  const displayCursor = useMemo(() => {
    if (cursorPosition) {
      return screenToLocal(cursorPosition.x, cursorPosition.y)
    }
    return locked ? userMouse : null
  }, [cursorPosition, locked, userMouse, screenToLocal])

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          ref={overlayNodeRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={cn(
            "absolute inset-0 z-50",
            locked ? "pointer-events-auto" : "pointer-events-none"
          )}
        >
          {/* Locked mode: content blocking area (cursor-none only here, below status bar) */}
          {locked && (
            <div className="absolute inset-0 top-8 bg-black/5 cursor-none" />
          )}

          {/* Glow border — inset box-shadow, starts below status bar */}
          <GlowBorder active={!!currentAction} locked={locked} />

          {/* Status bar — z-20 to sit above everything, normal cursor */}
          <StatusBar
            currentAction={currentAction}
            recentActions={recentActions.slice(0, 3)}
            locked={locked}
            onUnlock={onUnlock}
          />

          {/* AI Cursor — z-30 topmost, always visible when locked */}
          {displayCursor && (
            <AICursor position={displayCursor} isOperating={!!cursorPosition} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Glow border — single inset box-shadow element, no clipping issues */
function GlowBorder({ active, locked }: { active: boolean; locked: boolean }) {
  const shadow = locked
    ? "inset 0 0 15px 3px rgba(59,130,246,0.35), inset 0 0 4px 1px rgba(59,130,246,0.6)"
    : "inset 0 0 10px 2px rgba(59,130,246,0.15), inset 0 0 3px 1px rgba(59,130,246,0.3)"

  return (
    <motion.div
      className="absolute inset-0 top-8 pointer-events-none z-10 rounded-[inherit]"
      style={{ boxShadow: shadow }}
      animate={active ? {
        opacity: [0.6, 1, 0.6],
      } : {
        opacity: locked ? 1 : 0.7,
      }}
      transition={active ? {
        duration: 2,
        repeat: Infinity,
        ease: "easeInOut",
      } : { duration: 0.3 }}
    />
  )
}

/** Status bar — minimal, professional, always has normal cursor */
function StatusBar({
  currentAction,
  recentActions,
  locked,
  onUnlock,
}: {
  currentAction: string | null
  recentActions: Array<{ id: string; summary: string }>
  locked: boolean
  onUnlock?: () => void
}) {
  const { t } = useTranslation("common")
  return (
    <motion.div
      initial={{ y: -32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -32, opacity: 0 }}
      className={cn(
        "absolute top-0 left-0 right-0 z-20",
        "h-8 px-3",
        "bg-zinc-900/90 backdrop-blur-md",
        "border-b border-white/[0.06]",
        "flex items-center gap-2",
        locked && "cursor-default"
      )}
    >
      {/* Activity dot */}
      <div className="relative flex items-center justify-center w-4 h-4">
        <motion.div
          className={cn(
            "w-[6px] h-[6px] rounded-full",
            currentAction ? "bg-blue-400" : "bg-blue-400/50"
          )}
          animate={currentAction ? {
            scale: [1, 1.4, 1],
            opacity: [0.8, 1, 0.8],
          } : {}}
          transition={{
            duration: 1.5,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
        {currentAction && (
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ scale: 0.8, opacity: 0.6 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{
              duration: 1.5,
              repeat: Infinity,
              ease: "easeOut",
            }}
          >
            <div className="w-[6px] h-[6px] rounded-full bg-blue-400" />
          </motion.div>
        )}
      </div>

      {/* Current action text */}
      <span className={cn(
        "text-[11px] font-medium tracking-wide",
        currentAction ? "text-white/90" : "text-white/50"
      )}>
        {currentAction || (locked ? t("browser.overlay.aiControlling") : t("browser.overlay.waiting"))}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Recent actions - compact, only when not locked */}
      {!locked && recentActions.length > 0 && (
        <div className="flex gap-1 overflow-hidden">
          {recentActions.map((action) => (
            <span
              key={action.id}
              className="text-[10px] text-white/30 truncate max-w-[100px]"
            >
              {action.summary}
            </span>
          ))}
        </div>
      )}

      {/* Manual unlock button — always pointer cursor */}
      {locked && onUnlock && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onUnlock()
          }}
          className="pointer-events-auto flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-white/70 hover:text-white/90 bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] hover:border-white/[0.15] transition-all cursor-pointer"
        >
          <Unlock className="w-2.5 h-2.5" />
          <span>{t("browser.overlay.takeControl")}</span>
        </button>
      )}
    </motion.div>
  )
}

/** AI cursor — mirrored ↗️ direction, with "AI" label and click press animation */
function AICursor({
  position,
  isOperating = false,
}: {
  position: { x: number; y: number }
  isOperating?: boolean
}) {
  const [isClicking, setIsClicking] = useState(false)
  const [prevPosition, setPrevPosition] = useState(position)

  // Detect "click" by watching for position changes that settle
  const triggerClick = useCallback(() => {
    setIsClicking(true)
    setTimeout(() => setIsClicking(false), 200)
  }, [])

  useEffect(() => {
    // Only trigger click animation during AI operations
    if (!isOperating) return
    const dx = Math.abs(position.x - prevPosition.x)
    const dy = Math.abs(position.y - prevPosition.y)
    if (dx > 5 || dy > 5) {
      const timer = setTimeout(triggerClick, 350)
      setPrevPosition(position)
      return () => clearTimeout(timer)
    }
  }, [position, prevPosition, triggerClick, isOperating])

  return (
    <motion.div
      className="absolute pointer-events-none z-30"
      initial={false}
      animate={{
        x: position.x,
        y: position.y,
      }}
      transition={isOperating ? {
        type: "spring",
        damping: 25,
        stiffness: 400,
        mass: 0.5,
      } : {
        // Follow user mouse instantly
        type: "tween",
        duration: 0,
      }}
    >
      {/* Offset wrapper — aligns mirrored cursor tip with position point */}
      <div style={{ position: "relative", left: -14, top: -1.5 }}>
        {/* Mirrored ↗️ cursor SVG (horizontally flipped path) */}
        <motion.svg
          className="w-[18px] h-[18px]"
          style={{
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))",
            transformOrigin: "77% 8%",
          }}
          animate={isClicking ? {
            scale: [1, 0.75, 1],
          } : {
            scale: 1,
          }}
          transition={{
            duration: 0.2,
            ease: "easeInOut",
          }}
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            d="M18.5 2L18.5 19.5L14.5 15L10 22.5L7.5 21L12 13.5L6 13.5L18.5 2Z"
            fill="#1a1a1a"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>

        {/* "AI" label — trailing the cursor shaft (lower-left of ↗️ cursor) */}
        <div
          className="absolute flex items-center gap-0.5 px-[3px] py-[1px] rounded-sm bg-blue-500/90 backdrop-blur-sm"
          style={{
            left: -4,
            top: 17,
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))",
          }}
        >
          <span className="text-[8px] font-bold text-white leading-none tracking-wider">AI</span>
        </div>

        {/* Click ripple — only during AI operations */}
        <AnimatePresence>
          {isClicking && (
            <motion.div
              className="absolute pointer-events-none"
              style={{ top: 1.5, left: 14 }}
              initial={{ scale: 0, opacity: 0.5 }}
              animate={{ scale: 2.5, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            >
              <div className="w-4 h-4 rounded-full border border-blue-400/60 -translate-x-1/2 -translate-y-1/2" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
