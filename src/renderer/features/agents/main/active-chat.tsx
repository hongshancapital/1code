"use client"

import { Button } from "../../../components/ui/button"
import {
  IconCloseSidebarRight,
  IconSpinner,
} from "../../../components/ui/icons"
import { ResizableSidebar } from "../../../components/ui/resizable-sidebar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
// e2b API routes are used instead of useSandboxManager for agents
// import { clearSubChatSelectionAtom, isSubChatMultiSelectModeAtom, selectedSubChatIdsAtom } from "@/lib/atoms/agent-subchat-selection"
import { Chat, useChat } from "@ai-sdk/react"
import type { DiffViewMode } from "../ui/agent-diff-view"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  ArrowLeftFromLine,
  MoveHorizontal,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { flushSync } from "react-dom"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import type { FileStatus } from "../../../../shared/changes-types"
import { getQueryClient } from "../../../contexts/TRPCProvider"
import {
  trackClickNewChat,
  trackClickPlanApprove,
  trackSendMessage,
} from "../../../lib/sensors-analytics"
import {
  chatSourceModeAtom,
  customClaudeConfigAtom,
  defaultAgentModeAtom,
  isDesktopAtom, isFullscreenAtom,
  normalizeCustomClaudeConfig,
  selectedOllamaModelAtom,
  soundNotificationsEnabledAtom,
  summaryProviderIdAtom,
  summaryModelIdAtom,
} from "../../../lib/atoms"
import {
  sessionModelOverrideAtom,
  chatModelSelectionsAtom,
  subChatModelSelectionsAtom,
} from "../../../lib/atoms/model-config"
import { useFileChangeListener, useGitWatcher } from "../../../lib/hooks/use-file-change-listener"
import { useRemoteChat } from "../../../lib/hooks/use-remote-chats"
import { useResolvedHotkeyDisplay } from "../../../lib/hotkeys"
import { appStore } from "../../../lib/jotai-store"
import { api } from "../../../lib/mock-api"
import { trpc, trpcClient } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { usePlatform } from "../../../contexts/PlatformContext"
import { PanelGate, usePanelContext, PANEL_IDS, PanelsProvider, PanelZone } from "../ui/panel-system"
import { builtinPanelDefinitions } from "../ui/panel-system/panel-definitions"
import { useChatKeyboardShortcuts } from "../hooks/use-chat-keyboard-shortcuts"
import { useDraftRestoration } from "../hooks/use-draft-restoration"
import { usePendingMessageHandling } from "../hooks/use-pending-message-handling"
import { usePlanEditTracking } from "../hooks/use-plan-edit-tracking"
import { usePrUrlDetection } from "../hooks/use-pr-url-detection"
import { useStreamStopShortcuts } from "../hooks/use-stream-stop-shortcuts"
import { useMessageEditing } from "../hooks/use-message-editing"
import { usePlanApprovalState } from "../hooks/use-plan-approval-state"
import {
  DiffStateProvider,
  DiffSidebarRenderer,
  useDiffState,
} from "../ui/diff-sidebar"
import {
  utf8ToBase64,
  waitForStreamingReady,
  getFirstSubChatId,
  computeTabsToRender,
  ScrollToBottomButton,
  MessageGroup,
} from "./chat-utils"
import {
  SubChatTabsContainer,
  type ChatViewInnerProps,
} from "../components/sub-chat-tabs-renderer"
import { ChatViewHeader } from "../components/chat-view-header"
import { FileViewerPanel } from "../components/file-viewer-panel"
import { PreviewSidebarPanel } from "../components/preview-sidebar-panel"
import { ChatViewLoadingPlaceholder } from "../components/chat-view-loading-placeholder"
import {
  detailsSidebarOpenAtom,
  unifiedSidebarEnabledAtom,
  expandedWidgetAtomFamily,
} from "../../details-sidebar/atoms"
import { DetailsSidebar } from "../../details-sidebar/details-sidebar"
import { ExpandedWidgetSidebar } from "../../details-sidebar/expanded-widget-sidebar"
import { FileSearchDialog } from "../../file-viewer/components/file-search-dialog"
import { BrowserPanel } from "../../browser-sidebar"
import { browserPendingScreenshotAtomFamily } from "../../browser-sidebar/atoms"
import { pendingPlanApprovalsAtom } from "../atoms"
import { terminalSidebarOpenAtomFamily, terminalDisplayModeAtom, terminalBottomHeightAtom } from "../../terminal/atoms"
import { TerminalSidebar, TerminalBottomPanelContent } from "../../terminal/terminal-sidebar"
import { ResizableBottomPanel } from "@/components/ui/resizable-bottom-panel"
import {
  agentsChangesPanelCollapsedAtom,
  agentsChangesPanelWidthAtom,
  agentsDiffSidebarWidthAtom,
  agentsPlanSidebarWidthAtom,
  agentsBrowserSidebarWidthAtom,
  agentsPreviewSidebarOpenAtom,
  agentsSubChatsSidebarModeAtom,
  agentsSubChatUnseenChangesAtom,
  agentsUnseenChangesAtom,
  subChatStatusStorageAtom,
  markSubChatUnseen,
  clearSubChatUnseen,
  fileSearchDialogOpenAtom,
  fileViewerDisplayModeAtom,
  fileViewerOpenAtomFamily,
  clearLoading,
  compactingSubChatsAtom,
  currentPlanPathAtomFamily,
  diffSidebarOpenAtomFamily,
  diffViewDisplayModeAtom,
  expiredUserQuestionsAtom,
  filteredDiffFilesAtom,
  isCreatingPrAtom,
  justCreatedIdsAtom,
  lastSelectedModelIdAtom,
  loadingSubChatsAtom,
  MODEL_ID_MAP,
  pendingAuthRetryMessageAtom,
  pendingBuildPlanSubChatIdAtom,
  pendingUserQuestionsAtom,
  planEditRefetchTriggerAtomFamily,
  planSidebarOpenAtomFamily,
  QUESTIONS_SKIPPED_MESSAGE,
  selectedAgentChatIdAtom,
  selectedCommitAtom,
  diffActiveTabAtom,
  selectedDiffFilePathAtom,
  selectedProjectAtom,
  setLoading,
  subChatFilesAtom,
  subChatModeAtomFamily,
  undoStackAtom,
currentProjectModeAtom,
  workspaceDiffCacheAtomFamily,
  agentsChatFullWidthAtom,
  pendingMentionAtom,
  suppressInputFocusAtom,
  diffHasPendingChangesAtomFamily,
  unconfirmedNameSubChatsAtom,
  markNameUnconfirmed,
  confirmName,
  type AgentMode,
  type SelectedCommit,
  type CachedParsedDiffFile,
} from "../atoms"
import { BUILTIN_SLASH_COMMANDS } from "../commands"
import { OpenLocallyDialog } from "../components/open-locally-dialog"
import type { TextSelectionSource } from "../context/text-selection-context"
import { TextSelectionProvider } from "../context/text-selection-context"
import { useAgentsFileUpload } from "../hooks/use-agents-file-upload"
import { useAutoImport } from "../hooks/use-auto-import"
import { useAutoScroll } from "../hooks/useAutoScroll"
import { useScrollToTarget, scrollTargetAtom, SCROLL_TO_BOTTOM } from "../../../lib/router"
import { useChangedFilesTracking } from "../hooks/use-changed-files-tracking"
import { useDesktopNotifications } from "../hooks/use-desktop-notifications"
import { useFocusInputOnEnter } from "../hooks/use-focus-input-on-enter"
import { usePastedTextFiles } from "../hooks/use-pasted-text-files"
import { useTextContextSelection } from "../hooks/use-text-context-selection"
import { useToggleFocusOnCmdEsc } from "../hooks/use-toggle-focus-on-cmd-esc"
import { useChatViewSetup } from "../hooks/use-chat-view-setup"
import { useSidebarMutualExclusion } from "../hooks/use-sidebar-mutual-exclusion"
import { useDiffSidebarLayout } from "../hooks/use-diff-sidebar-layout"
import { useDiffData } from "../hooks/use-diff-data"
import { useBrowserSidebar } from "../hooks/use-browser-sidebar"
import { useSubChatNameSync } from "../hooks/use-subchat-name-sync"
import { usePrGitOperations } from "../hooks/use-pr-git-operations"
import { clearSubChatDraft } from "../lib/drafts"
import { IPCChatTransport } from "../lib/ipc-chat-transport"
import {
  createQueueItem,
  generateQueueId,
  toQueuedDiffTextContext,
  toQueuedFile,
  toQueuedImage,
  toQueuedTextContext,
  type AgentQueueItem,
} from "../lib/queue-utils"
import { buildImagePart, buildFilePart } from "../lib/message-utils"
import { RemoteChatTransport } from "../lib/remote-chat-transport"
import {
  FileOpenProvider,
  MENTION_PREFIXES,
  type AgentsMentionsEditorHandle,
} from "../mentions"
import {
  ChatSearchBar,
  chatSearchCurrentMatchAtom,
  SearchHighlightProvider
} from "../search"
import { chatRegistry } from "../stores/chat-registry"
import { EMPTY_QUEUE, useMessageQueueStore } from "../stores/message-queue-store"
import { clearSubChatCaches, isRollingBackAtom, rollbackHandlerAtom, syncMessagesWithStatusAtom, currentSubChatIdAtom, messageIdsAtom, type MessagePart, type Message, type MessageMetadata } from "../stores/message-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import {
  useAgentSubChatStore,
  type SubChatMeta,
} from "../stores/sub-chat-store"
import {
  AgentDiffView,
  diffViewModeAtom,
  splitUnifiedDiffByFile,
  type AgentDiffViewRef,
  type ParsedDiffFile,
} from "../ui/agent-diff-view"
import { AgentPlanSidebar } from "../ui/agent-plan-sidebar"
import { AgentQueueIndicator } from "../ui/agent-queue-indicator"
import { AgentToolCall } from "../ui/agent-tool-call"
import { AgentToolRegistry } from "../ui/agent-tool-registry"
import { isPlanFile } from "../ui/agent-tool-utils"
import { AgentUserMessageBubble } from "../ui/agent-user-message-bubble"
import { AgentUserQuestion, type AgentUserQuestionHandle } from "../ui/agent-user-question"
import { ChatTitleEditor } from "../ui/chat-title-editor"
import { DocumentCommentInput } from "../ui/document-comment-input"
import { useCommentInput } from "../hooks/use-comment-input"
import { ReviewButton } from "../ui/review-button"
import { SubChatStatusCard } from "../ui/sub-chat-status-card"
import { TextSelectionPopover } from "../ui/text-selection-popover"
import { autoRenameAgentChat } from "../utils/auto-rename"
import { ChatInputArea } from "./chat-input-area"
import { CHAT_LAYOUT } from "./constants"
import { IsolatedMessagesSection } from "./isolated-messages-section"
import { ExplorerPanel } from "../../details-sidebar/sections/explorer-panel"
import { explorerPanelOpenAtomFamily } from "../atoms"
import type { ProjectMode } from "../../../../shared/feature-config"
import type { AgentChat, ChatProject } from "../types"
import { isRemoteChat, getSandboxId, getProjectPath, getRemoteStats } from "../types"
import { ChatInstanceValueProvider, type ChatInstanceContextValue } from "../context/chat-instance-context"
import { ChatCapabilitiesProvider } from "../context/chat-capabilities-context"
const clearSubChatSelectionAtom = atom(null, () => {})
const isSubChatMultiSelectModeAtom = atom(false)
const selectedSubChatIdsAtom = atom(new Set<string>())
// import { selectedTeamIdAtom } from "@/lib/atoms/team"
const selectedTeamIdAtom = atom<string | null>(null)
// import type { PlanType } from "@/lib/config/subscription-plans"
// PlanType stub - cloud subscription plans are disabled

// Module-level Map to track pending cache cleanup timeouts
// Used to cancel cleanup if component remounts with same subChatId
const pendingCacheCleanups = new Map<string, ReturnType<typeof setTimeout>>()

