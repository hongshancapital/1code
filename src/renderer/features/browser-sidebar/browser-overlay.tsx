/**
 * Browser Overlay Component
 * AI operation visualization with cursor animation
 */

import { useAtomValue } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import {
  browserCurrentActionAtom,
  browserRecentActionsAtom,
  browserCursorPositionAtom,
} from "./atoms"
import { cn } from "@/lib/utils"

interface BrowserOverlayProps {
  active: boolean
}

export function BrowserOverlay({ active }: BrowserOverlayProps) {
  const currentAction = useAtomValue(browserCurrentActionAtom)
  const recentActions = useAtomValue(browserRecentActionsAtom)
  const cursorPosition = useAtomValue(browserCursorPositionAtom)

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 pointer-events-none z-50"
        >
          {/* Edge glow effect */}
          <div
            className={cn(
              "absolute inset-0",
              "border-2 border-blue-500/40",
              "shadow-[inset_0_0_20px_rgba(59,130,246,0.2)]",
              "animate-pulse"
            )}
          />

          {/* Status bar */}
          <StatusBar
            currentAction={currentAction}
            recentActions={recentActions.slice(0, 3)}
          />

          {/* AI Cursor */}
          {cursorPosition && (
            <AICursor position={cursorPosition} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Status bar showing current action */
function StatusBar({
  currentAction,
  recentActions,
}: {
  currentAction: string | null
  recentActions: Array<{ id: string; summary: string }>
}) {
  return (
    <motion.div
      initial={{ y: -40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -40, opacity: 0 }}
      className={cn(
        "absolute top-0 left-0 right-0",
        "h-10 px-4",
        "bg-gray-900/90 backdrop-blur-sm",
        "border-b border-blue-500/30",
        "flex items-center gap-3"
      )}
    >
      {/* Activity indicator */}
      <div className="relative">
        <div className="w-2 h-2 rounded-full bg-blue-500" />
        <div className="absolute inset-0 w-2 h-2 rounded-full bg-blue-500 animate-ping" />
      </div>

      {/* Current action */}
      <span className="text-white text-sm font-medium">
        {currentAction || "AI is operating..."}
      </span>

      {/* Recent actions */}
      <div className="flex-1 flex justify-end gap-2 overflow-hidden">
        {recentActions.map((action) => (
          <span
            key={action.id}
            className="text-gray-400 text-xs truncate max-w-[150px]"
          >
            {action.summary}
          </span>
        ))}
      </div>
    </motion.div>
  )
}

/** AI cursor - mirrored from user's cursor */
function AICursor({
  position,
}: {
  position: { x: number; y: number }
}) {
  return (
    <motion.div
      className="absolute pointer-events-none"
      initial={false}
      animate={{
        x: position.x,
        y: position.y + 40, // Offset for status bar
      }}
      transition={{
        type: "spring",
        damping: 20,
        stiffness: 300,
      }}
    >
      {/* Cursor icon - mirrored (flipped horizontally) */}
      <svg
        className="w-5 h-5 -translate-x-1/2 -translate-y-1/2"
        style={{
          transform: "scaleX(-1)", // Mirror horizontally
          filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.3))",
        }}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M5 2L5 19L9 15L13 22L16 21L12 14L18 14L5 2Z"
          fill="#60A5FA"
          stroke="#3B82F6"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Click ripple effect */}
      <ClickRipple />
    </motion.div>
  )
}

/** Click ripple animation */
function ClickRipple() {
  return (
    <motion.div
      className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2"
      initial={{ scale: 0, opacity: 0.8 }}
      animate={{ scale: 2, opacity: 0 }}
      transition={{
        duration: 0.5,
        ease: "easeOut",
      }}
    >
      <div className="w-6 h-6 rounded-full bg-blue-500/50" />
    </motion.div>
  )
}
