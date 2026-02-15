"use client"

import { useEffect, useRef, useCallback } from "react"
import { useAtom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { isDesktopApp } from "../../../lib/utils/platform"
import { alwaysShowNotificationsAtom, customNotificationSoundAtom, soundNotificationsEnabledAtom, notificationVolumeAtom } from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { createLogger } from "../../../lib/logger"

const log = createLogger("useDesktopNotifications")


// Track pending notifications count for badge
const pendingNotificationsAtom = atomWithStorage<number>(
  "desktop-pending-notifications",
  0,
)

// Notification types for different scenarios
export type NotificationType = "complete" | "error" | "user-input-required"

// Notification config for each type
const notificationConfig: Record<NotificationType, { title: string; getBody: (name: string) => string }> = {
  complete: {
    title: "Agent finished",
    getBody: (name) => `${name} completed the task`,
  },
  error: {
    title: "Agent failed",
    getBody: (name) => `${name} encountered an error`,
  },
  "user-input-required": {
    title: "Input required",
    getBody: (name) => `${name} needs your input`,
  },
}

/**
 * Resolve sound identifier to a playable audio source URL.
 *   null             → "./sound.mp3"          (default)
 *   "builtin:name"   → "./sounds/name.wav"    (built-in)
 *   "/abs/path/..."  → "local-file://..."     (custom file)
 */
export function resolveNotificationSoundSrc(soundId: string | null): string {
  if (!soundId) return "./sound.mp3"
  if (soundId.startsWith("builtin:")) {
    const name = soundId.slice("builtin:".length)
    return `./sounds/${name}.wav`
  }
  const normalizedPath = soundId.startsWith("/") ? soundId : `/${soundId}`
  return `local-file://localhost${normalizedPath}`
}

/**
 * Play notification sound if enabled in settings
 * Supports built-in sounds, custom file path, and volume control
 */
function playNotificationSound() {
  const isSoundEnabled = appStore.get(soundNotificationsEnabledAtom)
  if (!isSoundEnabled) return

  const soundId = appStore.get(customNotificationSoundAtom)
  const volume = appStore.get(notificationVolumeAtom)
  const soundSrc = resolveNotificationSoundSrc(soundId)

  try {
    const audio = new Audio(soundSrc)
    audio.volume = Math.max(0, Math.min(1, volume))
    audio.play().catch((err) => {
      log.error("Failed to play notification sound:", err)
    })
  } catch (err) {
    log.error("Failed to create audio:", err)
  }
}

// Track window focus state
let isWindowFocused = true

/**
 * Generate a badge icon image for Windows taskbar overlay
 * Creates a 32x32 canvas with a red circle and white number
 */
function generateBadgeIcon(count: number): string {
  const size = 32
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext("2d")

  if (!ctx) return ""

  // Draw red circle background
  ctx.fillStyle = "#FF4444"
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fill()

  // Draw white border
  ctx.strokeStyle = "#FFFFFF"
  ctx.lineWidth = 2
  ctx.stroke()

  // Draw white number text
  ctx.fillStyle = "#FFFFFF"
  ctx.font = "bold 18px Arial"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"

  // Format count (show "9+" if > 9)
  const displayText = count > 9 ? "9+" : String(count)
  ctx.fillText(displayText, size / 2, size / 2)

  return canvas.toDataURL("image/png")
}

/**
 * Hook to manage desktop notifications and badge count
 * - Shows native notifications when window is not focused
 * - Updates dock badge with pending notification count
 * - Clears badge when window regains focus
 */
export function useDesktopNotifications() {
  const [pendingCount, setPendingCount] = useAtom(pendingNotificationsAtom)
  const isInitialized = useRef(false)

  // Subscribe to window focus changes
  useEffect(() => {
    if (!isDesktopApp() || typeof window === "undefined") return

    // Initialize focus state
    isWindowFocused = document.hasFocus()

    const handleFocus = () => {
      isWindowFocused = true
      // Clear badge when window gains focus
      setPendingCount(0)
      window.desktopApi?.setBadge(null)
    }

    const handleBlur = () => {
      isWindowFocused = false
    }

    // Use both window events and Electron API
    window.addEventListener("focus", handleFocus)
    window.addEventListener("blur", handleBlur)

    // Also subscribe to Electron focus events
    const unsubscribe = window.desktopApi?.onFocusChange?.((focused) => {
      if (focused) {
        handleFocus()
      } else {
        handleBlur()
      }
    })

    isInitialized.current = true

    return () => {
      window.removeEventListener("focus", handleFocus)
      window.removeEventListener("blur-sm", handleBlur)
      unsubscribe?.()
    }
  }, [setPendingCount])

  // Update badge when pending count changes
  useEffect(() => {
    if (!isDesktopApp() || typeof window === "undefined") return

    if (pendingCount > 0) {
      window.desktopApi?.setBadge(pendingCount)

      // Windows: Generate and set overlay icon with badge number
      if (window.desktopApi?.platform === "win32" && window.desktopApi?.setBadgeIcon) {
        const badgeImage = generateBadgeIcon(pendingCount)
        window.desktopApi.setBadgeIcon(badgeImage)
      }
    } else {
      window.desktopApi?.setBadge(null)
      // Clear overlay icon on Windows
      if (window.desktopApi?.platform === "win32" && window.desktopApi?.setBadgeIcon) {
        window.desktopApi.setBadgeIcon(null)
      }
    }
  }, [pendingCount])

  /**
   * Show a notification with optional sound
   * Notification is only shown when window is not focused
   * Sound behavior:
   * - user-input-required: always plays sound (needs immediate attention)
   * - error: always plays sound (important to know about failures)
   * - complete: caller controls via playSound parameter (to avoid double-playing)
   */
  const notify = useCallback(
    (agentName: string, type: NotificationType = "complete", playSound: boolean = false) => {
      if (!isDesktopApp() || typeof window === "undefined") return

      const config = notificationConfig[type]

      // user-input-required and error need immediate attention, always play sound
      // complete: caller controls via playSound parameter
      const shouldPlaySound = type === "user-input-required" || type === "error" || playSound
      if (shouldPlaySound) {
        playNotificationSound()
      }

      // Check if we should show notification based on settings and focus state
      const alwaysShow = appStore.get(alwaysShowNotificationsAtom)
      const shouldShowNotification = alwaysShow || !isWindowFocused

      if (shouldShowNotification) {
        // Increment badge count
        setPendingCount((prev) => prev + 1)

        // Show native notification
        window.desktopApi?.showNotification({
          title: config.title,
          body: config.getBody(agentName),
        })
      }
    },
    [setPendingCount],
  )

  /**
   * Show a notification for agent completion
   * Sound is NOT played by this function - caller should handle sound separately
   * Only shows notification if window is not focused (in desktop app)
   */
  const notifyAgentComplete = useCallback(
    (agentName: string) => {
      notify(agentName, "complete", false)
    },
    [notify],
  )

  /**
   * Show a notification for agent error/failure
   * Always plays sound (important to know about failures)
   * Only shows notification if window is not focused
   */
  const notifyAgentError = useCallback(
    (agentName: string) => {
      notify(agentName, "error")
    },
    [notify],
  )

  /**
   * Show a notification when user input is required
   * Always plays sound (needs immediate user attention)
   * Only shows notification if window is not focused
   */
  const notifyUserInputRequired = useCallback(
    (agentName: string) => {
      notify(agentName, "user-input-required")
    },
    [notify],
  )

  /**
   * Check if window is currently focused
   */
  const isAppFocused = useCallback(() => {
    return isWindowFocused
  }, [])

  return {
    notify,
    notifyAgentComplete,
    notifyAgentError,
    notifyUserInputRequired,
    isAppFocused,
    pendingCount,
    clearBadge: () => {
      setPendingCount(0)
      window.desktopApi?.setBadge(null)
    },
  }
}

/**
 * Standalone function to show notification with sound (for use outside React components)
 * Sound behavior:
 * - user-input-required: always plays sound (needs immediate attention)
 * - error: always plays sound (important to know about failures)
 * - complete: only plays sound if playSound=true
 */
export function showAgentNotification(agentName: string, type: NotificationType = "complete", playSound: boolean = false) {
  if (!isDesktopApp() || typeof window === "undefined") return

  const config = notificationConfig[type]
  const isFocused = document.hasFocus()

  // user-input-required and error need immediate attention, always play sound
  // complete: caller controls via playSound parameter
  const shouldPlaySound = type === "user-input-required" || type === "error" || playSound
  if (shouldPlaySound) {
    playNotificationSound()
  }

  // Check if we should show notification based on settings and focus state
  const alwaysShow = appStore.get(alwaysShowNotificationsAtom)
  const shouldShowNotification = alwaysShow || !isFocused

  if (shouldShowNotification) {
    window.desktopApi?.showNotification({
      title: config.title,
      body: config.getBody(agentName),
    })
  }
}

/**
 * Standalone function to show error notification with sound
 */
export function showAgentErrorNotification(agentName: string) {
  showAgentNotification(agentName, "error")
}

/**
 * Standalone function to show user input required notification with sound
 */
export function showUserInputRequiredNotification(agentName: string) {
  showAgentNotification(agentName, "user-input-required")
}
