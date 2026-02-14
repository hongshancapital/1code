/**
 * Common React Hooks Library
 *
 * Collection of reusable hooks for common patterns.
 */

// Stable callback hooks - prevent unnecessary re-renders and infinite loops
export {
  useLatest,
  useMemoizedFn,
  useEvent,
  useStableCallback,
  usePersistFn,
} from "./use-stable-callback"

// Other hooks
export { useCodeTheme } from "./use-code-theme"
export { useRemoteChat } from "./use-remote-chats"
export { useProjectIcon } from "./use-project-icon"
export { useVoiceRecording } from "./use-voice-recording"
export { useFileChangeListener, useGitWatcher } from "./use-file-change-listener"
export { useAuthRequired } from "./use-auth-required"
export { useTrafficLightSync } from "./use-traffic-light-sync"
