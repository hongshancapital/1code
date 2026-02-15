import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// ============================================
// RE-EXPORT FROM FEATURES/AGENTS/ATOMS (source of truth)
// ============================================

export {
  // Chat atoms
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  previousAgentChatIdAtom,
  selectedDraftIdAtom,
  showNewChatFormAtom,
  suppressInputFocusAtom,
  pendingMentionAtom,
  subChatModeAtomFamily,
  lastSelectedModelIdAtom,
  lastSelectedAgentIdAtom,
  lastSelectedRepoAtom,
  selectedProjectAtom,
  agentsUnseenChangesAtom,
  agentsSubChatUnseenChangesAtom,
  loadingSubChatsAtom,
  setLoading,
  clearLoading,
  MODEL_ID_MAP,
  lastChatModesAtom,
  unconfirmedNameSubChatsAtom,
  markNameUnconfirmed,
  confirmName,
  compactingSubChatsAtom,
  justCreatedIdsAtom,

  // Sidebar atoms
  agentsSidebarOpenAtom,
  agentsSidebarWidthAtom,
  agentsSubChatsSidebarModeAtom,
  agentsSubChatsSidebarWidthAtom,

  // Preview atoms
  previewPathAtomFamily,
  viewportModeAtomFamily,
  previewScaleAtomFamily,
  mobileDeviceAtomFamily,
  agentsPreviewSidebarWidthAtom,
  agentsPreviewSidebarOpenAtom,

  // Diff atoms
  agentsDiffSidebarWidthAtom,
  agentsChangesPanelWidthAtom,
  agentsChangesPanelCollapsedAtom,
  agentsDiffSidebarOpenAtom,
  agentsFocusedDiffFileAtom,
  filteredDiffFilesAtom,
  selectedDiffFilePathAtom,
  isCreatingPrAtom,
  filteredSubChatIdAtom,
  selectedCommitAtom,
  diffActiveTabAtom,
  diffFilesCollapsedAtomFamily,
  diffSidebarOpenAtomFamily,
  diffViewDisplayModeAtom,
  diffHasPendingChangesAtomFamily,

  // Chat area full width mode
  agentsChatFullWidthAtom,

  // Browser sidebar atoms
  agentsBrowserSidebarWidthAtom,

  // Archive atoms
  archivePopoverOpenAtom,
  archiveSearchQueryAtom,
  archiveRepositoryFilterAtom,

  // UI state
  agentsMobileViewModeAtom,

  // Debug mode
  agentsDebugModeAtom,
  showMessageJsonAtom,

  // Todos
  currentTodosAtomFamily,

  // Task tools
  currentTaskToolsAtomFamily,

  // AskUserQuestion
  pendingUserQuestionsAtom,
  expiredUserQuestionsAtom,
  askUserQuestionResultsAtom,
  QUESTIONS_SKIPPED_MESSAGE,
  QUESTIONS_TIMED_OUT_MESSAGE,

  // Pending messages
  pendingPrMessageAtom,
  pendingReviewMessageAtom,
  pendingConflictResolutionMessageAtom,
  pendingBranchRenameMessageAtom,
  pendingAuthRetryMessageAtom,
  pendingBuildPlanSubChatIdAtom,
  pendingPlanApprovalsAtom,

  // Work mode
  lastSelectedWorkModeAtom,
  lastSelectedBranchesAtom,

  // Undo stack
  undoStackAtom,

  // SubChat status
  subChatStatusStorageAtom,
  unseenSubChatIdsAtom,
  committedSubChatIdsAtom,
  markSubChatUnseen,
  clearSubChatUnseen,
  markSubChatCommitted,

  // SubChat files
  subChatFilesAtom,
  subChatToChatMapAtom,

  // Viewed files
  viewedFilesAtomFamily,

  // File viewer
  fileViewerOpenAtomFamily,
  fileViewerSidebarWidthAtom,
  fileViewerDisplayModeAtom,
  fileViewerWordWrapAtom,
  fileViewerMinimapAtom,
  fileViewerLineNumbersAtom,
  fileViewerStickyScrollAtom,
  fileViewerWhitespaceAtom,
  fileViewerBracketPairsAtom,
  fileSearchDialogOpenAtom,
  recentlyOpenedFilesAtom,
  openLocallyChatIdAtom,

  // Plan sidebar
  agentsPlanSidebarWidthAtom,
  planSidebarOpenAtomFamily,
  currentPlanPathAtomFamily,
  planEditRefetchTriggerAtomFamily,

  // Explorer panel
  explorerDisplayModeAtom,
  explorerSidebarWidthAtom,
  explorerPanelOpenAtomFamily,

  // Terminal panel height
  codingTerminalPanelHeightAtom,

  // Desktop view navigation
  desktopViewAtom,
  activeSidebarNavAtom,
  automationsSidebarWidthAtom,
  selectedAutomationIdAtom,
  automationDetailIdAtom,
  automationTemplateParamsAtom,
  inboxSelectedChatIdAtom,
  agentsInboxSidebarWidthAtom,
  inboxMobileViewModeAtom,

  // Settings sidebar widths
  settingsMcpSidebarWidthAtom,
  settingsToolsSidebarWidthAtom,
  settingsSkillsSidebarWidthAtom,
  settingsCommandsSidebarWidthAtom,
  settingsAgentsSidebarWidthAtom,
  settingsPluginsSidebarWidthAtom,
  settingsKeyboardSidebarWidthAtom,
  settingsProjectsSidebarWidthAtom,

  // Context comments
  contextCommentsAtom,
  contextCommentClickedAtom,

  // Project mode
  currentProjectModeAtom,
  enabledWidgetsAtom,

  // Diff data cache
  workspaceDiffCacheAtomFamily,

  // Mode utilities
  AGENT_MODES,
  getNextMode,

  // Types
  type SavedRepo,
  type SelectedProject,
  type AgentsMobileViewMode,
  type AgentsDebugMode,
  type SubChatFileChange,
  type AgentMode,
  type DesktopView,
  type AutomationTemplateParams,
  type InboxMobileViewMode,
  type SidebarNavItem,
  type DiffViewDisplayMode,
  type ProjectMode,
  type WorkMode,
  type SelectedCommit,
  type SubChatStatus,
  type ViewedFileState,
  type CachedParsedDiffFile,
  type DiffStatsCache,
  type WorkspaceDiffCache,
  type ExplorerDisplayMode,
  type FileViewerDisplayMode,
  type FileViewerWhitespace,
  type PendingUserQuestion,
  type PendingAuthRetryMessage,
  type UndoItem,
  type ContextCommentItem,
  type TaskToolItem,
} from "../../features/agents/atoms"

