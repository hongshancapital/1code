import { useAtom } from "jotai"
import { useEffect, useState, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import {
  askUserQuestionTimeoutAtom,
  autoAdvanceTargetAtom,
  ctrlTabTargetAtom,
  customNotificationSoundAtom,
  defaultAgentModeAtom,
  desktopNotificationsEnabledAtom,
  extendedThinkingEnabledAtom,
  languagePreferenceAtom,
  notificationVolumeAtom,
  soundNotificationsEnabledAtom,
  preferredEditorAtom,
  perTypeSoundEnabledAtom,
  completeSoundAtom,
  errorSoundAtom,
  userInputSoundAtom,
  type AgentMode,
  type AskUserQuestionTimeout,
  type AutoAdvanceTarget,
  type CtrlTabTarget,
  type LanguagePreference,
} from "../../../lib/atoms"
import { APP_META, type ExternalApp } from "../../../../shared/external-apps"

// Editor icon imports
import cursorIcon from "../../../assets/app-icons/cursor.svg"
import vscodeIcon from "../../../assets/app-icons/vscode.svg"
import vscodeInsidersIcon from "../../../assets/app-icons/vscode-insiders.svg"
import zedIcon from "../../../assets/app-icons/zed.png"
import sublimeIcon from "../../../assets/app-icons/sublime.svg"
import xcodeIcon from "../../../assets/app-icons/xcode.svg"
import intellijIcon from "../../../assets/app-icons/intellij.svg"
import webstormIcon from "../../../assets/app-icons/webstorm.svg"
import pycharmIcon from "../../../assets/app-icons/pycharm.svg"
import phpstormIcon from "../../../assets/app-icons/phpstorm.svg"
import golandIcon from "../../../assets/app-icons/goland.svg"
import clionIcon from "../../../assets/app-icons/clion.svg"
import riderIcon from "../../../assets/app-icons/rider.svg"
import fleetIcon from "../../../assets/app-icons/fleet.svg"
import rustroverIcon from "../../../assets/app-icons/rustrover.svg"
import windsurfIcon from "../../../assets/app-icons/windsurf.svg"
import traeIcon from "../../../assets/app-icons/trae.svg"
import itermIcon from "../../../assets/app-icons/iterm.png"
import warpIcon from "../../../assets/app-icons/warp.png"
import terminalIcon from "../../../assets/app-icons/terminal.png"
import ghosttyIcon from "../../../assets/app-icons/ghostty.svg"

const EDITOR_ICONS: Partial<Record<ExternalApp, string>> = {
  cursor: cursorIcon,
  vscode: vscodeIcon,
  "vscode-insiders": vscodeInsidersIcon,
  zed: zedIcon,
  windsurf: windsurfIcon,
  sublime: sublimeIcon,
  xcode: xcodeIcon,
  trae: traeIcon,
  iterm: itermIcon,
  warp: warpIcon,
  terminal: terminalIcon,
  ghostty: ghosttyIcon,
  intellij: intellijIcon,
  webstorm: webstormIcon,
  pycharm: pycharmIcon,
  phpstorm: phpstormIcon,
  goland: golandIcon,
  clion: clionIcon,
  rider: riderIcon,
  fleet: fleetIcon,
  rustrover: rustroverIcon,
}

interface EditorOption {
  id: ExternalApp
  label: string
}

// Order matches Superset: editors, terminals, VS Code, JetBrains
const EDITORS: EditorOption[] = [
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
  { id: "sublime", label: "Sublime Text" },
  { id: "xcode", label: "Xcode" },
  { id: "windsurf", label: "Windsurf" },
  { id: "trae", label: "Trae" },
]

const TERMINALS: EditorOption[] = [
  { id: "iterm", label: "iTerm" },
  { id: "warp", label: "Warp" },
  { id: "terminal", label: "Terminal" },
  { id: "ghostty", label: "Ghostty" },
]

const VSCODE: EditorOption[] = [
  { id: "vscode", label: "VS Code" },
  { id: "vscode-insiders", label: "VS Code Insiders" },
]

const JETBRAINS: EditorOption[] = [
  { id: "intellij", label: "IntelliJ IDEA" },
  { id: "webstorm", label: "WebStorm" },
  { id: "pycharm", label: "PyCharm" },
  { id: "phpstorm", label: "PhpStorm" },
  { id: "goland", label: "GoLand" },
  { id: "clion", label: "CLion" },
  { id: "rider", label: "Rider" },
  { id: "fleet", label: "Fleet" },
  { id: "rustrover", label: "RustRover" },
]
import vscodeBaseIcon from "../../../assets/app-icons/vscode.svg"
import jetbrainsBaseIcon from "../../../assets/app-icons/jetbrains.svg"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../../ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
import { ChevronDown, ChevronRight, Play, Square, Upload, Volume2 } from "lucide-react"
import { resolveNotificationSoundSrc } from "../../../features/sidebar/hooks/use-desktop-notifications"
import { Switch } from "../../ui/switch"
import { Button } from "../../ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../ui/collapsible"
import { cn } from "../../../lib/utils"
import { appStore } from "../../../lib/jotai-store"

// Built-in sound definitions
const BUILTIN_SOUNDS = [
  { id: null, labelKey: "default" },
  { id: "builtin:abstract-sound1", labelKey: "abstract1" },
  { id: "builtin:abstract-sound2", labelKey: "abstract2" },
  { id: "builtin:abstract-sound3", labelKey: "abstract3" },
  { id: "builtin:abstract-sound4", labelKey: "abstract4" },
  { id: "builtin:phone-vibration", labelKey: "phoneVibration" },
  { id: "builtin:cow-mooing", labelKey: "cowMooing" },
  { id: "builtin:rooster", labelKey: "rooster" },
] as const

type BuiltinSoundId = (typeof BUILTIN_SOUNDS)[number]["id"]

function isCustomFile(soundId: string | null): boolean {
  return soundId !== null && !soundId.startsWith("builtin:")
}
import { trpc } from "../../../lib/trpc"

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

export function AgentsPreferencesTab() {
  const { t } = useTranslation("settings")
  const [thinkingEnabled, setThinkingEnabled] = useAtom(
    extendedThinkingEnabledAtom,
  )
  const [soundEnabled, setSoundEnabled] = useAtom(soundNotificationsEnabledAtom)
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useAtom(desktopNotificationsEnabledAtom)
  const [selectedSound, setSelectedSound] = useAtom(customNotificationSoundAtom)
  const [volume, setVolume] = useAtom(notificationVolumeAtom)

  // Sound preview state
  const [playingId, setPlayingId] = useState<string | null | undefined>(undefined)
  const stopRef = useRef<(() => void) | null>(null)

  const stopPreview = useCallback(() => {
    stopRef.current?.()
    stopRef.current = null
    setPlayingId(undefined)
  }, [])

  const handlePreview = useCallback(
    (soundId: string | null) => {
      if (playingId === soundId) {
        stopPreview()
        return
      }
      stopRef.current?.()
      const soundSrc = resolveNotificationSoundSrc(soundId)
      try {
        const audio = new Audio(soundSrc)
        audio.volume = Math.max(0, Math.min(1, volume))
        audio.play().catch(() => {})
        stopRef.current = () => { audio.pause(); audio.currentTime = 0 }
        setPlayingId(soundId)
        setTimeout(() => {
          setPlayingId((current) => (current === soundId ? undefined : current))
        }, 3000)
      } catch { /* ignore */ }
    },
    [playingId, volume, stopPreview],
  )

  const handleSelectCustomFile = useCallback(async () => {
    const filePath = await window.desktopApi?.selectAudioFile?.()
    if (filePath) setSelectedSound(filePath)
  }, [setSelectedSound])

  const hasCustomFile = isCustomFile(selectedSound)
  const [soundPickerOpen, setSoundPickerOpen] = useState(false)

  // Per-type sound state
  const [perTypeEnabled, setPerTypeEnabled] = useAtom(perTypeSoundEnabledAtom)
  const [completeSound, setCompleteSound] = useAtom(completeSoundAtom)
  const [errorSound, setErrorSound] = useAtom(errorSoundAtom)
  const [userInputSound, setUserInputSound] = useAtom(userInputSoundAtom)

  // Get display label for current sound
  const currentSoundLabel = (() => {
    if (!selectedSound) return t("preferences.notifications.sounds.default")
    if (hasCustomFile) return selectedSound.split("/").pop() || t("preferences.notifications.sounds.custom")
    const found = BUILTIN_SOUNDS.find((s) => s.id === selectedSound)
    return found ? t(`preferences.notifications.sounds.${found.labelKey}`) : t("preferences.notifications.sounds.default")
  })()
  const [ctrlTabTarget, setCtrlTabTarget] = useAtom(ctrlTabTargetAtom)
  const [autoAdvanceTarget, setAutoAdvanceTarget] = useAtom(autoAdvanceTargetAtom)
  const [defaultAgentMode, setDefaultAgentMode] = useAtom(defaultAgentModeAtom)
  const [askUserQuestionTimeout, setAskUserQuestionTimeout] = useAtom(askUserQuestionTimeoutAtom)
  const [preferredEditor, setPreferredEditor] = useAtom(preferredEditorAtom)
  const [languagePreference, setLanguagePreference] = useAtom(languagePreferenceAtom)
  const isNarrowScreen = useIsNarrowScreen()

  // Co-authored-by setting from Claude settings.json
  const { data: includeCoAuthoredBy, refetch: refetchCoAuthoredBy } =
    trpc.claudeSettings.getIncludeCoAuthoredBy.useQuery()
  const setCoAuthoredByMutation =
    trpc.claudeSettings.setIncludeCoAuthoredBy.useMutation({
      onSuccess: () => {
        refetchCoAuthoredBy()
      },
    })

  const handleCoAuthoredByToggle = (enabled: boolean) => {
    setCoAuthoredByMutation.mutate({ enabled })
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      {/* Header - hidden on narrow screens since it's in the navigation bar */}
      {!isNarrowScreen && (
        <div className="flex flex-col gap-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">{t("preferences.title")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("preferences.description")}
          </p>
        </div>
      )}

      {/* Language */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.language.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.language.description")}
            </span>
          </div>
          <Select
            value={languagePreference}
            onValueChange={(value: LanguagePreference) => setLanguagePreference(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">
                {languagePreference === "system"
                  ? t("preferences.language.system")
                  : languagePreference === "en"
                    ? "English"
                    : "中文"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">{t("preferences.language.system")}</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="zh">中文</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Agent Behavior */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.extendedThinking.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.extendedThinking.description")}{" "}
              <span className="text-foreground/70">{t("preferences.extendedThinking.note")}</span>
            </span>
          </div>
          <Switch
            checked={thinkingEnabled}
            onCheckedChange={setThinkingEnabled}
          />
        </div>

        {/* AI Question Timeout */}
        <div className="flex items-start justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.aiQuestionTimeout.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.aiQuestionTimeout.description")}
            </span>
          </div>
          <Select
            value={String(askUserQuestionTimeout)}
            onValueChange={(value) => setAskUserQuestionTimeout(Number(value) as AskUserQuestionTimeout)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">
                {askUserQuestionTimeout === 0
                  ? t("preferences.aiQuestionTimeout.noTimeout")
                  : askUserQuestionTimeout === 30
                    ? t("preferences.aiQuestionTimeout.seconds", { count: 30 })
                    : askUserQuestionTimeout === 60
                      ? t("preferences.aiQuestionTimeout.minute")
                      : askUserQuestionTimeout === 120
                        ? t("preferences.aiQuestionTimeout.minutes", { count: 2 })
                        : t("preferences.aiQuestionTimeout.minutes", { count: 5 })}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("preferences.aiQuestionTimeout.noTimeout")}</SelectItem>
              <SelectItem value="30">{t("preferences.aiQuestionTimeout.seconds", { count: 30 })}</SelectItem>
              <SelectItem value="60">{t("preferences.aiQuestionTimeout.minute")}</SelectItem>
              <SelectItem value="120">{t("preferences.aiQuestionTimeout.minutes", { count: 2 })}</SelectItem>
              <SelectItem value="300">{t("preferences.aiQuestionTimeout.minutes", { count: 5 })}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.defaultMode.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.defaultMode.description")}
            </span>
          </div>
          <Select
            value={defaultAgentMode}
            onValueChange={(value: AgentMode) => setDefaultAgentMode(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">
                {defaultAgentMode === "agent" ? t("preferences.defaultMode.agent") : t("preferences.defaultMode.plan")}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="agent">{t("preferences.defaultMode.agent")}</SelectItem>
              <SelectItem value="plan">{t("preferences.defaultMode.plan")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.coAuthored.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.coAuthored.description")}
            </span>
          </div>
          <Switch
            checked={includeCoAuthoredBy ?? true}
            onCheckedChange={handleCoAuthoredByToggle}
            disabled={setCoAuthoredByMutation.isPending}
          />
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.notifications.desktop.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.notifications.desktop.description")}
            </span>
          </div>
          <Switch checked={desktopNotificationsEnabled} onCheckedChange={setDesktopNotificationsEnabled} />
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.notifications.sound.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.notifications.sound.description")}
            </span>
          </div>
          <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
        </div>

        {/* Sound Picker — collapsible, only when sound is enabled */}
        {soundEnabled && (
          <>
            {/* Current sound + expand toggle */}
            <div
              className="flex items-center justify-between p-4 border-t border-border cursor-pointer hover:bg-accent/30 transition-colors"
              onClick={() => setSoundPickerOpen((o) => !o)}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-sm font-medium text-foreground">
                  {t("preferences.notifications.notificationSound")}
                </span>
                <span className="text-xs text-muted-foreground truncate">{currentSoundLabel}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handlePreview(selectedSound) }}
                  className={cn(
                    "w-6 h-6 flex items-center justify-center rounded hover:bg-accent-foreground/10 text-muted-foreground hover:text-foreground transition-colors",
                    playingId === selectedSound && "text-primary",
                  )}
                >
                  {playingId === selectedSound ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </button>
                <ChevronRight className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", soundPickerOpen && "rotate-90")} />
              </div>
            </div>

            {/* Expanded sound list */}
            {soundPickerOpen && (
              <div className="border-t border-border">
                {BUILTIN_SOUNDS.map((sound, index) => {
                  const isSelected =
                    sound.id === null
                      ? !selectedSound || selectedSound === undefined
                      : selectedSound === sound.id
                  const isPlaying = playingId === sound.id

                  return (
                    <div
                      key={sound.id ?? "default"}
                      className={cn(
                        "flex items-center gap-3 px-6 py-1.5 cursor-pointer transition-colors",
                        "hover:bg-accent/50",
                        isSelected && "bg-accent",
                        index > 0 && "border-t border-border/50",
                      )}
                      onClick={() => { setSelectedSound(sound.id); setSoundPickerOpen(false) }}
                    >
                      <div
                        className={cn(
                          "w-3 h-3 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                          isSelected ? "border-primary" : "border-muted-foreground/40",
                        )}
                      >
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                      </div>
                      <span className="text-xs text-foreground flex-1">
                        {t(`preferences.notifications.sounds.${sound.labelKey}`)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handlePreview(sound.id) }}
                        className={cn(
                          "w-5 h-5 flex items-center justify-center rounded hover:bg-accent-foreground/10 text-muted-foreground hover:text-foreground transition-colors",
                          isPlaying && "text-primary",
                        )}
                      >
                        {isPlaying ? <Square className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                  )
                })}

                {/* Custom sound option */}
                <div
                  className={cn(
                    "flex items-center gap-3 px-6 py-1.5 cursor-pointer transition-colors border-t border-border/50",
                    "hover:bg-accent/50",
                    hasCustomFile && "bg-accent",
                  )}
                  onClick={() => { if (!hasCustomFile) handleSelectCustomFile() }}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full border-2 flex-shrink-0 flex items-center justify-center",
                      hasCustomFile ? "border-primary" : "border-muted-foreground/40",
                    )}
                  >
                    {hasCustomFile && <div className="w-1.5 h-1.5 rounded-full bg-primary" />}
                  </div>
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-xs text-foreground">
                      {t("preferences.notifications.sounds.custom")}
                    </span>
                    {hasCustomFile && selectedSound && (
                      <span className="text-[10px] text-muted-foreground truncate" title={selectedSound}>
                        {selectedSound.split("/").pop()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {hasCustomFile && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handlePreview(selectedSound) }}
                        className={cn(
                          "w-5 h-5 flex items-center justify-center rounded hover:bg-accent-foreground/10 text-muted-foreground hover:text-foreground transition-colors",
                          playingId === selectedSound && "text-primary",
                        )}
                      >
                        {playingId === selectedSound ? <Square className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                      </button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleSelectCustomFile() }}
                      className="h-5 text-[10px] px-1.5"
                    >
                      <Upload className="w-2.5 h-2.5 mr-0.5" />
                      {t("preferences.notifications.choose")}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Per-type sound overrides */}
            <Collapsible open={perTypeEnabled} onOpenChange={setPerTypeEnabled}>
              <CollapsibleTrigger asChild>
                <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border cursor-pointer hover:bg-accent/30 transition-colors">
                  <ChevronRight className={cn(
                    "w-3 h-3 text-muted-foreground transition-transform duration-200",
                    perTypeEnabled && "rotate-90",
                  )} />
                  <span className="text-xs text-muted-foreground">
                    {t("preferences.notifications.perType.toggle")}
                  </span>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-col border-t border-border/50">
                  {([
                    { labelKey: "complete" as const, soundId: completeSound, setSoundId: setCompleteSound },
                    { labelKey: "error" as const, soundId: errorSound, setSoundId: setErrorSound },
                    { labelKey: "inputRequired" as const, soundId: userInputSound, setSoundId: setUserInputSound },
                  ]).map(({ labelKey, soundId, setSoundId }, i) => (
                    <div key={labelKey} className={cn("flex items-center gap-2 px-6 py-1.5", i > 0 && "border-t border-border/30")}>
                      <span className="text-xs text-muted-foreground w-[72px] flex-shrink-0">
                        {t(`preferences.notifications.perType.${labelKey}`)}
                      </span>
                      <Select
                        value={soundId ?? "__inherit__"}
                        onValueChange={(value: string) => setSoundId(value === "__inherit__" ? null : value)}
                      >
                        <SelectTrigger className="h-6 text-[11px] flex-1 min-w-0 px-2 border-border/50">
                          <span className="truncate">
                            {soundId === null
                              ? t("preferences.notifications.perType.inherit")
                              : (() => {
                                  const found = BUILTIN_SOUNDS.find((s) => s.id === soundId)
                                  return found
                                    ? t(`preferences.notifications.sounds.${found.labelKey}`)
                                    : isCustomFile(soundId) ? (soundId.split("/").pop() || soundId) : t("preferences.notifications.sounds.default")
                                })()}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__inherit__">
                            {t("preferences.notifications.perType.inherit")}
                          </SelectItem>
                          {BUILTIN_SOUNDS.filter((s) => s.id !== null).map((sound) => (
                            <SelectItem key={sound.id!} value={sound.id!}>
                              {t(`preferences.notifications.sounds.${sound.labelKey}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <button
                        type="button"
                        onClick={() => {
                          const globalSound = appStore.get(customNotificationSoundAtom)
                          const effectiveSound = soundId ?? globalSound
                          handlePreview(effectiveSound)
                        }}
                        className={cn(
                          "w-5 h-5 flex items-center justify-center rounded hover:bg-accent-foreground/10 text-muted-foreground hover:text-foreground transition-colors flex-shrink-0",
                          playingId === (soundId ?? selectedSound) && "text-primary",
                        )}
                      >
                        {playingId === (soundId ?? selectedSound)
                          ? <Square className="w-2.5 h-2.5" />
                          : <Play className="w-2.5 h-2.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Volume slider */}
            <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
              <Volume2 className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(volume * 100)}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                className="flex-1 h-1 bg-muted rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:shadow-sm"
              />
              <span className="text-[10px] text-muted-foreground tabular-nums w-7 text-right">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.navigation.quickSwitch.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.navigation.quickSwitch.description", { key: "⌃Tab" })}
            </span>
          </div>
          <Select
            value={ctrlTabTarget}
            onValueChange={(value: CtrlTabTarget) => setCtrlTabTarget(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">
                {ctrlTabTarget === "workspaces" ? t("preferences.navigation.quickSwitch.workspaces") : t("preferences.navigation.quickSwitch.agents")}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workspaces">{t("preferences.navigation.quickSwitch.workspaces")}</SelectItem>
              <SelectItem value="agents">{t("preferences.navigation.quickSwitch.agents")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.navigation.autoAdvance.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.navigation.autoAdvance.description")}
            </span>
          </div>
          <Select
            value={autoAdvanceTarget}
            onValueChange={(value: AutoAdvanceTarget) => setAutoAdvanceTarget(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">
                {autoAdvanceTarget === "next"
                  ? t("preferences.navigation.autoAdvance.next")
                  : autoAdvanceTarget === "previous"
                    ? t("preferences.navigation.autoAdvance.previous")
                    : t("preferences.navigation.autoAdvance.close")}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="next">{t("preferences.navigation.autoAdvance.next")}</SelectItem>
              <SelectItem value="previous">{t("preferences.navigation.autoAdvance.previous")}</SelectItem>
              <SelectItem value="close">{t("preferences.navigation.autoAdvance.close")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-foreground">
              {t("preferences.navigation.preferredEditor.title")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("preferences.navigation.preferredEditor.description")}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {EDITOR_ICONS[preferredEditor] && (
                  <img
                    src={EDITOR_ICONS[preferredEditor]}
                    alt=""
                    className="h-4 w-4 shrink-0"
                  />
                )}
                <span className="truncate">
                  {APP_META[preferredEditor].label}
                </span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {EDITORS.map((editor) => (
                <DropdownMenuItem
                  key={editor.id}
                  onClick={() => setPreferredEditor(editor.id)}
                  className="flex items-center gap-2"
                >
                  {EDITOR_ICONS[editor.id] ? (
                    <img src={EDITOR_ICONS[editor.id]} alt="" className="h-4 w-4 shrink-0 object-contain" />
                  ) : (
                    <div className="h-4 w-4 shrink-0" />
                  )}
                  <span>{editor.label}</span>
                </DropdownMenuItem>
              ))}
              {TERMINALS.map((app) => (
                <DropdownMenuItem
                  key={app.id}
                  onClick={() => setPreferredEditor(app.id)}
                  className="flex items-center gap-2"
                >
                  {EDITOR_ICONS[app.id] ? (
                    <img src={EDITOR_ICONS[app.id]} alt="" className="h-4 w-4 shrink-0 object-contain" />
                  ) : (
                    <div className="h-4 w-4 shrink-0" />
                  )}
                  <span>{app.label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2">
                  <img src={vscodeBaseIcon} alt="" className="h-4 w-4 shrink-0 object-contain" />
                  <span>VS Code</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48" sideOffset={6} alignOffset={-4}>
                  {VSCODE.map((app) => (
                    <DropdownMenuItem
                      key={app.id}
                      onClick={() => setPreferredEditor(app.id)}
                      className="flex items-center gap-2"
                    >
                      {EDITOR_ICONS[app.id] ? (
                        <img src={EDITOR_ICONS[app.id]} alt="" className="h-4 w-4 shrink-0 object-contain" />
                      ) : (
                        <div className="h-4 w-4 shrink-0" />
                      )}
                      <span>{app.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2">
                  <img src={jetbrainsBaseIcon} alt="" className="h-4 w-4 shrink-0 object-contain" />
                  <span>JetBrains</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48 max-h-[300px] overflow-y-auto" sideOffset={6} alignOffset={-4}>
                  {JETBRAINS.map((app) => (
                    <DropdownMenuItem
                      key={app.id}
                      onClick={() => setPreferredEditor(app.id)}
                      className="flex items-center gap-2"
                    >
                      {EDITOR_ICONS[app.id] ? (
                        <img src={EDITOR_ICONS[app.id]} alt="" className="h-4 w-4 shrink-0 object-contain" />
                      ) : (
                        <div className="h-4 w-4 shrink-0" />
                      )}
                      <span>{app.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
