"use client"

import { Button } from "../../../components/ui/button"
import {
  AgentIcon,
  AttachIcon,
  ClaudeCodeIcon,
  IconOpenSidebarRight,
  IconSpinner,
  IconTextUndo
} from "../../../components/ui/icons"
import { Kbd } from "../../../components/ui/kbd"
import {
  PromptInput,
  PromptInputActions
} from "../../../components/ui/prompt-input"
import { ResizableBottomPanel } from "@/components/ui/resizable-bottom-panel"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"
import { Chat, useChat } from "@ai-sdk/react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  ArrowLeftFromLine,
  ChevronDown,
  GitFork,
  MoveHorizontal,
  SquareTerminal,
} from "lucide-react"
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { toast } from "sonner"
import { useShallow } from "zustand/react/shallow"
import { getQueryClient } from "../../../contexts/TRPCProvider"
import {
  trackClickNewChat,
  trackClickPlanApprove,
} from "../../../lib/sensors-analytics"
import {
  betaBrowserEnabledAtom,
  chatSourceModeAtom,
  customClaudeConfigAtom,
  defaultAgentModeAtom,
  isDesktopAtom, isFullscreenAtom,
  normalizeCustomClaudeConfig,
  selectedOllamaModelAtom,
  summaryProviderIdAtom,
  summaryModelIdAtom,
} from "../../../lib/atoms"
import {
  setTrafficLightRequestAtom,
  removeTrafficLightRequestAtom,
  TRAFFIC_LIGHT_PRIORITIES,
} from "../../../lib/atoms/traffic-light"
import {
  sessionModelOverrideAtom,
  chatModelSelectionsAtom,
} from "../../../lib/atoms/model-config"
import { useFileChangeListener, useGitWatcher } from "../../../lib/hooks/use-file-change-listener"
import { useRemoteChat } from "../../../lib/hooks/use-remote-chats"
import { useResolvedHotkeyDisplay } from "../../../lib/hotkeys"
import { appStore } from "../../../lib/jotai-store"
import { api } from "../../../lib/mock-api"
import { trpc, trpcClient } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { isDesktopApp } from "../../../lib/utils/platform"
import { FileSearchDialog } from "../../file-viewer/components/file-search-dialog"
import { browserPendingScreenshotAtomFamily } from "../../browser-sidebar"
import { terminalBottomHeightAtom } from "../../terminal/atoms"
import { TerminalBottomPanelContent } from "../../terminal/terminal-sidebar"
import {
  agentsDiffSidebarWidthAtom,
  agentsSubChatsSidebarModeAtom,
  agentsSubChatUnseenChangesAtom,
  agentsUnseenChangesAtom,
  subChatStatusStorageAtom,
  clearSubChatUnseen,
  compactingSubChatsAtom,
  expiredUserQuestionsAtom,
  justCreatedIdsAtom,
  lastSelectedModelIdAtom,
  loadingSubChatsAtom,
  pendingBuildPlanSubChatIdAtom,
  pendingUserQuestionsAtom,
  planEditRefetchTriggerAtomFamily,
  QUESTIONS_SKIPPED_MESSAGE,
  selectedAgentChatIdAtom,
  selectedProjectAtom,
  setLoading,
  subChatModeAtomFamily,
  undoStackAtom,
  currentProjectModeAtom,
  agentsChatFullWidthAtom,
  suppressInputFocusAtom,
  clearSubChatSelectionAtom,
  isSubChatMultiSelectModeAtom,
  selectedSubChatIdsAtom,
  selectedTeamIdAtom,
  type AgentMode,
} from "../atoms"
import { AgentSendButton } from "../components/agent-send-button"
import { PreviewSetupHoverCard } from "../components/preview-setup-hover-card"
import type { TextSelectionSource } from "../context/text-selection-context"
import { TextSelectionProvider } from "../context/text-selection-context"
import { ChatInstanceProvider, useChatInstance } from "../context/chat-instance-context"
import { useAgentsFileUpload } from "../hooks/use-agents-file-upload"
import { useAutoImport } from "../hooks/use-auto-import"
import { scrollTargetAtom, SCROLL_TO_BOTTOM } from "../../../lib/router"
import { useChangedFilesTracking } from "../hooks/use-changed-files-tracking"
import { useDesktopNotifications } from "../hooks/use-desktop-notifications"
import { useFocusInputOnEnter } from "../hooks/use-focus-input-on-enter"
import { usePastedTextFiles } from "../hooks/use-pasted-text-files"
import { useTextContextSelection } from "../hooks/use-text-context-selection"
import { useToggleFocusOnCmdEsc } from "../hooks/use-toggle-focus-on-cmd-esc"
import {
  clearSubChatDraft,
  getSubChatDraftFull
} from "../lib/drafts"
import {
  FileOpenProvider,
  type AgentsMentionsEditorHandle,
} from "../mentions"
import {
  ChatSearchBar,
  chatSearchCurrentMatchAtom,
  SearchHighlightProvider
} from "../search"
import { chatRegistry } from "../stores/chat-registry"
import { EMPTY_QUEUE, useMessageQueueStore } from "../stores/message-queue-store"
import { clearSubChatCaches, isRollingBackAtom, rollbackHandlerAtom, syncMessagesWithStatusAtom, type MessagePart, type Message, type MessageMetadata } from "../stores/message-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import {
  useAgentSubChatStore,
} from "../stores/sub-chat-store"
import {
  diffViewModeAtom,
  type AgentDiffViewRef,
} from "../ui/agent-diff-view"
import { AgentQueueIndicator } from "../ui/agent-queue-indicator"
import { AgentToolCall } from "../ui/agent-tool-call"
import { AgentToolRegistry } from "../ui/agent-tool-registry"
import { isPlanFile } from "../ui/agent-tool-utils"
import { AgentUserMessageBubble } from "../ui/agent-user-message-bubble"
import { AgentUserQuestion, type AgentUserQuestionHandle } from "../ui/agent-user-question"
import { AgentsHeaderControls } from "../ui/agents-header-controls"
import { ChatTitleEditor } from "../ui/chat-title-editor"
import { MobileChatHeader } from "../ui/mobile-chat-header"
import { DocumentCommentInput } from "../ui/document-comment-input"
import { useDocumentComments } from "../hooks/use-document-comments"
import { SubChatSelector } from "../ui/sub-chat-selector"
import { SubChatStatusCard } from "../ui/sub-chat-status-card"
import { TextSelectionPopover } from "../ui/text-selection-popover"
import { autoRenameAgentChat } from "../utils/auto-rename"
import { ChatInputArea } from "./chat-input-area"
import { CHAT_LAYOUT, PLAYBACK_SPEEDS, type PlaybackSpeed } from "./constants"
import { IsolatedMessagesSection } from "./isolated-messages-section"
import type { ProjectMode } from "../../../../shared/feature-config"
import type { AgentChat, ChatProject } from "../types"
import { isRemoteChat, getSandboxId, getProjectPath } from "../types"
import { pendingCacheCleanups, getFirstSubChatId, createChatCallbacks, createChatTransport, type ChatCallbacksDeps } from "../utils/chat-utils"
import { ScrollToBottomButton } from "../ui/scroll-to-bottom-button"
import { MessageGroup } from "../ui/message-group"
import { useChatHotkeys } from "../hooks/use-chat-hotkeys"
import { useChatScroll } from "../hooks/use-chat-scroll"
import { useChatPendingActions } from "../hooks/use-chat-pending-actions"
import { useMessageSend } from "../hooks/use-message-send"
import { usePrOperations } from "../hooks/use-pr-operations"
import { useSidebarState } from "../hooks/use-sidebar-state"
import { useDiffData } from "../hooks/use-diff-data"
import { useStoreInitialization } from "../hooks/use-store-initialization"
import { ChatSidebars } from "../ui/parts/chat-sidebars"
// Inner chat component - only rendered when chat object is ready
// Memoized to prevent re-renders when parent state changes (e.g., selectedFilePath)
const ChatViewInner = memo(function ChatViewInner({
  chat,
  subChatId,
  parentChatId,
  isFirstSubChat,
  teamId,
  repository,
  streamId,
  isMobile = false,
  sandboxSetupStatus = "ready",
  sandboxSetupError,
  onRetrySetup,
  isSubChatsSidebarOpen = false,
  sandboxId,
  existingPrUrl,
  isActive = true,
}: {
  chat: Chat<any>
  subChatId: string
  parentChatId: string
  isFirstSubChat: boolean
  teamId?: string
  repository?: string
  streamId?: string | null
  isMobile?: boolean
  sandboxSetupStatus?: "cloning" | "ready" | "error"
  sandboxSetupError?: string
  onRetrySetup?: () => void
  isSubChatsSidebarOpen?: boolean
  sandboxId?: string
  existingPrUrl?: string | null
  isActive?: boolean
}) {
  const hasTriggeredRenameRef = useRef(false)
  const hasTriggeredAutoGenerateRef = useRef(false)

  // Keep isActive in ref for use in callbacks (avoid stale closures)
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  const editorRef = useRef<AgentsMentionsEditorHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const questionRef = useRef<AgentUserQuestionHandle>(null)
  const prevSubChatIdRef = useRef<string | null>(null)

  // Workspace-level state & callbacks from Context (eliminates props drilling)
  const {
    projectMode, projectPath, pendingMention, setPendingMention, setIsCreatingPr,
    isArchived, onCreateNewSubChat, onAutoRename, refreshDiff, onRestoreWorkspace,
  } = useChatInstance()

  // Consume pending mentions from external components (e.g. MCP widget in sidebar)
  useEffect(() => {
    if (pendingMention) {
      editorRef.current?.insertMention(pendingMention)
      editorRef.current?.focus()
      setPendingMention(null)
    }
  }, [pendingMention, setPendingMention])

  // TTS playback rate state (persists across messages and sessions via localStorage)
  const [_ttsPlaybackRate, _setTtsPlaybackRate] = useState<PlaybackSpeed>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tts-playback-rate")
      if (saved && PLAYBACK_SPEEDS.includes(Number(saved) as PlaybackSpeed)) {
        return Number(saved) as PlaybackSpeed
      }
    }
    return 1
  })

  // PR creation loading state - now from ChatInstanceContext (see useChatInstance() above)

  // Rollback state
  const [isRollingBack, setIsRollingBack] = useState(false)

  // tRPC utils for cache invalidation
  const utils = api.useUtils()

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
      } catch {
        // Revert on error (toast shown by mutation onError)
        useAgentSubChatStore
          .getState()
          .updateSubChatName(subChatId, subChatNameRef.current || "New Chat")
      }
    },
    [subChatId],
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
  } = useAgentsFileUpload()

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

  // Document comment state for review system (scoped by activeSubChatId for consistency with diff view)
  // We use activeSubChatId instead of subChatId because:
  // - Comments are added from diff view which reads from activeSubChatId
  // - This ensures comments are stored and read from the same place
  const [commentInputState, setCommentInputState] = useAtom(commentInputStateAtom)
  const activeSubChatIdForComment = useAgentSubChatStore((state) => state.activeSubChatId)
  const { addComment, getComment, updateComment, removeComment } = useDocumentComments(activeSubChatIdForComment || subChatId)

  // Message queue for sending messages while streaming
  const queue = useMessageQueueStore((s) => s.queues[subChatId] ?? EMPTY_QUEUE)
  const addToQueue = useMessageQueueStore((s) => s.addToQueue)
  const removeFromQueue = useMessageQueueStore((s) => s.removeFromQueue)
  const popItemFromQueue = useMessageQueueStore((s) => s.popItem)

  // Plan approval pending state (for tool approval loading)
  const [_planApprovalPending, _setPlanApprovalPending] = useState<
    Record<string, boolean>
  >({})

  // Track chat changes for rename trigger reset
  const chatRef = useRef<Chat<any> | null>(null)

  if (prevSubChatIdRef.current !== subChatId) {
    hasTriggeredRenameRef.current = false // Reset on sub-chat change
    hasTriggeredAutoGenerateRef.current = false // Reset auto-generate on sub-chat change
    prevSubChatIdRef.current = subChatId
  }
  chatRef.current = chat

  // Restore draft when subChatId changes (switching between sub-chats)
  const prevSubChatIdForDraftRef = useRef<string | null>(null)
  useEffect(() => {
    // Restore full draft (text + attachments + text contexts) for new sub-chat
    const savedDraft = parentChatId
      ? getSubChatDraftFull(parentChatId, subChatId)
      : null

    if (savedDraft) {
      // Restore text
      if (savedDraft.text) {
        editorRef.current?.setValue(savedDraft.text)
      } else {
        editorRef.current?.clear()
      }
      // Restore images
      if (savedDraft.images.length > 0) {
        setImagesFromDraft(savedDraft.images)
      } else {
        clearAll()
      }
      // Restore files
      if (savedDraft.files.length > 0) {
        setFilesFromDraft(savedDraft.files)
      }
      // Restore text contexts
      if (savedDraft.textContexts.length > 0) {
        setTextContextsFromDraft(savedDraft.textContexts)
      } else {
        clearTextContexts()
      }
    } else if (
      prevSubChatIdForDraftRef.current &&
      prevSubChatIdForDraftRef.current !== subChatId
    ) {
      // Clear everything when switching to a sub-chat with no draft
      editorRef.current?.clear()
      clearAll()
      clearTextContexts()
    }

    prevSubChatIdForDraftRef.current = subChatId
  }, [
    subChatId,
    parentChatId,
    setImagesFromDraft,
    setFilesFromDraft,
    setTextContextsFromDraft,
    clearAll,
    clearTextContexts,
  ])

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

  // ===========================================================================
  // REFACTORED HOOKS
  // ===========================================================================

  // 1. Scroll Management
  const {
    chatContainerRef,
    scrollToBottom,
    handleScroll,
    isAtBottom,
    shouldAutoScrollRef,
    isAutoScrollingRef,
    isInitializingScrollRef,
    enableAutoScroll
  } = useChatScroll({
    isActive,
    subChatId,
    messages
  })

  // 2. Plan Mode Logic (Must be defined before Pending Actions to be passed down)
  const hasUnapprovedPlan = useMemo(() => {
    // If already in agent mode, plan is approved (mode is the source of truth)
    if (subChatMode !== "plan") return false

    // Look for completed ExitPlanMode in messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      // If assistant message with completed ExitPlanMode, we found an unapproved plan
      if (msg.role === "assistant" && msg.parts) {
        const exitPlanPart = msg.parts.find(
          (p: any) => p.type === "tool-ExitPlanMode"
        )
        // Check if ExitPlanMode is completed (has output, even if empty)
        if (exitPlanPart && exitPlanPart.output !== undefined) {
          return true
        }
      }
    }
    return false
  }, [messages, subChatMode])

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

  // 3. Pending Actions (Plan, PR, Auth, Questions)
  const {
    pendingQuestions,
    expiredQuestions,
    handleQuestionsSkip
  } = useChatPendingActions({
    isActive,
    isStreaming,
    subChatId,
    parentChatId,
    hasUnapprovedPlan,
    sendMessage,
    scrollToBottom
  })

  // 4. Hotkeys
  useChatHotkeys({
    chatId: parentChatId,
    subChatId,
    isActive,
    isStreaming,
    hasUnapprovedPlan,
    isArchived,
    isRestoring: isRollingBack,
    editorRef,
    stop: () => {
      chatRegistry.setManuallyAborted(subChatId, true)
      stop()
    },
    handleQuestionsSkip,
    handleApprovePlan,
    scrollToBottom,
    handleCreateNewSubChat: onCreateNewSubChat || (() => {}),
    handleRestoreWorkspace: onRestoreWorkspace || (() => {})
  })

  // ===========================================================================

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

  // Handler for document comment (review system)
  const handleAddComment = useCallback((
    text: string,
    source: TextSelectionSource,
    rect: DOMRect,
    charStart?: number | null,
    charLength?: number | null,
    lineStart?: number | null,
    lineEnd?: number | null
  ) => {
    // Map TextSelectionSource to DocumentType
    let documentType: DocumentType
    let documentPath: string
    let lineType: "old" | "new" | undefined

    // Use passed lineStart/lineEnd, but for diff also check source.lineNumber
    let finalLineStart = lineStart ?? undefined
    let finalLineEnd = lineEnd ?? undefined

    if (source.type === "plan") {
      documentType = "plan"
      documentPath = source.planPath
    } else if (source.type === "diff") {
      documentType = "diff"
      documentPath = source.filePath
      // For diff, prefer source.lineNumber if available (more accurate from DOM)
      if (source.lineNumber) {
        finalLineStart = source.lineNumber
        // If we don't have lineEnd, use lineStart
        if (!finalLineEnd) finalLineEnd = finalLineStart
      }
      lineType = source.lineType
    } else if (source.type === "tool-edit") {
      documentType = "tool-edit"
      documentPath = source.filePath
    } else {
      return // Don't handle assistant-message type for comments
    }

    setCommentInputState({
      selectedText: text,
      documentType,
      documentPath,
      lineStart: finalLineStart,
      lineEnd: finalLineEnd,
      lineType,
      charStart: charStart ?? undefined,
      charLength: charLength ?? undefined,
      rect,
    })
  }, [setCommentInputState])

  // Handler for document comment submit
  const handleCommentSubmit = useCallback((content: string) => {
    if (!commentInputState) return

    addComment({
      documentType: commentInputState.documentType,
      documentPath: commentInputState.documentPath,
      selectedText: commentInputState.selectedText,
      content,
      lineStart: commentInputState.lineStart,
      lineEnd: commentInputState.lineEnd,
      lineType: commentInputState.lineType,
      charStart: commentInputState.charStart,
      charLength: commentInputState.charLength,
    })

    setCommentInputState(null)
    window.getSelection()?.removeAllRanges()
  }, [commentInputState, addComment, setCommentInputState])

  // Handler for document comment cancel
  const handleCommentCancel = useCallback(() => {
    setCommentInputState(null)
  }, [setCommentInputState])

  // Handler for document comment update (edit mode)
  const handleCommentUpdate = useCallback((content: string) => {
    if (!commentInputState?.existingCommentId) return
    updateComment(commentInputState.existingCommentId, { content })
    setCommentInputState(null)
  }, [commentInputState, updateComment, setCommentInputState])

  // Handler for document comment delete (edit mode)
  const handleCommentDelete = useCallback(() => {
    if (!commentInputState?.existingCommentId) return
    removeComment(commentInputState.existingCommentId)
    setCommentInputState(null)
  }, [commentInputState, removeComment, setCommentInputState])

  // Get existing comment for edit mode
  const existingComment = useMemo(() => {
    if (!commentInputState?.existingCommentId) return undefined
    return getComment(commentInputState.existingCommentId)
  }, [commentInputState?.existingCommentId, getComment])

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


  // Detect PR URLs in assistant messages and store them
  // Initialize with existing PR URL to prevent duplicate toast on re-mount
  const detectedPrUrlRef = useRef<string | null>(existingPrUrl ?? null)

  useEffect(() => {
    // Only check after streaming ends
    if (isStreaming) return

    // Look through messages for PR URLs
    for (const msg of messages) {
      if (msg.role !== "assistant") continue

      // Extract text content from message
      const textContent =
        msg.parts
          ?.filter((p: any) => p.type === "text")
          .map((p: any) => p.text)
          .join(" ") || ""

      // Match GitHub PR URL pattern
      const prUrlMatch = textContent.match(
        /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/,
      )

      if (prUrlMatch && prUrlMatch[0] !== detectedPrUrlRef.current) {
        const prUrl = prUrlMatch[0]
        const prNumber = parseInt(prUrlMatch[1], 10)

        // Store to prevent duplicate calls
        detectedPrUrlRef.current = prUrl

        // Update database
        trpcClient.chats.updatePrInfo
          .mutate({ chatId: parentChatId, prUrl, prNumber })
          .then(() => {
            // Invalidate the agentChat query to refetch with new PR info
            utils.agents.getAgentChat.invalidate({ chatId: parentChatId })
          })

        break // Only process first PR URL found
      }
    }
  }, [messages, isStreaming, parentChatId])

  // Track plan Edit completions to trigger sidebar refetch
  const triggerPlanEditRefetch = useSetAtom(
    useMemo(() => planEditRefetchTriggerAtomFamily(subChatId), [subChatId])
  )
  const lastPlanEditCountRef = useRef(0)

  useEffect(() => {
    // Count completed plan Edits
    let completedPlanEdits = 0
    for (const msg of messages) {
      const msgWithParts = msg as Message
      if (msgWithParts.role !== "assistant" || !msgWithParts.parts) continue
      for (const part of msgWithParts.parts) {
        if (
          part.type === "tool-Edit" &&
          part.state !== "input-streaming" &&
          part.state !== "pending" &&
          isPlanFile((part.input?.file_path as string) || "")
        ) {
          completedPlanEdits++
        }
      }
    }

    // Trigger refetch if count increased (new Edit completed)
    if (completedPlanEdits > lastPlanEditCountRef.current) {
      lastPlanEditCountRef.current = completedPlanEdits
      triggerPlanEditRefetch()
    }
  }, [messages, triggerPlanEditRefetch])

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
  useEffect(() => {
    // Skip keyboard handlers for inactive tabs (keep-alive)
    if (!isActive) return

    const handleKeyDown = async (e: KeyboardEvent) => {
      let shouldStop = false
      let shouldSkipQuestions = false

      // Check for Escape key without modifiers (works even from input fields, like terminal Ctrl+C)
      // Ignore if Cmd/Ctrl is pressed (reserved for Cmd+Esc to focus input)
      if (
        e.key === "Escape" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        !e.altKey &&
        isStreaming
      ) {
        const target = e.target as HTMLElement

        // Allow ESC to propagate if it originated from a modal/dialog/dropdown
        const isInsideOverlay = target.closest(
          '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-state="open"]',
        )

        // Also check if any dialog/modal is open anywhere in the document (not just at event target)
        // This prevents stopping stream when settings dialog is open but not focused
        const hasOpenDialog = document.querySelector(
          '[role="dialog"][aria-modal="true"], [data-modal="agents-settings"]',
        )

        if (!isInsideOverlay && !hasOpenDialog) {
          // If there are pending/expired questions for this chat, skip/dismiss them instead of stopping stream
          if (displayQuestions) {
            shouldSkipQuestions = true
          } else {
            shouldStop = true
          }
        }
      }

      // Check for Ctrl+C (only Ctrl, not Cmd on Mac)
      if (e.ctrlKey && !e.metaKey && e.code === "KeyC") {
        if (!isStreaming) return

        const selection = window.getSelection()
        const hasSelection = selection && selection.toString().length > 0

        // If there's a text selection, let browser handle copy
        if (hasSelection) return

        shouldStop = true
      }

      // Check for Cmd+Shift+Backspace (Mac) or Ctrl+Shift+Backspace (Windows/Linux)
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key === "Backspace" &&
        isStreaming
      ) {
        shouldStop = true
      }

      if (shouldSkipQuestions) {
        e.preventDefault()
        await handleQuestionsSkip()
      } else if (shouldStop) {
        e.preventDefault()
        // Mark as manually aborted to prevent completion sound
        chatRegistry.setManuallyAborted(subChatId, true)
        await stop()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isActive, isStreaming, stop, subChatId, displayQuestions, handleQuestionsSkip])

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
      if (!hasTriggeredRenameRef.current && isFirstSubChat) {
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

  // ===========================================================================
  // MESSAGE SEND HANDLERS (extracted to useMessageSend hook)
  // ===========================================================================
  const {
    handleSend,
    handleSendFromQueue,
    handleRemoveFromQueue,
    handleRestoreFromQueue,
    handleForceSend,
    handleRetryMessage,
  } = useMessageSend({
    subChatId,
    parentChatId,
    projectPath,
    sandboxSetupStatus,
    isArchived,
    onRestoreWorkspace,
    onAutoRename,
    teamId,
    utils,
    editorRef,
    isStreamingRef,
    shouldAutoScrollRef,
    sendMessageRef,
    images,
    files,
    clearAll,
    setImagesFromDraft,
    setFilesFromDraft,
    textContextsRef,
    diffTextContextsRef,
    pastedTextsRef,
    fileContentsRef,
    clearTextContexts,
    clearDiffTextContexts,
    clearPastedTexts,
    clearFileContents,
    setTextContextsFromDraft,
    setDiffTextContextsFromDraft,
    scrollToBottom,
    messages,
    isStreaming,
    regenerate,
    handleStop,
    subChatMode,
    setExpiredQuestionsMap,
  })

  // NOTE: Auto-processing of queue is now handled globally by QueueProcessor
  // component in agents-layout.tsx. This ensures queues continue processing
  // even when user navigates to different sub-chats or workspaces.

  // Check if there's an unapproved plan (in plan mode with completed ExitPlanMode)

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
          onAddComment={handleAddComment}
          onFocusInput={handleFocusInput}
        />

        {/* Document comment input for review system */}
        {commentInputState && (
          <DocumentCommentInput
            selectedText={commentInputState.selectedText}
            documentType={commentInputState.documentType}
            documentPath={commentInputState.documentPath}
            lineStart={commentInputState.lineStart}
            lineEnd={commentInputState.lineEnd}
            lineType={commentInputState.lineType}
            rect={commentInputState.rect}
            onSubmit={handleCommentSubmit}
            onCancel={handleCommentCancel}
            existingComment={existingComment}
            onUpdate={handleCommentUpdate}
            onDelete={handleCommentDelete}
          />
        )}

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
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const isChatFullWidth = useAtomValue(agentsChatFullWidthAtom)
  const customClaudeConfig = useAtomValue(customClaudeConfigAtom)
  const selectedOllamaModel = useAtomValue(selectedOllamaModelAtom)
  const normalizedCustomClaudeConfig =
    normalizeCustomClaudeConfig(customClaudeConfig)
  const hasCustomClaudeConfig = Boolean(normalizedCustomClaudeConfig)
  const setLoadingSubChats = useSetAtom(loadingSubChatsAtom)
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
  // Sidebar state management (extracted to hook)
  const activeSubChatIdForPlan = useAgentSubChatStore((state) => state.activeSubChatId)
  const sidebarState = useSidebarState({ chatId, activeSubChatId: activeSubChatIdForPlan })
  const {
    isPlanSidebarOpen, setIsPlanSidebarOpen,
    currentPlanPath, setCurrentPlanPath,
    isBrowserSidebarOpen, setIsBrowserSidebarOpen,
    setBrowserActive, setBrowserPendingScreenshot,
    isDiffSidebarOpen, setIsDiffSidebarOpen,
    diffDisplayMode, setDiffDisplayMode,
    isPreviewSidebarOpen, setIsPreviewSidebarOpen,
    isTerminalSidebarOpen, setIsTerminalSidebarOpen,
    terminalDisplayMode,
    isUnifiedSidebarEnabled,
    isDetailsSidebarOpen, setIsDetailsSidebarOpen,
    isExplorerPanelOpen, setIsExplorerPanelOpen,
    fileViewerPath, setFileViewerPath,
    fileViewerDisplayMode,
  } = sidebarState

  // Diff data management (cache, fetch, throttle, git status)
  const diffData = useDiffData({
    chatId,
    worktreePath,
    sandboxId,
    isDiffSidebarOpen,
    agentChat,
  })
  const {
    diffStats, parsedFileDiffs, prefetchedFileContents, diffContent,
    setDiffStats, setParsedFileDiffs, setPrefetchedFileContents, setDiffContent,
    fetchDiffStats, fetchDiffStatsRef,
    subChatFiles,
    branchData, gitStatus, isGitStatusLoading, handleRefreshGitStatus,
    hasPendingDiffChanges, setHasPendingDiffChanges,
    handleRefreshDiff,
  } = diffData

  // Browser beta feature check
  const betaBrowserEnabled = useAtomValue(betaBrowserEnabledAtom)

  // File search dialog (Cmd+P) - state owned by ChatView, shared via ChatInstanceContext
  const [fileSearchOpen, setFileSearchOpen] = useState(false)

  // Resolved hotkeys for tooltips
  const toggleDetailsHotkey = useResolvedHotkeyDisplay("toggle-details")
  const toggleTerminalHotkey = useResolvedHotkeyDisplay("toggle-terminal")

  const setPendingBuildPlanSubChatId = useSetAtom(pendingBuildPlanSubChatIdAtom)

  // Read plan edit refetch trigger from atom (set by ChatViewInner when Edit completes)
  const planEditRefetchTriggerAtom = useMemo(
    () => planEditRefetchTriggerAtomFamily(activeSubChatIdForPlan || ""),
    [activeSubChatIdForPlan],
  )
  const planEditRefetchTrigger = useAtomValue(planEditRefetchTriggerAtom)

  // Handler for plan sidebar "Build plan" button
  // Uses getState() to get fresh activeSubChatId (avoids stale closure)
  const handleApprovePlanFromSidebar = useCallback(() => {
    const activeSubChatId = useAgentSubChatStore.getState().activeSubChatId
    if (activeSubChatId) {
      setPendingBuildPlanSubChatId(activeSubChatId)
    }
  }, [setPendingBuildPlanSubChatId])

  const [diffMode, setDiffMode] = useAtom(diffViewModeAtom)
  const subChatsSidebarMode = useAtomValue(agentsSubChatsSidebarModeAtom)

  // Hide/show traffic lights based on full-page diff or full-page file viewer
  const setTrafficLightRequest = useSetAtom(setTrafficLightRequestAtom)
  const removeTrafficLightRequest = useSetAtom(removeTrafficLightRequestAtom)

  useEffect(() => {
    if (!isDesktop || isFullscreen) return

    const isFullPageDiff = isDiffSidebarOpen && diffDisplayMode === "full-page"
    const isFullPageFileViewer = !!fileViewerPath && fileViewerDisplayMode === "full-page"
    const shouldHide = isFullPageDiff || isFullPageFileViewer

    if (shouldHide) {
      setTrafficLightRequest({
        requester: "active-chat-viewer",
        visible: false,
        priority: TRAFFIC_LIGHT_PRIORITIES.ACTIVE_CHAT_VIEWER,
      })
    } else {
      removeTrafficLightRequest("active-chat-viewer")
    }

    return () => removeTrafficLightRequest("active-chat-viewer")
  }, [isDiffSidebarOpen, diffDisplayMode, fileViewerPath, fileViewerDisplayMode, isDesktop, isFullscreen, setTrafficLightRequest, removeTrafficLightRequest])

  // Track diff sidebar width for responsive header
  const storedDiffSidebarWidth = useAtomValue(agentsDiffSidebarWidthAtom)
  const diffSidebarRef = useRef<HTMLDivElement>(null)
  const diffViewRef = useRef<AgentDiffViewRef>(null)
  const [diffSidebarWidth, setDiffSidebarWidth] = useState(
    storedDiffSidebarWidth,
  )
  // Track if all diff files are collapsed/expanded for button disabled states
  const [_diffCollapseState, setDiffCollapseState] = useState({
    allCollapsed: false,
    allExpanded: true,
  })

  // Compute isNarrow for filtering logic (same threshold as DiffSidebarContent)
  const isDiffSidebarNarrow = diffSidebarWidth < 500

  // ResizeObserver to track diff sidebar width in real-time (atom only updates after resize ends)
  useEffect(() => {
    if (!isDiffSidebarOpen) {
      return
    }

    let observer: ResizeObserver | null = null
    let rafId: number | null = null

    const checkRef = () => {
      const element = diffSidebarRef.current
      if (!element) {
        // Retry if ref not ready yet
        rafId = requestAnimationFrame(checkRef)
        return
      }

      // Set initial width
      setDiffSidebarWidth(element.offsetWidth || storedDiffSidebarWidth)

      observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = entry.contentRect.width
          if (width > 0) {
            setDiffSidebarWidth(width)
          }
        }
      })

      observer.observe(element)
    }

    checkRef()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      if (observer) observer.disconnect()
    }
  }, [isDiffSidebarOpen, storedDiffSidebarWidth])

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

  // Restore per-chat model selection when switching chats
  const chatModelSelections = useAtomValue(chatModelSelectionsAtom)
  const setSessionModelOverride = useSetAtom(sessionModelOverrideAtom)
  useEffect(() => {
    const saved = chatModelSelections[chatId]
    if (saved) {
      setSessionModelOverride(saved)
    } else {
      setSessionModelOverride(null)
    }
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps -- only restore on chat switch

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

  // tRPC utils for optimistic cache updates
  const utils = api.useUtils()

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

  // Workspace isolation: limit mounted tabs to prevent memory growth
  // CRITICAL: Filter by workspace to prevent rendering sub-chats from other workspaces
  // Always render: active + pinned, then fill with recent up to limit
  const MAX_MOUNTED_TABS = 10
  const tabsToRender = useMemo(() => {
    if (!activeSubChatId) return []

    // Combine server data (agentSubChats) with local store (allSubChats) for validation.
    // This handles:
    // 1. Race condition where setChatId resets allSubChats but activeSubChatId loads from localStorage
    // 2. Optimistic updates when creating new sub-chats (new sub-chat is in allSubChats but not in agentSubChats yet)
    //
    // By combining both sources, we validate against all known sub-chats from both server and local state.
    const validSubChatIds = new Set([
      ...agentSubChats.map(sc => sc.id),
      ...allSubChats.map(sc => sc.id),
    ])

    // When both data sources are still empty (loading), trust activeSubChatId from localStorage.
    // Without this, there's a race condition:
    //   1. setChatId() resets allSubChats to []
    //   2. Server query for agentChat is still loading → agentSubChats is []
    //   3. activeSubChatId is restored from localStorage (valid)
    //   4. validSubChatIds is empty → activeSubChatId fails validation → returns []
    //   5. No ChatViewInner renders → blank screen
    // By skipping the validation when no data has loaded yet, we allow the tab to mount
    // and load its messages. Once data arrives, the next re-render will properly validate.
    const dataNotYetLoaded = validSubChatIds.size === 0

    // If active sub-chat doesn't belong to this workspace → return []
    // This prevents rendering sub-chats from another workspace during race condition
    // But skip this check when data hasn't loaded yet (trust localStorage)
    if (!dataNotYetLoaded && !validSubChatIds.has(activeSubChatId)) {
      return []
    }

    // Filter openSubChatIds and pinnedSubChatIds to only valid IDs for this workspace
    // When data hasn't loaded, allow all IDs through (they came from localStorage for this chatId)
    const validOpenIds = dataNotYetLoaded
      ? openSubChatIds
      : openSubChatIds.filter(id => validSubChatIds.has(id))
    const validPinnedIds = dataNotYetLoaded
      ? pinnedSubChatIds
      : pinnedSubChatIds.filter(id => validSubChatIds.has(id))

    // Start with active (must always be mounted)
    const mustRender = new Set([activeSubChatId])

    // Add pinned tabs (only valid ones)
    for (const id of validPinnedIds) {
      mustRender.add(id)
    }

    // If we have room, add recent tabs from openSubChatIds (only valid ones)
    if (mustRender.size < MAX_MOUNTED_TABS) {
      const remaining = MAX_MOUNTED_TABS - mustRender.size
      const recentTabs = validOpenIds
        .filter(id => !mustRender.has(id))
        .slice(-remaining) // Take the most recent (end of array)

      for (const id of recentTabs) {
        mustRender.add(id)
      }
    }

    // Return tabs to render
    // Always include activeSubChatId even if not in validOpenIds (handles race condition
    // where openSubChatIds from localStorage doesn't include the active tab yet)
    const result = validOpenIds.filter(id => mustRender.has(id))
    if (!result.includes(activeSubChatId)) {
      result.unshift(activeSubChatId)
    }
    return result
  }, [activeSubChatId, pinnedSubChatIds, openSubChatIds, allSubChats, agentSubChats])

  // tRPC utils for cache invalidation
  const trpcUtils = trpc.useUtils()

  // Restore archived workspace mutation (silent - no toast)
  const restoreWorkspaceMutation = trpc.chats.restore.useMutation({
    onSuccess: (restoredChat) => {
      if (restoredChat) {
        // Update the main chat list cache
        trpcUtils.chats.list.setData({}, (oldData) => {
          if (!oldData) return [restoredChat]
          if (oldData.some((c) => c.id === restoredChat.id)) return oldData
          return [restoredChat, ...oldData]
        })
      }
      // Invalidate both lists to refresh
      trpcUtils.chats.list.invalidate()
      trpcUtils.chats.listArchived.invalidate()
      // Invalidate this chat's data to update isArchived state
      utils.agents.getAgentChat.invalidate({ chatId })
    },
  })

  const handleRestoreWorkspace = useCallback(() => {
    restoreWorkspaceMutation.mutate({ id: chatId })
  }, [chatId, restoreWorkspaceMutation])

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
  const canOpenDiff = !!worktreePath || (!!sandboxId && !isDesktopApp())

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

  // Shared deps for createChatCallbacks (used by getOrCreateChat and handleCreateNewSubChat)
  const chatCallbacksDeps: Omit<ChatCallbacksDeps, "agentName"> = {
    chatId,
    setLoadingSubChats,
    setSubChatUnseenChanges,
    setSubChatStatus,
    setUnseenChanges,
    notifyAgentComplete,
    notifyAgentError,
    fetchDiffStatsRef,
  }

  // Review system - document comments for plan sidebar (scoped by activeSubChatId)
  const { comments: reviewComments, commentsByDocument, clearComments } = useDocumentComments(activeSubChatIdForPlan || "")

  // PR Operations hook
  const {
    prState,
    hasMergeConflicts,
    isPrOpen,
    createPrMutation,
    mergeFromDefaultMutation,
    mergePrMutation,
    handleMergePr,
    isCreatingPr,
    setIsCreatingPr,
    isCommittingToPr,
    isReviewing,
    handleCreatePrDirect,
    handleCreatePr,
    handleCommitToPr,
    handleReview,
    handleSubmitReview,
    handleFixConflicts,
  } = usePrOperations({
    chatId,
    worktreePath,
    activeSubChatId: activeSubChatIdForPlan,
    hasPrNumber: !!agentChat?.prNumber,
    refetchGitStatus: handleRefreshGitStatus,
    setIsPlanSidebarOpen,
    setIsDiffSidebarOpen,
    reviewComments,
    commentsByDocument,
    clearComments,
  })

  const handleExpandAll = useCallback(() => {
    diffViewRef.current?.expandAll()
  }, [])

  const handleCollapseAll = useCallback(() => {
    diffViewRef.current?.collapseAll()
  }, [])

  const handleMarkAllViewed = useCallback(() => {
    diffViewRef.current?.markAllViewed()
  }, [])

  const handleMarkAllUnviewed = useCallback(() => {
    diffViewRef.current?.markAllUnviewed()
  }, [])

  // Initialize Zustand store when chat data loads (validates localStorage, syncs DB sub-chats)
  useStoreInitialization(chatId, agentChat, agentSubChats)

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

      // Create transport via factory function
      const transport = createChatTransport({
        chatId,
        subChatId,
        subChatName: subChat?.name || "Chat",
        agentChat: agentChat as AgentChat | null,
        worktreePath,
        mode: subChatMode,
        selectedModelId,
      })

      if (!transport) {
        console.error("[getOrCreateChat] No transport available")
        return null
      }

      // Create callbacks via factory function
      const callbacks = createChatCallbacks(subChatId, {
        ...chatCallbacksDeps,
        agentName: agentChat?.name || "Agent",
      })

      const newChat = new Chat<any>({
        id: subChatId,
        messages,
        transport,
        ...callbacks,
      })

      chatRegistry.register(subChatId, newChat, chatId)
      // Store streamId at creation time to prevent resume during active streaming
      // tRPC refetch would update stream_id in DB, but store stays stable
      chatRegistry.registerStreamId(subChatId, subChat?.stream_id || null)
      forceUpdate({}) // Trigger re-render to use new chat
      return newChat
    },
    [
      agentChat,
      chatWorkingDir,
      worktreePath,
      chatId,
      currentMode,
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

    // Create transport via factory function
    const newSubChatTransport = createChatTransport({
      chatId,
      subChatId: newId,
      subChatName: "New Chat",
      agentChat: agentChat as AgentChat | null,
      worktreePath,
      mode: newSubChatMode,
      selectedModelId,
    })

    if (newSubChatTransport) {
      // Create callbacks via factory function
      const callbacks = createChatCallbacks(newId, {
        ...chatCallbacksDeps,
        agentName: agentChat?.name || "Agent",
      })

      const newChat = new Chat<any>({
        id: newId,
        messages: [],
        transport: newSubChatTransport,
        ...callbacks,
      })
      chatRegistry.register(newId, newChat, chatId)
      chatRegistry.registerStreamId(newId, null) // New chat has no active stream
      forceUpdate({}) // Trigger re-render
    }
  }, [
    worktreePath,
    chatId,
    defaultAgentMode,
    utils,
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

  // Helper to add sub-chat to undo stack
  const addSubChatToUndoStack = useCallback((subChatId: string) => {
    const timeoutId = setTimeout(() => {
      setUndoStack((prev) => prev.filter(
        (item) => !(item.type === "subchat" && item.subChatId === subChatId)
      ))
    }, 10000)

    setUndoStack((prev) => [...prev, {
      type: "subchat",
      subChatId,
      chatId,
      timeoutId,
    }])
  }, [chatId, setUndoStack])

  // Keyboard shortcut: Close active sub-chat (or bulk close if multi-select mode)
  // Web: Opt+Cmd+W (browser uses Cmd+W to close tab)
  // Desktop: Cmd+W
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isDesktop = isDesktopApp()

      // Desktop: Cmd+W (without Alt)
      const isDesktopShortcut =
        isDesktop &&
        e.metaKey &&
        e.code === "KeyW" &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey
      // Web: Opt+Cmd+W (with Alt)
      const isWebShortcut = e.altKey && e.metaKey && e.code === "KeyW"

      if (isDesktopShortcut || isWebShortcut) {
        e.preventDefault()

        const store = useAgentSubChatStore.getState()

        // If multi-select mode, bulk close selected sub-chats
        if (isSubChatMultiSelectMode && selectedSubChatIds.size > 0) {
          const idsToClose = Array.from(selectedSubChatIds)
          const remainingOpenIds = store.openSubChatIds.filter(
            (id) => !idsToClose.includes(id),
          )

          // Don't close all tabs via hotkey - user should use sidebar dialog for last tab
          if (remainingOpenIds.length > 0) {
            idsToClose.forEach((id) => {
              store.removeFromOpenSubChats(id)
              addSubChatToUndoStack(id)
            })
          }
          clearSubChatSelection()
          return
        }

        // Otherwise close active sub-chat
        const activeId = store.activeSubChatId
        const openIds = store.openSubChatIds

        // Only close if we have more than one tab open and there's an active tab
        // removeFromOpenSubChats automatically switches to the last remaining tab
        if (activeId && openIds.length > 1) {
          store.removeFromOpenSubChats(activeId)
          addSubChatToUndoStack(activeId)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isSubChatMultiSelectMode, selectedSubChatIds, clearSubChatSelection, addSubChatToUndoStack])

  // Handle auto-rename for sub-chat and parent chat
  // Receives subChatId as param to avoid stale closure issues
  const handleAutoRename = useCallback(
    (userMessage: string, subChatId: string) => {
      // Check if this is the first sub-chat using agentSubChats directly
      // to avoid race condition with store initialization
      const firstSubChatId = getFirstSubChatId(agentSubChats)
      const isFirst = firstSubChatId === subChatId

      autoRenameAgentChat({
        subChatId,
        parentChatId: chatId,
        userMessage,
        isFirstSubChat: isFirst,
        generateName: async (msg) => {
          const sp = appStore.get(summaryProviderIdAtom)
          const sm = appStore.get(summaryModelIdAtom)
          return generateSubChatNameMutation.mutateAsync({
            userMessage: msg,
            ...(sp && sm && { summaryProviderId: sp, summaryModelId: sm }),
          })
        },
        renameSubChat: async (input) => {
          await renameSubChatMutation.mutateAsync(input)
        },
        renameChat: async (input) => {
          await renameChatMutation.mutateAsync(input)
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
    ],
  )

  // Determine if chat header should be hidden
  const shouldHideChatHeader =
    subChatsSidebarMode === "sidebar" &&
    isPreviewSidebarOpen &&
    isDiffSidebarOpen &&
    !isMobileFullscreen

  // No early return - let the UI render with loading state handled by activeChat check below

  // Global comment input state for TextSelectionPopover at ChatView level
  // This enables comment functionality for diff sidebar which is outside ChatViewInner
  const [, setGlobalCommentInputState] = useAtom(commentInputStateAtom)

  // Handler for adding comment from top-level TextSelectionPopover
  // This is a simplified version that only handles diff comments (no addTextContext)
  const handleGlobalAddComment = useCallback((
    text: string,
    source: TextSelectionSource,
    rect: DOMRect,
    charStart?: number | null,
    charLength?: number | null,
    lineStart?: number | null,
    lineEnd?: number | null
  ) => {
    // Map TextSelectionSource to DocumentType
    let documentType: DocumentType
    let documentPath: string
    let lineType: "old" | "new" | undefined

    let finalLineStart = lineStart ?? undefined
    let finalLineEnd = lineEnd ?? undefined

    if (source.type === "plan") {
      documentType = "plan"
      documentPath = source.planPath
    } else if (source.type === "diff") {
      documentType = "diff"
      documentPath = source.filePath
      if (source.lineNumber) {
        finalLineStart = source.lineNumber
        if (!finalLineEnd) finalLineEnd = finalLineStart
      }
      lineType = source.lineType
    } else if (source.type === "tool-edit") {
      documentType = "tool-edit"
      documentPath = source.filePath
    } else {
      return // Don't handle assistant-message or file-viewer types
    }

    setGlobalCommentInputState({
      selectedText: text,
      documentType,
      documentPath,
      lineStart: finalLineStart,
      lineEnd: finalLineEnd,
      lineType,
      rect,
      charStart: charStart ?? undefined,
      charLength: charLength ?? undefined,
    })
  }, [setGlobalCommentInputState])

  return (
    <ChatInstanceProvider
      chatId={chatId}
      projectPath={worktreePath || undefined}
      projectMode={chatProjectMode}
      fileSearchOpen={fileSearchOpen}
      setFileSearchOpen={setFileSearchOpen}
      isArchived={isArchived}
      onCreateNewSubChat={handleCreateNewSubChat}
      onAutoRename={handleAutoRename}
      refreshDiff={handleRefreshDiff}
      onRestoreWorkspace={handleRestoreWorkspace}
    >
    <FileOpenProvider onOpenFile={setFileViewerPath}>
    <TextSelectionProvider>
    {/* Global TextSelectionPopover for diff sidebar (outside ChatViewInner) */}
    <TextSelectionPopover
      onAddToContext={() => {}} // No-op - diff sidebar doesn't have chat input
      onAddComment={handleGlobalAddComment}
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
    <div className="flex h-full flex-col">
      {/* Main content */}
      <div className="flex-1 overflow-hidden flex">
        {/* Chat Panel */}
        <div
          className="flex-1 flex flex-col overflow-hidden relative"
          style={{ minWidth: "350px" }}
        >
          {/* SubChatSelector header - absolute when sidebar open (desktop only), regular div otherwise */}
          {!shouldHideChatHeader && (
            <div
              className={cn(
                "relative z-20 pointer-events-none",
                // Mobile: always flex; Desktop: absolute when sidebar open, flex when closed
                !isMobileFullscreen && subChatsSidebarMode === "sidebar"
                  ? `absolute top-0 left-0 right-0 ${CHAT_LAYOUT.headerPaddingSidebarOpen}`
                  : `shrink-0 ${CHAT_LAYOUT.headerPaddingSidebarClosed}`,
              )}
            >
              {/* Gradient background - only when not absolute */}
              {(isMobileFullscreen || subChatsSidebarMode !== "sidebar") && (
                <div className="absolute inset-0 bg-linear-to-b from-background via-background to-transparent" />
              )}
              <div className="pointer-events-auto flex items-center justify-between relative">
                <div className="flex-1 min-w-0 flex items-center gap-2">
                  {/* Mobile header - simplified with chat name as trigger */}
                  {isMobileFullscreen ? (
                    <MobileChatHeader
                      onCreateNew={handleCreateNewSubChat}
                      onBackToChats={onBackToChats}
                      onOpenPreview={hideGitFeatures ? undefined : onOpenPreview}
                      canOpenPreview={hideGitFeatures ? false : canOpenPreview}
                      onOpenDiff={hideGitFeatures ? undefined : onOpenDiff}
                      canOpenDiff={hideGitFeatures ? false : canShowDiffButton}
                      diffStats={hideGitFeatures ? undefined : diffStats}
                      onOpenTerminal={hideGitFeatures ? undefined : onOpenTerminal}
                      canOpenTerminal={hideGitFeatures ? false : !!worktreePath}
                      isTerminalOpen={isTerminalSidebarOpen}
                      isArchived={isArchived}
                      onRestore={handleRestoreWorkspace}
                      onOpenLocally={handleOpenLocally}
                      showOpenLocally={showOpenLocally}
                    />
                  ) : (
                    <>
                      {/* Header controls - desktop only */}
                      <AgentsHeaderControls
                        isSidebarOpen={isSidebarOpen}
                        onToggleSidebar={onToggleSidebar}
                        hasUnseenChanges={hasAnyUnseenChanges}
                        isSubChatsSidebarOpen={
                          subChatsSidebarMode === "sidebar"
                        }
                      />
                      <SubChatSelector
                        onCreateNew={handleCreateNewSubChat}
                        isMobile={false}
                        onBackToChats={onBackToChats}
                        onOpenPreview={hideGitFeatures ? undefined : onOpenPreview}
                        canOpenPreview={hideGitFeatures ? false : canOpenPreview}
                        onOpenDiff={hideGitFeatures ? undefined : (canOpenDiff ? () => setIsDiffSidebarOpen(true) : undefined)}
                        canOpenDiff={hideGitFeatures ? false : canShowDiffButton}
                        isDiffSidebarOpen={hideGitFeatures ? false : isDiffSidebarOpen}
                        diffStats={hideGitFeatures ? undefined : diffStats}
                        onOpenTerminal={hideGitFeatures ? undefined : () => setIsTerminalSidebarOpen(true)}
                        canOpenTerminal={hideGitFeatures ? false : !!worktreePath}
                        isTerminalOpen={isTerminalSidebarOpen}
                        chatId={chatId}
                      />
                      {/* Open Locally button - desktop only, sandbox mode */}
                      {showOpenLocally && (
                        <Tooltip delayDuration={500}>
                          <TooltipTrigger asChild>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={handleOpenLocally}
                              disabled={isImporting}
                              className="h-6 px-2 gap-1.5 text-xs font-medium ml-2"
                            >
                              {isImporting ? (
                                <IconSpinner className="h-3 w-3 animate-spin" />
                              ) : (
                                <GitFork className="h-3 w-3" />
                              )}
                              Fork Locally
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            Continue this session on your local machine
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </>
                  )}
                </div>
                {/* Open Preview Button - shows when preview is closed (desktop only, local mode only) */}
                {!hideGitFeatures &&
                  !isMobileFullscreen &&
                  !isPreviewSidebarOpen &&
                  sandboxId &&
                  chatSourceMode === "local" &&
                  (canOpenPreview ? (
                    <Tooltip delayDuration={500}>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setIsPreviewSidebarOpen(true)}
                          className="h-6 w-6 p-0 hover:bg-foreground/10 transition-colors text-foreground shrink-0 rounded-md ml-2"
                          aria-label="Open preview"
                        >
                          <IconOpenSidebarRight className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Open preview</TooltipContent>
                    </Tooltip>
                  ) : (
                    <PreviewSetupHoverCard>
                      <span className="inline-flex ml-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled
                          className="h-6 w-6 p-0 text-muted-foreground shrink-0 rounded-md cursor-not-allowed pointer-events-none"
                          aria-label="Preview not available"
                        >
                          <IconOpenSidebarRight className="h-4 w-4" />
                        </Button>
                      </span>
                    </PreviewSetupHoverCard>
                  ))}
                {/* Overview/Terminal Button - shows when sidebar is closed and worktree/sandbox exists (desktop only) */}
                {!isMobileFullscreen &&
                  (worktreePath || sandboxId) && (
                    isUnifiedSidebarEnabled ? (
                      // Details button for unified sidebar
                      !isDetailsSidebarOpen && (
                        <Tooltip delayDuration={500}>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setIsDetailsSidebarOpen(true)}
                              className="h-6 w-6 p-0 hover:bg-foreground/10 transition-colors text-foreground shrink-0 rounded-md ml-2"
                              aria-label="View details"
                            >
                              <IconOpenSidebarRight className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            View details
                            {toggleDetailsHotkey && <Kbd>{toggleDetailsHotkey}</Kbd>}
                          </TooltipContent>
                        </Tooltip>
                      )
                    ) : (
                      // Terminal button for legacy sidebars (hidden in cowork mode)
                      !hideGitFeatures && !isTerminalSidebarOpen && (
                        <Tooltip delayDuration={500}>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setIsTerminalSidebarOpen(true)}
                              className="h-6 w-6 p-0 hover:bg-foreground/10 transition-colors text-foreground shrink-0 rounded-md ml-2"
                              aria-label="Open terminal"
                            >
                              <SquareTerminal className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom">
                            Open terminal
                            {toggleTerminalHotkey && <Kbd>{toggleTerminalHotkey}</Kbd>}
                          </TooltipContent>
                        </Tooltip>
                      )
                    )
                  )}
                {/* Restore Button - shows when viewing archived workspace (desktop only) */}
                {!isMobileFullscreen && isArchived && (
                  <Tooltip delayDuration={500}>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        onClick={handleRestoreWorkspace}
                        disabled={restoreWorkspaceMutation.isPending}
                        className="h-6 px-2 gap-1.5 hover:bg-foreground/10 transition-colors text-foreground shrink-0 rounded-md ml-2 flex items-center"
                        aria-label="Restore workspace"
                      >
                        <IconTextUndo className="h-4 w-4" />
                        <span className="text-xs">Restore</span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      Restore workspace
                      <Kbd>⇧⌘E</Kbd>
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Custom right header slot - used by Cowork mode for panel toggle */}
                {rightHeaderSlot}
              </div>
            </div>
          )}

          {/* Chat Content - Keep-alive: render all open tabs, hide inactive with CSS */}
          {tabsToRender.length > 0 && agentChat ? (
            <div className="relative flex-1 min-h-0 flex">
              {/* Collapsed indicator column - occupies its own space in left */}
              {collapsedIndicator && (
                <div className="shrink-0 pl-2">
                  {collapsedIndicator}
                </div>
              )}
              {/* Chat tabs container */}
              <div className="relative flex-1 min-h-0">
                {/* Loading gate: prevent getOrCreateChat() from caching empty messages before data is ready */}
                {/* 修复：区分"正在加载"和"加载完成但无数据"
                    - isLoadingMessages: 查询正在执行
                    - subChatMessagesData: 查询结果（可能为 null 如果 subchat 不存在）
                    当查询完成后（无论结果如何），都应该允许渲染，不能卡在 loading */}
                {(isLocalChatLoading || (chatSourceMode === "local" && isLoadingMessages && subChatMessagesData === undefined)) ? (
                  <div className="flex items-center justify-center h-full">
                    <IconSpinner className="h-6 w-6 animate-spin" />
                  </div>
                ) : (
                  tabsToRender.map(subChatId => {
                    const chat = getOrCreateChat(subChatId)
                    const isActive = subChatId === activeSubChatId
                    const isFirstSubChat = getFirstSubChatId(agentSubChats) === subChatId

                    // Defense in depth: double-check workspace ownership
                    // Use agentSubChats (server data) as primary source, fall back to allSubChats for optimistic updates
                    // This fixes the race condition where allSubChats is empty after setChatId but before setAllSubChats
                    // When both sources are empty (data still loading), skip this check - tabsToRender already
                    // handles this case by trusting localStorage when no data has loaded yet.
                    const hasWorkspaceData = agentSubChats.length > 0 || allSubChats.length > 0
                    const belongsToWorkspace = !hasWorkspaceData ||
                      agentSubChats.some(sc => sc.id === subChatId) ||
                      allSubChats.some(sc => sc.id === subChatId)

                    if (!chat || !belongsToWorkspace) return null

                    return (
                      <div
                        key={subChatId}
                        className="absolute inset-0 flex flex-col"
                        style={{
                          // GPU-accelerated visibility switching (нативное ощущение)
                          // transform + opacity быстрее чем visibility для GPU
                          transform: isActive ? "translateZ(0)" : "translateZ(0) scale(0.98)",
                          opacity: isActive ? 1 : 0,
                          // Prevent pointer events on hidden tabs
                          pointerEvents: isActive ? "auto" : "none",
                          // GPU layer hints
                          willChange: "transform, opacity",
                          // Изолируем layout - изменения внутри не влияют на другие табы
                          contain: "layout style paint",
                        }}
                        aria-hidden={!isActive}
                      >
                        <ChatViewInner
                          chat={chat}
                          subChatId={subChatId}
                          parentChatId={chatId}
                          isFirstSubChat={isFirstSubChat}
                          teamId={selectedTeamId || undefined}
                          repository={repositoryString}
                          streamId={null}
                          isMobile={isMobileFullscreen}
                          isSubChatsSidebarOpen={subChatsSidebarMode === "sidebar"}
                          sandboxId={sandboxId || undefined}
                          existingPrUrl={agentChat?.prUrl}
                          isActive={isActive}
                        />
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Empty chat area - no loading indicator */}
              <div className="flex-1" />

              {/* Disabled input while loading */}
              <div className="px-2 pb-2">
                <div className={cn("w-full mx-auto", !isChatFullWidth && "max-w-2xl")}>
                  <div className="relative w-full">
                    <PromptInput
                      className="border bg-input-background relative z-10 p-2 rounded-xl opacity-50 pointer-events-none"
                      maxHeight={200}
                    >
                      <div className="p-1 text-muted-foreground text-sm">
                        Plan, @ for context, / for commands
                      </div>
                      <PromptInputActions className="w-full">
                        <div className="flex items-center gap-0.5 flex-1 min-w-0">
                          {/* Mode selector placeholder */}
                          <button
                            disabled
                            className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground rounded-md cursor-not-allowed"
                          >
                            <AgentIcon className="h-3.5 w-3.5" />
                            <span>Agent</span>
                            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                          </button>

                          {/* Model selector placeholder */}
                          <button
                            disabled
                            className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground rounded-md cursor-not-allowed"
                          >
                            <ClaudeCodeIcon className="h-3.5 w-3.5" />
                            <span>
                              {hasCustomClaudeConfig ? (
                                "Custom Model"
                              ) : (
                                <>
                                  Sonnet{" "}
                                  <span className="text-muted-foreground">
                                    4.5
                                  </span>
                                </>
                              )}
                            </span>
                            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                          </button>
                        </div>
                        <div className="flex items-center gap-0.5 ml-auto shrink-0">
                          {/* Attach button placeholder */}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled
                            className="h-7 w-7 rounded-sm cursor-not-allowed"
                          >
                            <AttachIcon className="h-4 w-4" />
                          </Button>

                          {/* Send button */}
                          <div className="ml-1">
                            <AgentSendButton
                              disabled={true}
                              onClick={() => {}}
                            />
                          </div>
                        </div>
                      </PromptInputActions>
                    </PromptInput>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <ChatSidebars
          chatId={chatId}
          activeSubChatId={activeSubChatIdForPlan}
          worktreePath={worktreePath}
          sandboxId={sandboxId}
          sidebarState={sidebarState}
          hideGitFeatures={hideGitFeatures}
          betaBrowserEnabled={betaBrowserEnabled}
          isQuickSetup={isQuickSetup}
          isMobileFullscreen={isMobileFullscreen}
          isDesktop={isDesktop}
          isFullscreen={isFullscreen}
          planEditRefetchTrigger={planEditRefetchTrigger}
          currentMode={currentMode}
          handleApprovePlanFromSidebar={handleApprovePlanFromSidebar}
          handleSubmitReview={handleSubmitReview}
          agentChat={agentChat}
          repositoryString={repositoryString}
          previewPort={previewPort}
          canOpenDiff={canOpenDiff}
          parsedFileDiffs={parsedFileDiffs}
          diffStats={diffStats}
          diffContent={diffContent}
          prefetchedFileContents={prefetchedFileContents}
          setDiffStats={setDiffStats}
          setDiffContent={setDiffContent}
          setParsedFileDiffs={setParsedFileDiffs}
          setPrefetchedFileContents={setPrefetchedFileContents}
          fetchDiffStats={fetchDiffStats}
          setDiffCollapseState={setDiffCollapseState}
          diffViewRef={diffViewRef}
          diffSidebarRef={diffSidebarRef}
          repository={repository}
          branchData={branchData}
          gitStatus={gitStatus}
          isGitStatusLoading={isGitStatusLoading}
          diffSidebarWidth={diffSidebarWidth}
          handleReview={handleReview}
          isReviewing={isReviewing}
          handleCreatePrDirect={handleCreatePrDirect}
          handleCreatePr={handleCreatePr}
          isCreatingPr={isCreatingPr}
          handleMergePr={handleMergePr}
          mergePrMutation={mergePrMutation}
          handleRefreshGitStatus={handleRefreshGitStatus}
          hasPrNumber={hasPrNumber}
          isPrOpen={isPrOpen}
          hasMergeConflicts={hasMergeConflicts}
          handleFixConflicts={handleFixConflicts}
          handleExpandAll={handleExpandAll}
          handleCollapseAll={handleCollapseAll}
          diffMode={diffMode}
          setDiffMode={setDiffMode}
          handleMarkAllViewed={handleMarkAllViewed}
          handleMarkAllUnviewed={handleMarkAllUnviewed}
          handleCommitToPr={handleCommitToPr}
          isCommittingToPr={isCommittingToPr}
          subChatsWithFiles={subChatsWithFiles}
          hasPendingDiffChanges={hasPendingDiffChanges}
          handleRefreshDiff={handleRefreshDiff}
          isDiffSidebarNarrow={isDiffSidebarNarrow}
          openLocallyDialogOpen={openLocallyDialogOpen}
          setOpenLocallyDialogOpen={setOpenLocallyDialogOpen}
          remoteAgentChat={remoteAgentChat}
          openLocallyMatchingProjects={openLocallyMatchingProjects}
          projects={projects ?? []}
          remoteInfo={remoteInfo}
          setSelectedFilePath={setSelectedFilePath}
          setFilteredDiffFiles={setFilteredDiffFiles}
        />
      </div>

      {/* Terminal Bottom Panel — renders below the main row when displayMode is "bottom" */}
      {terminalDisplayMode === "bottom" && worktreePath && !isMobileFullscreen && (
        <ResizableBottomPanel
          isOpen={isTerminalSidebarOpen}
          onClose={() => setIsTerminalSidebarOpen(false)}
          heightAtom={terminalBottomHeightAtom}
          minHeight={150}
          maxHeight={500}
          showResizeTooltip={true}
          closeHotkey={toggleTerminalHotkey ?? undefined}
          className="bg-background border-t"
          style={{ borderTopWidth: "0.5px" }}
        >
          <TerminalBottomPanelContent
            chatId={chatId}
            cwd={worktreePath}
            workspaceId={chatId}
            onClose={() => setIsTerminalSidebarOpen(false)}
          />
        </ResizableBottomPanel>
      )}
    </div>
    </TextSelectionProvider>
    </FileOpenProvider>
    </ChatInstanceProvider>
  )
}
