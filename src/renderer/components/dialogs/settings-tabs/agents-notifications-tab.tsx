import { useAtom } from "jotai"
import { useEffect, useState, useCallback, useRef } from "react"
import { Play, Square, Upload, Bell, Volume2 } from "lucide-react"
import {
  alwaysShowNotificationsAtom,
  customNotificationSoundAtom,
  soundNotificationsEnabledAtom,
  notificationVolumeAtom,
} from "../../../lib/atoms"
import { resolveNotificationSoundSrc } from "../../../features/sidebar/hooks/use-desktop-notifications"
import { Switch } from "../../ui/switch"
import { Button } from "../../ui/button"
import { appStore } from "../../../lib/jotai-store"
import { cn } from "../../../lib/utils"

// Built-in sound definitions
const BUILTIN_SOUNDS = [
  { id: null, label: "Default", labelZh: "默认" },
  { id: "builtin:abstract-sound1", label: "Abstract 1", labelZh: "科技音 1" },
  { id: "builtin:abstract-sound2", label: "Abstract 2", labelZh: "科技音 2" },
  { id: "builtin:abstract-sound3", label: "Abstract 3", labelZh: "科技音 3" },
  { id: "builtin:abstract-sound4", label: "Abstract 4", labelZh: "科技音 4" },
  { id: "builtin:phone-vibration", label: "Phone Vibration", labelZh: "手机震动" },
  { id: "builtin:cow-mooing", label: "Cow Mooing", labelZh: "哞~" },
  { id: "builtin:rooster", label: "Rooster", labelZh: "公鸡打鸣" },
] as const

type BuiltinSoundId = (typeof BUILTIN_SOUNDS)[number]["id"]

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
 * Play a specific sound with given volume. Returns a stop function.
 */
function previewSound(soundId: string | null, volume: number): () => void {
  const soundSrc = resolveNotificationSoundSrc(soundId)

  try {
    const audio = new Audio(soundSrc)
    audio.volume = Math.max(0, Math.min(1, volume))
    audio.play().catch((err) => {
      console.error("Failed to play sound:", err)
    })
    return () => {
      audio.pause()
      audio.currentTime = 0
    }
  } catch (err) {
    console.error("Failed to create audio:", err)
    return () => {}
  }
}

/**
 * Determine if the current sound selection is a custom file (not null, not builtin:*)
 */
function isCustomFile(soundId: string | null): boolean {
  return soundId !== null && !soundId.startsWith("builtin:")
}

/**
 * Get display name for a custom file path
 */
function getCustomFileName(path: string): string {
  return path.split("/").pop() || path
}