// Inner chat component - only rendered when chat object is ready
// Memoized to prevent re-renders when parent state changes (e.g., selectedFilePath)
const ChatViewInner = memo(function ChatViewInner({
  chat,
  subChatId,
  parentChatId,
  isFirstSubChat,
  onAutoRename,
  onCreateNewSubChat,
  refreshDiff,
  teamId,
  repository,
  streamId,
  isMobile = false,
  sandboxSetupStatus = "ready",
  sandboxSetupError,
  onRetrySetup,
  isSubChatsSidebarOpen = false,
  sandboxId,
  projectPath,
  isArchived = false,
  onRestoreWorkspace,
  existingPrUrl,
  isActive = true,
}: {
  chat: Chat<any>
  subChatId: string
  parentChatId: string
  isFirstSubChat: boolean
  onAutoRename: (userMessage: string, subChatId: string) => void
  onCreateNewSubChat?: () => void
  refreshDiff?: () => void
  teamId?: string
  repository?: string
  streamId?: string | null
  isMobile?: boolean
  sandboxSetupStatus?: "cloning" | "ready" | "error"
  sandboxSetupError?: string
  onRetrySetup?: () => void
  isSubChatsSidebarOpen?: boolean
  sandboxId?: string
  projectPath?: string
  isArchived?: boolean
  onRestoreWorkspace?: () => void
  existingPrUrl?: string | null
  isActive?: boolean
}) {
  const hasTriggeredRenameRef = useRef(false)
  const hasTriggeredAutoGenerateRef = useRef(false)

  // Keep isActive in ref for use in callbacks (avoid stale closures)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  // Auto-scroll management via custom hook
  const {
    chatContainerRef,
    chatContainerObserverRef,
    shouldAutoScrollRef,
    isAutoScrollingRef,
    isInitializingScrollRef,
    hasUnapprovedPlanRef,
    handleScroll,
    scrollToBottom,
    isAtBottom,
    enableAutoScroll,
  } = useAutoScroll(isActive)

  // Memory router: scroll to target message when navigated via useNavigate
  // onScrollInitialized callback enables auto-scroll after routing-triggered scroll completes
  // Note: useScrollToTarget is called below after useChat to access messages.length
  const handleScrollInitialized = useCallback(() => {
    shouldAutoScrollRef.current = true
    isInitializingScrollRef.current = false
  }, [])

  const editorRef = useRef<AgentsMentionsEditorHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const questionRef = useRef<AgentUserQuestionHandle>(null)
  const prevSubChatIdRef = useRef<string | null>(null)

  // Project mode for hiding git features in SubChatStatusCard
  const projectMode = useAtomValue(currentProjectModeAtom)

  // Consume pending mentions from external components (e.g. MCP widget in sidebar)
  // Only the active subchat should process the mention to avoid writing drafts to all subchats
  const [pendingMention, setPendingMention] = useAtom(pendingMentionAtom)
  useEffect(() => {
    if (pendingMention && isActive) {
      editorRef.current?.insertMention(pendingMention)
      editorRef.current?.focus()
      setPendingMention(null)
    }
  }, [pendingMention, setPendingMention, isActive])

  // PR creation loading state - from atom to allow resetting after message sent
  const setIsCreatingPr = useSetAtom(isCreatingPrAtom)

  // Rollback state
  const [isRollingBack, setIsRollingBack] = useState(false)

  // tRPC utils for cache invalidation
  const utils = api.useUtils()

  // For confirming name on manual rename (stop shimmer)
  const setUnconfirmedNameSubChats = useSetAtom(unconfirmedNameSubChatsAtom)

  // For cleaning up pending plan approvals on unmount
  const setPendingPlanApprovals = useSetAtom(pendingPlanApprovalsAtom)

  // Get sub-chat name from store
  const subChatName = useAgentSubChatStore(
    (state) => state.allSubChats.find((sc) => sc.id === subChatId)?.name || "",
  )

  // Mutation for renaming sub-chat
  const renameSubChatMutation = api.agents.renameSubChat.useMutation({
    onError: (error) => {
      if (error.data?.code === "NOT_FOUND") {
        toast.error("Send a message first before renaming this chat")
      } else {
        toast.error("Failed to rename chat")
      }
    },
  })

  // Handler for renaming sub-chat
  // Using ref for mutation to avoid callback recreation
  const renameSubChatMutationRef = useRef(renameSubChatMutation)
  renameSubChatMutationRef.current = renameSubChatMutation
  const subChatNameRef = useRef(subChatName)
  subChatNameRef.current = subChatName

  const handleRenameSubChat = useCallback(
    async (newName: string) => {
      // Optimistic update in store
      useAgentSubChatStore.getState().updateSubChatName(subChatId, newName)

      // Save to database
      try {
        await renameSubChatMutationRef.current.mutateAsync({
          subChatId,
          name: newName,
        })
        // User manually renamed - confirm the name (stop shimmer if any)
        confirmName(setUnconfirmedNameSubChats, subChatId)
      } catch {
        // Revert on error (toast shown by mutation onError)
        useAgentSubChatStore
          .getState()
          .updateSubChatName(subChatId, subChatNameRef.current || "New Chat")
      }
    },
    [subChatId, setUnconfirmedNameSubChats],
  )

  // Plan mode state (per-subChat using atomFamily)
  const [subChatMode, setSubChatMode] = useAtom(subChatModeAtomFamily(subChatId))

  // Chat area full width mode
  const [isChatFullWidth, setIsChatFullWidth] = useAtom(agentsChatFullWidthAtom)

  // Mutation for updating sub-chat mode in database
  const updateSubChatModeMutation = api.agents.updateSubChatMode.useMutation({
    onSuccess: () => {
      // Invalidate to refetch with new mode from DB
      utils.agents.getAgentChat.invalidate({ chatId: parentChatId })
    },
    onError: (error, variables) => {
      // Don't revert if sub-chat not found in DB - it may not be persisted yet
      // This is expected for new sub-chats that haven't been saved to DB
      if (error.message === "Sub-chat not found") {
        console.warn("Sub-chat not found in DB, keeping local mode state")
        return
      }

      // Revert local state on error to maintain sync with database
      const revertedMode: AgentMode = variables.mode === "plan" ? "agent" : "plan"
      setSubChatMode(revertedMode)
      // Also update store for consistency
      useAgentSubChatStore
        .getState()
        .updateSubChatMode(variables.subChatId, revertedMode)
      console.error("Failed to update sub-chat mode:", error.message)
    },
  })

  // Sync atomFamily mode to Zustand store on mount/subChatId change
  // This ensures the sidebar shows the correct mode icon
  useEffect(() => {
    if (subChatId) {
      // Read mode directly from atomFamily to ensure we get the correct value
      const mode = appStore.get(subChatModeAtomFamily(subChatId))
      useAgentSubChatStore.getState().updateSubChatMode(subChatId, mode)
    }
  }, [subChatId])

  // NOTE: We no longer clear caches on deactivation.
  // With proper subChatId isolation, each chat's caches are separate.
  // Caches are only cleared on unmount (when tab is evicted from keep-alive pool).

  // Cleanup message caches on unmount (when tab is evicted from keep-alive)
  // CRITICAL: Use a delayed cleanup to avoid clearing caches during temporary unmount/remount
  // (e.g., React StrictMode, HMR, or parent re-render causing component remount)
  useEffect(() => {
    const currentSubChatId = subChatId
    return () => {
      // Delay cache clearing to allow remount to happen first
      // If the component remounts with the same subChatId, the sync will repopulate the atoms
      // If it truly unmounts, the timeout will clear the caches
      const timeoutId = setTimeout(() => {
        clearSubChatCaches(currentSubChatId)
      }, 100)

      // Store the timeout so it can be cancelled if the component remounts
      pendingCacheCleanups.set(currentSubChatId, timeoutId)
    }
  }, [subChatId])

  // Cancel pending cleanup if we remount with the same subChatId
  useEffect(() => {
    const pendingTimeout = pendingCacheCleanups.get(subChatId)
    if (pendingTimeout !== undefined) {
      clearTimeout(pendingTimeout)
      pendingCacheCleanups.delete(subChatId)
    }
  }, [subChatId])

  // File/image upload hook
  const {
    images,
    files,
    handleAddAttachments,
    removeImage,
    removeFile,
    clearAll,
    isUploading,
    setImagesFromDraft,
    setFilesFromDraft,
  } = useAgentsFileUpload(
    parentChatId ? `${parentChatId}:${subChatId}` : undefined
  )

  // Listen for browser screenshots to add to chat input
  const browserPendingScreenshotAtom = useMemo(
    () => browserPendingScreenshotAtomFamily(parentChatId),
    [parentChatId],
  )
  const [pendingScreenshot, setPendingScreenshot] = useAtom(browserPendingScreenshotAtom)
  useEffect(() => {
    if (!pendingScreenshot) return

    // Convert data URL to File and add as attachment
    const addScreenshotToInput = async () => {
      try {
        // Parse data URL: data:image/png;base64,xxxx
        const [header, base64Data] = pendingScreenshot.split(",")
        if (!base64Data) return

        const mimeMatch = header?.match(/data:([^;]+)/)
        const mimeType = mimeMatch?.[1] || "image/png"
        const extension = mimeType.split("/")[1] || "png"

        // Convert base64 to blob
        const byteCharacters = atob(base64Data)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: mimeType })

        // Create file
        const filename = `browser-screenshot-${Date.now()}.${extension}`
        const file = new File([blob], filename, { type: mimeType })

        // Add to attachments
        await handleAddAttachments([file])
      } catch (error) {
        console.error("Failed to add screenshot to input:", error)
      } finally {
        // Clear pending screenshot
        setPendingScreenshot(null)
      }
    }

    addScreenshotToInput()
  }, [pendingScreenshot, setPendingScreenshot, handleAddAttachments])

  // Text context selection hook (for selecting text from assistant messages and diff)
  const {
    textContexts,
    diffTextContexts,
    addTextContext: addTextContextOriginal,
    addDiffTextContext,
    removeTextContext,
    removeDiffTextContext,
    clearTextContexts,
    clearDiffTextContexts,
    textContextsRef,
    diffTextContextsRef,
    setTextContextsFromDraft,
    setDiffTextContextsFromDraft,
  } = useTextContextSelection()

  // Pasted text files (large pasted text saved as files)
  const {
    pastedTexts,
    addPastedText,
    removePastedText,
    clearPastedTexts,
    pastedTextsRef,
  } = usePastedTextFiles(subChatId)

  // File contents cache - stores content for file mentions (keyed by mentionId)
  // This content gets added to the prompt when sending, without showing a separate card
  const fileContentsRef = useRef<Map<string, string>>(new Map())
  const cacheFileContent = useCallback((mentionId: string, content: string) => {
    fileContentsRef.current.set(mentionId, content)
  }, [])
  const clearFileContents = useCallback(() => {
    fileContentsRef.current.clear()
  }, [])

  // Clear file contents cache when switching subChats to prevent stale data
  useEffect(() => {
    fileContentsRef.current.clear()
  }, [subChatId])

  // Comment input - unified handler for TextSelectionPopover
  const openCommentInput = useCommentInput()

  // Message queue for sending messages while streaming
  const queue = useMessageQueueStore((s) => s.queues[subChatId] ?? EMPTY_QUEUE)
  const addToQueue = useMessageQueueStore((s) => s.addToQueue)
  const removeFromQueue = useMessageQueueStore((s) => s.removeFromQueue)
  const popItemFromQueue = useMessageQueueStore((s) => s.popItem)


  // Track chat changes for rename trigger reset
  const chatRef = useRef<Chat<any> | null>(null)

  if (prevSubChatIdRef.current !== subChatId) {
    hasTriggeredRenameRef.current = false // Reset on sub-chat change
    hasTriggeredAutoGenerateRef.current = false // Reset auto-generate on sub-chat change
    prevSubChatIdRef.current = subChatId
  }
  chatRef.current = chat

  // Restore draft when subChatId changes (switching between sub-chats)
  useDraftRestoration({
    subChatId,
    parentChatId,
    editorRef,
    setImagesFromDraft,
    setFilesFromDraft,
    setTextContextsFromDraft,
    clearAll,
    clearTextContexts,
  })

  // Use subChatId as stable key to prevent HMR-induced duplicate resume requests
  // resume: !!streamId to reconnect to active streams (background streaming support)
  const { messages, sendMessage, status, stop, regenerate, setMessages } = useChat({
    id: subChatId,
    chat,
    resume: false,
    experimental_throttle: 50,  // Throttle updates to reduce re-renders during streaming
  })

  // Refs for useChat functions to keep callbacks stable across renders
  const sendMessageRef = useRef(sendMessage)
  sendMessageRef.current = sendMessage
  const stopRef = useRef(stop)
  stopRef.current = stop

  const isStreaming = status === "streaming" || status === "submitted"

  // Setup ChatView registration for multi-instance support
  // ChatInputProvider is now at App.tsx level, so multiple ChatViews can share it
  const { instanceId: chatViewInstanceId, isActiveInstance } = useChatViewSetup({
    chatId: parentChatId,
    subChatId,
    projectPath,
    sandboxId,
    teamId,
    isActive,
    isStreaming,
    isArchived,
    sandboxSetupStatus: sandboxSetupStatus === "cloning" ? "loading" : sandboxSetupStatus,
    sendMessageRef,
    stopRef,
    editorRef,
    shouldAutoScrollRef,
    scrollToBottom,
  })

  // Memory router: scroll to target message when navigated via useNavigate
  // messagesLoaded ensures we wait for messages before scrolling to specific messageId
  const messagesLoaded = messages.length > 0
  useScrollToTarget(chatContainerRef, subChatId, isActive, handleScrollInitialized, messagesLoaded)

  // Ref for isStreaming to use in callbacks/effects that need fresh value
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming

  // Track compacting status from SDK
  const compactingSubChats = useAtomValue(compactingSubChatsAtom)
  const isCompacting = compactingSubChats.has(subChatId)

  // Handler to trigger manual context compaction
  const handleCompact = useCallback(() => {
    if (isStreamingRef.current) return // Can't compact while streaming
    sendMessageRef.current({
      role: "user",
      parts: [{ type: "text", text: "/compact" }],
    })
  }, [])

  // Handler to stop streaming - memoized to prevent ChatInputArea re-renders
  const handleStop = useCallback(async () => {
    // Mark as manually aborted to prevent completion sound
    chatRegistry.setManuallyAborted(subChatId, true)
    await stopRef.current()
  }, [subChatId])

  // Wrapper for addTextContext that handles TextSelectionSource
  const addTextContext = useCallback((text: string, source: TextSelectionSource) => {
    if (source.type === "assistant-message") {
      addTextContextOriginal(text, source.messageId)
    } else if (source.type === "diff") {
      addDiffTextContext(text, source.filePath, source.lineNumber, source.lineType)
    } else if (source.type === "tool-edit") {
      // Tool edit selections are treated as code selections (similar to diff)
      addDiffTextContext(text, source.filePath)
    } else if (source.type === "plan") {
      // Plan selections are treated as code selections (similar to diff)
      addDiffTextContext(text, source.planPath)
    } else if (source.type === "file-viewer") {
      // File viewer selections are treated as code selections
      addDiffTextContext(text, source.filePath)
    }
  }, [addTextContextOriginal, addDiffTextContext])

  // Focus handler for text selection popover - focus chat input after adding to context
  const handleFocusInput = useCallback(() => {
    editorRef.current?.focus()
  }, [])

  // Listen for file-viewer "Add to Context" from the custom context menu
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        text: string
        source: TextSelectionSource
      }
      if (detail.text && detail.source) {
        addTextContext(detail.text, detail.source)
        editorRef.current?.focus()
      }
    }
    window.addEventListener("file-viewer-add-to-context", handler)
    return () => window.removeEventListener("file-viewer-add-to-context", handler)
  }, [addTextContext])

  // Sync loading status to atom for UI indicators
  // Only SET loading here when streaming starts.
  // CLEARING is handled exclusively by onFinish/onError callbacks in getOrCreateChat,
  // because isStreaming can briefly become false between tool calls (e.g. during bash execution)
  // while the overall turn is still in progress.
  const setLoadingSubChats = useSetAtom(loadingSubChatsAtom)

  useEffect(() => {
    if (!isStreaming) return
    const storedParentChatId = chatRegistry.getEntry(subChatId)?.parentChatId
    if (!storedParentChatId) return

    setLoading(setLoadingSubChats, subChatId, storedParentChatId)
  }, [isStreaming, subChatId, setLoadingSubChats])

  // Handle pending messages (PR, Review, Conflict Resolution)
  usePendingMessageHandling({
    isStreaming,
    isActive,
    sendMessage,
  })

  // Handle pending "Build plan" from sidebar (atom - effect is defined after handleApprovePlan)
  const [pendingBuildPlanSubChatId, setPendingBuildPlanSubChatId] = useAtom(
    pendingBuildPlanSubChatIdAtom,
  )

  // Pending user questions from AskUserQuestion tool
  const [pendingQuestionsMap, setPendingQuestionsMap] = useAtom(
    pendingUserQuestionsAtom,
  )
  // Get pending questions for this specific subChat
  const pendingQuestions = pendingQuestionsMap.get(subChatId) ?? null

  // Expired user questions (timed out but still answerable as normal messages)
  const [expiredQuestionsMap, setExpiredQuestionsMap] = useAtom(
    expiredUserQuestionsAtom,
  )
  const expiredQuestions = expiredQuestionsMap.get(subChatId) ?? null

  // Unified display questions: prefer pending (live), fall back to expired
  const displayQuestions = pendingQuestions ?? expiredQuestions
  const isQuestionExpired = !pendingQuestions && !!expiredQuestions

  // Track whether chat input has content (for custom text with questions)
  const [inputHasContent, setInputHasContent] = useState(false)

  // Memoize the last assistant message to avoid unnecessary recalculations
  const lastAssistantMessage = useMemo(
    () => messages.findLast((m) => m.role === "assistant"),
    [messages],
  )

  // Pre-compute token data for ChatInputArea to avoid passing unstable messages array
  // This prevents ChatInputArea from re-rendering on every streaming chunk
  // After compaction, only count tokens from messages after the compact boundary
  const messageTokenData = useMemo(() => {
    let totalCostUsd = 0

    // Sum cost across all messages
    for (const msg of messages) {
      if (msg.metadata) {
        totalCostUsd += msg.metadata.totalCostUsd || 0
      }
    }

    // Context window usage estimation:
    //
    // SDK's metadata.inputTokens/outputTokens are CUMULATIVE across ALL API calls
    // in the agentic loop, NOT per-call values. Using them directly would massively
    // overcount (e.g. 3 tool calls in one turn → ~3x inflation).
    //
    // We now capture per-API-call tokens from streaming events (message_start has
    // input_tokens, message_delta has output_tokens). The LAST API call's input
    // tokens = actual context window size. Adding its output tokens gives the
    // approximate context for the next request.
    //
    // Fallback: if per-call data isn't available (e.g. non-streaming or Ollama),
    // use cumulative values as a rough upper bound.
    let lastCallInputTokens = 0
    let lastCallOutputTokens = 0
    let lastCumulativeInputTokens = 0
    let lastCumulativeOutputTokens = 0

    // Find the last message with token data
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.metadata && (msg.metadata.inputTokens || msg.metadata.outputTokens)) {
        lastCumulativeInputTokens = msg.metadata.inputTokens || 0
        lastCumulativeOutputTokens = msg.metadata.outputTokens || 0
        lastCallInputTokens = msg.metadata.lastCallInputTokens || 0
        lastCallOutputTokens = msg.metadata.lastCallOutputTokens || 0
        break
      }
    }

    return {
      // Per-call values (accurate context window size)
      lastCallInputTokens,
      lastCallOutputTokens,
      // Cumulative values (for fallback and cost display)
      totalInputTokens: lastCumulativeInputTokens,
      totalOutputTokens: lastCumulativeOutputTokens,
      totalCostUsd,
      messageCount: messages.length,
    }
  }, [messages])

  // Track previous streaming state to detect stream stop
  const prevIsStreamingRef = useRef(isStreaming)
  // Track if we recently stopped streaming (to prevent sync effect from restoring)
  const recentlyStoppedStreamRef = useRef(false)

  // Clear pending questions when streaming is aborted
  // This effect runs when isStreaming transitions from true to false
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current
    prevIsStreamingRef.current = isStreaming

    // Detect streaming stop transition
    if (wasStreaming && !isStreaming) {
      // Mark that we recently stopped streaming
      recentlyStoppedStreamRef.current = true
      // Clear the flag after a delay
      const flagTimeout = setTimeout(() => {
        recentlyStoppedStreamRef.current = false
      }, 500)

      // Streaming just stopped - if there's a pending question for this chat,
      // clear it after a brief delay (backend already handled the abort)
      if (pendingQuestions) {
        const timeout = setTimeout(() => {
          // Re-check if still showing the same question (might have been cleared by other means)
          setPendingQuestionsMap((current) => {
            if (current.has(subChatId)) {
              const newMap = new Map(current)
              newMap.delete(subChatId)
              return newMap
            }
            return current
          })
        }, 150) // Small delay to allow for race conditions with transport chunks
        return () => {
          clearTimeout(timeout)
          clearTimeout(flagTimeout)
        }
      }
      return () => clearTimeout(flagTimeout)
    }
  }, [isStreaming, subChatId, pendingQuestions, setPendingQuestionsMap])

  // Sync pending questions with messages state
  // This handles: 1) restoring on chat switch, 2) clearing when question is answered/timed out
  useEffect(() => {
    // Check if there's a pending AskUserQuestion in the last assistant message
    const pendingQuestionPart = lastAssistantMessage?.parts?.find(
      (part: MessagePart) =>
        part.type === "tool-AskUserQuestion" &&
        part.state !== "output-available" &&
        part.state !== "output-error" &&
        part.state !== "result" &&
        part.input?.questions,
    ) as MessagePart | undefined


    // Helper to clear pending question for this subChat
    const clearPendingQuestion = () => {
      setPendingQuestionsMap((current) => {
        if (current.has(subChatId)) {
          const newMap = new Map(current)
          newMap.delete(subChatId)
          return newMap
        }
        return current
      })
    }

    // If streaming and we already have a pending question for this chat, keep it
    // (transport will manage it via chunks)
    if (isStreaming && pendingQuestions) {
      // But if the question in messages is already answered, clear the atom
      if (!pendingQuestionPart) {
        // Check if the specific toolUseId is now answered
        const answeredPart = lastAssistantMessage?.parts?.find(
          (part: any) =>
            part.type === "tool-AskUserQuestion" &&
            part.toolCallId === pendingQuestions.toolUseId &&
            (part.state === "output-available" ||
              part.state === "output-error" ||
              part.state === "result"),
        )
        if (answeredPart) {
          clearPendingQuestion()
        }
      }
      return
    }

    // Not streaming - DON'T restore pending questions from messages
    // If stream is not active, the question is either:
    // 1. Already answered (state would be "output-available")
    // 2. Interrupted/aborted (should not show dialog)
    // 3. Timed out (should not show dialog)
    // We only show the question dialog during active streaming when
    // the backend is waiting for user response.
    if (pendingQuestionPart) {
      // Don't restore - if there's an existing pending question for this chat, clear it
      if (pendingQuestions) {
        clearPendingQuestion()
      }
    } else {
      // No pending question - clear if belongs to this sub-chat
      if (pendingQuestions) {
        clearPendingQuestion()
      }
    }
  }, [subChatId, lastAssistantMessage, isStreaming, pendingQuestions, setPendingQuestionsMap])

  // Helper to clear pending and expired questions for this subChat (used in callbacks)
  const clearPendingQuestionCallback = useCallback(() => {
    setPendingQuestionsMap((current) => {
      if (current.has(subChatId)) {
        const newMap = new Map(current)
        newMap.delete(subChatId)
        return newMap
      }
      return current
    })
    setExpiredQuestionsMap((current) => {
      if (current.has(subChatId)) {
        const newMap = new Map(current)
        newMap.delete(subChatId)
        return newMap
      }
      return current
    })
  }, [subChatId, setPendingQuestionsMap, setExpiredQuestionsMap])

  // Shared helpers for question answer handlers
  const formatAnswersAsText = useCallback(
    (answers: Record<string, string>): string =>
      Object.entries(answers)
        .map(([question, answer]) => `${question}: ${answer}`)
        .join("\n"),
    [],
  )

  const clearInputAndDraft = useCallback(() => {
    editorRef.current?.clear()
    if (parentChatId) {
      clearSubChatDraft(parentChatId, subChatId)
    }
  }, [parentChatId, subChatId])

  const sendUserMessage = useCallback(async (text: string) => {
    shouldAutoScrollRef.current = true
    await sendMessageRef.current({
      role: "user",
      parts: [{ type: "text", text }],
    })
  }, [])

  // Handle answering questions
  const handleQuestionsAnswer = useCallback(
    async (answers: Record<string, string>) => {
      if (!displayQuestions) return

      if (isQuestionExpired) {
        // Question timed out - send answers as a normal user message
        clearPendingQuestionCallback()
        await sendUserMessage(formatAnswersAsText(answers))
      } else {
        // Question is still live - use tool approval path
        await trpcClient.claude.respondToolApproval.mutate({
          toolUseId: displayQuestions.toolUseId,
          approved: true,
          updatedInput: { questions: displayQuestions.questions, answers },
        })
        clearPendingQuestionCallback()
      }
    },
    [displayQuestions, isQuestionExpired, clearPendingQuestionCallback, sendUserMessage, formatAnswersAsText],
  )

  // Handle skipping questions
  const handleQuestionsSkip = useCallback(async () => {
    if (!displayQuestions) return

    if (isQuestionExpired) {
      // Expired question - just clear the UI, no backend call needed
      clearPendingQuestionCallback()
      return
    }

    const toolUseId = displayQuestions.toolUseId

    // Clear UI immediately - don't wait for backend
    // This ensures dialog closes even if stream was already aborted
    clearPendingQuestionCallback()

    // Try to notify backend (may fail if already aborted - that's ok)
    try {
      await trpcClient.claude.respondToolApproval.mutate({
        toolUseId,
        approved: false,
        message: QUESTIONS_SKIPPED_MESSAGE,
      })
    } catch {
      // Stream likely already aborted - ignore
    }
  }, [displayQuestions, isQuestionExpired, clearPendingQuestionCallback])

  // Ref to prevent double submit of question answer
  const isSubmittingQuestionAnswerRef = useRef(false)

  // Handle answering questions with custom text from input (called on Enter in input)
  const handleSubmitWithQuestionAnswer = useCallback(
    async () => {
      if (!displayQuestions) return
      if (isSubmittingQuestionAnswerRef.current) return
      isSubmittingQuestionAnswerRef.current = true

      try {
        // 1. Get custom text from input
        const customText = editorRef.current?.getValue()?.trim() || ""
        if (!customText) {
          isSubmittingQuestionAnswerRef.current = false
          return
        }

        // 2. Get already selected answers from question component
        const selectedAnswers = questionRef.current?.getAnswers() || {}
        const formattedAnswers: Record<string, string> = { ...selectedAnswers }

        // 3. Add custom text to the last question as "Other"
        const lastQuestion =
          displayQuestions.questions[displayQuestions.questions.length - 1]
        if (lastQuestion) {
          const existingAnswer = formattedAnswers[lastQuestion.question]
          if (existingAnswer) {
            // Append to existing answer
            formattedAnswers[lastQuestion.question] = `${existingAnswer}, Other: ${customText}`
          } else {
            formattedAnswers[lastQuestion.question] = `Other: ${customText}`
          }
        }

        if (isQuestionExpired) {
          // Expired: send user's custom text as-is (don't format)
          clearPendingQuestionCallback()
          clearInputAndDraft()
          // await sendUserMessage(formatAnswersAsText(formattedAnswers))
          await sendUserMessage(customText)
        } else {
          // Live: use existing tool approval flow
          await trpcClient.claude.respondToolApproval.mutate({
            toolUseId: displayQuestions.toolUseId,
            approved: true,
            updatedInput: {
              questions: displayQuestions.questions,
              answers: formattedAnswers,
            },
          })
          clearPendingQuestionCallback()

          // Stop stream if currently streaming
          if (isStreamingRef.current) {
            chatRegistry.setManuallyAborted(subChatId, true)
            await stopRef.current()
            await new Promise((resolve) => setTimeout(resolve, 100))
          }

          clearInputAndDraft()
          await sendUserMessage(customText)
        }
      } finally {
        isSubmittingQuestionAnswerRef.current = false
      }
    },
    [displayQuestions, isQuestionExpired, clearPendingQuestionCallback, clearInputAndDraft, sendUserMessage, formatAnswersAsText, subChatId],
  )

  // Memoize the callback to prevent ChatInputArea re-renders
  // Only provide callback when there's a pending or expired question for this subChat
  const submitWithQuestionAnswerCallback = useMemo(
    () =>
      displayQuestions
        ? handleSubmitWithQuestionAnswer
        : undefined,
    [displayQuestions, handleSubmitWithQuestionAnswer],
  )

  // Watch for pending auth retry message (after successful OAuth flow)
  const [pendingAuthRetry, setPendingAuthRetry] = useAtom(
    pendingAuthRetryMessageAtom,
  )

  useEffect(() => {
    // Only retry when:
    // 1. There's a pending message
    // 2. readyToRetry is true (set by modal on OAuth success)
    // 3. We're in the correct chat
    // 4. Not currently streaming
    if (
      pendingAuthRetry &&
      pendingAuthRetry.readyToRetry &&
      pendingAuthRetry.subChatId === subChatId &&
      !isStreaming
    ) {
      // Clear the pending message immediately to prevent double-sending
      setPendingAuthRetry(null)

      // Build message parts
      const parts: Array<
        { type: "text"; text: string } | { type: "data-image"; data: any }
      > = [{ type: "text", text: pendingAuthRetry.prompt }]

      // Add images if present
      if (pendingAuthRetry.images && pendingAuthRetry.images.length > 0) {
        for (const img of pendingAuthRetry.images) {
          parts.push({
            type: "data-image",
            data: {
              base64Data: img.base64Data,
              mediaType: img.mediaType,
              filename: img.filename,
            },
          })
        }
      }

      // Send the message to Claude
      sendMessage({
        role: "user",
        parts,
      })
    }
  }, [
    pendingAuthRetry,
    isStreaming,
    sendMessage,
    setPendingAuthRetry,
    subChatId,
  ])

  // Handle plan approval - sends "Build plan" message and switches to agent mode
  const handleApprovePlan = useCallback(() => {
    trackClickPlanApprove()
    // Update store mode synchronously BEFORE sending (transport reads from store)
    useAgentSubChatStore.getState().updateSubChatMode(subChatId, "agent")

    // Sync mode to database for sidebar indicator (getPendingPlanApprovals)
    if (!subChatId.startsWith("temp-")) {
      updateSubChatModeMutation.mutate({ subChatId, mode: "agent" })
    }

    // Update atomFamily state (for UI) - this also syncs to store via effect
    setSubChatMode("agent")

    // Enable auto-scroll and immediately scroll to bottom
    shouldAutoScrollRef.current = true
    scrollToBottom()

    // Send "Build plan" message (now in agent mode)
    sendMessageRef.current({
      role: "user",
      parts: [{ type: "text", text: "Implement plan" }],
    })
  }, [subChatId, setSubChatMode, scrollToBottom, updateSubChatModeMutation])

  // Handle pending "Build plan" from sidebar
  useEffect(() => {
    // Only trigger if this is the target sub-chat and we're active
    if (pendingBuildPlanSubChatId === subChatId && isActive) {
      setPendingBuildPlanSubChatId(null) // Clear immediately to prevent double-trigger
      handleApprovePlan()
    }
  }, [pendingBuildPlanSubChatId, subChatId, isActive, setPendingBuildPlanSubChatId, handleApprovePlan])

  // Detect PR URLs in assistant messages and store them
  usePrUrlDetection({
    messages,
    isStreaming,
    parentChatId,
    existingPrUrl,
  })

  // Track plan Edit completions to trigger sidebar refetch
  usePlanEditTracking({ messages, subChatId })

  const { changedFiles: changedFilesForSubChat, recomputeChangedFiles } = useChangedFilesTracking(
    messages,
    subChatId,
    isStreaming,
    parentChatId,
  )

  // Rollback handler - truncates messages to the clicked assistant message and restores git state
  // The SDK UUID from the last assistant message will be used for resumeSessionAt on next send
  const handleRollback = useCallback(
    async (assistantMsg: (typeof messages)[0]) => {
      if (isRollingBack) {
        toast.error("Rollback already in progress")
        return
      }
      if (isStreaming) {
        toast.error("Cannot rollback while streaming")
        return
      }

      const sdkUuid = (assistantMsg.metadata as MessageMetadata | undefined)?.sdkMessageUuid
      if (!sdkUuid) {
        toast.error("Cannot rollback: message has no SDK UUID")
        return
      }

      // Find the index of this message in the current messages array (for fallback)
      const messageIndex = messages.findIndex(m => m.id === assistantMsg.id)

      // Debug logging to diagnose rollback issues
      console.log("[handleRollback] Rolling back to message:", {
        messageId: assistantMsg.id,
        sdkUuid,
        messageIndex,
        totalMessages: messages.length,
        allAssistantUuids: messages
          .filter(m => m.role === "assistant")
          .map(m => ({
            id: m.id,
            sdkUuid: (m.metadata as MessageMetadata | undefined)?.sdkMessageUuid,
          })),
      })

      setIsRollingBack(true)

      try {
        // Single call handles both message truncation and git rollback
        const result = await trpcClient.chats.rollbackToMessage.mutate({
          subChatId,
          sdkMessageUuid: sdkUuid,
          messageIndex: messageIndex >= 0 ? messageIndex : undefined,
        })

        if (!result.success) {
          toast.error(`Failed to rollback: ${result.error}`)
          setIsRollingBack(false)
          return
        }

        // Update local state with truncated messages from server
        setMessages(result.messages)
        recomputeChangedFiles(result.messages)
        refreshDiff?.()
      } catch (error) {
        console.error("[handleRollback] Error:", error)
        toast.error("Failed to rollback")
      } finally {
        setIsRollingBack(false)
      }
    },
    [
      isRollingBack,
      isStreaming,
      messages,
      setMessages,
      subChatId,
      recomputeChangedFiles,
      refreshDiff,
    ],
  )

  // Expose rollback handler/state via atoms for message action bar
  const setRollbackHandler = useSetAtom(rollbackHandlerAtom)
  useEffect(() => {
    setRollbackHandler(() => handleRollback)
    return () => setRollbackHandler(null)
  }, [handleRollback, setRollbackHandler])

  const setIsRollingBackAtom = useSetAtom(isRollingBackAtom)
  useEffect(() => {
    setIsRollingBackAtom(isRollingBack)
  }, [isRollingBack, setIsRollingBackAtom])

  // ESC, Ctrl+C and Cmd+Shift+Backspace handler for stopping stream
  useStreamStopShortcuts({
    isActive,
    isStreaming,
    subChatId,
    stop,
    displayQuestions,
    handleQuestionsSkip,
  })

  // Keyboard shortcut: Enter to focus input when not already focused
  useFocusInputOnEnter(editorRef)

  // Keyboard shortcut: Cmd+Esc to toggle focus/blur (without stopping generation)
  useToggleFocusOnCmdEsc(editorRef)

  // Auto-trigger AI response when we have initial message but no response yet
  // Also trigger auto-rename for initial sub-chat with pre-populated message
  // IMPORTANT: Skip if there's an active streamId (prevents double-generation on resume)
  useEffect(() => {
    if (
      messages.length === 1 &&
      status === "ready" &&
      !streamId &&
      !hasTriggeredAutoGenerateRef.current
    ) {
      hasTriggeredAutoGenerateRef.current = true
      // Trigger rename for pre-populated initial message (from createAgentChat)
      if (!hasTriggeredRenameRef.current) {
        const firstMsg = messages[0]
        if (firstMsg?.role === "user") {
          const textPart = firstMsg.parts?.find((p: any) => p.type === "text")
          if (textPart && "text" in textPart) {
            hasTriggeredRenameRef.current = true
            onAutoRename(textPart.text, subChatId)
          }
        }
      }
      regenerate()
    }
  }, [
    status,
    messages,
    regenerate,
    isFirstSubChat,
    onAutoRename,
    streamId,
    subChatId,
  ])

  // Track if this tab has been initialized (for keep-alive)
  const hasInitializedRef = useRef(false)
  // Track previous subChatId to detect subchat changes
  const prevSubChatIdForScrollRef = useRef<string | null>(null)

  // Set scroll target to bottom when subchat becomes active without an existing scroll target
  // This handles cases where user clicks on a chat/workspace directly (not through navigateToSubChat)
  const setScrollTarget = useSetAtom(scrollTargetAtom)
  useEffect(() => {
    if (!isActive) return
    // Skip if subChatId hasn't changed
    if (prevSubChatIdForScrollRef.current === subChatId) return
    prevSubChatIdForScrollRef.current = subChatId

    // Check if there's already a pending scroll target
    const currentTarget = appStore.get(scrollTargetAtom)
    if (currentTarget && !currentTarget.consumed) {
      // Already have a scroll target (from routing), let it handle the scroll
      return
    }

    // No scroll target - set one to scroll to bottom
    // This triggers useScrollToTarget which will scroll to bottom and call handleScrollInitialized
    setScrollTarget({
      messageId: SCROLL_TO_BOTTOM,
      consumed: false,
    })
  }, [isActive, subChatId, setScrollTarget])

  // MutationObserver for async content (images, code blocks loading after initial render)
  // Initial scroll is now handled by routing via useScrollToTarget,
  // but we still need MutationObserver to keep scrolling when content loads dynamically
  useEffect(() => {
    // Skip if not active (keep-alive: hidden tabs don't need scroll init)
    if (!isActive) return

    const container = chatContainerRef.current
    if (!container) return

    // Mark scroll as initializing - will be set to false by useScrollToTarget callback
    // Only do this on first mount, not on every re-render
    if (!hasInitializedRef.current) {
      hasInitializedRef.current = true
      isInitializingScrollRef.current = true
    }

    // MutationObserver for async content (images, code blocks loading after initial render)
    const observer = new MutationObserver((mutations) => {
      // Skip if not active (keep-alive: don't scroll hidden tabs)
      if (!isActive) return
      if (!shouldAutoScrollRef.current) return
      // Skip during initialization - let routing handle initial scroll
      if (isInitializingScrollRef.current) return

      // Check if content was added
      const hasAddedContent = mutations.some(
        (m) => m.type === "childList" && m.addedNodes.length > 0
      )

      if (hasAddedContent) {
        requestAnimationFrame(() => {
          isAutoScrollingRef.current = true
          container.scrollTop = container.scrollHeight
          requestAnimationFrame(() => {
            isAutoScrollingRef.current = false
          })
        })
      }
    })

    observer.observe(container, { childList: true, subtree: true })

    return () => {
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subChatId, isActive])

  // Attach scroll listener (separate effect)
  useEffect(() => {
    const container = chatContainerRef.current
    if (!container) return

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => {
      container.removeEventListener("scroll", handleScroll)
    }
  }, [handleScroll])

  // Auto scroll to bottom when messages change during streaming
  // Only kicks in after content fills the viewport (overflow behavior)
  useEffect(() => {
    // Skip if not active (keep-alive: don't scroll hidden tabs)
    if (!isActive) return
    // Skip if scroll not yet initialized (routing-triggered scroll still pending)
    if (isInitializingScrollRef.current) return

    // Auto-scroll during streaming if user hasn't scrolled up
    if (shouldAutoScrollRef.current && status === "streaming") {
      const container = chatContainerRef.current
      if (container) {
        // Always scroll during streaming if auto-scroll is enabled
        // (user can disable by scrolling up)
        requestAnimationFrame(() => {
          isAutoScrollingRef.current = true
          container.scrollTop = container.scrollHeight
          requestAnimationFrame(() => {
            isAutoScrollingRef.current = false
          })
        })
      }
    }
  }, [isActive, messages, status, subChatId])

  // Auto-focus input when switching to this chat (any sub-chat change)
  // Skip on mobile to prevent keyboard from opening automatically
  useEffect(() => {
    // Skip if not active (keep-alive: don't focus hidden tabs)
    if (!isActive) return
    if (isMobile) return // Don't autofocus on mobile

    // Use requestAnimationFrame to ensure DOM is ready after render
    requestAnimationFrame(() => {
      // Skip if sidebar keyboard navigation is active (user is arrowing through sidebar items)
      if (appStore.get(suppressInputFocusAtom)) {
        appStore.set(suppressInputFocusAtom, false)
        return
      }
      editorRef.current?.focus()
    })
  }, [isActive, subChatId, isMobile])

  // Refs for handleSend to avoid recreating callback on every messages change
  const messagesLengthRef = useRef(messages.length)
  messagesLengthRef.current = messages.length
  const subChatModeRef = useRef(subChatMode)
  subChatModeRef.current = subChatMode
  const imagesRef = useRef(images)
  imagesRef.current = images
  const filesRef = useRef(files)
  filesRef.current = files

  const handleSend = useCallback(async () => {
    // Block sending while sandbox is still being set up
    if (sandboxSetupStatus !== "ready") {
      return
    }

    // Clear any expired questions when user sends a new message
    setExpiredQuestionsMap((current) => {
      if (current.has(subChatId)) {
        const newMap = new Map(current)
        newMap.delete(subChatId)
        return newMap
      }
      return current
    })

    // Get value from uncontrolled editor
    const inputValue = editorRef.current?.getValue() || ""
    const hasText = inputValue.trim().length > 0
    const currentImages = imagesRef.current
    const currentFiles = filesRef.current
    const currentTextContexts = textContextsRef.current
    const currentPastedTexts = pastedTextsRef.current
    const currentDiffTextContexts = diffTextContextsRef.current
    const hasImages =
      currentImages.filter((img) => !img.isLoading && img.url).length > 0
    const hasTextContexts = currentTextContexts.length > 0
    const hasPastedTexts = currentPastedTexts.length > 0
    const hasDiffTextContexts = currentDiffTextContexts.length > 0

    if (!hasText && !hasImages && !hasTextContexts && !hasPastedTexts && !hasDiffTextContexts) return

    // If streaming, add to queue instead of sending directly
    if (isStreamingRef.current) {
      const queuedImages = currentImages
        .filter((img) => !img.isLoading && img.url)
        .map(toQueuedImage)
      const queuedFiles = currentFiles
        .filter((f) => !f.isLoading && f.url)
        .map(toQueuedFile)
      const queuedTextContexts = currentTextContexts.map(toQueuedTextContext)
      const queuedDiffTextContexts = currentDiffTextContexts.map(toQueuedDiffTextContext)

      const item = createQueueItem(
        generateQueueId(),
        inputValue.trim(),
        queuedImages.length > 0 ? queuedImages : undefined,
        queuedFiles.length > 0 ? queuedFiles : undefined,
        queuedTextContexts.length > 0 ? queuedTextContexts : undefined,
        queuedDiffTextContexts.length > 0 ? queuedDiffTextContexts : undefined
      )
      addToQueue(subChatId, item)

      // Clear input and attachments
      editorRef.current?.clear()
      if (parentChatId) {
        clearSubChatDraft(parentChatId, subChatId)
      }
      clearAll()
      clearTextContexts()
      clearDiffTextContexts()
      clearPastedTexts()
      return
    }

    // Auto-restore archived workspace when sending a message
    if (isArchived && onRestoreWorkspace) {
      onRestoreWorkspace()
    }

    const text = inputValue.trim()

    // Expand custom slash commands with arguments (e.g. "/Apex my argument")
    // This mirrors the logic in new-chat-form.tsx
    let finalText = text
    const slashMatch = text.match(/^\/(\S+)\s*(.*)$/s)
    if (slashMatch) {
      const [, commandName, args] = slashMatch
      const builtinNames = new Set(
        BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.name),
      )
      if (!builtinNames.has(commandName)) {
        try {
          const commands = await trpcClient.commands.list.query({
            projectPath,
          })
          const cmd = commands.find(
            (c) => c.name.toLowerCase() === commandName.toLowerCase(),
          )
          if (cmd) {
            const { content } = await trpcClient.commands.getContent.query({
              path: cmd.path,
            })
            finalText = content.replace(/\$ARGUMENTS/g, args.trim())
          }
        } catch (error) {
          console.error("Failed to expand custom slash command:", error)
        }
      }
    }

    // Clear editor and draft from localStorage
    editorRef.current?.clear()
    if (parentChatId) {
      clearSubChatDraft(parentChatId, subChatId)
    }

    // Trigger auto-rename on first message in a new sub-chat
    if (messagesLengthRef.current === 0 && !hasTriggeredRenameRef.current) {
      hasTriggeredRenameRef.current = true
      onAutoRename(finalText || "Image message", subChatId)
    }

    // Build message parts: images first, then files, then text
    // Small images (< 5MB) are inlined as base64; large images use file path reference
    // Claude API supports up to 8MB inline base64, 5MB leaves reasonable headroom
    const parts: any[] = [
      ...currentImages
        .filter((img) => !img.isLoading && img.url)
        .map(buildImagePart),
      ...currentFiles
        .filter((f) => !f.isLoading && f.url)
        .map(buildFilePart),
    ]

    // Add text contexts as mention tokens
    let mentionPrefix = ""

    if (currentTextContexts.length > 0 || currentDiffTextContexts.length > 0 || currentPastedTexts.length > 0) {
      const quoteMentions = currentTextContexts.map((tc) => {
        const preview = tc.preview.replace(/[:[\]]/g, "") // Sanitize preview
        const encodedText = utf8ToBase64(tc.text) // Base64 encode full text
        return `@[${MENTION_PREFIXES.QUOTE}${preview}:${encodedText}]`
      })

      const diffMentions = currentDiffTextContexts.map((dtc) => {
        const preview = dtc.preview.replace(/[:[\]]/g, "") // Sanitize preview
        const encodedText = utf8ToBase64(dtc.text) // Base64 encode full text
        const lineNum = dtc.lineNumber || 0
        // Include comment if present: encode it as base64 and append
        const encodedComment = dtc.comment ? utf8ToBase64(dtc.comment) : ""
        return `@[${MENTION_PREFIXES.DIFF}${dtc.filePath}:${lineNum}:${preview}:${encodedText}:${encodedComment}]`
      })

      // Add pasted text as pasted mentions (format: pasted:size:preview|filepath)
      // Using | as separator since filepath can contain colons
      const pastedTextMentions = currentPastedTexts.map((pt) => {
        // Sanitize preview to remove special characters that break mention parsing
        const sanitizedPreview = pt.preview.replace(/[:[\]|]/g, "")
        return `@[${MENTION_PREFIXES.PASTED}${pt.size}:${sanitizedPreview}|${pt.filePath}]`
      })

      mentionPrefix = [...quoteMentions, ...diffMentions, ...pastedTextMentions].join(" ") + " "
    }

    if (finalText || mentionPrefix) {
      parts.push({ type: "text", text: mentionPrefix + (finalText || "") })
    }

    // Add cached file contents as hidden parts (sent to agent but not displayed in UI)
    // These are from dropped text files - content is embedded so agent sees it immediately
    if (fileContentsRef.current.size > 0) {
      for (const [mentionId, content] of fileContentsRef.current.entries()) {
        // Extract file path from mentionId (file:local:path or file:external:path)
        const filePath = mentionId.replace(/^file:(local|external):/, "")
        parts.push({
          type: "data-file-content" as const,
          data: { filePath, content },
        })
      }
    }

    clearAll()
    clearTextContexts()
    clearDiffTextContexts()
    clearPastedTexts()
    clearFileContents()

    // Optimistic update: immediately update chat's updated_at and resort array for instant sidebar resorting
    if (teamId) {
      const now = new Date()
      utils.agents.getAgentChats.setData({ teamId }, (old: any) => {
        if (!old) return old
        // Update the timestamp and sort by updated_at descending
        const updated = old.map((c: any) =>
          c.id === parentChatId ? { ...c, updated_at: now } : c,
        )
        return updated.sort(
          (a: any, b: any) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
      })
    }

    // Desktop app: Optimistic update for chats.list to update sidebar immediately
    const queryClient = getQueryClient()
    if (queryClient) {
      const now = new Date()
      const queries = queryClient.getQueryCache().getAll()
      const chatsListQuery = queries.find(q =>
        Array.isArray(q.queryKey) &&
        Array.isArray(q.queryKey[0]) &&
        q.queryKey[0][0] === 'chats' &&
        q.queryKey[0][1] === 'list'
      )
      if (chatsListQuery) {
        queryClient.setQueryData(chatsListQuery.queryKey, (old: any[] | undefined) => {
          if (!old) return old
          // Update the timestamp and sort by updatedAt descending
          const updated = old.map((c: any) =>
            c.id === parentChatId ? { ...c, updatedAt: now } : c,
          )
          return updated.sort(
            (a: any, b: any) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          )
        })
      }
    }

    // Optimistically update sub-chat timestamp to move it to top
    useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)

    // Enable auto-scroll and immediately scroll to bottom
    shouldAutoScrollRef.current = true
    scrollToBottom()

    // Track message sent
    const hasAt = parts.some((p: any) => p.type === "text" && p.text?.includes("@"))
    trackSendMessage(subChatModeRef.current, hasAt)

    await sendMessageRef.current({ role: "user", parts })
  }, [
    sandboxSetupStatus,
    isArchived,
    onRestoreWorkspace,
    parentChatId,
    subChatId,
    onAutoRename,
    clearAll,
    clearTextContexts,
    clearPastedTexts,
    teamId,
    addToQueue,
    setExpiredQuestionsMap,
  ])

  // Queue handlers for sending queued messages
  const handleSendFromQueue = useCallback(async (itemId: string) => {
    const item = popItemFromQueue(subChatId, itemId)
    if (!item) return

    try {
      // Stop current stream if streaming and wait for status to become ready.
      // The server-side save block preserves sessionId on abort, so the next
      // message can resume the session with full conversation context.
      if (isStreamingRef.current) {
        await handleStop()
        await waitForStreamingReady(subChatId)
      }

      // Build message parts from queued item
      const parts: any[] = [
        ...(item.images || []).map(buildImagePart),
        ...(item.files || []).map(buildFilePart),
      ]

      // Add text contexts as mention tokens
      let mentionPrefix = ""
      if (item.textContexts && item.textContexts.length > 0) {
        const quoteMentions = item.textContexts.map((tc) => {
          const preview = tc.text.slice(0, 50).replace(/[:[\]]/g, "") // Create and sanitize preview
          const encodedText = utf8ToBase64(tc.text) // Base64 encode full text
          return `@[${MENTION_PREFIXES.QUOTE}${preview}:${encodedText}]`
        })
        mentionPrefix = quoteMentions.join(" ") + " "
      }

      // Add diff text contexts as mention tokens
      if (item.diffTextContexts && item.diffTextContexts.length > 0) {
        const diffMentions = item.diffTextContexts.map((dtc) => {
          const preview = dtc.text.slice(0, 50).replace(/[:[\]]/g, "") // Create and sanitize preview
          const encodedText = utf8ToBase64(dtc.text) // Base64 encode full text
          const lineNum = dtc.lineNumber || 0
          return `@[${MENTION_PREFIXES.DIFF}${dtc.filePath}:${lineNum}:${preview}:${encodedText}]`
        })
        mentionPrefix += diffMentions.join(" ") + " "
      }

      if (item.message || mentionPrefix) {
        parts.push({ type: "text", text: mentionPrefix + (item.message || "") })
      }

      // Update timestamps
      useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)

      // Enable auto-scroll and immediately scroll to bottom
      shouldAutoScrollRef.current = true
      scrollToBottom()

      // Track message sent
      const hasAt = parts.some((p: any) => p.type === "text" && p.text?.includes("@"))
      trackSendMessage(subChatModeRef.current, hasAt)

      await sendMessageRef.current({ role: "user", parts })
    } catch (error) {
      console.error("[handleSendFromQueue] Error sending queued message:", error)
      // Requeue the item at the front so it isn't lost
      useMessageQueueStore.getState().prependItem(subChatId, item)
    }
  }, [subChatId, popItemFromQueue, handleStop])

  const handleRemoveFromQueue = useCallback((itemId: string) => {
    removeFromQueue(subChatId, itemId)
  }, [subChatId, removeFromQueue])

  // Restore queue item back to input (undo queue)
  const handleRestoreFromQueue = useCallback((item: AgentQueueItem) => {
    // Remove from queue first
    removeFromQueue(subChatId, item.id)

    // Restore message text to editor
    if (item.message) {
      editorRef.current?.setValue(item.message)
    }

    // Restore images
    if (item.images && item.images.length > 0) {
      const restoredImages = item.images.map((img) => ({
        id: img.id,
        url: img.url,
        mediaType: img.mediaType,
        filename: img.filename || "image",
        base64Data: img.base64Data,
        isLoading: false,
      }))
      setImagesFromDraft(restoredImages)
    }

    // Restore files
    if (item.files && item.files.length > 0) {
      const restoredFiles = item.files.map((f) => ({
        id: f.id,
        url: f.url,
        filename: f.filename,
        type: f.mediaType || "application/octet-stream",
        size: f.size || 0,
        isLoading: false,
      }))
      setFilesFromDraft(restoredFiles)
    }

    // Restore text contexts
    if (item.textContexts && item.textContexts.length > 0) {
      const restoredTextContexts = item.textContexts.map((tc) => ({
        id: tc.id,
        text: tc.text,
        sourceMessageId: tc.sourceMessageId,
        preview: tc.text.slice(0, 50) + (tc.text.length > 50 ? "..." : ""),
        createdAt: new Date(),
      }))
      setTextContextsFromDraft(restoredTextContexts)
    }

    // Restore diff text contexts
    if (item.diffTextContexts && item.diffTextContexts.length > 0) {
      const restoredDiffTextContexts = item.diffTextContexts.map((dtc) => ({
        id: dtc.id,
        text: dtc.text,
        filePath: dtc.filePath,
        lineNumber: dtc.lineNumber,
        lineType: dtc.lineType,
        preview: dtc.text.slice(0, 50) + (dtc.text.length > 50 ? "..." : ""),
        createdAt: new Date(),
        comment: dtc.comment,
      }))
      setDiffTextContextsFromDraft(restoredDiffTextContexts)
    }

    // Focus the editor
    editorRef.current?.focus()
  }, [subChatId, removeFromQueue, setImagesFromDraft, setFilesFromDraft, setTextContextsFromDraft, setDiffTextContextsFromDraft])

  // Force send - stop stream and send immediately, bypassing queue (Opt+Enter)
  const handleForceSend = useCallback(async () => {
    // Block sending while sandbox is still being set up
    if (sandboxSetupStatus !== "ready") {
      return
    }

    // Get value from uncontrolled editor
    const inputValue = editorRef.current?.getValue() || ""
    const hasText = inputValue.trim().length > 0
    const currentImages = imagesRef.current
    const currentFiles = filesRef.current
    const hasImages =
      currentImages.filter((img) => !img.isLoading && img.url).length > 0

    if (!hasText && !hasImages) return

    // Stop current stream if streaming and wait for status to become ready.
    // The server-side save block sets sessionId=null on abort, so the next
    // message starts fresh without needing an explicit cancel mutation.
    if (isStreamingRef.current) {
      await handleStop()
      await waitForStreamingReady(subChatId)
    }

    // Auto-restore archived workspace when sending a message
    if (isArchived && onRestoreWorkspace) {
      onRestoreWorkspace()
    }

    const text = inputValue.trim()

    // Expand custom slash commands with arguments (e.g. "/Apex my argument")
    let finalText = text
    const slashMatch = text.match(/^\/(\S+)\s*(.*)$/s)
    if (slashMatch) {
      const [, commandName, args] = slashMatch
      const builtinNames = new Set(
        BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.name),
      )
      if (!builtinNames.has(commandName)) {
        try {
          const commands = await trpcClient.commands.list.query({
            projectPath,
          })
          const cmd = commands.find(
            (c) => c.name.toLowerCase() === commandName.toLowerCase(),
          )
          if (cmd) {
            const { content } = await trpcClient.commands.getContent.query({
              path: cmd.path,
            })
            finalText = content.replace(/\$ARGUMENTS/g, args.trim())
          }
        } catch (error) {
          console.error("Failed to expand custom slash command:", error)
        }
      }
    }

    // Clear editor and draft from localStorage
    editorRef.current?.clear()
    if (parentChatId) {
      clearSubChatDraft(parentChatId, subChatId)
    }

    // Build message parts
    const parts: any[] = [
      ...currentImages
        .filter((img) => !img.isLoading && img.url)
        .map(buildImagePart),
      ...currentFiles
        .filter((f) => !f.isLoading && f.url)
        .map(buildFilePart),
    ]

    if (finalText) {
      parts.push({ type: "text", text: finalText })
    }

    // Clear attachments
    clearAll()

    // Update timestamps
    useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)

    // Force scroll to bottom
    shouldAutoScrollRef.current = true
    scrollToBottom()

    // Track message sent
    const hasAt = parts.some((p: any) => p.type === "text" && p.text?.includes("@"))
    trackSendMessage(subChatModeRef.current, hasAt)

    try {
      await sendMessageRef.current({ role: "user", parts })
    } catch (error) {
      console.error("[handleForceSend] Error sending message:", error)
      // Restore editor content so the user can retry
      editorRef.current?.setValue(finalText)
    }
  }, [
    sandboxSetupStatus,
    isArchived,
    onRestoreWorkspace,
    parentChatId,
    subChatId,
    handleStop,
    clearAll,
  ])

  const { handleRetryMessage, handleEditMessage } = useMessageEditing({
    messages,
    isStreaming,
    subChatId,
    setMessages,
    regenerate,
    editorRef,
  })

  // NOTE: Auto-processing of queue is now handled globally by QueueProcessor
  // component in agents-layout.tsx. This ensures queues continue processing
  // even when user navigates to different sub-chats or workspaces.

  // Plan approval state: hasUnapprovedPlan, sidebar indicators, Cmd+Enter shortcut
  const { hasUnapprovedPlan } = usePlanApprovalState({
    messages,
    subChatMode,
    subChatId,
    parentChatId,
    isActive,
    isStreaming,
    handleApprovePlan,
    hasUnapprovedPlanRef,
  })

  // Cmd/Ctrl + Arrow Down to scroll to bottom (works even when focused in input)
  // But don't intercept if input has content - let native cursor navigation work
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "ArrowDown" &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        // Don't intercept if input has content - let native cursor navigation work
        const inputValue = editorRef.current?.getValue() || ""
        if (inputValue.trim().length > 0) {
          return
        }

        e.preventDefault()
        scrollToBottom()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [scrollToBottom])

  // Clean up pending plan approval when unmounting
  useEffect(() => {
    return () => {
      setPendingPlanApprovals((prev: Map<string, string>) => {
        if (prev.has(subChatId)) {
          const newMap = new Map(prev)
          newMap.delete(subChatId)
          return newMap
        }
        return prev
      })
    }
  }, [subChatId, setPendingPlanApprovals])

  // Compute sticky top class for user messages
  const stickyTopClass = isMobile
    ? CHAT_LAYOUT.stickyTopMobile
    : isSubChatsSidebarOpen
      ? CHAT_LAYOUT.stickyTopSidebarOpen
      : CHAT_LAYOUT.stickyTopSidebarClosed

  // Sync messages to Jotai store for isolated rendering
  // CRITICAL: Only sync from the ACTIVE tab to prevent overwriting global atoms
  // Each tab has its own useChat() instance, but global atoms (messageIdsAtom, etc.) are shared.
  // Only the active tab should update these global atoms.
  const syncMessages = useSetAtom(syncMessagesWithStatusAtom)
  useLayoutEffect(() => {
    // Skip syncing for inactive tabs - they shouldn't update global atoms
    if (!isActive) return
    syncMessages({ messages, status, subChatId })
  }, [messages, status, subChatId, syncMessages, isActive])

  // Sync status to global streaming status store for queue processing
  const setStreamingStatus = useStreamingStatusStore((s) => s.setStatus)
  useEffect(() => {
    setStreamingStatus(subChatId, status as "ready" | "streaming" | "submitted" | "error")
  }, [subChatId, status, setStreamingStatus])

  // Chat search - scroll to current match
  // Use ref to track scroll lock and prevent race conditions
  const searchScrollLockRef = useRef<number>(0)
  const currentSearchMatch = useAtomValue(chatSearchCurrentMatchAtom)
  useEffect(() => {
    if (!currentSearchMatch) return

    const container = chatContainerRef.current
    if (!container) return

    // Increment lock to cancel any pending scroll operations
    const currentLock = ++searchScrollLockRef.current

    // Use double requestAnimationFrame + small delay to ensure DOM has updated with new highlights
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          // Check if this scroll operation is still valid (not superseded by newer one)
          if (searchScrollLockRef.current !== currentLock) return

          // First try to find the highlight mark
          let targetElement: Element | null = container.querySelector(".search-highlight-current")

          // If no highlight mark, find the message element with matching data attributes
          if (!targetElement) {
            const selector = `[data-message-id="${currentSearchMatch.messageId}"][data-part-index="${currentSearchMatch.partIndex}"]`
            targetElement = container.querySelector(selector)
          }

          if (targetElement) {
            // Check if this is inside a sticky user message container
            const stickyParent = targetElement.closest("[data-user-message-id]")
            if (stickyParent) {
              const messageGroupWrapper = stickyParent.parentElement
              if (messageGroupWrapper) {
                messageGroupWrapper.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
                return
              }
            }

            targetElement.scrollIntoView({
              behavior: "smooth",
              block: "center",
            })
          }
        }, 50)
      })
    })
  }, [currentSearchMatch])

  // Calculate top offset for search bar based on sub-chat selector
  const searchBarTopOffset = isSubChatsSidebarOpen ? "52px" : undefined

  return (
    <SearchHighlightProvider>
      <div className="flex flex-col flex-1 min-h-0 relative">
        {/* Text selection popover for adding text to context */}
        <TextSelectionPopover
          onAddToContext={addTextContext}
          onAddComment={openCommentInput}
          onFocusInput={handleFocusInput}
        />

        {/* Document comment input for review system (self-contained, reads atom directly) */}
        <DocumentCommentInput />

        {/* Chat search bar */}
        <ChatSearchBar messages={messages} topOffset={searchBarTopOffset} />

        {/* Chat title - flex above scroll area (desktop only) */}
        {!isMobile && (
          <div
            className={cn(
              "shrink-0 pb-2",
              isSubChatsSidebarOpen ? "pt-[52px]" : "pt-2",
            )}
          >
            <div className={cn(
              "flex items-center gap-2 mx-auto px-4",
              isChatFullWidth ? "max-w-[calc(100%-48px)]" : "max-w-2xl"
            )}>
              <div className="flex-1 min-w-0">
                <ChatTitleEditor
                  name={subChatName}
                  placeholder="New Chat"
                  onSave={handleRenameSubChat}
                  isMobile={false}
                  chatId={subChatId}
                  hasMessages={messages.length > 0}
                />
              </div>
              {/* Full width toggle button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsChatFullWidth(!isChatFullWidth)}
                    className="h-7 w-7 p-0 shrink-0 hover:bg-foreground/10"
                  >
                    {isChatFullWidth ? (
                      <ArrowLeftFromLine className="size-4 text-muted-foreground" />
                    ) : (
                      <MoveHorizontal className="size-4 text-muted-foreground" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isChatFullWidth ? "Restore default width" : "Expand to full width"}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}

      {/* Messages */}
      <div
        ref={(el) => {
          // Cleanup previous observer
          if (chatContainerObserverRef.current) {
            chatContainerObserverRef.current.disconnect()
            chatContainerObserverRef.current = null
          }

          chatContainerRef.current = el

          // Setup ResizeObserver for --chat-container-height CSS variable
          if (el) {
            const observer = new ResizeObserver((entries) => {
              const height = entries[0]?.contentRect.height ?? 0
              el.style.setProperty("--chat-container-height", `${height}px`)
            })
            observer.observe(el)
            chatContainerObserverRef.current = observer
          }
        }}
        className="flex-1 overflow-y-auto w-full relative allow-text-selection outline-hidden"
        tabIndex={-1}
        data-chat-container
      >
        <div
          className={cn(
            "px-2 mx-auto -mb-4 space-y-4",
            !isChatFullWidth && "max-w-2xl",
          )}
          style={{
            paddingBottom: "32px",
          }}
        >
          <div>
            {/* ISOLATED: Messages rendered via Jotai atom subscription
                Each component subscribes to specific atoms and only re-renders when those change
                KEY: Force remount on subChatId change to ensure fresh atom reads after syncMessages */}
            <IsolatedMessagesSection
              key={subChatId}
              subChatId={subChatId}
              chatId={parentChatId}
              isMobile={isMobile}
              sandboxSetupStatus={sandboxSetupStatus}
              stickyTopClass={stickyTopClass}
              sandboxSetupError={sandboxSetupError}
              onRetrySetup={onRetrySetup}
              onRetryMessage={handleRetryMessage}
              onEditMessage={handleEditMessage}
              UserBubbleComponent={AgentUserMessageBubble}
              ToolCallComponent={AgentToolCall}
              MessageGroupWrapper={MessageGroup}
              toolRegistry={AgentToolRegistry}
            />
          </div>
        </div>
      </div>

      {/* User questions panel - shows for both live (pending) and expired (timed out) questions */}
      {displayQuestions && (
        <div className="px-4 relative z-20">
          <div className={cn("w-full px-2 mx-auto", !isChatFullWidth && "max-w-2xl")}>
            <AgentUserQuestion
              ref={questionRef}
              pendingQuestions={displayQuestions}
              onAnswer={handleQuestionsAnswer}
              onSkip={handleQuestionsSkip}
              hasCustomText={inputHasContent}
            />
          </div>
        </div>
      )}

      {/* Stacked cards container - queue + status */}
      {!displayQuestions &&
        (queue.length > 0 || changedFilesForSubChat.length > 0) && (
          <div className="px-2 -mb-6 relative z-10">
            <div className={cn("w-full mx-auto px-2", !isChatFullWidth && "max-w-2xl")}>
              {/* Queue indicator card - top card */}
              {queue.length > 0 && (
                <AgentQueueIndicator
                  queue={queue}
                  onRemoveItem={handleRemoveFromQueue}
                  onSendNow={handleSendFromQueue}
                  onRestoreItem={handleRestoreFromQueue}
                  isStreaming={isStreaming}
                  hasStatusCardBelow={changedFilesForSubChat.length > 0}
                />
              )}
              {/* Status card - bottom card, only when there are changed files */}
              {changedFilesForSubChat.length > 0 && (
                <SubChatStatusCard
                  chatId={parentChatId}
                  subChatId={subChatId}
                  isStreaming={isStreaming}
                  isCompacting={isCompacting}
                  changedFiles={changedFilesForSubChat}
                  worktreePath={projectPath}
                  onStop={handleStop}
                  hasQueueCardAbove={queue.length > 0}
                  projectMode={projectMode}
                />
              )}
            </div>
          </div>
        )}

      {/* Input - isolated component to prevent re-renders */}
      <ChatInputArea
        editorRef={editorRef}
        fileInputRef={fileInputRef}
        onSend={handleSend}
        onForceSend={handleForceSend}
        onStop={handleStop}
        onCompact={handleCompact}
        onCreateNewSubChat={onCreateNewSubChat}
        isStreaming={isStreaming}
        isCompacting={isCompacting}
        images={images}
        files={files}
        onAddAttachments={handleAddAttachments}
        onRemoveImage={removeImage}
        onRemoveFile={removeFile}
        isUploading={isUploading}
        textContexts={textContexts}
        onRemoveTextContext={removeTextContext}
        diffTextContexts={diffTextContexts}
        onRemoveDiffTextContext={removeDiffTextContext}
        pastedTexts={pastedTexts}
        onAddPastedText={addPastedText}
        onRemovePastedText={removePastedText}
        onCacheFileContent={cacheFileContent}
        messageTokenData={messageTokenData}
        subChatId={subChatId}
        parentChatId={parentChatId}
        teamId={teamId}
        repository={repository}
        sandboxId={sandboxId}
        projectPath={projectPath}
        changedFiles={changedFilesForSubChat}
        isMobile={isMobile}
        queueLength={queue.length}
        onSendFromQueue={handleSendFromQueue}
        firstQueueItemId={queue[0]?.id}
        onInputContentChange={setInputHasContent}
        onSubmitWithQuestionAnswer={submitWithQuestionAnswerCallback}
      />

        {/* Scroll to bottom button - isolated component to avoid re-renders during streaming */}
        <ScrollToBottomButton
          containerRef={chatContainerRef}
          onScrollToBottom={scrollToBottom}
          hasStackedCards={!displayQuestions && (queue.length > 0 || changedFilesForSubChat.length > 0)}
          subChatId={subChatId}
          isActive={isActive}
        />
      </div>
    </SearchHighlightProvider>
  )
})

