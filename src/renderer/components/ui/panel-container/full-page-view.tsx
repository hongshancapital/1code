"use client"

import { useEffect, useCallback } from "react"
import { AnimatePresence, motion } from "motion/react"

interface FullPageViewProps {
  isOpen: boolean
  onClose: () => void
  children: React.ReactNode
}

export function FullPageView({
  isOpen,
  onClose,
  children,
}: FullPageViewProps) {
  // Hide traffic lights when full-page view is open
  useEffect(() => {
    if (typeof window === "undefined" || !window.desktopApi?.setTrafficLightVisibility) return

    if (isOpen) {
      window.desktopApi.setTrafficLightVisibility(false)
      return () => {
        // Restore traffic lights when closing
        window.desktopApi?.setTrafficLightVisibility(true)
      }
    }
  }, [isOpen])

  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown)
      return () => document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isOpen, handleKeyDown])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-0 z-50 bg-background flex flex-col"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