// ============================================
// RE-EXPORT FROM FEATURES/AGENTS/ATOMS/BACKGROUND-TASKS
// ============================================

export {
  backgroundTasksAtomFamily,
  runningTasksCountAtomFamily,
  allRunningTasksAtom,
  createBackgroundTask,
  updateTaskStatus,
} from "../../features/agents/atoms/background-tasks"

export type { BackgroundTask, BackgroundTaskStatus } from "../../features/agents/types/background-task"

// ============================================
// RE-EXPORT FROM FEATURES/AGENTS/ATOMS/REVIEW-ATOMS
// ============================================

export {
  reviewCommentsAtomFamily,
  reviewPanelOpenAtomFamily,
} from "../../features/agents/atoms/review-atoms"

// ============================================
// RE-EXPORT FROM FEATURES/COWORK/ATOMS
// ============================================

export {
  filePreviewPathAtom,
  filePreviewLineAtom,
  filePreviewHighlightAtom,
  filePreviewOpenAtom,
  filePreviewDisplayModeAtom,
  artifactsAtomFamily,
  isCoworkModeAtom,
  coworkRightPanelWidthAtom,
  coworkRightPanelOpenAtom,
  coworkRightPanelUserClosedAtom,
  editorModeAtom,
  editorDirtyAtom,
  editorOriginalContentAtom,
  editorContentAtom,
  resetEditorStateAtom,
  pendingFileReferenceAtom,
  type Artifact,
  type ArtifactContext,
  type FilePreviewDisplayMode,
  type EditorMode,
  type PendingFileReference,
} from "../../features/cowork/atoms"

// ============================================
// RE-EXPORT FROM FEATURES/TERMINAL/ATOMS
// ============================================

export {
  terminalsAtom,
  activeTerminalIdAtom,
  terminalSidebarOpenAtomFamily,
  terminalSidebarOpenAtom,
  terminalSidebarWidthAtom,
  terminalCwdAtom,
  terminalDisplayModeAtom,
  terminalBottomHeightAtom,
  terminalSearchOpenAtom,
  type TerminalDisplayMode,
} from "../../features/terminal/atoms"

// ============================================
// TEAM ATOMS (unique to lib/atoms)
// ============================================

