// Auto-scroll hook for chat views
export { useAutoScroll } from "./useAutoScroll"

// File content cache for mentions
export { useFileContentCache } from "./useFileContentCache"

// Re-export existing hooks
export { useAgentsFileUpload } from "./use-agents-file-upload"
export { useAutoImport } from "./use-auto-import"
export { useChangedFilesTracking } from "./use-changed-files-tracking"
export { useDesktopNotifications } from "./use-desktop-notifications"
export { useDocumentComments } from "./use-document-comments"
export { useFocusInputOnEnter } from "./use-focus-input-on-enter"
export { usePastedTextFiles } from "./use-pasted-text-files"
export { useTextContextSelection } from "./use-text-context-selection"
export { useToggleFocusOnCmdEsc } from "./use-toggle-focus-on-cmd-esc"
export { useWorkspaceSwitch } from "./use-workspace-switch"

// Refactored hooks
export {
  useChatKeyboardShortcuts,
  type ChatKeyboardShortcutsOptions,
} from "./use-chat-keyboard-shortcuts"

export {
  useAutoRename,
  type UseAutoRenameOptions,
  type UseAutoRenameResult,
} from "./use-auto-rename"

// Question handling (AskUserQuestion tool response)
export {
  useQuestionHandlers,
  type QuestionHandlersOptions,
  type QuestionHandlersResult,
  type QuestionData,
  type QuestionComponentRef,
  type EditorRef,
} from "./use-question-handlers"

// Message sending (send, queue, force send, restore)
export {
  useMessageSending,
  type MessageSendingOptions,
  type MessageSendingResult,
  type ImageAttachment,
  type FileAttachment,
  type TextContext,
  type DiffTextContext,
  type PastedTextFile,
} from "./use-message-sending"

// Panel state management (unified panel system)
export {
  usePanel,
  type PanelHandle,
  // Deprecated re-exports for backwards compatibility
  usePanelState,
  usePanelGroup,
  useRightSidebar,
  type UsePanelStateOptions,
  type UsePanelStateResult,
  type UsePanelGroupOptions,
  type UsePanelGroupResult,
  type UseRightSidebarOptions,
} from "./use-panel-state"

// ChatView setup (multi-instance integration)
export {
  useChatViewSetup,
  useIsActiveChatView,
  type ChatViewSetupOptions,
  type ChatViewSetupResult,
} from "./use-chat-view-setup"

// Sidebar mutual exclusion (Details vs Plan/Terminal)
export {
  useSidebarMutualExclusion,
  type SidebarMutualExclusionState,
  type SidebarMutualExclusionSetters,
} from "./use-sidebar-mutual-exclusion"

// Diff data management (stats, parsed files, fetch)
export {
  useDiffData,
  type UseDiffDataOptions,
  type UseDiffDataResult,
  type DiffStats,
} from "./use-diff-data"
