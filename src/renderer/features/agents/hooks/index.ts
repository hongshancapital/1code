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

// New refactored hooks (Phase 2)
export {
  usePrOperations,
  type PrOperationsResult,
} from "./use-pr-operations"

export {
  useChatKeyboardShortcuts,
  type ChatKeyboardShortcutsOptions,
} from "./use-chat-keyboard-shortcuts"

export {
  useSidebarManager,
  type SidebarManagerOptions,
  type SidebarManagerResult,
  type SidebarState,
  type DiffSidebarState,
  type PlanSidebarState,
  type TerminalSidebarState,
  type BrowserSidebarState,
  type FileViewerState,
} from "./use-sidebar-manager"

export {
  useChatMutations,
  type ChatMutationsOptions,
  type ChatMutationsResult,
} from "./use-chat-mutations"

export {
  useGitData,
  type GitDataOptions,
  type GitDataResult,
  type GitStatusData,
  type BranchData,
  type PrStatusData,
} from "./use-git-data"

export {
  useCommentHandlers,
  type CommentHandlersOptions,
  type CommentHandlersResult,
} from "./use-comment-handlers"

export {
  useQuestionHandlers,
  type QuestionHandlersOptions,
  type QuestionHandlersResult,
  type QuestionData,
  type QuestionComponentRef,
  type EditorRef,
} from "./use-question-handlers"
