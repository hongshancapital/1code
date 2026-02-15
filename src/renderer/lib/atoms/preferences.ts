import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { isFeatureAvailable } from "../feature-flags"
import type { AgentMode as AgentModeType } from "../../features/agents/atoms"

// Preferences - Extended Thinking
// When enabled, Claude will use extended thinking for deeper reasoning (128K tokens)
// Note: Extended thinking disables response streaming
export const extendedThinkingEnabledAtom = atomWithStorage<boolean>(
  "preferences:extended-thinking-enabled",
  false,
  undefined,
  { getOnInit: true },
)

// Preferences - AskUserQuestion Timeout
// Timeout in seconds for AI questions (0 = no timeout, default = 60)
// When AI asks a question and user doesn't respond within this time, it will timeout
export type AskUserQuestionTimeout = 0 | 30 | 60 | 120 | 300
export const askUserQuestionTimeoutAtom = atomWithStorage<AskUserQuestionTimeout>(
  "preferences:ask-user-question-timeout",
  60,
  undefined,
  { getOnInit: true },
)

// Preferences - History (Rollback)
// When enabled, allow rollback to previous assistant messages
export const historyEnabledAtom = atomWithStorage<boolean>(
  "preferences:history-enabled",
  false,
  undefined,
  { getOnInit: true },
)

// Preferences - Sound Notifications
// When enabled, play a sound when agent completes work (if not viewing the chat)
export const soundNotificationsEnabledAtom = atomWithStorage<boolean>(
  "preferences:sound-notifications-enabled",
  true,
  undefined,
  { getOnInit: true },
)

// Preferences - Always Show Notifications
// When enabled, show system notifications even when the app window is focused
// Default: false (only show notifications when window is not focused)
export const alwaysShowNotificationsAtom = atomWithStorage<boolean>(
  "preferences:always-show-notifications",
  false,
  undefined,
  { getOnInit: true },
)

// Preferences - Custom Notification Sound
// Sound identifier:
//   null → default sound.mp3
//   "builtin:abstract-sound1" → built-in sound from /sounds/
//   "/absolute/path/to/file.mp3" → custom file
export const customNotificationSoundAtom = atomWithStorage<string | null>(
  "preferences:custom-notification-sound",
  null,
  undefined,
  { getOnInit: true },
)

// Preferences - Notification Volume (0.0 - 1.0)
export const notificationVolumeAtom = atomWithStorage<number>(
  "preferences:notification-volume",
  0.8,
  undefined,
  { getOnInit: true },
)

// Preferences - Desktop Notifications (Windows)
// When enabled, show Windows desktop notification when agent completes work
export const desktopNotificationsEnabledAtom = atomWithStorage<boolean>(
  "preferences:desktop-notifications-enabled",
  true,
  undefined,
  { getOnInit: true },
)

// Preferences - Windows Window Frame Style
// When true, uses native frame (standard Windows title bar)
// When false, uses frameless window (dark custom title bar)
// Only applies on Windows, requires app restart to take effect
export const useNativeFrameAtom = atomWithStorage<boolean>(
  "preferences:windows-use-native-frame",
  false, // Default: frameless (dark title bar)
  undefined,
  { getOnInit: true },
)

// Beta: Enable git features in diff sidebar (commit, staging, file selection)
export const betaGitFeaturesEnabledAtom = atomWithStorage<boolean>(
  "preferences:beta-git-features-enabled",
  false, // Default OFF
  undefined,
  { getOnInit: true },
)

// Beta: Enable Automations & Inbox
// Internal storage atom
const _betaAutomationsEnabledStorageAtom = atomWithStorage<boolean>(
  "preferences:beta-automations-enabled",
  false, // Default OFF
  undefined,
  { getOnInit: true },
)

// Public atom - enforces dev-only restriction
export const betaAutomationsEnabledAtom = atom(
  (get) => isFeatureAvailable("automations") ? get(_betaAutomationsEnabledStorageAtom) : false,
  (_get, set, value: boolean) => set(_betaAutomationsEnabledStorageAtom, value)
)