export const selectedTeamIdAtom = atomWithStorage<string | null>(
  "agents:selectedTeamId",
  null,
  undefined,
  { getOnInit: true },
)

export const createTeamDialogOpenAtom = atom<boolean>(false)

// ============================================
// MULTI-SELECT ATOMS - Chats (unique to lib/atoms)
// ============================================

export const selectedAgentChatIdsAtom = atom<Set<string>>(new Set<string>())

export const isAgentMultiSelectModeAtom = atom((get) => {
  return get(selectedAgentChatIdsAtom).size > 0
})

export const selectedAgentChatsCountAtom = atom((get) => {
  return get(selectedAgentChatIdsAtom).size
})

export const toggleAgentChatSelectionAtom = atom(
  null,
  (get, set, chatId: string) => {
    const currentSet = get(selectedAgentChatIdsAtom)
    const newSet = new Set(currentSet)
    if (newSet.has(chatId)) {
      newSet.delete(chatId)
    } else {
      newSet.add(chatId)
    }
    set(selectedAgentChatIdsAtom, newSet)
  },
)

export const selectAllAgentChatsAtom = atom(
  null,
  (_get, set, chatIds: string[]) => {
    set(selectedAgentChatIdsAtom, new Set(chatIds))
  },
)

export const clearAgentChatSelectionAtom = atom(null, (_get, set) => {
  set(selectedAgentChatIdsAtom, new Set())
})

// ============================================
// MULTI-SELECT ATOMS - Sub-Chats (unique to lib/atoms)
// ============================================

export const selectedSubChatIdsAtom = atom<Set<string>>(new Set<string>())

export const isSubChatMultiSelectModeAtom = atom((get) => {
  return get(selectedSubChatIdsAtom).size > 0
})

export const selectedSubChatsCountAtom = atom((get) => {
  return get(selectedSubChatIdsAtom).size
})

export const toggleSubChatSelectionAtom = atom(
  null,
  (get, set, subChatId: string) => {
    const currentSet = get(selectedSubChatIdsAtom)
    const newSet = new Set(currentSet)
    if (newSet.has(subChatId)) {
      newSet.delete(subChatId)
    } else {
      newSet.add(subChatId)
    }
    set(selectedSubChatIdsAtom, newSet)
  },
)

export const selectAllSubChatsAtom = atom(
  null,
  (_get, set, subChatIds: string[]) => {
    set(selectedSubChatIdsAtom, new Set(subChatIds))
  },
)

export const clearSubChatSelectionAtom = atom(null, (_get, set) => {
  set(selectedSubChatIdsAtom, new Set())
})

// ============================================
// SETTINGS DIALOG (derived from desktopViewAtom)
// ============================================

import { desktopViewAtom as _desktopViewAtom } from "../../features/agents/atoms"

export type SettingsTab =
  | "profile"
  | "appearance"
  | "preferences"
  | "notifications"
  | "models"
  | "runtime"
  | "editor"
  | "tools"
  | "skills"
  | "commands"
  | "agents"
  | "mcp"
  | "plugins"
  | "worktrees"
  | "projects"
  | "debug"
  | "beta"
  | "keyboard"
  | "memory"
  | `project-${string}`
export const agentsSettingsDialogActiveTabAtom = atom<SettingsTab>("preferences")
export const agentsSettingsDialogOpenAtom = atom(
  (get) => get(_desktopViewAtom) === "settings",
  (_get, set, open: boolean) => {
    set(_desktopViewAtom, open ? "settings" : null)
  }
)

// ============================================
// UI STATE ATOMS (unique to lib/atoms)
// ============================================

export const agentsLoginModalOpenAtom = atom<boolean>(false)
export const agentsHelpPopoverOpenAtom = atom<boolean>(false)
export const agentsQuickSwitchOpenAtom = atom<boolean>(false)
export const agentsQuickSwitchSelectedIndexAtom = atom<number>(0)
export const subChatsQuickSwitchOpenAtom = atom<boolean>(false)
export const subChatsQuickSwitchSelectedIndexAtom = atom<number>(0)
export const isDesktopAtom = atom<boolean>(false)
export const isFullscreenAtom = atom<boolean | null>(null)

// ============================================
// RE-EXPORT THEMATIC MODULES
// ============================================

export * from "./preferences"
export * from "./themes"
export * from "./onboarding"
export * from "./session-info"
export * from "./beta-features"
export * from "./model-profiles"
export * from "./grouping"
export * from "./model-config"
export * from "./editor"
export * from "./runner"
export * from "./traffic-light"