// Chat View wrapper - handles loading and creates chat object
export function ChatView({
  chatId,
  isSidebarOpen,
  onToggleSidebar,
  selectedTeamName: _selectedTeamName,
  selectedTeamImageUrl: _selectedTeamImageUrl,
  isMobileFullscreen = false,
  onBackToChats,
  onOpenPreview,
  onOpenDiff,
  onOpenTerminal,
  hideGitFeatures: hideGitFeaturesFromProps,
  rightHeaderSlot,
  collapsedIndicator,
}: {
  chatId: string
  isSidebarOpen: boolean
  onToggleSidebar: () => void
  selectedTeamName?: string
  selectedTeamImageUrl?: string
  isMobileFullscreen?: boolean
  onBackToChats?: () => void
  onOpenPreview?: () => void
  onOpenDiff?: () => void
  onOpenTerminal?: () => void
  /** Hide Git-related features (diff, terminal, preview, PR status) - used in Cowork mode */
  hideGitFeatures?: boolean
  /** Custom slot for additional buttons in the header right area */
  rightHeaderSlot?: React.ReactNode
  /** Collapsed indicator for sub-chat inputs - displayed in left column below header */
  collapsedIndicator?: React.ReactNode
}) {
  // Setter for project mode atom
  // Updated when chat's project mode is loaded
  const setCurrentProjectMode = useSetAtom(currentProjectModeAtom)

  const [selectedTeamId] = useAtom(selectedTeamIdAtom)
  const [selectedModelId] = useAtom(lastSelectedModelIdAtom)

  // tRPC utils for optimistic cache updates (must be defined early - used in useEffect below)
  const utils = api.useUtils()

  // Get active sub-chat ID from store for mode tracking (reactive)
  const activeSubChatIdForMode = useAgentSubChatStore((state) => state.activeSubChatId)
  // Use per-subChat mode atom - falls back to "agent" if no active sub-chat
  const subChatModeAtom = useMemo(
    () => subChatModeAtomFamily(activeSubChatIdForMode || ""),
    [activeSubChatIdForMode],
  )
  const [subChatMode] = useAtom(subChatModeAtom)
  // Default mode for new sub-chats (used as fallback when no active sub-chat)
  const defaultAgentMode = useAtomValue(defaultAgentModeAtom)
  // Current mode - use subChatMode when there's an active sub-chat, otherwise use user's default preference
  const currentMode: AgentMode = activeSubChatIdForMode ? subChatMode : defaultAgentMode

  const isDesktop = useAtomValue(isDesktopAtom)
  const platform = usePlatform()
  const isDesktopPlatform = platform.isDesktop // 用于替换 isDesktopApp() 调用
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const isChatFullWidth = useAtomValue(agentsChatFullWidthAtom)
  const customClaudeConfig = useAtomValue(customClaudeConfigAtom)
  const selectedOllamaModel = useAtomValue(selectedOllamaModelAtom)
  const normalizedCustomClaudeConfig =
    normalizeCustomClaudeConfig(customClaudeConfig)
  const hasCustomClaudeConfig = Boolean(normalizedCustomClaudeConfig)
  const setLoadingSubChats = useSetAtom(loadingSubChatsAtom)
  const setUnconfirmedNameSubChats = useSetAtom(unconfirmedNameSubChatsAtom)
  const unseenChanges = useAtomValue(agentsUnseenChangesAtom)
  const setUnseenChanges = useSetAtom(agentsUnseenChangesAtom)
  const setSubChatUnseenChanges = useSetAtom(agentsSubChatUnseenChangesAtom)
  const setSubChatStatus = useSetAtom(subChatStatusStorageAtom)
  const setJustCreatedIds = useSetAtom(justCreatedIdsAtom)
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const setUndoStack = useSetAtom(undoStackAtom)
  const setSelectedFilePath = useSetAtom(selectedDiffFilePathAtom)
  const setFilteredDiffFiles = useSetAtom(filteredDiffFilesAtom)
  const { notifyAgentComplete, notifyAgentError } = useDesktopNotifications()

  // Check if any chat has unseen changes
  const hasAnyUnseenChanges = unseenChanges.size > 0
  const [, forceUpdate] = useState({})
  // Track pending force updates to defer them after render
  const pendingForceUpdateRef = useRef(false)
  // Process deferred force updates after render to avoid "update while rendering" error
  useEffect(() => {
    if (pendingForceUpdateRef.current) {
      pendingForceUpdateRef.current = false
      forceUpdate({})
    }
  })
  const [isPreviewSidebarOpen, setIsPreviewSidebarOpen] = useAtom(
    agentsPreviewSidebarOpenAtom,
  )
  // Per-chat diff sidebar state - each chat remembers its own open/close state
  const diffSidebarAtom = useMemo(
    () => diffSidebarOpenAtomFamily(chatId),
    [chatId],
  )
  const [isDiffSidebarOpen, setIsDiffSidebarOpen] = useAtom(diffSidebarAtom)

  // Per-chat pending diff changes state - shows "Refresh" button when files change while sidebar is open
  const pendingDiffChangesAtom = useMemo(
    () => diffHasPendingChangesAtomFamily(chatId),
    [chatId],
  )
  const [hasPendingDiffChanges, setHasPendingDiffChanges] = useAtom(pendingDiffChangesAtom)

  // Subscribe to activeSubChatId for plan sidebar (needs to update when switching sub-chats)
  const activeSubChatIdForPlan = useAgentSubChatStore((state) => state.activeSubChatId)

  // Per-subChat plan sidebar state - each sub-chat remembers its own open/close state
  const planSidebarAtom = useMemo(
    () => planSidebarOpenAtomFamily(activeSubChatIdForPlan || ""),
    [activeSubChatIdForPlan],
  )
  const [isPlanSidebarOpen, setIsPlanSidebarOpen] = useAtom(planSidebarAtom)

  const currentPlanPathAtom = useMemo(
    () => currentPlanPathAtomFamily(activeSubChatIdForPlan || ""),
    [activeSubChatIdForPlan],
  )
  const [currentPlanPath, setCurrentPlanPath] = useAtom(currentPlanPathAtom)

  // File viewer sidebar state - per-chat open file path
  const fileViewerAtom = useMemo(
    () => fileViewerOpenAtomFamily(chatId),
    [chatId],
  )
  const [fileViewerPath, setFileViewerPath] = useAtom(fileViewerAtom)
  const [fileViewerDisplayMode] = useAtom(fileViewerDisplayModeAtom)

  // File search dialog (Cmd+P)
  const [fileSearchOpen, setFileSearchOpen] = useAtom(fileSearchDialogOpenAtom)

  // Details sidebar state (unified sidebar that combines all right sidebars)
  const isUnifiedSidebarEnabled = useAtomValue(unifiedSidebarEnabledAtom)
  const [isDetailsSidebarOpen, setIsDetailsSidebarOpenRaw] = useAtom(detailsSidebarOpenAtom)

  // Browser sidebar state - IPC events bridge to new Panel System
  const {
    betaBrowserEnabled,
    setBrowserActive,
    setBrowserUrl,
    setBrowserPendingScreenshot,
  } = useBrowserSidebar({ chatId })

  const setIsDetailsSidebarOpen = useCallback((open: boolean | ((prev: boolean) => boolean)) => {
    const newValue = typeof open === 'function' ? open(isDetailsSidebarOpen) : open
    // Note: We intentionally do NOT close browser sidebar when opening details
    // Both can be open at the same time
    setIsDetailsSidebarOpenRaw(newValue)
  }, [isDetailsSidebarOpen, setIsDetailsSidebarOpenRaw])

  // Listen for AI-generated sub-chat name from backend (success or failure)
  useSubChatNameSync({ selectedTeamId })

  // Resolved hotkeys for tooltips
  const toggleDetailsHotkey = useResolvedHotkeyDisplay("toggle-details")
  const toggleTerminalHotkey = useResolvedHotkeyDisplay("toggle-terminal")

  // Close plan sidebar when switching to a sub-chat that has no plan
  const prevSubChatIdRef = useRef(activeSubChatIdForPlan)
  useEffect(() => {
    if (prevSubChatIdRef.current !== activeSubChatIdForPlan) {
      // Sub-chat changed - if new one has no plan path, close sidebar
      if (!currentPlanPath) {
        setIsPlanSidebarOpen(false)
      }
      prevSubChatIdRef.current = activeSubChatIdForPlan
    }
  }, [activeSubChatIdForPlan, currentPlanPath, setIsPlanSidebarOpen])
  const setPendingBuildPlanSubChatId = useSetAtom(pendingBuildPlanSubChatIdAtom)

  // Read plan edit refetch trigger from atom (set by ChatViewInner when Edit completes)
  const planEditRefetchTriggerAtom = useMemo(
    () => planEditRefetchTriggerAtomFamily(activeSubChatIdForPlan || ""),
    [activeSubChatIdForPlan],
  )
  const planEditRefetchTrigger = useAtomValue(planEditRefetchTriggerAtom)
  const triggerPlanRefetch = useSetAtom(planEditRefetchTriggerAtom)

  // Handler for plan sidebar "Build plan" button
  // Uses getState() to get fresh activeSubChatId (avoids stale closure)
  const handleApprovePlanFromSidebar = useCallback(() => {
    const activeSubChatId = useAgentSubChatStore.getState().activeSubChatId
    if (activeSubChatId) {
      setPendingBuildPlanSubChatId(activeSubChatId)
    }
  }, [setPendingBuildPlanSubChatId])

  // Handler for expanding plan sidebar - opens sidebar and triggers refetch
  // This ensures plan content is refreshed when "View plan" is clicked,
  // even if the sidebar is already open
  const handleExpandPlan = useCallback(() => {
    setIsPlanSidebarOpen(true)
    // Always trigger refetch when expanding to ensure fresh content
    triggerPlanRefetch()
  }, [setIsPlanSidebarOpen, triggerPlanRefetch])

  // Per-chat terminal sidebar state - each chat remembers its own open/close state
  const terminalSidebarAtom = useMemo(
    () => terminalSidebarOpenAtomFamily(chatId),
    [chatId],
  )
  const [isTerminalSidebarOpen, setIsTerminalSidebarOpen] = useAtom(terminalSidebarAtom)
  const terminalDisplayMode = useAtomValue(terminalDisplayModeAtom)

  // Keyboard shortcut: Cmd+J to toggle terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey &&
        e.code === "KeyJ"
      ) {
        e.preventDefault()
        e.stopPropagation()
        setIsTerminalSidebarOpen(!isTerminalSidebarOpen)
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [isTerminalSidebarOpen, setIsTerminalSidebarOpen])

  // Per-chat expanded widget state - for Explorer and other expandable widgets
  const expandedWidgetAtom = useMemo(
    () => expandedWidgetAtomFamily(chatId),
    [chatId],
  )
  const [_expandedWidget, _setExpandedWidget] = useAtom(expandedWidgetAtom)

  // Explorer panel state - separate from ExpandedWidgetSidebar (supports three display modes)
  const explorerPanelOpenAtom = useMemo(
    () => explorerPanelOpenAtomFamily(chatId),
    [chatId],
  )
  const [isExplorerPanelOpen, setIsExplorerPanelOpen] = useAtom(explorerPanelOpenAtom)

  // Diff view mode atoms (independent of diff data) - defined before useSidebarMutualExclusion
  const [diffMode, setDiffMode] = useAtom(diffViewModeAtom)
  const [diffDisplayMode, setDiffDisplayMode] = useAtom(diffViewDisplayModeAtom)
  const subChatsSidebarMode = useAtomValue(agentsSubChatsSidebarModeAtom)

  // Mutual exclusion: Details sidebar vs Plan/Terminal/Diff(side-peek) sidebars
  // Now includes Diff sidebar handling (previously separate useEffect below)
  useSidebarMutualExclusion(
    {
      isDetailsSidebarOpen,
      isPlanSidebarOpen,
      currentPlanPath,
      isTerminalSidebarOpen,
      terminalDisplayMode,
      isDiffSidebarOpen,
      diffDisplayMode,
    },
    {
      setIsDetailsSidebarOpen,
      setIsPlanSidebarOpen,
      setIsTerminalSidebarOpen,
      setIsDiffSidebarOpen,
      setDiffDisplayMode,
    }
  )

  // Diff sidebar layout management (width tracking, traffic lights, resize observer)
  const {
    diffSidebarRef,
    diffSidebarWidth,
    isDiffSidebarNarrow,
  } = useDiffSidebarLayout({
    isDiffSidebarOpen,
    diffDisplayMode,
    fileViewerPath,
    fileViewerDisplayMode,
  })
  const diffViewRef = useRef<AgentDiffViewRef>(null)
  // Track if all diff files are collapsed/expanded for button disabled states
  const [_diffCollapseState, setDiffCollapseState] = useState({
    allCollapsed: false,
    allExpanded: true,
  })

  // Track changed files across all sub-chats for throttled diff refresh
  const subChatFiles = useAtomValue(subChatFilesAtom)
  // Initialize to Date.now() to prevent double-fetch on mount
  // (the "mount" effect already fetches, throttle should wait)
  const lastDiffFetchTimeRef = useRef<number>(Date.now())
  const DIFF_THROTTLE_MS = 2000 // Max 1 fetch per 2 seconds

  // Clear "unseen changes" when chat is opened
  useEffect(() => {
    setUnseenChanges((prev: Set<string>) => {
      if (prev.has(chatId)) {
        const next = new Set(prev)
        next.delete(chatId)
        return next
      }
      return prev
    })
  }, [chatId, setUnseenChanges])

  // Restore per-subChat model selection when switching sub-chats or chats
  const subChatModelSelections = useAtomValue(subChatModelSelectionsAtom)
  const chatModelSelections = useAtomValue(chatModelSelectionsAtom)
  const setSessionModelOverride = useSetAtom(sessionModelOverrideAtom)
  const activeSubChatIdForModel = useAgentSubChatStore((state) => state.activeSubChatId)
  useEffect(() => {
    // Priority 1: per-subChat selection
    if (activeSubChatIdForModel) {
      const subChatSaved = subChatModelSelections[activeSubChatIdForModel]
      if (subChatSaved) {
        setSessionModelOverride(subChatSaved)
        return
      }
    }
    // Priority 2: per-chat fallback (backwards compatibility)
    const chatSaved = chatModelSelections[chatId]
    if (chatSaved) {
      setSessionModelOverride(chatSaved)
      return
    }
    // No saved selection: use global default
    setSessionModelOverride(null)
  }, [activeSubChatIdForModel, chatId]) // eslint-disable-line react-hooks/exhaustive-deps -- only restore on switch

  // Get sub-chat state from store (reactive subscription for tabsToRender)
  const {
    activeSubChatId,
    openSubChatIds,
    pinnedSubChatIds,
    allSubChats,
  } = useAgentSubChatStore(
    useShallow((state) => ({
      activeSubChatId: state.activeSubChatId,
      openSubChatIds: state.openSubChatIds,
      pinnedSubChatIds: state.pinnedSubChatIds,
      allSubChats: state.allSubChats,
    }))
  )

  // Clear sub-chat "unseen changes" indicator when sub-chat becomes active
  useEffect(() => {
    if (!activeSubChatId) return
    // Clear from both old atom and new persisted storage
    setSubChatUnseenChanges((prev: Set<string>) => {
      if (prev.has(activeSubChatId)) {
        const next = new Set(prev)
        next.delete(activeSubChatId)
        return next
      }
      return prev
    })
    clearSubChatUnseen(setSubChatStatus, activeSubChatId)
  }, [activeSubChatId, setSubChatUnseenChanges, setSubChatStatus])

  // tRPC mutations for renaming
  const renameSubChatMutation = api.agents.renameSubChat.useMutation()
  const renameChatMutation = api.agents.renameChat.useMutation()
  const generateSubChatNameMutation =
    api.agents.generateSubChatName.useMutation()

  // Determine if we're in sandbox mode
  const chatSourceMode = useAtomValue(chatSourceModeAtom)

  // Fetch chat data from local or remote based on mode
  const { data: localAgentChat, isLoading: isLocalLoading } = api.agents.getAgentChat.useQuery(
    { chatId },
    { enabled: !!chatId && chatSourceMode === "local" },
  )

  // Lazy load messages for the active sub-chat (performance optimization)
  // Check if sub-chat belongs to current workspace (from server data or local store)
  // This prevents loading messages for stale/invalid sub-chat IDs from localStorage
  // NOTE: Using localAgentChat here is correct because:
  // 1. The query below is only enabled when chatSourceMode === "local"
  // 2. localAgentChat is defined above (line 4498) - avoids TDZ with agentChat (line 4529)
  // 3. Dual-source check handles race condition where store hasn't updated yet
  const activeSubChatExistsInWorkspace = activeSubChatId && (
    (localAgentChat?.subChats ?? []).some(sc => sc.id === activeSubChatId) ||
    allSubChats.some(sc => sc.id === activeSubChatId)
  )
  const { data: subChatMessagesData, isLoading: isLoadingMessages } = trpc.chats.getSubChatMessages.useQuery(
    { id: activeSubChatId! },
    {
      // 修复：移除 activeSubChatExistsInWorkspace 条件
      // 问题：当 localAgentChat 还在加载时，activeSubChatExistsInWorkspace 为 false，
      // 导致消息查询不执行。由于 staleTime: Infinity，即使后来条件满足，
      // 查询可能也不会重新执行。
      // 解决：让查询总是执行，后端会处理不存在的 subChat（返回 null）
      enabled: !!activeSubChatId && chatSourceMode === "local",
      // staleTime: Infinity, // REMOVED: Must refetch on mount/switch to get updates that happened in background
    }
  )

  // Reset messages cache when parent chatId changes (switching between workspaces)
  // CRITICAL: Must use resetQueries instead of invalidateQueries because:
  // - invalidateQueries only marks as stale and refetches in background, keeping old cached data
  // - With staleTime: Infinity, the old cache is returned immediately (isLoading=false, data=stale)
  // - This bypasses the loading gate, causing getOrCreateChat to use stale messages
  // - resetQueries clears the cache entirely (data=undefined, isLoading=true)
  // - This ensures the loading gate blocks rendering until fresh data arrives
  const prevChatIdRef = useRef(chatId)
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      getQueryClient().resetQueries({
        queryKey: [['chats', 'getSubChatMessages']],
      })
      prevChatIdRef.current = chatId
    }
  }, [chatId])

  const { data: remoteAgentChat, isLoading: _isRemoteLoading } = useRemoteChat(
    chatSourceMode === "sandbox" ? chatId : null,
  )

  // Use the appropriate data source
  // IMPORTANT: Must memoize to prevent infinite re-render loop
  // The inline object spread creates a new reference on every render,
  // which triggers the useEffect that calls setAllSubChats(), causing re-renders
  const agentChat = useMemo(() => {
    if (chatSourceMode === "sandbox") {
      if (!remoteAgentChat) return null
      return {
        ...remoteAgentChat,
        // Transform remote chat to match local structure
        createdAt: new Date(remoteAgentChat.created_at),
        updatedAt: new Date(remoteAgentChat.updated_at),
        archivedAt: null,
        projectId: null,
        worktreePath: null,
        branch: null,
        baseBranch: null,
        prUrl: null,
        prNumber: null,
        sandbox_id: remoteAgentChat.sandbox_id,
        sandboxId: remoteAgentChat.sandbox_id,
        isRemote: true as const,
        // Preserve stats from remote chat for diff display
        remoteStats: remoteAgentChat.stats,
        subChats: remoteAgentChat.subChats?.map(sc => ({
          ...sc,
          mode: sc.mode as "plan" | "agent" | null | undefined,
          created_at: new Date(sc.created_at),
          updated_at: new Date(sc.updated_at),
        })) ?? [],
      }
    }
    // Add isRemote: false for type compatibility
    return localAgentChat ? { ...localAgentChat, isRemote: false as const } : null
  }, [chatSourceMode, remoteAgentChat, localAgentChat])

  // Extract sub-chats from agentChat (defined early since it's used in multiple places)
  const agentSubChats = (agentChat?.subChats ?? []) as Array<{
    id: string
    name?: string | null
    mode?: "plan" | "agent" | null
    created_at?: Date | string | null
    updated_at?: Date | string | null
    messages?: any
    stream_id?: string | null
  }>

  // Compute if we're waiting for local chat data (used as loading gate)
  // Only show loading if there's no data AND we're loading - this prevents
  // blocking the UI during cache invalidation/refetch when data already exists
  const isLocalChatLoading = chatSourceMode === "local" && isLocalLoading && !localAgentChat

  // Projects query for "Open Locally" functionality
  const { data: projects } = trpc.projects.list.useQuery()

  // Open Locally dialog state
  const [openLocallyDialogOpen, setOpenLocallyDialogOpen] = useState(false)

  // Auto-import hook for "Open Locally"
  const { getMatchingProjects, autoImport, isImporting } = useAutoImport()

  // Handler for "Open Locally" button in header
  const handleOpenLocally = useCallback(() => {
    if (!remoteAgentChat) return

    const matchingProjects = getMatchingProjects(projects ?? [], remoteAgentChat)

    if (matchingProjects.length === 1) {
      // Auto-import: single match found
      autoImport(remoteAgentChat, matchingProjects[0]!)
    } else {
      // Show dialog: 0 or 2+ matches
      setOpenLocallyDialogOpen(true)
    }
  }, [remoteAgentChat, projects, getMatchingProjects, autoImport])

  // Determine if "Open Locally" button should show
  const showOpenLocally = chatSourceMode === "sandbox" && !!remoteAgentChat

  // Get matching projects for dialog (only computed when needed)
  const openLocallyMatchingProjects = useMemo(() => {
    if (!remoteAgentChat) return []
    return getMatchingProjects(projects ?? [], remoteAgentChat)
  }, [remoteAgentChat, projects, getMatchingProjects])

  // Get project mode from chat's associated project
  // Each chat has its own project with its own mode
  const chatProject = (agentChat as AgentChat | null)?.project as ChatProject | undefined
  const chatProjectMode: ProjectMode = chatProject?.mode ?? "cowork"

  // Sync currentProjectModeAtom when chat data changes
  // This triggers agents-layout.tsx to recompute enabledWidgets
  useEffect(() => {
    if (agentChat) {
      setCurrentProjectMode(chatProjectMode)
    }
  }, [agentChat, chatProjectMode, setCurrentProjectMode])

  // Hide git features based on chat's project mode or explicit prop
  // In cowork mode, git features are hidden by default
  const hideGitFeatures = hideGitFeaturesFromProps ?? (chatProjectMode === "cowork")

  // Workspace isolation: compute which tabs to render (keep-alive pool)
  // Extracted to computeTabsToRender utility for maintainability
  const tabsToRender = useMemo(
    () => computeTabsToRender(activeSubChatId, pinnedSubChatIds, openSubChatIds, allSubChats, agentSubChats),
    [activeSubChatId, pinnedSubChatIds, openSubChatIds, allSubChats, agentSubChats]
  )

  // Check if this workspace is archived
  const isArchived = !!agentChat?.archivedAt

  // Get user usage data for credit checks
  const { data: _usageData } = api.usage.getUserUsage.useQuery()

  // Selected project for fallback path
  const selectedProject = useAtomValue(selectedProjectAtom)

  // Desktop: use worktreePath instead of sandbox, fallback to selectedProject.path during loading
  const worktreePath = (agentChat?.worktreePath as string | null) ?? selectedProject?.path ?? null
  // Fallback for web: use sandbox_id
  const sandboxId = agentChat?.sandbox_id
  const sandboxUrl = sandboxId ? `https://3003-${sandboxId}.e2b.app` : null
  // Desktop uses worktreePath, web uses sandboxUrl
  const chatWorkingDir = worktreePath || sandboxUrl

  // Diff data management - extracted to useDiffData hook
  const {
    diffStats,
    parsedFileDiffs,
    prefetchedFileContents,
    diffContent,
    setDiffStats,
    setParsedFileDiffs,
    setPrefetchedFileContents,
    setDiffContent,
    fetchDiffStats,
    fetchDiffStatsRef,
  } = useDiffData({
    chatId,
    worktreePath,
    sandboxId,
    isDesktopPlatform,
    isDiffSidebarOpen,
    setHasPendingDiffChanges,
    agentChat,
  })

  // Listen for file changes from Claude Write/Edit tools and invalidate git status
  useFileChangeListener(worktreePath)

  // Subscribe to GitWatcher for real-time file system monitoring (chokidar on main process)
  // When diff sidebar is open, don't auto-refresh - show "Refresh" button instead
  useGitWatcher(worktreePath, {
    isDiffSidebarOpen,
    onPendingChange: setHasPendingDiffChanges,
  })

  // Plugin MCP approval - disabled for now since official marketplace plugins
  // are trusted by default. Will re-enable when third-party plugin support is added.

  // Extract port, repository, and quick setup flag from meta
  const meta = agentChat?.meta as {
    sandboxConfig?: { port?: number }
    repository?: { owner: string; name: string } | string
    branch?: string | null
    isQuickSetup?: boolean
  } | null
  // Repository can be either an object or a string (legacy format)
  const repository = meta?.repository && typeof meta.repository === 'object'
    ? meta.repository
    : null
  // String format for components that expect string (e.g., ActiveChatContainer)
  const repositoryString = repository
    ? `${repository.owner}/${repository.name}`
    : typeof meta?.repository === 'string'
      ? meta.repository
      : undefined

  // Remote info for Details sidebar (when worktreePath is null but sandboxId exists)
  const remoteInfo = useMemo(() => {
    if (worktreePath || !sandboxId) return null
    return {
      repository: repositoryString,
      branch: meta?.branch,
      sandboxId,
    }
  }, [worktreePath, sandboxId, repositoryString, meta?.branch])

  // Track if we've already triggered sandbox setup for this chat
  // Check if this is a quick setup (no preview available)
  const isQuickSetup = meta?.isQuickSetup || !meta?.sandboxConfig?.port
  const previewPort = meta?.sandboxConfig?.port ?? 3000

  // Check if preview can be opened (sandbox with port exists and not quick setup)
  const canOpenPreview = !!(
    sandboxId &&
    !isQuickSetup &&
    meta?.sandboxConfig?.port
  )

  // Check if diff button can be shown (stats available)
  // This shows the Changes button with stats in header
  const canShowDiffButton = !!worktreePath || !!sandboxId

  // Check if diff sidebar can be opened (actual diff content available)
  // Desktop remote chats (sandboxId without worktree) cannot open diff sidebar - only stats in header
  const canOpenDiff = !!worktreePath || (!!sandboxId && !isDesktopPlatform)

  // Create list of subchats with changed files for filtering
  // Only include subchats that have uncommitted changes, sorted by most recent first
  const subChatsWithFiles = useMemo(() => {
    const result: Array<{
      id: string
      name: string
      filePaths: string[]
      fileCount: number
      updatedAt: string
    }> = []

    // Only include subchats that have files (uncommitted changes)
    for (const subChat of allSubChats) {
      const files = subChatFiles.get(subChat.id) || []
      if (files.length > 0) {
        result.push({
          id: subChat.id,
          name: subChat.name || "New Chat",
          filePaths: files.map((f) => f.filePath),
          fileCount: files.length,
          updatedAt: subChat.updated_at || subChat.created_at || "",
        })
      }
    }

    // Sort by most recent first
    result.sort((a, b) => {
      if (!a.updatedAt && !b.updatedAt) return 0
      if (!a.updatedAt) return 1
      if (!b.updatedAt) return -1
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

    return result
  }, [allSubChats, subChatFiles])

  // Close preview sidebar if preview becomes unavailable
  useEffect(() => {
    if (!canOpenPreview && isPreviewSidebarOpen) {
      setIsPreviewSidebarOpen(false)
    }
  }, [canOpenPreview, isPreviewSidebarOpen, setIsPreviewSidebarOpen])

  // Note: We no longer forcibly close diff sidebar when canOpenDiff is false.
  // The sidebar render is guarded by canOpenDiff, so it naturally hides.
  // Per-chat state (diffSidebarOpenAtomFamily) preserves each chat's preference.

  // PR/Git operations - extracted to usePrGitOperations hook
  const {
    hasPrNumber,
    isPrOpen,
    hasMergeConflicts,
    branchData,
    gitStatus,
    isGitStatusLoading,
    isCreatingPr,
    isReviewing,
    isCommittingToPr,
    mergePrMutation,
    restoreWorkspaceMutation,
    handleCreatePrDirect,
    handleCreatePr,
    handleMergePr,
    handleCommitToPr,
    handleReview,
    handleSubmitReview,
    handleFixConflicts,
    handleRestoreWorkspace,
    handleRefreshGitStatus,
    handleRefreshDiff,
    handleExpandAll,
    handleCollapseAll,
    handleMarkAllViewed,
    handleMarkAllUnviewed,
  } = usePrGitOperations({
    chatId,
    worktreePath,
    isDiffSidebarOpen,
    activeSubChatId,
    activeSubChatIdForPlan,
    agentChat,
    setHasPendingDiffChanges,
    parsedFileDiffs,
    setParsedFileDiffs,
    setPrefetchedFileContents,
    setDiffContent,
    setDiffStats,
    fetchDiffStats,
    diffViewRef,
    setIsPlanSidebarOpen,
    setIsDiffSidebarOpen,
  })

  // Track if we've initialized mode for this chatId to avoid overwriting user's mode changes
  const initializedChatIdRef = useRef<string | null>(null)

  // Initialize store when chat data loads
  useEffect(() => {
    if (!agentChat) return

    const store = useAgentSubChatStore.getState()
    const isNewChat = store.chatId !== chatId

    // Only initialize if chatId changed
    if (isNewChat) {
      // 清除旧 workspace 的 Chat 缓存，防止旧的空 Chat 对象被复用
      // 这修复了切换 workspace 后消息不显示的问题
      const oldOpenIds = store.openSubChatIds
      for (const oldId of oldOpenIds) {
        chatRegistry.unregister(oldId)
      }

      store.setChatId(chatId)
      // 重置全局消息状态，防止旧的 currentSubChatIdAtom 导致 IsolatedMessagesSection 跳过渲染
      appStore.set(currentSubChatIdAtom, "default")
      appStore.set(messageIdsAtom, [])
    }

    // Re-get fresh state after setChatId may have loaded from localStorage
    const freshState = useAgentSubChatStore.getState()

    // Get sub-chats from DB (like Canvas - no isPersistedInDb flag)
    // Build a map of existing local sub-chats to preserve their created_at if DB doesn't have it
    const existingSubChatsMap = new Map(
      freshState.allSubChats.map((sc) => [sc.id, sc]),
    )

    const dbSubChats: SubChatMeta[] = agentSubChats.map((sc) => {
      const existingLocal = existingSubChatsMap.get(sc.id)
      const createdAt =
        typeof sc.created_at === "string"
          ? sc.created_at
          : sc.created_at?.toISOString()
      const updatedAt =
        typeof sc.updated_at === "string"
          ? sc.updated_at
          : sc.updated_at?.toISOString()
      return {
        id: sc.id,
        name: sc.name || "New Chat",
        // Prefer DB timestamp, fall back to local timestamp, then current time
        created_at:
          createdAt ?? existingLocal?.created_at ?? new Date().toISOString(),
        updated_at: updatedAt ?? existingLocal?.updated_at,
        mode:
          (sc.mode as "plan" | "agent" | undefined) ||
          existingLocal?.mode ||
          "agent",
      }
    })
    const dbSubChatIds = new Set(dbSubChats.map((sc) => sc.id))

    // DB is the source of truth — archived sub-chats are already filtered out.
    // New sub-chats are added to the store directly via addToAllSubChats + React Query setData
    // at creation time, so no placeholder logic is needed here.
    freshState.setAllSubChats(dbSubChats)

    // Initialize atomFamily mode for each sub-chat from database
    // IMPORTANT: Only do this when chatId changes (new chat loaded), not on every agentChat update
    // This prevents overwriting user's mode changes when agentChat is invalidated/refetched
    if (initializedChatIdRef.current !== chatId) {
      initializedChatIdRef.current = chatId
      for (const sc of dbSubChats) {
        if (sc.mode) {
          appStore.set(subChatModeAtomFamily(sc.id), sc.mode)
        }
      }

      // Initialize openSubChatIds from DB.
      // DB already filters out archived sub-chats (via archived_at),
      // so we trust DB as source of truth.
      if (dbSubChats.length > 0) {
        freshState.setOpenSubChats(dbSubChats.map(sc => sc.id))
      }
    }

    // Validate openSubChatIds — remove any IDs that no longer exist in DB
    // (e.g. sub-chat was archived or deleted since last session)
    const currentOpenIds = freshState.openSubChatIds
    const validOpenIds = currentOpenIds.filter(id => dbSubChatIds.has(id))
    if (validOpenIds.length !== currentOpenIds.length) {
      freshState.setOpenSubChats(validOpenIds)
    }

    // Validate activeSubChatId
    const currentActive = freshState.activeSubChatId
    if (!currentActive || !dbSubChatIds.has(currentActive)) {
      // Pick the most recently updated sub-chat from open tabs, or from all DB sub-chats
      const candidates = validOpenIds.length > 0
        ? validOpenIds.map(id => dbSubChats.find(sc => sc.id === id)).filter(Boolean) as SubChatMeta[]
        : dbSubChats
      if (candidates.length > 0) {
        const latest = candidates.reduce((a, b) => {
          const aTime = a.updated_at || a.created_at || ""
          const bTime = b.updated_at || b.created_at || ""
          return bTime > aTime ? b : a
        })
        freshState.setActiveSubChat(latest.id)
        // If no open tabs, also open this one
        if (validOpenIds.length === 0) {
          freshState.setOpenSubChats([latest.id])
        }
      } else {
        freshState.setActiveSubChat(null)
      }
    }
  }, [agentChat, chatId])

  // Auto-detect plan path from ACTIVE sub-chat messages when sub-chat changes
  // This ensures the plan sidebar shows the correct plan for the active sub-chat only
  useEffect(() => {
    if (!agentSubChats || agentSubChats.length === 0 || !activeSubChatIdForPlan) {
      setCurrentPlanPath(null)
      return
    }

    // Find the active sub-chat
    const activeSubChat = agentSubChats.find(sc => sc.id === activeSubChatIdForPlan)
    if (!activeSubChat) {
      setCurrentPlanPath(null)
      return
    }

    // Find last plan file path from active sub-chat only
    let lastPlanPath: string | null = null
    type MessageLike = { role?: string; parts?: Array<{ type?: string; input?: { file_path?: string } }> }
    const messages = (Array.isArray(activeSubChat.messages) ? activeSubChat.messages : []) as MessageLike[]
    for (const msg of messages) {
      if (msg.role !== "assistant") continue
      const parts = msg.parts || []
      for (const part of parts) {
        if (
          part.type === "tool-Write" &&
          part.input?.file_path &&
          isPlanFile(part.input.file_path)
        ) {
          lastPlanPath = part.input.file_path
        }
      }
    }

    setCurrentPlanPath(lastPlanPath)
  }, [agentSubChats, activeSubChatIdForPlan, setCurrentPlanPath])

  // Create or get Chat instance for a sub-chat
  const getOrCreateChat = useCallback(
    (subChatId: string): Chat<any> | null => {
      // Desktop uses worktreePath, web uses sandboxUrl
      if (!chatWorkingDir || !agentChat) {
        return null
      }

      // Return existing chat if we have it
      const existing = chatRegistry.get(subChatId)
      if (existing) {
        // 检查 CWD 是否变更（playground 转项目后路径变化）
        const entry = chatRegistry.getEntry(subChatId)
        if (worktreePath && entry?.cwd && entry.cwd !== worktreePath) {
          console.log('[getOrCreateChat] CWD changed, hot-updating transport', {
            subChatId: subChatId.slice(-8),
            oldCwd: entry.cwd,
            newCwd: worktreePath,
          })
          // 热更新：保留 Chat 实例和消息，只更新 transport CWD
          chatRegistry.updateCwdByParentChatId(entry.parentChatId, worktreePath)
          return existing
        } else {
          // 检查：如果缓存的 Chat 初始化时消息为空，但现在有消息数据了
          // 需要清除缓存并重新创建，以使用新的消息数据
          // 这修复了时序问题：Chat 在 subChatMessagesData 到达前被创建为空消息
          const hasNewMessages = subChatMessagesData?.messages && subChatId === activeSubChatId
          if (hasNewMessages) {
            try {
              const parsed = JSON.parse(subChatMessagesData.messages)
              // 使用 existing.messages 属性（来自 @ai-sdk/react Chat 类）
              const existingMessages = existing.messages ?? []
              console.log('[getOrCreateChat] Checking cache', {
                subChatId: subChatId.slice(-8),
                cachedMsgCount: existingMessages.length,
                newMsgCount: parsed.length,
              })
              // 如果数据库有更多消息（例如用户发送后后端已保存但 Chat 对象未更新），重新创建 Chat
              if (parsed.length > existingMessages.length) {
                console.log('[getOrCreateChat] Recreating chat with new messages')
                chatRegistry.unregister(subChatId)
                // 不 return，继续往下创建新 Chat
              } else {
                return existing
              }
            } catch {
              return existing
            }
          } else {
            return existing
          }
        }
      }

      // Find sub-chat data
      const subChat = agentSubChats.find((sc) => sc.id === subChatId)

      // Use lazy-loaded messages for local chats (performance optimization)
      // Remote chats still use messages from agentSubChats
      let messages: unknown[] = []
      if (subChatMessagesData?.messages && subChatId === activeSubChatId) {
        try {
          const parsed = JSON.parse(subChatMessagesData.messages)
          // Transform messages from DB format to AI SDK format
          messages = parsed.map((msg: any) => {
            if (!msg.parts) return msg
            return {
              ...msg,
              parts: msg.parts.map((part: any) => {
                // Migrate old "tool-invocation" type to "tool-{toolName}"
                if (part.type === "tool-invocation" && part.toolName) {
                  return {
                    ...part,
                    type: `tool-${part.toolName}`,
                    toolCallId: part.toolCallId || part.toolInvocationId,
                    input: part.input || part.args,
                  }
                }
                // Migrate old "tool-Thinking" to native "reasoning" part
                if (part.type === "tool-Thinking") {
                  return {
                    type: "reasoning",
                    text: part.input?.text || "",
                    state: "done",
                  }
                }
                // Normalize state field from DB format to AI SDK format
                if (part.type?.startsWith("tool-") && part.state) {
                  let normalizedState = part.state
                  if (part.state === "result") {
                    normalizedState = part.result?.success === false ? "output-error" : "output-available"
                  }
                  return { ...part, state: normalizedState, output: part.output || part.result }
                }
                return part
              }),
            }
          })
        } catch (err) {
          console.warn("[getOrCreateChat] Failed to parse lazy-loaded messages", err)
        }
      } else if (Array.isArray(subChat?.messages)) {
        // Fallback for remote chats or when lazy loading hasn't completed
        messages = subChat.messages as unknown[]
      }

      // Get mode from store metadata (falls back to currentMode)
      const subChatMeta = useAgentSubChatStore
        .getState()
        .allSubChats.find((sc) => sc.id === subChatId)
      const subChatMode = subChatMeta?.mode || currentMode

      // Create transport based on chat type (local worktree vs remote sandbox)
      // Note: Extended thinking setting is read dynamically inside the transport
      // projectPath: original project path for MCP config lookup (worktreePath is the cwd)
      const projectPath = getProjectPath(agentChat as AgentChat | null)
      const chatSandboxId = getSandboxId(agentChat as AgentChat | null)
      const chatSandboxUrl = chatSandboxId ? `https://3003-${chatSandboxId}.e2b.app` : null
      const isChatRemote = isRemoteChat(agentChat as AgentChat | null) || !!chatSandboxId

      console.log("[getOrCreateChat] Transport selection", {
        subChatId: subChatId.slice(-8),
        isChatRemote,
        chatSandboxId,
        chatSandboxUrl,
        worktreePath: worktreePath ? "exists" : "none",
      })

      let transport: IPCChatTransport | RemoteChatTransport | null = null

      if (isChatRemote && chatSandboxUrl) {
        // Remote sandbox chat: use HTTP SSE transport
        const subChatName = subChat?.name || "Chat"
        const modelString = MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP["sonnet"]
        console.log("[getOrCreateChat] Using RemoteChatTransport", { sandboxUrl: chatSandboxUrl, model: modelString })
        transport = new RemoteChatTransport({
          chatId,
          subChatId,
          subChatName,
          sandboxUrl: chatSandboxUrl,
          mode: subChatMode,
          model: modelString,
        })
      } else if (worktreePath) {
        // Local worktree chat: use IPC transport
        transport = new IPCChatTransport({
          chatId,
          subChatId,
          cwd: worktreePath,
          projectPath,
          mode: subChatMode,
        })
      }

      if (!transport) {
        console.error("[getOrCreateChat] No transport available")
        return null
      }

      const newChat = new Chat<any>({
        id: subChatId,
        messages,
        transport,
        onError: () => {
          // Clear loading state on error (matches onFinish behavior)
          clearLoading(setLoadingSubChats, subChatId)

          // Sync status to global store on error (allows queue to continue)
          useStreamingStatusStore.getState().setStatus(subChatId, "ready")

          // Show error notification with sound
          notifyAgentError(agentChat?.name || "Agent")
        },
        // Clear loading when streaming completes (works even if component unmounted)
        onFinish: () => {
          clearLoading(setLoadingSubChats, subChatId)

          // Sync status to global store for queue processing (even when component unmounted)
          useStreamingStatusStore.getState().setStatus(subChatId, "ready")

          // Check if this was a manual abort (ESC/Ctrl+C) - skip sound if so
          const wasManuallyAborted =
            chatRegistry.wasManuallyAborted(subChatId)
          chatRegistry.clearManuallyAborted(subChatId)

          // Get CURRENT values at runtime (not stale closure values)
          const currentActiveSubChatId =
            useAgentSubChatStore.getState().activeSubChatId
          const currentSelectedChatId = appStore.get(selectedAgentChatIdAtom)

          const isViewingThisSubChat = currentActiveSubChatId === subChatId
          const isViewingThisChat = currentSelectedChatId === chatId

          if (!isViewingThisSubChat) {
            // Mark as unseen in both old atom and new persisted storage
            setSubChatUnseenChanges((prev: Set<string>) => {
              const next = new Set(prev)
              next.add(subChatId)
              return next
            })
            markSubChatUnseen(setSubChatStatus, subChatId)
          }

          // Also mark parent chat as unseen if user is not viewing it
          if (!isViewingThisChat) {
            setUnseenChanges((prev: Set<string>) => {
              const next = new Set(prev)
              next.add(chatId)
              return next
            })

            // Play completion sound only if NOT manually aborted and sound is enabled
            if (!wasManuallyAborted) {
              const isSoundEnabled = appStore.get(soundNotificationsEnabledAtom)
              if (isSoundEnabled) {
                try {
                  const audio = new Audio("./sound.mp3")
                  audio.volume = 1.0
                  audio.play().catch(() => {})
                } catch {
                  // Ignore audio errors
                }
              }

              // Show native notification (desktop app, when window not focused)
              notifyAgentComplete(agentChat?.name || "Agent")
            }
          }

          // Refresh diff stats after agent finishes making changes
          fetchDiffStatsRef.current()

          // Note: sidebar timestamp update is handled via optimistic update in handleSend
          // No need to refetch here as it would overwrite the optimistic update with stale data
        },
      })

      chatRegistry.register(subChatId, newChat, chatId, worktreePath || undefined, transport instanceof IPCChatTransport ? transport : undefined)
      // Store streamId at creation time to prevent resume during active streaming
      // tRPC refetch would update stream_id in DB, but store stays stable
      chatRegistry.registerStreamId(subChatId, subChat?.stream_id || null)
      // Defer force update to avoid "update while rendering" error
      pendingForceUpdateRef.current = true
      return newChat
    },
    [
      agentChat,
      chatWorkingDir,
      worktreePath,
      chatId,
      currentMode,
      setSubChatUnseenChanges,
      setSubChatStatus,
      selectedChatId,
      setUnseenChanges,
      notifyAgentComplete,
      notifyAgentError,
      subChatMessagesData,
      activeSubChatId,
    ],
  )

  // Handle creating a new sub-chat
  const handleCreateNewSubChat = useCallback(async () => {
    trackClickNewChat("add")
    const store = useAgentSubChatStore.getState()
    // New sub-chats use the user's default mode preference
    const newSubChatMode = defaultAgentMode

    // Check if this is a remote sandbox chat
    const isChatRemoteForNew = isRemoteChat(agentChat as AgentChat | null)

    let newId: string

    if (isChatRemoteForNew) {
      // Sandbox mode: lazy creation (web app pattern)
      // Sub-chat will be persisted on first message via RemoteChatTransport UPSERT
      newId = crypto.randomUUID()
    } else {
      // Local mode: create sub-chat in DB first to get the real ID
      const newSubChat = await trpcClient.chats.createSubChat.mutate({
        chatId,
        name: "New Chat",
        mode: newSubChatMode,
      })
      newId = newSubChat.id
      utils.agents.getAgentChat.invalidate({ chatId })

      // Optimistic update: add new sub-chat to React Query cache immediately
      // This is CRITICAL for workspace isolation - without this, the new sub-chat
      // won't be in validSubChatIds and will be filtered out by tabsToRender
      utils.agents.getAgentChat.setData({ chatId }, (old) => {
        if (!old) return old
        return {
          ...old,
          subChats: [
            ...(old.subChats || []),
            {
              id: newId,
              name: "New Chat",
              mode: newSubChatMode,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              messages: null,
              stream_id: null,
            },
          ],
        }
      })
    }

    // Track this subchat as just created for typewriter effect
    setJustCreatedIds((prev) => new Set([...prev, newId]))

    // Add to allSubChats with placeholder name
    store.addToAllSubChats({
      id: newId,
      name: "New Chat",
      created_at: new Date().toISOString(),
      mode: newSubChatMode,
    })

    // Set the mode atomFamily for the new sub-chat (so currentMode reads correct value)
    appStore.set(subChatModeAtomFamily(newId), newSubChatMode)

    // Add to open tabs and set as active
    store.addToOpenSubChats(newId)
    store.setActiveSubChat(newId)

    // Create empty Chat instance for the new sub-chat
    const projectPath = getProjectPath(agentChat as AgentChat | null)
    const newSubChatSandboxId = getSandboxId(agentChat as AgentChat | null)
    const newSubChatSandboxUrl = newSubChatSandboxId ? `https://3003-${newSubChatSandboxId}.e2b.app` : null
    const isNewSubChatRemote = isRemoteChat(agentChat as AgentChat | null) || !!newSubChatSandboxId

    console.log("[createNewSubChat] Transport selection", {
      newId: newId.slice(-8),
      isNewSubChatRemote,
      newSubChatSandboxId,
      newSubChatSandboxUrl,
    })

    let newSubChatTransport: IPCChatTransport | RemoteChatTransport | null = null

    if (isNewSubChatRemote && newSubChatSandboxUrl) {
      // Remote sandbox chat: use HTTP SSE transport
      const modelString = MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP["sonnet"]
      console.log("[createNewSubChat] Using RemoteChatTransport", { model: modelString })
      newSubChatTransport = new RemoteChatTransport({
        chatId,
        subChatId: newId,
        subChatName: "New Chat",
        sandboxUrl: newSubChatSandboxUrl,
        mode: subChatMode,
        model: modelString,
      })
    } else if (worktreePath) {
      // Local worktree chat: use IPC transport
      newSubChatTransport = new IPCChatTransport({
        chatId,
        subChatId: newId,
        cwd: worktreePath,
        projectPath,
        mode: newSubChatMode,
      })
    }

    if (newSubChatTransport) {
      const transport = newSubChatTransport

      const newChat = new Chat<any>({
        id: newId,
        messages: [],
        transport,
        onError: () => {
          // Sync status to global store on error (allows queue to continue)
          useStreamingStatusStore.getState().setStatus(newId, "ready")

          // Show error notification with sound
          notifyAgentError(agentChat?.name || "Agent")
        },
        // Clear loading when streaming completes
        onFinish: () => {
          clearLoading(setLoadingSubChats, newId)

          // Sync status to global store for queue processing (even when component unmounted)
          useStreamingStatusStore.getState().setStatus(newId, "ready")

          // Check if this was a manual abort (ESC/Ctrl+C) - skip sound if so
          const wasManuallyAborted = chatRegistry.wasManuallyAborted(newId)
          chatRegistry.clearManuallyAborted(newId)

          // Get CURRENT values at runtime (not stale closure values)
          const currentActiveSubChatId =
            useAgentSubChatStore.getState().activeSubChatId
          const currentSelectedChatId = appStore.get(selectedAgentChatIdAtom)

          const isViewingThisSubChat = currentActiveSubChatId === newId
          const isViewingThisChat = currentSelectedChatId === chatId

          if (!isViewingThisSubChat) {
            // Mark as unseen in both old atom and new persisted storage
            setSubChatUnseenChanges((prev: Set<string>) => {
              const next = new Set(prev)
              next.add(newId)
              return next
            })
            markSubChatUnseen(setSubChatStatus, newId)
          }

          // Also mark parent chat as unseen if user is not viewing it
          if (!isViewingThisChat) {
            setUnseenChanges((prev: Set<string>) => {
              const next = new Set(prev)
              next.add(chatId)
              return next
            })

            // Play completion sound only if NOT manually aborted and sound is enabled
            if (!wasManuallyAborted) {
              const isSoundEnabled = appStore.get(soundNotificationsEnabledAtom)
              if (isSoundEnabled) {
                try {
                  const audio = new Audio("./sound.mp3")
                  audio.volume = 1.0
                  audio.play().catch(() => {})
                } catch {
                  // Ignore audio errors
                }
              }

              // Show native notification (desktop app, when window not focused)
              notifyAgentComplete(agentChat?.name || "Agent")
            }
          }

          // Refresh diff stats after agent finishes making changes
          fetchDiffStatsRef.current()

          // Note: sidebar timestamp update is handled via optimistic update in handleSend
          // No need to refetch here as it would overwrite the optimistic update with stale data
        },
      })
      chatRegistry.register(newId, newChat, chatId, worktreePath || undefined, transport instanceof IPCChatTransport ? transport : undefined)
      chatRegistry.registerStreamId(newId, null) // New chat has no active stream
      // Defer force update to avoid "update while rendering" error
      pendingForceUpdateRef.current = true
    }
  }, [
    worktreePath,
    chatId,
    defaultAgentMode,
    utils,
    setSubChatUnseenChanges,
    setSubChatStatus,
    selectedChatId,
    setUnseenChanges,
    notifyAgentComplete,
    notifyAgentError,
    agentChat?.isRemote,
    agentChat?.name,
  ])

  // NOTE: Desktop notifications for pending questions are now triggered directly
  // in ipc-chat-transport.ts when the ask-user-question chunk arrives.
  // This prevents duplicate notifications from multiple ChatView instances.

  // Multi-select state for sub-chats (for Cmd+W bulk close)
  const selectedSubChatIds = useAtomValue(selectedSubChatIdsAtom)
  const isSubChatMultiSelectMode = useAtomValue(isSubChatMultiSelectModeAtom)
  const clearSubChatSelection = useSetAtom(clearSubChatSelectionAtom)

  // Keyboard shortcuts: Cmd+T, Cmd+W, Cmd+[/], Cmd+D, Cmd+Shift+E
  // Consolidated into a single hook for cleaner code
  useChatKeyboardShortcuts({
    chatId,
    onNewSubChat: handleCreateNewSubChat,
    onToggleDiffSidebar: useCallback(() => setIsDiffSidebarOpen((prev) => !prev), []),
    onRestoreWorkspace: handleRestoreWorkspace,
    isDiffSidebarOpen,
    isArchived,
    isRestoringWorkspace: restoreWorkspaceMutation.isPending,
    isSubChatMultiSelectMode,
    selectedSubChatIds,
    clearSubChatSelection,
  })

  // Handle auto-rename for sub-chat and parent chat
  // Receives subChatId as param to avoid stale closure issues
  const handleAutoRename = useCallback(
    (userMessage: string, subChatId: string) => {
      // Check if this is the first sub-chat using agentSubChats directly
      // to avoid race condition with store initialization
      const firstSubChatId = getFirstSubChatId(agentSubChats)
      const isFirst = firstSubChatId === subChatId

      // Get the sub-chat to check manuallyRenamed flag
      const subChat = agentSubChats.find(sc => sc.id === subChatId)
      if (subChat?.manually_renamed) {
        console.log("[auto-rename] Skipping - user has manually renamed this sub-chat")
        return
      }

      autoRenameAgentChat({
        subChatId,
        parentChatId: chatId,
        userMessage,
        isFirstSubChat: isFirst,
        generateName: async (msg) => {
          const sp = appStore.get(summaryProviderIdAtom)
          const sm = appStore.get(summaryModelIdAtom)
          const payload = {
            userMessage: msg,
            subChatId,
            chatId,
            projectId: chatProject?.id,
            isFirstSubChat: isFirst,
            ...(sp && sm && { summaryProviderId: sp, summaryModelId: sm }),
          }
          console.log("[auto-rename] summaryProvider:", sp || "(not set)", "summaryModel:", sm || "(not set)")
          return generateSubChatNameMutation.mutateAsync(payload)
        },
        renameSubChat: async (input) => {
          // Pass skipManuallyRenamed to prevent setting the flag for auto-rename
          await renameSubChatMutation.mutateAsync({ ...input, skipManuallyRenamed: true })
        },
        renameChat: async (input) => {
          // Pass skipManuallyRenamed to prevent setting the flag for auto-rename
          await renameChatMutation.mutateAsync({ ...input, skipManuallyRenamed: true })
        },
        updateSubChatName: (subChatIdToUpdate, name) => {
          // Update local store
          useAgentSubChatStore
            .getState()
            .updateSubChatName(subChatIdToUpdate, name)
          // Also update query cache so init effect doesn't overwrite
          utils.agents.getAgentChat.setData({ chatId }, (old) => {
            if (!old) return old
            const existsInCache = old.subChats.some(
              (sc: { id: string }) => sc.id === subChatIdToUpdate,
            )
            if (!existsInCache) {
              // Sub-chat not in cache yet (DB save still in flight) - add it
              return {
                ...old,
                subChats: [
                  ...old.subChats,
                  {
                    id: subChatIdToUpdate,
                    name,
                    created_at: new Date(),
                    updated_at: new Date(),
                    messages: [],
                    mode: "agent",
                    stream_id: null,
                    chat_id: chatId,
                  },
                ],
              }
            }
            return {
              ...old,
              subChats: old.subChats.map((sc: { id: string; name: string }) =>
                sc.id === subChatIdToUpdate ? { ...sc, name } : sc,
              ),
            }
          })
        },
        updateChatName: (chatIdToUpdate, name) => {
          // Optimistic update for sidebar (list query)
          // On desktop, selectedTeamId is always null, so we update unconditionally
          utils.agents.getAgentChats.setData(
            { teamId: selectedTeamId },
            (old: { id: string; name: string | null }[] | undefined) => {
              if (!old) return old
              return old.map((c) =>
                c.id === chatIdToUpdate ? { ...c, name } : c,
              )
            },
          )
          // Optimistic update for header (single chat query)
          utils.agents.getAgentChat.setData(
            { chatId: chatIdToUpdate },
            (old) => {
              if (!old) return old
              return { ...old, name }
            },
          )
        },
        // Name confirmation callbacks
        onNameUnconfirmed: () => {
          console.log("[auto-rename] Marking name as unconfirmed (shimmer) for subChatId:", subChatId)
          markNameUnconfirmed(setUnconfirmedNameSubChats, subChatId)
        },
        onNameConfirmed: () => {
          // Fallback: called by timeout if IPC never arrives
          console.log("[auto-rename] Fallback: confirming name for subChatId:", subChatId)
          confirmName(setUnconfirmedNameSubChats, subChatId)
        },
      })
    },
    [
      chatId,
      agentSubChats,
      generateSubChatNameMutation,
      renameSubChatMutation,
      renameChatMutation,
      selectedTeamId,
      selectedOllamaModel,
      utils.agents.getAgentChats,
      utils.agents.getAgentChat,
      chatProject?.id,
      setUnconfirmedNameSubChats,
    ],
  )

  // Determine if chat header should be hidden
  const shouldHideChatHeader =
    subChatsSidebarMode === "sidebar" &&
    isPreviewSidebarOpen &&
    isDiffSidebarOpen &&
    !isMobileFullscreen

  // No early return - let the UI render with loading state handled by activeChat check below

  // Global comment input - reuses the same hook as ChatViewInner (writes to same atom)
  const globalOpenCommentInput = useCommentInput()

  // ── ChatInstanceContext value ──────────────────────────────────────────
  // Provides chat identity + data to all children via useChatInstance()
  // Uses ValueProvider to avoid duplicate tRPC queries (ChatView already fetches agentChat)
  const chatInstanceValue = useMemo<ChatInstanceContextValue>(() => ({
    chatId,
    worktreePath,
    sandboxId: sandboxId ?? null,
    projectPath: chatProject?.path ?? selectedProject?.path ?? null,
    agentChat: agentChat as AgentChat | null,
    agentSubChats: agentSubChats as any[],
    isLoading: isLocalChatLoading,
    isRemoteChat: chatSourceMode === "sandbox",
    isSandboxMode: chatSourceMode === "sandbox" || !!sandboxId,
    isPlayground: selectedProject?.isPlayground === true,
    project: chatProject,
    isArchived,
    invalidateChat: async () => {
      const queryClient = getQueryClient()
      await queryClient.invalidateQueries({
        queryKey: [["agents", "getAgentChat"], { input: { chatId } }],
      })
    },
    refreshBranch: async () => {
      if (!worktreePath) return
      try {
        await trpcClient.changes.fetchRemote.mutate({ worktreePath })
        const queryClient = getQueryClient()
        await queryClient.invalidateQueries({
          queryKey: [["agents", "getAgentChat"], { input: { chatId } }],
        })
      } catch (error) {
        console.error("[ChatInstanceContext] Failed to refresh branch:", error)
      }
    },
  }), [
    chatId, worktreePath, sandboxId, chatProject, selectedProject,
    agentChat, agentSubChats, isLocalChatLoading, chatSourceMode, isArchived,
  ])

  return (
    <ChatInstanceValueProvider value={chatInstanceValue}>
    <ChatCapabilitiesProvider hideGitFeaturesOverride={hideGitFeatures}>
    <FileOpenProvider onOpenFile={setFileViewerPath}>
    <TextSelectionProvider>
    {/* Global TextSelectionPopover for diff sidebar (outside ChatViewInner) */}
    <TextSelectionPopover
      onAddToContext={() => {}} // No-op - diff sidebar doesn't have chat input
      onAddComment={globalOpenCommentInput}
    />
    {/* File Search Dialog (Cmd+P) */}
    {worktreePath && (
      <FileSearchDialog
        open={fileSearchOpen}
        onOpenChange={setFileSearchOpen}
        projectPath={worktreePath}
        onSelectFile={setFileViewerPath}
      />
    )}
    <PanelsProvider panels={builtinPanelDefinitions}>
    <div className="flex h-full flex-col">
      {/* Main content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Chat Panel */}
        <div
          className="flex-1 flex flex-col overflow-hidden relative"
          style={{ minWidth: "350px" }}
        >
          {/* Chat Header - extracted to ChatViewHeader component */}
          <ChatViewHeader
            isMobileFullscreen={isMobileFullscreen}
            subChatsSidebarMode={subChatsSidebarMode}
            shouldHideChatHeader={shouldHideChatHeader}
            isSidebarOpen={isSidebarOpen}
            onToggleSidebar={onToggleSidebar}
            hasAnyUnseenChanges={hasAnyUnseenChanges}
            handleCreateNewSubChat={handleCreateNewSubChat}
            onBackToChats={onBackToChats}
            hideGitFeatures={hideGitFeatures}
            canOpenPreview={canOpenPreview}
            onOpenPreview={onOpenPreview}
            isPreviewSidebarOpen={isPreviewSidebarOpen}
            setIsPreviewSidebarOpen={setIsPreviewSidebarOpen}
            chatSourceMode={chatSourceMode}
            canShowDiffButton={canShowDiffButton}
            canOpenDiff={canOpenDiff}
            isDiffSidebarOpen={isDiffSidebarOpen}
            setIsDiffSidebarOpen={setIsDiffSidebarOpen}
            diffStats={diffStats}
            isTerminalSidebarOpen={isTerminalSidebarOpen}
            setIsTerminalSidebarOpen={setIsTerminalSidebarOpen}
            toggleTerminalHotkey={toggleTerminalHotkey}
            isUnifiedSidebarEnabled={isUnifiedSidebarEnabled}
            isDetailsSidebarOpen={isDetailsSidebarOpen}
            setIsDetailsSidebarOpen={setIsDetailsSidebarOpen}
            toggleDetailsHotkey={toggleDetailsHotkey}
            handleRestoreWorkspace={handleRestoreWorkspace}
            isRestorePending={restoreWorkspaceMutation.isPending}
            showOpenLocally={showOpenLocally}
            handleOpenLocally={handleOpenLocally}
            isImporting={isImporting}
            rightHeaderSlot={rightHeaderSlot}
          />

          {/* Chat Content - Keep-alive: render all open tabs, hide inactive with CSS */}
          <SubChatTabsContainer
            show={tabsToRender.length > 0 && !!agentChat}
            tabsToRender={tabsToRender}
            activeSubChatId={activeSubChatId}
            agentSubChats={agentSubChats}
            allSubChats={allSubChats}
            isLocalChatLoading={isLocalChatLoading}
            isLoadingMessages={isLoadingMessages}
            chatSourceMode={chatSourceMode}
            subChatMessagesData={subChatMessagesData}
            getOrCreateChat={getOrCreateChat}
            handleAutoRename={handleAutoRename}
            handleCreateNewSubChat={handleCreateNewSubChat}
            selectedTeamId={selectedTeamId}
            repositoryString={repositoryString}
            isMobileFullscreen={isMobileFullscreen}
            subChatsSidebarMode={subChatsSidebarMode}
            handleRestoreWorkspace={handleRestoreWorkspace}
            existingPrUrl={agentChat?.prUrl}
            ChatViewInnerComponent={ChatViewInner}
            collapsedIndicator={collapsedIndicator}
          />
          {!(tabsToRender.length > 0 && agentChat) && (
            <ChatViewLoadingPlaceholder
              isChatFullWidth={isChatFullWidth}
              hasCustomClaudeConfig={hasCustomClaudeConfig}
            />
          )}
        </div>

        {/* ── PanelZone: 统一面板渲染 ── */}
        {/* 每个 Panel 通过 PanelZone 自动管理容器（ResizableSidebar/CenterPeekDialog 等） */}
        {/* Panel 组件从 Context/Atom/Store 自行获取数据，keepMounted 优化重型组件 */}
        <PanelZone position="right" />

        {/* Open Locally Dialog - for importing sandbox chats to local */}
        <OpenLocallyDialog
          isOpen={openLocallyDialogOpen}
          onClose={() => setOpenLocallyDialogOpen(false)}
          remoteChat={remoteAgentChat ?? null}
          matchingProjects={openLocallyMatchingProjects}
          allProjects={projects ?? []}
          remoteSubChatId={activeSubChatId}
        />

        {/* Expanded Widget Sidebar — 暂时保留（DetailsPanel 内部尚未整合） */}
        {isUnifiedSidebarEnabled && !isMobileFullscreen && worktreePath && (
          <ExpandedWidgetSidebar
            chatId={chatId}
            worktreePath={worktreePath}
            planPath={currentPlanPath}
            planRefetchTrigger={planEditRefetchTrigger}
            activeSubChatId={activeSubChatIdForPlan}
            canOpenDiff={canOpenDiff}
            isDiffSidebarOpen={isDiffSidebarOpen}
            setIsDiffSidebarOpen={setIsDiffSidebarOpen}
            diffStats={diffStats}
          />
        )}
      </div>
      <PanelZone position="bottom" />
    </div>
    <PanelZone position="overlay" />
    </PanelsProvider>
    </TextSelectionProvider>
    </FileOpenProvider>
    </ChatCapabilitiesProvider>
    </ChatInstanceValueProvider>
  )
}