// Beta: Enable Tasks functionality in Claude Code SDK
export const enableTasksAtom = atomWithStorage<boolean>(
  "preferences:enable-tasks",
  true, // Default ON
  undefined,
  { getOnInit: true },
)

// Beta: Skill Awareness (Prompt Injection)
export const skillAwarenessEnabledAtom = atomWithStorage<boolean>(
  "preferences:skill-awareness-enabled",
  true, // Default ON
  undefined,
  { getOnInit: true },
)

// Preferences - Ctrl+Tab Quick Switch Target
export type CtrlTabTarget = "workspaces" | "agents"
export const ctrlTabTargetAtom = atomWithStorage<CtrlTabTarget>(
  "preferences:ctrl-tab-target",
  "workspaces",
  undefined,
  { getOnInit: true },
)

// Preferences - Auto-advance after archive
export type AutoAdvanceTarget = "next" | "previous" | "close"
export const autoAdvanceTargetAtom = atomWithStorage<AutoAdvanceTarget>(
  "preferences:auto-advance-target",
  "next",
  undefined,
  { getOnInit: true },
)

// Preferences - Default Agent Mode
// Migration: convert old isPlanMode boolean to new defaultAgentMode string
if (typeof window !== "undefined") {
  const oldKey = "agents:isPlanMode"
  const newKey = "preferences:default-agent-mode"
  const oldValue = localStorage.getItem(oldKey)
  if (oldValue !== null && localStorage.getItem(newKey) === null) {
    const wasInPlanMode = oldValue === "true"
    localStorage.setItem(newKey, JSON.stringify(wasInPlanMode ? "plan" : "agent"))
    localStorage.removeItem(oldKey)
    console.log("[atoms] Migrated isPlanMode to defaultAgentMode:", wasInPlanMode ? "plan" : "agent")
  }
}

export const defaultAgentModeAtom = atomWithStorage<AgentModeType>(
  "preferences:default-agent-mode",
  "agent",
  undefined,
  { getOnInit: true },
)

// Preferences - VS Code Code Themes (syntax highlighting)
export const vscodeCodeThemeLightAtom = atomWithStorage<string>(
  "preferences:vscode-code-theme-light",
  "github-light",
  undefined,
  { getOnInit: true },
)

export const vscodeCodeThemeDarkAtom = atomWithStorage<string>(
  "preferences:vscode-code-theme-dark",
  "github-dark",
  undefined,
  { getOnInit: true },
)

// Show workspace icon in sidebar
export const showWorkspaceIconAtom = atomWithStorage<boolean>(
  "preferences:show-workspace-icon",
  false,
  undefined,
  { getOnInit: true },
)

// Always expand to-do list
export const alwaysExpandTodoListAtom = atomWithStorage<boolean>(
  "preferences:always-expand-todo-list",
  false,
  undefined,
  { getOnInit: true },
)

// Preferred editor
import type { ExternalApp } from "../../../shared/external-apps"

export const preferredEditorAtom = atomWithStorage<ExternalApp>(
  "preferences:preferred-editor",
  "cursor",
  undefined,
  { getOnInit: true },
)

// Language settings
export type LanguagePreference = "system" | "en" | "zh"

export const languagePreferenceAtom = atomWithStorage<LanguagePreference>(
  "preferences:language",
  "system",
  undefined,
  { getOnInit: true },
)

// Custom hotkeys
import type { CustomHotkeysConfig } from "../hotkeys/types"
export type { CustomHotkeysConfig }

export const customHotkeysAtom = atomWithStorage<CustomHotkeysConfig>(
  "preferences:custom-hotkeys",
  { version: 1, bindings: {} },
  undefined,
  { getOnInit: true },
)

export const recordingHotkeyForActionAtom = atom<string | null>(null)
