import { useAtom } from "jotai"
import { useEffect, useState, useCallback } from "react"
import { Play, Upload, RotateCcw, Bell } from "lucide-react"
import {
  alwaysShowNotificationsAtom,
  customNotificationSoundAtom,
  soundNotificationsEnabledAtom,
} from "../../../lib/atoms"
import { Switch } from "../../ui/switch"
import { Button } from "../../ui/button"
import { appStore } from "../../../lib/jotai-store"

// Hook to detect narrow screen
function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth <= 768)
    }

    checkWidth()
    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [])

  return isNarrow
}

/**
 * Play notification sound (respects custom sound setting)
 */
function playSound(customPath: string | null) {
  const soundSrc = customPath
    ? `local-file://${customPath}`
    : "./sound.mp3"

  try {
    const audio = new Audio(soundSrc)
    audio.volume = 1.0
    audio.play().catch((err) => {
      console.error("Failed to play sound:", err)
    })
  } catch (err) {
    console.error("Failed to create audio:", err)
  }
}

export function AgentsNotificationsTab() {
  const [soundEnabled, setSoundEnabled] = useAtom(soundNotificationsEnabledAtom)
  const [alwaysShowNotifications, setAlwaysShowNotifications] = useAtom(
    alwaysShowNotificationsAtom,
  )
  const [customSound, setCustomSound] = useAtom(customNotificationSoundAtom)
  const isNarrowScreen = useIsNarrowScreen()

  // Handle selecting a custom sound file
  const handleSelectSound = useCallback(async () => {
    if (!window.desktopApi?.selectAudioFile) {
      console.error("selectAudioFile not available")
      return
    }

    const filePath = await window.desktopApi.selectAudioFile()
    if (filePath) {
      setCustomSound(filePath)
    }
  }, [setCustomSound])

  // Handle resetting to default sound
  const handleResetSound = useCallback(() => {
    setCustomSound(null)
  }, [setCustomSound])

  // Handle testing the sound
  const handleTestSound = useCallback(() => {
    playSound(customSound)
  }, [customSound])

  // Handle testing the notification
  const handleTestNotification = useCallback(() => {
    // Play sound
    const isSoundEnabled = appStore.get(soundNotificationsEnabledAtom)
    if (isSoundEnabled) {
      playSound(customSound)
    }

    // Show notification
    window.desktopApi?.showNotification({
      title: "Test Notification",
      body: "This is a test notification from 1Code",
    })
  }, [customSound])

  // Get display name for current sound
  const soundDisplayName = customSound
    ? customSound.split("/").pop() || customSound
    : "Default sound"

  return (
    <div className="p-6 space-y-6">
      {/* Header - hidden on narrow screens since it's in the navigation bar */}
      {!isNarrowScreen && (
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          <p className="text-xs text-muted-foreground">
            Configure notification sounds and behavior
          </p>
        </div>
      )}

      {/* Sound Section */}
      <div className="space-y-2">
        <div className="pb-2">
          <h4 className="text-sm font-medium text-foreground">Sound</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Configure notification sounds
          </p>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="p-4 space-y-6">
            {/* Sound Notifications Toggle */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col space-y-1">
                <span className="text-sm font-medium text-foreground">
                  Sound Notifications
                </span>
                <span className="text-xs text-muted-foreground">
                  Play a sound when agent completes work, encounters an error, or needs input
                </span>
              </div>
              <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
            </div>

            {/* Custom Sound Selector */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col space-y-1 flex-1 mr-4">
                <span className="text-sm font-medium text-foreground">
                  Notification Sound
                </span>
                <span className="text-xs text-muted-foreground truncate max-w-[200px]" title={customSound || undefined}>
                  {soundDisplayName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectSound}
                  className="h-8 text-xs"
                >
                  <Upload className="w-3.5 h-3.5 mr-1.5" />
                  Choose
                </Button>
                {customSound && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetSound}
                    className="h-8 text-xs"
                    title="Reset to default"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Test Sound Button */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestSound}
                disabled={!soundEnabled}
                className="h-8 text-xs"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" />
                Test Sound
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* System Notifications Section */}
      <div className="space-y-2">
        <div className="pb-2">
          <h4 className="text-sm font-medium text-foreground">System Notifications</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Configure when system notifications appear
          </p>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="p-4 space-y-6">
            {/* Always Show Notifications Toggle */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col space-y-1">
                <span className="text-sm font-medium text-foreground">
                  Always Show Notifications
                </span>
                <span className="text-xs text-muted-foreground">
                  Show system notifications even when the app is focused
                </span>
              </div>
              <Switch
                checked={alwaysShowNotifications}
                onCheckedChange={setAlwaysShowNotifications}
              />
            </div>

            {/* Test Notification Button */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestNotification}
                className="h-8 text-xs"
              >
                <Bell className="w-3.5 h-3.5 mr-1.5" />
                Test Notification
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