export function AgentsNotificationsTab() {
  const [soundEnabled, setSoundEnabled] = useAtom(soundNotificationsEnabledAtom)
  const [alwaysShowNotifications, setAlwaysShowNotifications] = useAtom(
    alwaysShowNotificationsAtom,
  )
  const [selectedSound, setSelectedSound] = useAtom(customNotificationSoundAtom)
  const [volume, setVolume] = useAtom(notificationVolumeAtom)
  const isNarrowScreen = useIsNarrowScreen()

  // Track which sound is currently playing for preview
  const [playingId, setPlayingId] = useState<string | null | undefined>(undefined)
  const stopRef = useRef<(() => void) | null>(null)

  // Stop any playing preview
  const stopPreview = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    setPlayingId(undefined)
  }, [])

  // Preview a sound
  const handlePreview = useCallback(
    (soundId: string | null) => {
      // If same sound is playing, stop it
      if (playingId === soundId) {
        stopPreview()
        return
      }

      // Stop previous
      stopRef.current?.()

      const stop = previewSound(soundId, volume)
      stopRef.current = stop
      setPlayingId(soundId)

      // Auto-clear playing state after a reasonable duration
      setTimeout(() => {
        setPlayingId((current) => (current === soundId ? undefined : current))
      }, 3000)
    },
    [playingId, volume, stopPreview],
  )

  // Select a built-in sound
  const handleSelectBuiltin = useCallback(
    (id: BuiltinSoundId) => {
      setSelectedSound(id)
    },
    [setSelectedSound],
  )

  // Select a custom sound file
  const handleSelectCustomFile = useCallback(async () => {
    if (!window.desktopApi?.selectAudioFile) {
      console.error("selectAudioFile not available")
      return
    }

    const filePath = await window.desktopApi.selectAudioFile()
    if (filePath) {
      setSelectedSound(filePath)
    }
  }, [setSelectedSound])

  // Test notification
  const handleTestNotification = useCallback(() => {
    const isSoundEnabled = appStore.get(soundNotificationsEnabledAtom)
    if (isSoundEnabled) {
      previewSound(selectedSound, volume)
    }

    window.desktopApi?.showNotification({
      title: "Test Notification",
      body: "This is a test notification from Hóng",
    })
  }, [selectedSound, volume])

  // Check if current selection is a custom file
  const hasCustomFile = isCustomFile(selectedSound)

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header */}
      {!isNarrowScreen && (
        <div className="flex flex-col gap-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          <p className="text-xs text-muted-foreground">
            Configure notification sounds and behavior
          </p>
        </div>
      )}

      {/* Sound Section */}
      <div className="flex flex-col gap-2">
        <div className="pb-2">
          <h4 className="text-sm font-medium text-foreground">Sound</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Configure notification sounds
          </p>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="p-4 flex flex-col gap-5">
            {/* Sound Notifications Toggle */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium text-foreground">
                  Sound Notifications
                </span>
                <span className="text-xs text-muted-foreground">
                  Play a sound when agent completes work, encounters an error, or needs input
                </span>
              </div>
              <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
            </div>

            {/* Sound Picker */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">
                Notification Sound
              </span>

              <div className="flex flex-col rounded-md border border-border overflow-hidden">
                {/* Built-in sounds */}
                {BUILTIN_SOUNDS.map((sound, index) => {
                  const isSelected =
                    sound.id === null
                      ? selectedSound === null || selectedSound === undefined
                      : selectedSound === sound.id
                  const isPlaying = playingId === sound.id

                  return (
                    <div
                      key={sound.id ?? "default"}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors",
                        "hover:bg-accent/50",
                        isSelected && "bg-accent",
                        index > 0 && "border-t border-border",
                      )}
                      onClick={() => handleSelectBuiltin(sound.id)}
                    >
                      {/* Radio indicator */}
                      <div
                        className={cn(
                          "w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                          isSelected
                            ? "border-primary"
                            : "border-muted-foreground/40",
                        )}
                      >
                        {isSelected && (
                          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                        )}
                      </div>

                      {/* Label */}
                      <span className="text-sm text-foreground flex-1">
                        {sound.label}
                      </span>

                      {/* Preview button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePreview(sound.id)
                        }}
                        className={cn(
                          "w-6 h-6 flex items-center justify-center rounded hover:bg-accent-foreground/10 text-muted-foreground hover:text-foreground transition-colors",
                          isPlaying && "text-primary",
                        )}
                        disabled={!soundEnabled}
                      >
                        {isPlaying ? (
                          <Square className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  )
                })}

                {/* Separator + Custom sound option */}
                <div
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors border-t border-border",
                    "hover:bg-accent/50",
                    hasCustomFile && "bg-accent",
                  )}
                  onClick={() => {
                    if (!hasCustomFile) handleSelectCustomFile()
                  }}
                >
                  {/* Radio indicator */}
                  <div
                    className={cn(
                      "w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                      hasCustomFile
                        ? "border-primary"
                        : "border-muted-foreground/40",
                    )}
                  >
                    {hasCustomFile && (
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                    )}
                  </div>

                  {/* Label + file name */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm text-foreground">Custom</span>
                    {hasCustomFile && selectedSound && (
                      <span
                        className="text-xs text-muted-foreground truncate"
                        title={selectedSound}
                      >
                        {getCustomFileName(selectedSound)}
                      </span>
                    )}
                  </div>

                  {/* Preview + Choose buttons */}
                  <div className="flex items-center gap-1.5">
                    {hasCustomFile && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePreview(selectedSound)
                        }}
                        className={cn(
                          "w-6 h-6 flex items-center justify-center rounded hover:bg-accent-foreground/10 text-muted-foreground hover:text-foreground transition-colors",
                          playingId === selectedSound && "text-primary",
                        )}
                        disabled={!soundEnabled}
                      >
                        {playingId === selectedSound ? (
                          <Square className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                      </button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleSelectCustomFile()
                      }}
                      className="h-6 text-xs px-2"
                    >
                      <Upload className="w-3 h-3 mr-1" />
                      Choose
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Volume Slider */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                  <Volume2 className="w-3.5 h-3.5" />
                  Volume
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                disabled={!soundEnabled}
                className="w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* System Notifications Section */}
      <div className="flex flex-col gap-2">
        <div className="pb-2">
          <h4 className="text-sm font-medium text-foreground">System Notifications</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Configure when system notifications appear
          </p>
        </div>

        <div className="bg-background rounded-lg border border-border overflow-hidden">
          <div className="p-4 flex flex-col gap-6">
            {/* Always Show Notifications Toggle */}
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
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
