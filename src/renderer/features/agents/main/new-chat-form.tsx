"use client"

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { AlignJustify, Plus, Zap } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Button } from "../../../components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import {
  AgentIcon,
  AttachIcon,
  BranchIcon,
  CheckIcon,
  ClaudeCodeIcon,
  CursorIcon,
  IconChevronDown,
  PlanIcon,
  SearchIcon,
} from "../../../components/ui/icons"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog"
import { cn } from "../../../lib/utils"
import {
  agentsDebugModeAtom,
  currentProjectModeAtom,
  justCreatedIdsAtom,
  lastSelectedAgentIdAtom,
  lastSelectedBranchesAtom,
  lastSelectedModelIdAtom,
  lastSelectedRepoAtom,
  lastSelectedWorkModeAtom,
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedDraftIdAtom,
  selectedProjectAtom,
  getNextMode,
  type AgentMode,
} from "../atoms"
import { defaultAgentModeAtom } from "../../../lib/atoms"
import { ProjectSelector } from "../components/project-selector"
import { ProjectModeToggle, ProjectModeToggleWithSlogan } from "../components/project-mode-selector"
import { BranchModeSelector } from "../components/branch-mode-selector"
// import { selectedTeamIdAtom } from "@/lib/atoms/team"
import { atom } from "jotai"
const selectedTeamIdAtom = atom<string | null>(null)
import {
  agentsSettingsDialogOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  customClaudeConfigAtom,
  normalizeCustomClaudeConfig,
  showOfflineModeFeaturesAtom,
  selectedOllamaModelAtom,
  customHotkeysAtom,
  chatSourceModeAtom,
} from "../../../lib/atoms"
// Desktop uses real tRPC
import { toast } from "sonner"
import { trpc } from "../../../lib/trpc"
import { api } from "../../../lib/mock-api"
import {
  AgentsSlashCommand,
  COMMAND_PROMPTS,
  BUILTIN_SLASH_COMMANDS,
  type SlashCommandOption,
} from "../commands"
import { useAgentsFileUpload } from "../hooks/use-agents-file-upload"
import { usePastedTextFiles } from "../hooks/use-pasted-text-files"
import { useFocusInputOnEnter } from "../hooks/use-focus-input-on-enter"
import { useToggleFocusOnCmdEsc } from "../hooks/use-toggle-focus-on-cmd-esc"
import {
  useVoiceRecording,
  blobToBase64,
  getAudioFormat,
} from "../../../lib/hooks/use-voice-recording"
import { getResolvedHotkey } from "../../../lib/hotkeys"
import {
  AgentsFileMention,
  AgentsMentionsEditor,
  MENTION_PREFIXES,
  type AgentsMentionsEditorHandle,
  type FileMentionOption,
} from "../mentions"
import { pendingFileReferenceAtom } from "../../cowork/atoms"
import { AgentFileItem } from "../ui/agent-file-item"
import { AgentImageItem } from "../ui/agent-image-item"
import { AgentPastedTextItem } from "../ui/agent-pasted-text-item"
import { AgentsHeaderControls } from "../ui/agents-header-controls"
import { VoiceWaveIndicator } from "../ui/voice-wave-indicator"
import {
  PromptInput,
  PromptInputActions,
  PromptInputContextItems,
} from "../../../components/ui/prompt-input"
import { agentsSidebarOpenAtom, agentsUnseenChangesAtom, agentsSubChatsSidebarModeAtom } from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { AgentSendButton } from "../components/agent-send-button"
import { formatTimeAgo } from "../utils/format-time-ago"
import { handlePasteEvent } from "../utils/paste-text"
import {
  loadGlobalDrafts,
  saveGlobalDrafts,
  generateDraftId,
  deleteNewChatDraft,
  markDraftVisible,
  type DraftProject,
} from "../lib/drafts"
import { CLAUDE_MODELS } from "../lib/models"
// import type { PlanType } from "@/lib/config/subscription-plans"
type PlanType = string

// Codex icon (OpenAI style)
const CodexIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
  </svg>
)

// Hook to get available models (including offline models if Ollama is available and debug enabled)
function useAvailableModels() {
  const showOfflineFeatures = useAtomValue(showOfflineModeFeaturesAtom)
  const { data: ollamaStatus } = trpc.ollama.getStatus.useQuery(undefined, {
    refetchInterval: showOfflineFeatures ? 30000 : false,
    enabled: showOfflineFeatures, // Only query Ollama when offline mode is enabled
  })

  const baseModels = CLAUDE_MODELS

  const isOffline = ollamaStatus ? !ollamaStatus.internet.online : false
  const hasOllama = ollamaStatus?.ollama.available && (ollamaStatus.ollama.models?.length ?? 0) > 0
  const ollamaModels = ollamaStatus?.ollama.models || []
  const recommendedModel = ollamaStatus?.ollama.recommendedModel

  // Only show offline models if:
  // 1. Debug flag is enabled (showOfflineFeatures)
  // 2. Ollama is available with models
  // 3. User is actually offline
  if (showOfflineFeatures && hasOllama && isOffline) {
    return {
      models: baseModels,
      ollamaModels,
      recommendedModel,
      isOffline,
      hasOllama: true,
    }
  }

  return {
    models: baseModels,
    ollamaModels: [] as string[],
    recommendedModel: undefined as string | undefined,
    isOffline,
    hasOllama: false,
  }
}

// Agent providers
const agents = [
  { id: "claude-code", name: "Claude Code", hasModels: true },
  { id: "cursor", name: "Cursor CLI", disabled: true },
  { id: "codex", name: "OpenAI Codex", disabled: true },
]

interface NewChatFormProps {
  isMobileFullscreen?: boolean
  onBackToChats?: () => void
}

export function NewChatForm({
  isMobileFullscreen = false,
  onBackToChats,
}: NewChatFormProps = {}) {
  // UNCONTROLLED: just track if editor has content for send button
  const [hasContent, setHasContent] = useState(false)
  const [selectedTeamId] = useAtom(selectedTeamIdAtom)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setChatSourceMode = useSetAtom(chatSourceModeAtom)
  const [selectedDraftId, setSelectedDraftId] = useAtom(selectedDraftIdAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)

  // Current draft ID being edited (generated when user starts typing in empty form)
  const currentDraftIdRef = useRef<string | null>(null)
  const unseenChanges = useAtomValue(agentsUnseenChangesAtom)

  // Check if any chat has unseen changes
  const hasAnyUnseenChanges = unseenChanges.size > 0
  const [lastSelectedRepo, setLastSelectedRepo] = useAtom(lastSelectedRepoAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)

  // Fetch projects to validate selectedProject exists
  const { data: projectsList, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Validate selected project exists in DB
  // While loading, trust the stored value to prevent flicker
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projectsList) return null
    const exists = projectsList.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projectsList, isLoadingProjects])

  // Clear invalid project from storage
  useEffect(() => {
    if (selectedProject && projectsList && !validatedProject) {
      setSelectedProject(null)
    }
  }, [selectedProject, projectsList, validatedProject, setSelectedProject])

  const [lastSelectedAgentId, setLastSelectedAgentId] = useAtom(
    lastSelectedAgentIdAtom,
  )
  const [lastSelectedModelId, setLastSelectedModelId] = useAtom(
    lastSelectedModelIdAtom,
  )
  // Mode for new chat - uses user's default preference directly
  // Note: defaultAgentMode is initialized synchronously via atomWithStorage with getOnInit: true
  const defaultAgentMode = useAtomValue(defaultAgentModeAtom)
  const [agentMode, setAgentMode] = useState<AgentMode>(() => defaultAgentMode)
  // Toggle mode helper
  const toggleMode = useCallback(() => {
    setAgentMode(getNextMode)
  }, [])
  const [workMode, setWorkMode] = useAtom(lastSelectedWorkModeAtom)
  const [currentProjectMode, setCurrentProjectMode] = useAtom(currentProjectModeAtom)

  // Sync currentProjectModeAtom with validatedProject.mode
  // This ensures the mode toggle reflects the project's actual mode
  useEffect(() => {
    if (validatedProject?.mode) {
      setCurrentProjectMode(validatedProject.mode as "chat" | "cowork" | "coding")
    }
  }, [validatedProject?.mode, setCurrentProjectMode])

  // Auto-initialize playground when in chat mode without a project
  // This runs on mount and when mode changes to chat
  const getOrCreatePlaygroundMutation = trpc.projects.getOrCreatePlayground.useMutation()
  const hasInitializedPlayground = useRef(false)

  useEffect(() => {
    // Only auto-init if:
    // 1. In chat mode
    // 2. No project selected
    // 3. Haven't already initialized
    // 4. Not currently loading projects
    if (
      currentProjectMode === "chat" &&
      !selectedProject &&
      !hasInitializedPlayground.current &&
      !isLoadingProjects
    ) {
      hasInitializedPlayground.current = true
      getOrCreatePlaygroundMutation.mutateAsync().then((playground) => {
        if (playground) {
          setSelectedProject({
            id: playground.id,
            name: playground.name,
            path: playground.path,
            mode: "chat",
            isPlayground: true,
          })
        }
      }).catch((error) => {
        console.error("Failed to initialize playground:", error)
        hasInitializedPlayground.current = false // Allow retry
      })
    }
  }, [currentProjectMode, selectedProject, isLoadingProjects, getOrCreatePlaygroundMutation, setSelectedProject])

  // File reference from file tree panel
  const [pendingFileReference, setPendingFileReference] = useAtom(pendingFileReferenceAtom)
  const debugMode = useAtomValue(agentsDebugModeAtom)
  const customClaudeConfig = useAtomValue(customClaudeConfigAtom)
  const normalizedCustomClaudeConfig =
    normalizeCustomClaudeConfig(customClaudeConfig)
  const hasCustomClaudeConfig = Boolean(normalizedCustomClaudeConfig)
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setJustCreatedIds = useSetAtom(justCreatedIdsAtom)
  const [repoSearchQuery, setRepoSearchQuery] = useState("")

  // Worktree config banner state
  const [worktreeBannerDismissed, setWorktreeBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem("worktree-banner-dismissed") === "true"
    } catch {
      return false
    }
  })

  // Check if project has worktree config
  const { data: worktreeConfigData } = trpc.worktreeConfig.get.useQuery(
    { projectId: validatedProject?.id ?? "" },
    { enabled: !!validatedProject?.id && workMode === "worktree" && !worktreeBannerDismissed },
  )

  const showWorktreeBanner =
    currentProjectMode === "coding" &&
    workMode === "worktree" &&
    validatedProject &&
    !worktreeBannerDismissed &&
    worktreeConfigData &&
    !worktreeConfigData.config

  const handleDismissWorktreeBanner = () => {
    setWorktreeBannerDismissed(true)
    try {
      localStorage.setItem("worktree-banner-dismissed", "true")
    } catch {}
  }

  const handleConfigureWorktree = () => {
    // Open the projects settings tab
    setSettingsActiveTab("projects")
    setSettingsDialogOpen(true)
  }
  // Parse owner/repo from GitHub URL
  const parseGitHubUrl = (url: string) => {
    const match = url.match(/(?:github\.com\/)?([^\/]+)\/([^\/\s#?]+)/)
    if (!match) return null
    return `${match[1]}/${match[2].replace(/\.git$/, "")}`
  }
  const [selectedAgent, setSelectedAgent] = useState(
    () => agents.find((a) => a.id === lastSelectedAgentId) || agents[0],
  )

  // Get available models (with offline support)
  const availableModels = useAvailableModels()
  const [selectedOllamaModel, setSelectedOllamaModel] = useAtom(selectedOllamaModelAtom)

  const [selectedModel, setSelectedModel] = useState(
    () =>
      availableModels.models.find((m) => m.id === lastSelectedModelId) || availableModels.models[0],
  )

  // Sync selectedModel when atom value changes (e.g., after localStorage hydration)
  useEffect(() => {
    const model = availableModels.models.find((m) => m.id === lastSelectedModelId)
    if (model && model.id !== selectedModel.id) {
      setSelectedModel(model)
    }
  }, [lastSelectedModelId])

  // Determine current Ollama model (selected or recommended)
  const currentOllamaModel = selectedOllamaModel || availableModels.recommendedModel || availableModels.ollamaModels[0]
  const [repoPopoverOpen, setRepoPopoverOpen] = useState(false)
  const [lastSelectedBranches, setLastSelectedBranches] = useAtom(
    lastSelectedBranchesAtom,
  )
  const [selectedBranchType, setSelectedBranchType] = useState<
    "local" | "remote" | undefined
  >(undefined)

  // Custom branch name state
  const [customBranchName, setCustomBranchName] = useState("")
  const [branchNameError, setBranchNameError] = useState<string | null>(null)

  // Pull branch state (for worktree creation)
  const [pullStatus, setPullStatus] = useState<string | null>(null)
  const [pullFailedDialog, setPullFailedDialog] = useState<{
    open: boolean
    message: string
    resolve?: (continueCreate: boolean) => void
  } | null>(null)
  const pullBranchMutation = trpc.changes.pullBranch.useMutation()

  // Validate branch name (simplified client-side validation)
  const validateBranchName = useCallback((name: string): string | null => {
    if (!name || name.trim().length === 0) return null // Empty is ok (will auto-generate)
    const trimmed = name.trim()
    if (trimmed.startsWith(".")) return "Cannot start with ."
    if (trimmed.endsWith(".lock")) return "Cannot end with .lock"
    if (trimmed.includes("..")) return "Cannot contain .."
    if (/[\x00-\x1f\x7f ~^:?*\[\]\\]/.test(trimmed)) return "Contains invalid characters"
    if (trimmed.startsWith("/") || trimmed.endsWith("/")) return "Cannot start or end with /"
    if (trimmed.includes("//")) return "Cannot contain //"
    if (trimmed.endsWith(".")) return "Cannot end with ."
    if (trimmed.includes("@{")) return "Cannot contain @{"
    if (trimmed === "@") return "Cannot be just @"
    return null
  }, [])

  const handleCustomBranchNameChange = useCallback((value: string) => {
    setCustomBranchName(value)
    const error = validateBranchName(value)
    setBranchNameError(error)
  }, [validateBranchName])

  // Get/set selected branch for current project (persisted per project)
  const selectedBranch = validatedProject?.id
    ? lastSelectedBranches[validatedProject.id]?.name || ""
    : ""
  const setSelectedBranch = useCallback(
    (branch: string, type?: "local" | "remote") => {
      if (validatedProject?.id && type) {
        setLastSelectedBranches((prev) => ({
          ...prev,
          [validatedProject.id]: { name: branch, type },
        }))
        setSelectedBranchType(type)
      }
    },
    [validatedProject?.id, setLastSelectedBranches],
  )
  const editorRef = useRef<AgentsMentionsEditorHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Restore selectedBranchType from persisted storage when project changes
  useEffect(() => {
    if (validatedProject?.id) {
      const stored = lastSelectedBranches[validatedProject.id]
      if (stored?.type) {
        setSelectedBranchType(stored.type)
      } else {
        setSelectedBranchType(undefined)
      }
    } else {
      setSelectedBranchType(undefined)
    }
  }, [validatedProject?.id, lastSelectedBranches])

  // File upload hook
  const {
    images,
    files,
    handleAddAttachments,
    removeImage,
    removeFile,
    clearImages,
    clearFiles,
    isUploading,
  } = useAgentsFileUpload()

  // Pasted text files - use a stable temp ID for new chat
  const tempPastedIdRef = useRef(`new-chat-${Date.now()}`)
  const {
    pastedTexts,
    addPastedText,
    removePastedText,
    clearPastedTexts,
  } = usePastedTextFiles(tempPastedIdRef.current)

  // File contents cache - stores content for file mentions (keyed by mentionId)
  // This content gets added to the prompt when sending, without showing a separate card
  const fileContentsRef = useRef<Map<string, string>>(new Map())

  // Mention dropdown state
  const [showMentionDropdown, setShowMentionDropdown] = useState(false)
  const [mentionSearchText, setMentionSearchText] = useState("")
  const [mentionPosition, setMentionPosition] = useState({ top: 0, left: 0 })

  // Mention subpage navigation state
  const [showingFilesList, setShowingFilesList] = useState(false)
  const [showingSkillsList, setShowingSkillsList] = useState(false)
  const [showingAgentsList, setShowingAgentsList] = useState(false)
  const [showingToolsList, setShowingToolsList] = useState(false)

  // Slash command dropdown state
  const [showSlashDropdown, setShowSlashDropdown] = useState(false)
  const [slashSearchText, setSlashSearchText] = useState("")
  const [slashPosition, setSlashPosition] = useState({ top: 0, left: 0 })

  // Mode tooltip state (floating tooltip like canvas)
  const [modeTooltip, setModeTooltip] = useState<{
    visible: boolean
    position: { top: number; left: number }
    mode: "agent" | "plan"
  } | null>(null)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasShownTooltipRef = useRef(false)
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false)
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)

  // Voice input state
  const customHotkeys = useAtomValue(customHotkeysAtom)
  const {
    isRecording: isVoiceRecording,
    audioLevel: voiceAudioLevel,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecording()
  const [isTranscribing, setIsTranscribing] = useState(false)
  const transcribeMutation = trpc.voice.transcribe.useMutation()

  // Check if voice input is available (authenticated OR has OPENAI_API_KEY)
  const { data: voiceAvailability } = trpc.voice.isAvailable.useQuery()
  const isVoiceAvailable = voiceAvailability?.available ?? false

  // Voice input handlers
  const handleVoiceMouseDown = useCallback(async () => {
    if (isUploading || isTranscribing || isVoiceRecording) return
    try {
      await startRecording()
    } catch (err) {
      console.error("[NewChatForm] Failed to start recording:", err)
    }
  }, [isUploading, isTranscribing, isVoiceRecording, startRecording])

  const handleVoiceMouseUp = useCallback(async () => {
    if (!isVoiceRecording) return
    try {
      const blob = await stopRecording()
      if (blob.size < 1000) {
        console.log("[NewChatForm] Recording too short, ignoring")
        return
      }
      setIsTranscribing(true)
      const base64 = await blobToBase64(blob)
      const format = getAudioFormat(blob.type)
      const result = await transcribeMutation.mutateAsync({ audio: base64, format })
      if (result.text && result.text.trim()) {
        const currentValue = editorRef.current?.getValue() || ""
        // Clean transcribed text - remove any remaining whitespace issues
        const transcribed = result.text
          .replace(/[\r\n\t]+/g, " ")
          .replace(/ +/g, " ")
          .trim()
        // Add space separator only if current text exists and doesn't end with whitespace
        const needsSpace = currentValue.length > 0 && !/\s$/.test(currentValue)
        const newValue = currentValue + (needsSpace ? " " : "") + transcribed
        editorRef.current?.setValue(newValue)
        setHasContent(true)
      }
    } catch (err) {
      console.error("[NewChatForm] Transcription failed:", err)
    } finally {
      setIsTranscribing(false)
    }
  }, [isVoiceRecording, stopRecording, transcribeMutation])

  const handleVoiceMouseLeave = useCallback(() => {
    if (isVoiceRecording) {
      cancelRecording()
    }
  }, [isVoiceRecording, cancelRecording])

  // Voice hotkey listener (push-to-talk: hold to record, release to transcribe)
  useEffect(() => {
    const voiceHotkey = getResolvedHotkey("voice-input", customHotkeys)
    if (!voiceHotkey) return

    // Parse hotkey once
    const parts = voiceHotkey.split("+").map(p => p.toLowerCase())
    const modifiers = parts.filter(p => ["cmd", "meta", "ctrl", "opt", "alt", "shift"].includes(p))
    const mainKey = parts.find(p => !["cmd", "meta", "ctrl", "opt", "alt", "shift"].includes(p))

    const needsCmd = modifiers.includes("cmd") || modifiers.includes("meta")
    const needsShift = modifiers.includes("shift")
    const needsCtrl = modifiers.includes("ctrl")
    const needsAlt = modifiers.includes("alt") || modifiers.includes("opt")

    // For modifier-only hotkeys (like ctrl+opt), we track when all modifiers are pressed
    const isModifierOnlyHotkey = !mainKey

    const modifiersMatch = (e: KeyboardEvent) => {
      return (
        e.metaKey === needsCmd &&
        e.shiftKey === needsShift &&
        e.ctrlKey === needsCtrl &&
        e.altKey === needsAlt
      )
    }

    const matchesHotkey = (e: KeyboardEvent) => {
      if (isModifierOnlyHotkey) {
        // For modifier-only: just check if all required modifiers are pressed
        return modifiersMatch(e)
      }

      // For regular hotkey with main key
      const keyMatches =
        e.key.toLowerCase() === mainKey ||
        e.code.toLowerCase() === mainKey ||
        e.code.toLowerCase() === `key${mainKey}` ||
        (mainKey === "space" && e.code === "Space")

      return keyMatches && modifiersMatch(e)
    }

    // Check if any modifier key is released
    const isModifierRelease = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      return key === "control" || key === "alt" || key === "meta" || key === "shift"
    }

    // Check if the released key is the main key (not a modifier)
    const isMainKeyRelease = (e: KeyboardEvent) => {
      if (isModifierOnlyHotkey) {
        return isModifierRelease(e)
      }
      const eventKey = e.key.toLowerCase()
      return (
        eventKey === mainKey ||
        e.code.toLowerCase() === mainKey ||
        e.code.toLowerCase() === `key${mainKey}` ||
        (mainKey === "space" && e.code === "Space")
      )
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!matchesHotkey(e)) return
      if (e.repeat) return // Ignore key repeat

      e.preventDefault()
      e.stopPropagation()

      // Start recording on keydown
      if (!isVoiceRecording && !isTranscribing) {
        handleVoiceMouseDown()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // Stop recording when the main key (or any modifier for modifier-only hotkeys) is released
      if (!isMainKeyRelease(e)) return

      // Only stop if we're currently recording
      if (isVoiceRecording) {
        e.preventDefault()
        e.stopPropagation()
        handleVoiceMouseUp()
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    window.addEventListener("keyup", handleKeyUp, true)
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true)
      window.removeEventListener("keyup", handleKeyUp, true)
    }
  }, [customHotkeys, isVoiceRecording, isTranscribing, handleVoiceMouseDown, handleVoiceMouseUp])

  // Shift+Tab handler for mode switching (now handled inside input component via onShiftTab prop)

  // Keyboard shortcut: Enter to focus input when not already focused
  useFocusInputOnEnter(editorRef)

  // Keyboard shortcut: Cmd+Esc to toggle focus/blur
  useToggleFocusOnCmdEsc(editorRef)

  // Fetch repos from team
  // Desktop: no remote repos, we use local projects
  // Stub type for disabled cloud feature
  type RepoStub = {
    id: string
    name: string
    full_name: string
    sandbox_status: "not_setup" | "in_progress" | "ready" | "error"
    html_url?: string
    description?: string | null
    private?: boolean
    owner?: { login: string }
    pushed_at?: string | null
  }
  const reposData: { repositories: RepoStub[] } = { repositories: [] }
  const isLoadingRepos = false

  // Memoize repos arrays to prevent useEffect from running on every keystroke
  // Apply debug mode simulations
  const repos = useMemo(() => {
    if (debugMode.enabled && debugMode.simulateNoRepos) {
      return []
    }
    return reposData?.repositories || []
  }, [reposData?.repositories, debugMode.enabled, debugMode.simulateNoRepos])

  const readyRepos = useMemo(() => {
    if (debugMode.enabled && debugMode.simulateNoReadyRepos) {
      return []
    }
    return repos.filter((r) => r.sandbox_status === "ready")
  }, [repos, debugMode.enabled, debugMode.simulateNoReadyRepos])

  const notReadyRepos = useMemo(
    () => repos.filter((r) => r.sandbox_status !== "ready"),
    [repos],
  )

  // Use state to avoid hydration mismatch
  const [resolvedRepo, setResolvedRepo] = useState<(typeof repos)[0] | null>(
    null,
  )

  // Derive selected repo from saved or first available (client-side only)
  // Now includes all repos, not just ready ones
  useEffect(() => {
    if (lastSelectedRepo) {
      // For public imports, use lastSelectedRepo directly (it won't be in repos list)
      if (lastSelectedRepo.isPublicImport) {
        setResolvedRepo({
          id: lastSelectedRepo.id,
          name: lastSelectedRepo.name,
          full_name: lastSelectedRepo.full_name,
          sandbox_status: lastSelectedRepo.sandbox_status || "not_setup",
        } as (typeof repos)[0])
        return
      }

      // Look in all repos by id or full_name
      // Only compare IDs when lastSelectedRepo.id is non-empty (old localStorage data might have empty id)
      const stillExists = repos.find(
        (r) =>
          (lastSelectedRepo.id && r.id === lastSelectedRepo.id) ||
          r.full_name === lastSelectedRepo.full_name,
      )
      if (stillExists) {
        setResolvedRepo(stillExists)
        return
      }
    }

    if (repos.length === 0) {
      setResolvedRepo(null)
      return
    }

    // Auto-save first repo if none saved (prefer ready repos, then any)
    if (!lastSelectedRepo && repos.length > 0) {
      const firstRepo = readyRepos[0] || repos[0]
      setLastSelectedRepo({
        id: firstRepo.id,
        name: firstRepo.name,
        full_name: firstRepo.full_name,
        sandbox_status: firstRepo.sandbox_status,
      })
    }

    setResolvedRepo(readyRepos[0] || repos[0] || null)
  }, [lastSelectedRepo, repos, readyRepos, setLastSelectedRepo])

  // Desktop: fetch branches from local git repository
  const branchesQuery = trpc.changes.getBranches.useQuery(
    { worktreePath: validatedProject?.path || "" },
    {
      enabled: !!validatedProject?.path,
      staleTime: 30_000, // Cache for 30 seconds
    },
  )

  const fetchRemoteMutation = trpc.changes.fetchRemote.useMutation()

  // Manual refresh branches
  const handleRefreshBranches = useCallback(() => {
    if (validatedProject?.path) {
      fetchRemoteMutation.mutate(
        { worktreePath: validatedProject.path },
        {
          onSuccess: () => {
            branchesQuery.refetch()
          },
          onError: (error) => {
            console.error("Failed to fetch remote branches:", error)
          },
        },
      )
    }
  }, [validatedProject?.path, fetchRemoteMutation, branchesQuery])

  // Transform branch data to match web app format
  const branches = useMemo(() => {
    if (!branchesQuery.data) return []

    const { local, remote, defaultBranch } = branchesQuery.data
    const result: Array<{
      name: string
      type: "local" | "remote"
      protected: boolean
      isDefault: boolean
      committedAt: string | null
      authorName: null
    }> = []

    // Add local branches
    for (const { branch, lastCommitDate } of local) {
      result.push({
        name: branch,
        type: "local",
        protected: false,
        isDefault: branch === defaultBranch,
        committedAt: lastCommitDate
          ? new Date(lastCommitDate).toISOString()
          : null,
        authorName: null,
      })
    }

    // Add remote branches
    for (const name of remote) {
      result.push({
        name: name,
        type: "remote",
        protected: false,
        isDefault: name === defaultBranch,
        committedAt: null,
        authorName: null,
      })
    }

    // Sort: default first, then local, then remote, alphabetically
    return result.sort((a, b) => {
      if (a.isDefault && !b.isDefault) return -1
      if (!a.isDefault && b.isDefault) return 1
      if (a.type !== b.type) return a.type === "local" ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [branchesQuery.data])

  // Format relative time for branches (reuse shared utility)
  const formatRelativeTime = (dateString: string | null): string => {
    if (!dateString) return ""
    return formatTimeAgo(dateString)
  }

  // Set default branch when project/branches change (only if no saved branch for this project)
  useEffect(() => {
    if (
      branchesQuery.data?.defaultBranch &&
      validatedProject?.id &&
      !selectedBranch
    ) {
      // Find the default branch in the branches list to get its type
      // Prefer local over remote if both exist
      const defaultBranchObj = branches.find(
        (b) => b.name === branchesQuery.data.defaultBranch && b.isDefault && b.type === "local",
      ) || branches.find(
        (b) => b.name === branchesQuery.data.defaultBranch && b.isDefault && b.type === "remote",
      )
      // Fallback to "local" if branch not found in list (shouldn't happen but prevents empty selector)
      const branchType = defaultBranchObj?.type || "local"
      setSelectedBranch(
        branchesQuery.data.defaultBranch,
        branchType,
      )
    }
  }, [
    branchesQuery.data?.defaultBranch,
    validatedProject?.id,
    selectedBranch,
    setSelectedBranch,
    branches,
  ])

  // Auto-focus input when NewChatForm is shown (when clicking "New Chat")
  // Skip on mobile to prevent keyboard from opening automatically
  useEffect(() => {
    if (isMobileFullscreen) return // Don't autofocus on mobile

    // Small delay to ensure DOM is ready and animations complete
    const timeoutId = setTimeout(() => {
      editorRef.current?.focus()
    }, 150)

    return () => clearTimeout(timeoutId)
  }, [isMobileFullscreen]) // Run on mount and when mobile state changes

  // Track last saved text to avoid unnecessary updates
  const lastSavedTextRef = useRef<string>("")

  // Track previous draft ID to detect when switching away from a draft
  const prevSelectedDraftIdRef = useRef<string | null>(null)

  // Restore draft when a specific draft is selected from sidebar
  // Or clear editor when "New Workspace" is clicked (selectedDraftId becomes null)
  useEffect(() => {
    const hadDraftBefore = prevSelectedDraftIdRef.current !== null
    prevSelectedDraftIdRef.current = selectedDraftId

    if (!selectedDraftId) {
      // No draft selected - only clear if we had a draft before (user clicked "New Workspace")
      // Don't clear if user is currently typing (currentDraftIdRef has a value)
      if (hadDraftBefore) {
        currentDraftIdRef.current = null
        lastSavedTextRef.current = ""
        if (editorRef.current) {
          editorRef.current.clear()
          setHasContent(false)
        }

        // Fetch remote branches in background when starting new workspace
        if (validatedProject?.path) {
          handleRefreshBranches()
        }
      }
      return
    }

    const globalDrafts = loadGlobalDrafts()
    const draft = globalDrafts[selectedDraftId]
    if (draft?.text) {
      currentDraftIdRef.current = selectedDraftId
      lastSavedTextRef.current = draft.text // Initialize to prevent immediate re-save

      // Try to set value immediately if editor is ready
      if (editorRef.current) {
        editorRef.current.setValue(draft.text)
        setHasContent(true)
      } else {
        // Fallback: wait for editor to initialize (rare case)
        const timeoutId = setTimeout(() => {
          editorRef.current?.setValue(draft.text)
          setHasContent(true)
        }, 50)
        return () => clearTimeout(timeoutId)
      }
    }
  }, [selectedDraftId, handleRefreshBranches, validatedProject?.path])

  // Mark draft as visible when component unmounts (user navigates away)
  // This ensures the draft only appears in the sidebar after leaving the form
  useEffect(() => {
    return () => {
      // On unmount, mark current draft as visible so it appears in sidebar
      if (currentDraftIdRef.current) {
        markDraftVisible(currentDraftIdRef.current)
      }
    }
  }, [])

  // Listen for pending file reference and insert as mention
  useEffect(() => {
    if (pendingFileReference && editorRef.current && validatedProject) {
      const { path, name, type } = pendingFileReference
      // Create mention option
      const mentionId = type === "folder"
        ? `${MENTION_PREFIXES.FOLDER}local:${path}`
        : `${MENTION_PREFIXES.FILE}local:${path}`
      const mention: FileMentionOption = {
        id: mentionId,
        label: name,
        path: path,
        repository: "local",
        type: type,
      }
      // Insert mention at end of editor directly
      editorRef.current.insertMentionAtEnd(mention)
      // Clear the pending reference
      setPendingFileReference(null)
    }
  }, [pendingFileReference, setPendingFileReference, validatedProject])

  // Filter all repos by search (combined list) and sort by preview status
  const filteredRepos = repos
    .filter(
      (repo) =>
        repo.name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
        repo.full_name.toLowerCase().includes(repoSearchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      // 1. Repos with preview (sandbox_status === "ready") come first
      const aHasPreview = a.sandbox_status === "ready"
      const bHasPreview = b.sandbox_status === "ready"
      if (aHasPreview && !bHasPreview) return -1
      if (!aHasPreview && bHasPreview) return 1

      // 2. Sort by last commit date (pushed_at) - most recent first
      const aDate = a.pushed_at ? new Date(a.pushed_at).getTime() : 0
      const bDate = b.pushed_at ? new Date(b.pushed_at).getTime() : 0
      return bDate - aDate
    })

  // Create chat mutation (real tRPC)
  const utils = trpc.useUtils()
  const apiUtils = api.useUtils()
  const createChatMutation = trpc.chats.create.useMutation({
    onSuccess: (data) => {
      // Clear editor, images, files, pasted texts, file contents cache, and custom branch name only on success
      editorRef.current?.clear()
      clearImages()
      clearFiles()
      clearPastedTexts()
      fileContentsRef.current.clear()
      clearCurrentDraft()
      setCustomBranchName("")
      setBranchNameError(null)
      utils.chats.list.invalidate()
      setSelectedChatId(data.id)
      // New chats are always local
      setSelectedChatIsRemote(false)
      setChatSourceMode("local")
      // Track this chat and its first subchat as just created for typewriter effect
      const ids = [data.id]
      if (data.subChats?.[0]?.id) {
        ids.push(data.subChats[0].id)
      }
      setJustCreatedIds((prev) => new Set([...prev, ...ids]))
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Get or create playground chat mutation (for Chat mode)
  const getOrCreatePlaygroundChatMutation = trpc.chats.getOrCreatePlaygroundChat.useMutation()

  // Create subchat mutation (for Chat mode - creates subchat under existing playground chat)
  // Note: We use mutateAsync in handleSend, so onSuccess/onError are handled there
  const createSubChatMutation = trpc.chats.createSubChat.useMutation()

  // Open folder mutation for selecting a project
  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (project) {
        // Optimistically update the projects list cache to prevent "Select repo" flash
        // This ensures validatedProject can find the new project immediately
        utils.projects.list.setData(undefined, (oldData) => {
          if (!oldData) return [project]
          // Check if project already exists (reopened existing project)
          const exists = oldData.some((p) => p.id === project.id)
          if (exists) {
            // Update existing project's timestamp
            return oldData.map((p) =>
              p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p,
            )
          }
          // Add new project at the beginning
          return [project, ...oldData]
        })

        setSelectedProject({
          id: project.id,
          name: project.name,
          path: project.path,
          gitRemoteUrl: project.gitRemoteUrl,
          gitProvider: project.gitProvider as
            | "github"
            | "gitlab"
            | "bitbucket"
            | null,
          gitOwner: project.gitOwner,
          gitRepo: project.gitRepo,
          mode: project.mode as "cowork" | "coding" | undefined,
        })
      }
    },
    onError: (error) => {
      toast.error(`Failed to open folder: ${error.message}`)
    },
  })

  const handleOpenFolder = async () => {
    await openFolder.mutateAsync()
  }

  // Handle project mode change (Chat/Cowork/Coding)
  const updateModeMutation = trpc.projects.updateMode.useMutation()

  const handleModeChange = useCallback(async (newMode: "chat" | "cowork" | "coding") => {
    // If switching to chat mode, auto-select playground
    if (newMode === "chat") {
      try {
        const playground = await getOrCreatePlaygroundMutation.mutateAsync()
        if (playground) {
          setSelectedProject({
            id: playground.id,
            name: playground.name,
            path: playground.path,
            mode: "chat",
            isPlayground: true,
          })
          setCurrentProjectMode("chat")
        }
      } catch (error) {
        console.error("Failed to switch to chat mode:", error)
        toast.error("Failed to switch to chat mode")
      }
      return
    }

    // If switching FROM chat mode to cowork/coding, clear selection (user needs to pick a project)
    if (validatedProject?.isPlayground) {
      setSelectedProject(null)
      setCurrentProjectMode(newMode)
      return
    }

    // For non-playground projects, update the mode
    if (!validatedProject?.id) {
      // No project selected, just update the mode atom
      setCurrentProjectMode(newMode)
      return
    }

    try {
      const updatedProject = await updateModeMutation.mutateAsync({
        id: validatedProject.id,
        mode: newMode,
      })

      // Update local state
      if (updatedProject) {
        setSelectedProject({
          ...validatedProject,
          mode: newMode,
        })
        setCurrentProjectMode(newMode)
      }
    } catch (error) {
      console.error("Failed to update project mode:", error)
      toast.error("Failed to update project mode")
    }
  }, [validatedProject, updateModeMutation, setSelectedProject, getOrCreatePlaygroundMutation, setCurrentProjectMode])

  const getAgentIcon = (agentId: string, className?: string) => {
    switch (agentId) {
      case "claude-code":
        return <ClaudeCodeIcon className={className} />
      case "cursor":
        return <CursorIcon className={className} />
      case "codex":
        return <CodexIcon className={className} />
      default:
        return null
    }
  }

  const trpcUtils = trpc.useUtils()

  const handleSend = useCallback(async () => {
    // Get value from uncontrolled editor
    let message = editorRef.current?.getValue() || ""

    // Allow send if there's text, images, files, or pasted text files
    const hasText = message.trim().length > 0
    const hasImages = images.filter((img) => !img.isLoading && img.url).length > 0
    const hasFiles = files.filter((f) => !f.isLoading).length > 0
    const hasPastedTexts = pastedTexts.length > 0

    if (!hasText && !hasImages && !hasFiles && !hasPastedTexts) {
      return
    }

    // For Chat mode, ensure playground is initialized
    let projectToUse = selectedProject
    if (currentProjectMode === "chat" && !selectedProject) {
      try {
        const playground = await getOrCreatePlaygroundMutation.mutateAsync()
        if (playground) {
          projectToUse = {
            id: playground.id,
            name: playground.name,
            path: playground.path,
            mode: "chat",
            isPlayground: true,
          }
          setSelectedProject(projectToUse)
        }
      } catch (error) {
        console.error("Failed to initialize playground:", error)
        toast.error("Failed to initialize chat mode")
        return
      }
    }

    if (!projectToUse) {
      return
    }

    // Check for branch name validation error
    if (branchNameError) {
      toast.error(branchNameError)
      return
    }

    // Check if message is a slash command with arguments (e.g. "/hello world")
    // Note: 's' flag makes '.' match newlines, so multi-line arguments are captured
    const slashMatch = message.match(/^\/(\S+)\s*(.*)$/s)
    if (slashMatch) {
      const [, commandName, args] = slashMatch

      // Check if it's a builtin command - if so, don't process as custom command
      const builtinNames = new Set(
        BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.name),
      )
      if (!builtinNames.has(commandName)) {
        // This is a custom command - load content and replace $ARGUMENTS
        try {
          const commands = await trpcUtils.commands.list.fetch({
            projectPath: validatedProject?.path,
          })
          const cmd = commands.find((c) => c.name.toLowerCase() === commandName.toLowerCase())

          if (cmd) {
            const { content } = await trpcUtils.commands.getContent.fetch({
              path: cmd.path,
            })
            // Replace $ARGUMENTS with the provided args
            message = content.replace(/\$ARGUMENTS/g, args.trim())
          }
        } catch (error) {
          console.error("Failed to process custom command:", error)
          // Fall through with original message
        }
      }
    }

    // Build message parts array (images first, then text, then hidden file contents)
    type MessagePart =
      | { type: "text"; text: string }
      | {
          type: "data-image"
          data: {
            url: string
            mediaType?: string
            filename?: string
            base64Data?: string
          }
        }
      | {
          type: "file-content"
          filePath: string
          content: string
        }

    const parts: MessagePart[] = images
      .filter((img) => !img.isLoading && img.url)
      .map((img) => ({
        type: "data-image" as const,
        data: {
          url: img.url!,
          mediaType: img.mediaType,
          filename: img.filename,
          base64Data: img.base64Data,
        },
      }))

    // Add pasted text as pasted mentions (format: pasted:size:preview|filepath)
    // Using | as separator since filepath can contain colons
    let finalMessage = message.trim()
    if (pastedTexts.length > 0) {
      const pastedMentions = pastedTexts
        .map((pt) => {
          // Sanitize preview to remove special characters that break mention parsing
          const sanitizedPreview = pt.preview.replace(/[:\[\]|]/g, "")
          return `@[${MENTION_PREFIXES.PASTED}${pt.size}:${sanitizedPreview}|${pt.filePath}]`
        })
        .join(" ")
      finalMessage = pastedMentions + (finalMessage ? " " + finalMessage : "")
    }

    if (finalMessage) {
      parts.push({ type: "text" as const, text: finalMessage })
    }

    // Add cached file contents as hidden parts (sent to agent but not displayed in UI)
    // These are from dropped text files - content is embedded so agent sees it immediately
    if (fileContentsRef.current.size > 0) {
      for (const [mentionId, content] of fileContentsRef.current.entries()) {
        // Extract file path from mentionId (file:local:path or file:external:path)
        const filePath = mentionId.replace(/^file:(local|external):/, "")
        parts.push({
          type: "file-content" as const,
          filePath,
          content,
        })
      }
    }

    // Chat mode: create subchat under existing playground chat
    if (currentProjectMode === "chat") {
      try {
        // Get or create the single playground chat
        const playgroundChat = await getOrCreatePlaygroundChatMutation.mutateAsync()

        // Create a new subchat with the message
        const newSubChat = await createSubChatMutation.mutateAsync({
          chatId: playgroundChat.id,
          name: message.trim().slice(0, 50),
          mode: agentMode,
          initialMessageParts: parts.length > 0 ? parts : undefined,
        })

        // Clear editor, images, files, pasted texts, file contents cache
        editorRef.current?.clear()
        clearImages()
        clearFiles()
        clearPastedTexts()
        fileContentsRef.current.clear()
        clearCurrentDraft()

        // Select the playground chat (this triggers ChatView to render)
        setSelectedChatId(playgroundChat.id)
        setSelectedChatIsRemote(false)
        setChatSourceMode("local")

        // Invalidate sidebar list
        utils.chats.listPlayground.invalidate()

        // CRITICAL: Refetch the chat data FIRST to ensure agentSubChats has the new subchat with messages
        // Must complete before setActiveSubChat, otherwise getOrCreateChat() will see empty messages
        await apiUtils.agents.getAgentChat.fetch({ chatId: playgroundChat.id })

        // Now set up the subchat store - at this point the query cache is already updated
        const store = useAgentSubChatStore.getState()
        // Ensure the chat is set correctly
        if (store.chatId !== playgroundChat.id) {
          store.setChatId(playgroundChat.id)
        }
        // Add to all subchats list (for sidebar display)
        store.addToAllSubChats({
          id: newSubChat.id,
          name: newSubChat.name,
          mode: newSubChat.mode as "plan" | "agent",
          created_at: newSubChat.createdAt?.toISOString() ?? new Date().toISOString(),
          updated_at: newSubChat.updatedAt?.toISOString() ?? new Date().toISOString(),
        })
        store.addToOpenSubChats(newSubChat.id)
        // Set active subchat LAST - this triggers ChatView to create the Chat object
        // By this point, agentSubChats in the query cache already contains the new subchat's messages
        store.setActiveSubChat(newSubChat.id)

        // Track as just created for typewriter effect
        setJustCreatedIds((prev) => new Set([...prev, newSubChat.id]))
      } catch (error) {
        console.error("Failed to create chat:", error)
        toast.error("Failed to create chat")
      }
      return
    }

    // Pull latest changes before creating worktree (cowork/coding modes only)
    if (workMode === "worktree" && selectedBranch && validatedProject?.path) {
      setPullStatus("Pulling latest changes...")

      try {
        await pullBranchMutation.mutateAsync({
          worktreePath: validatedProject.path,
          branch: selectedBranch,
        })
      } catch (err) {
        setPullStatus(null)

        // Show confirmation dialog
        const errorMessage = err instanceof Error ? err.message : String(err)
        const shouldContinue = await new Promise<boolean>((resolve) => {
          setPullFailedDialog({
            open: true,
            message: errorMessage,
            resolve,
          })
        })

        if (!shouldContinue) {
          return // User chose to cancel
        }
      }

      setPullStatus(null)
    }

    // Create chat with selected project, branch, and initial message (cowork/coding modes)
    createChatMutation.mutate({
      projectId: projectToUse.id,
      name: message.trim().slice(0, 50), // Use first 50 chars as chat name
      initialMessageParts: parts.length > 0 ? parts : undefined,
      baseBranch:
        workMode === "worktree" ? selectedBranch || undefined : undefined,
      branchType:
        workMode === "worktree" ? selectedBranchType : undefined,
      useWorktree: workMode === "worktree",
      mode: agentMode,
      customBranchName:
        workMode === "worktree" && customBranchName.trim()
          ? customBranchName.trim()
          : undefined,
    })
    // Editor, images, files, and pasted texts are cleared in onSuccess callback
  }, [
    selectedProject,
    validatedProject?.path,
    createChatMutation,
    createSubChatMutation,
    getOrCreatePlaygroundChatMutation,
    pullBranchMutation,
    hasContent,
    selectedBranch,
    selectedBranchType,
    workMode,
    customBranchName,
    branchNameError,
    images,
    files,
    pastedTexts,
    agentMode,
    trpcUtils,
    currentProjectMode,
    getOrCreatePlaygroundMutation,
    setSelectedProject,
    setSelectedChatId,
    setSelectedChatIsRemote,
    setChatSourceMode,
    setJustCreatedIds,
    utils,
    // Note: clearImages, clearFiles, clearPastedTexts, clearCurrentDraft are stable refs from hooks
  ])

  const handleMentionSelect = useCallback((mention: FileMentionOption) => {
    // Category navigation - enter subpage instead of inserting mention
    if (mention.type === "category") {
      if (mention.id === "files") {
        setShowingFilesList(true)
        return
      }
      if (mention.id === "skills") {
        setShowingSkillsList(true)
        return
      }
      if (mention.id === "agents") {
        setShowingAgentsList(true)
        return
      }
      if (mention.id === "tools") {
        setShowingToolsList(true)
        return
      }
    }

    // Otherwise: insert mention as normal
    editorRef.current?.insertMention(mention)
    setShowMentionDropdown(false)
    // Reset subpage state
    setShowingFilesList(false)
    setShowingSkillsList(false)
    setShowingAgentsList(false)
    setShowingToolsList(false)
  }, [])

  // Save draft to localStorage when content changes
  const handleContentChange = useCallback(
    (hasContent: boolean) => {
      setHasContent(hasContent)
      const text = editorRef.current?.getValue() || ""

      // Skip if text hasn't changed
      if (text === lastSavedTextRef.current) {
        return
      }
      lastSavedTextRef.current = text

      const globalDrafts = loadGlobalDrafts()

      if (text.trim() && validatedProject) {
        // If no current draft ID, create a new one
        if (!currentDraftIdRef.current) {
          currentDraftIdRef.current = generateDraftId()
        }

        const key = currentDraftIdRef.current
        globalDrafts[key] = {
          text,
          updatedAt: Date.now(),
          project: {
            id: validatedProject.id,
            name: validatedProject.name,
            path: validatedProject.path,
            gitOwner: validatedProject.gitOwner,
            gitRepo: validatedProject.gitRepo,
            gitProvider: validatedProject.gitProvider,
          },
        }
        saveGlobalDrafts(globalDrafts)
      } else if (currentDraftIdRef.current) {
        // Text is empty - delete the current draft
        deleteNewChatDraft(currentDraftIdRef.current)
        currentDraftIdRef.current = null
      }
    },
    [validatedProject],
  )

  // Clear current draft when chat is created
  const clearCurrentDraft = useCallback(() => {
    if (!currentDraftIdRef.current) return

    deleteNewChatDraft(currentDraftIdRef.current)
    currentDraftIdRef.current = null
    setSelectedDraftId(null)
  }, [setSelectedDraftId])

  // Memoized callbacks to prevent re-renders
  const handleMentionTrigger = useCallback(
    ({ searchText, rect, options }: { searchText: string; rect: DOMRect; options?: { showFilesList?: boolean } }) => {
      if (validatedProject) {
        setMentionSearchText(searchText)
        setMentionPosition({ top: rect.top, left: rect.left })
        // Reset subpage state when opening dropdown (unless options specify otherwise)
        setShowingFilesList(options?.showFilesList ?? false)
        setShowingSkillsList(false)
        setShowingAgentsList(false)
        setShowingToolsList(false)
        setShowMentionDropdown(true)
      }
    },
    [validatedProject],
  )

  const handleCloseTrigger = useCallback(() => {
    setShowMentionDropdown(false)
    // Reset subpage state when closing
    setShowingFilesList(false)
    setShowingSkillsList(false)
    setShowingAgentsList(false)
    setShowingToolsList(false)
  }, [])

  // Slash command handlers
  const handleSlashTrigger = useCallback(
    ({ searchText, rect }: { searchText: string; rect: DOMRect }) => {
      setSlashSearchText(searchText)
      setSlashPosition({ top: rect.top, left: rect.left })
      setShowSlashDropdown(true)
    },
    [],
  )

  const handleCloseSlashTrigger = useCallback(() => {
    setShowSlashDropdown(false)
  }, [])

  const handleSlashSelect = useCallback(
    (command: SlashCommandOption) => {
      // Clear the slash command text from editor
      editorRef.current?.clearSlashCommand()
      setShowSlashDropdown(false)

      // Handle builtin commands that change app state (no text input needed)
      if (command.category === "builtin") {
        switch (command.name) {
          case "clear":
            editorRef.current?.clear()
            return
          case "plan":
            if (agentMode !== "plan") {
              setAgentMode("plan")
            }
            return
          case "agent":
            if (agentMode === "plan") {
              setAgentMode("agent")
            }
            return
        }
      }

      // For all other commands (builtin prompts and custom):
      // insert the command and let user add arguments or press Enter to send
      editorRef.current?.setValue(`/${command.name} `)
    },
    [agentMode],
  )

  // Paste handler for images, plain text, and large text (saved as files)
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => handlePasteEvent(e, handleAddAttachments, addPastedText),
    [handleAddAttachments, addPastedText],
  )

  // Drag and drop handlers
  const [isDragOver, setIsDragOver] = useState(false)

  // Focus state for ring
  const [isFocused, setIsFocused] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  // Text file extensions that should have content read and attached
  const TEXT_FILE_EXTENSIONS = new Set([
    // Code
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp",
    ".cs", ".php", ".lua", ".r", ".m", ".mm", ".scala", ".clj", ".ex", ".exs",
    ".hs", ".elm", ".erl", ".fs", ".fsx", ".ml", ".v", ".vhdl", ".zig",
    // Config/Data
    ".json", ".yaml", ".yml", ".toml", ".xml", ".ini", ".env", ".conf", ".cfg",
    ".properties", ".plist",
    // Web
    ".html", ".htm", ".css", ".scss", ".sass", ".less", ".vue", ".svelte", ".astro",
    // Documentation
    ".md", ".mdx", ".rst", ".txt", ".text",
    // Graphics (text-based)
    ".svg",
    // Shell/Scripts
    ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd",
    // Other
    ".sql", ".graphql", ".gql", ".prisma", ".dockerfile", ".makefile",
    ".gitignore", ".gitattributes", ".editorconfig", ".eslintrc", ".prettierrc",
  ])

  const MAX_FILE_SIZE_FOR_CONTENT = 100 * 1024 // 100KB - files larger than this only get path mention

  // Image extensions that should be handled as attachments (base64)
  const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragOver(false)
      const droppedFiles = Array.from(e.dataTransfer.files)

      // Separate images from other files
      const imageFiles: File[] = []
      const otherFiles: File[] = []

      for (const file of droppedFiles) {
        const ext = file.name.includes(".") ? "." + file.name.split(".").pop()?.toLowerCase() : ""
        if (IMAGE_EXTENSIONS.has(ext)) {
          imageFiles.push(file)
        } else {
          otherFiles.push(file)
        }
      }

      // Handle images via existing attachment system (base64)
      if (imageFiles.length > 0) {
        handleAddAttachments(imageFiles)
      }

      // Process other files - for text files, read content and add as file mention
      for (const file of otherFiles) {
        // Get file path using Electron's webUtils API (more reliable than file.path)
        const filePath: string | undefined = window.webUtils?.getPathForFile?.(file) || (file as File & { path?: string }).path

        let mentionId: string
        let mentionPath: string

        // Check if file is inside the project
        if (
          validatedProject?.path &&
          filePath &&
          filePath.startsWith(validatedProject.path)
        ) {
          // Project file: use relative path with file:local: prefix
          const relativePath = filePath
            .slice(validatedProject.path.length)
            .replace(/^\//, "")
          mentionId = `file:local:${relativePath}`
          mentionPath = relativePath
        } else if (filePath) {
          // External file: use absolute path with file:external: prefix
          mentionId = `file:external:${filePath}`
          mentionPath = filePath
        } else {
          // Fallback: use filename only
          mentionId = `file:external:${file.name}`
          mentionPath = file.name
        }

        const fileName = file.name
        const ext = fileName.includes(".") ? "." + fileName.split(".").pop()?.toLowerCase() : ""
        // Files without extension are likely directories or special files - skip content reading
        const hasExtension = ext !== ""
        const isTextFile = hasExtension && TEXT_FILE_EXTENSIONS.has(ext)
        const isSmallEnough = file.size <= MAX_FILE_SIZE_FOR_CONTENT

        // For text files that are small enough, read content and store it
        // Show file chip, content will be added to prompt on send
        if (isTextFile && isSmallEnough && filePath) {
          // Add file chip for visual representation
          editorRef.current?.insertMention({
            id: mentionId,
            label: fileName,
            path: mentionPath,
            repository: "local",
            type: "file",
          })

          // Read and cache content (will be added to prompt on send)
          try {
            const content = await trpcUtils.files.readFile.fetch({ path: filePath })
            fileContentsRef.current.set(mentionId, content)
          } catch (err) {
            // If reading fails, chip is still there - agent can try to read via path
            console.error(`[handleDrop] Failed to read file content ${filePath}:`, err)
          }
        } else {
          // For binary files, large files - add as mention only
          // mentionPath contains full absolute path for external files
          editorRef.current?.insertMention({
            id: mentionId,
            label: fileName,
            path: mentionPath,
            repository: "local",
            type: "file",
          })
        }
      }

      // Focus after state update - use double rAF to wait for React render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          editorRef.current?.focus()
        })
      })
    },
    [validatedProject?.path, handleAddAttachments, trpcUtils],
  )

  // Context items for images, files, and pasted text files
  const contextItems =
    images.length > 0 || files.length > 0 || pastedTexts.length > 0 ? (
      <div className="flex flex-wrap gap-[6px]">
        {(() => {
          // Build allImages array for gallery navigation
          const allImages = images
            .filter((img) => img.url && !img.isLoading)
            .map((img) => ({
              id: img.id,
              filename: img.filename,
              url: img.url,
            }))

          return images.map((img, idx) => (
            <AgentImageItem
              key={img.id}
              id={img.id}
              filename={img.filename}
              url={img.url}
              isLoading={img.isLoading}
              onRemove={() => removeImage(img.id)}
              allImages={allImages}
              imageIndex={idx}
            />
          ))
        })()}
        {files.map((f) => (
          <AgentFileItem
            key={f.id}
            id={f.id}
            filename={f.filename}
            url={f.url || ""}
            size={f.size}
            isLoading={f.isLoading}
            onRemove={() => removeFile(f.id)}
          />
        ))}
        {pastedTexts.map((pt) => (
          <AgentPastedTextItem
            key={pt.id}
            filePath={pt.filePath}
            filename={pt.filename}
            size={pt.size}
            preview={pt.preview}
            onRemove={() => removePastedText(pt.id)}
          />
        ))}
      </div>
    ) : null

  // Handle container click to focus editor
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    if (
      e.target === e.currentTarget ||
      !(e.target as HTMLElement).closest("button, [contenteditable]")
    ) {
      editorRef.current?.focus()
    }
  }, [])

  return (
    <div className="flex h-full flex-col relative">
      {/* Header - Simple burger on mobile, AgentsHeaderControls on desktop */}
      <div className="shrink-0 flex items-center justify-between bg-background p-1.5">
        <div className="flex-1 min-w-0 flex items-center gap-2">
          {isMobileFullscreen ? (
            // Simple burger button for mobile - just opens chats list
            <Button
              variant="ghost"
              size="icon"
              onClick={onBackToChats}
              className="h-7 w-7 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] shrink-0 rounded-md"
              aria-label="All projects"
            >
              <AlignJustify className="h-4 w-4" />
            </Button>
          ) : (
            <AgentsHeaderControls
              isSidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
              hasUnseenChanges={hasAnyUnseenChanges}
            />
          )}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center overflow-y-auto relative">
        <div className="w-full max-w-2xl flex flex-col gap-6 md:gap-8 relative z-10 px-4">
          {/* Title */}
          <div className="text-center mb-2">
            <h1 className="text-2xl md:text-4xl font-medium tracking-tight">
              What do you want to get done?
            </h1>
          </div>

          {/* Mode Toggle - Cowork/Coding with slogan (left-aligned, above input) */}
          <div className="flex justify-start -mb-4!">
            <ProjectModeToggleWithSlogan
              value={currentProjectMode}
              onChange={handleModeChange}
              showSlogan={true}
            />
          </div>

          {/* Input Area - shown for both states */}
          {/* Chat mode: skip folder selection, show input directly (playground initializes async) */}
          {!validatedProject && currentProjectMode !== "chat" ? (
            // No project selected - show disabled input with folder selector
            <div className="relative w-full">
              <div
                className="relative w-full cursor-pointer"
                onClick={handleOpenFolder}
              >
                <div className="border bg-input-background relative z-10 p-2 rounded-xl opacity-60">
                  <div className="p-1 min-h-[44px] text-sm text-muted-foreground">
                    Select a folder to start chatting...
                  </div>
                  <div className="flex items-center justify-between w-full pt-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenFolder()
                      }}
                      disabled={openFolder.isPending}
                      className="flex items-center gap-1.5 px-2 py-1 text-sm text-primary hover:text-primary/80 transition-[background-color,color] duration-150 ease-out rounded-md hover:bg-primary/10 outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>{openFolder.isPending ? "Opening..." : "Select Folder"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            // Project selected - show input form
            <div
              className="relative w-full"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div
                className="relative w-full cursor-text"
                onClick={handleContainerClick}
              >
                <PromptInput
                  className={cn(
                    "border bg-input-background relative z-10 p-2 rounded-xl transition-[border-color,box-shadow] duration-150",
                    isDragOver && "ring-2 ring-primary/50 border-primary/50",
                    isFocused && !isDragOver && "ring-2 ring-primary/50",
                  )}
                  maxHeight={240}
                  onSubmit={handleSend}
                  contextItems={contextItems}
                >
                  <PromptInputContextItems />
                  <div className="relative">
                    <AgentsMentionsEditor
                      ref={editorRef}
                      onTrigger={handleMentionTrigger}
                      onCloseTrigger={handleCloseTrigger}
                      onSlashTrigger={handleSlashTrigger}
                      onCloseSlashTrigger={handleCloseSlashTrigger}
                      onContentChange={handleContentChange}
                      onSubmit={handleSend}
                      onShiftTab={toggleMode}
                      placeholder="Plan, @ for context, / for commands"
                      className={cn(
                        "bg-transparent max-h-[240px] overflow-y-auto p-1",
                        isMobileFullscreen ? "min-h-[56px]" : "min-h-[44px]",
                      )}
                      onPaste={handlePaste}
                      disabled={createChatMutation.isPending || pullStatus !== null}
                      onFocus={() => setIsFocused(true)}
                      onBlur={() => setIsFocused(false)}
                    />
                  </div>
                  <PromptInputActions className="w-full">
                    <div className="flex items-center gap-0.5 flex-1 min-w-0">
                      {/* Mode toggle (Agent/Plan) */}
                      <DropdownMenu
                        open={modeDropdownOpen}
                        onOpenChange={(open) => {
                          setModeDropdownOpen(open)
                          if (!open) {
                            if (tooltipTimeoutRef.current) {
                              clearTimeout(tooltipTimeoutRef.current)
                              tooltipTimeoutRef.current = null
                            }
                            setModeTooltip(null)
                            hasShownTooltipRef.current = false
                          }
                        }}
                      >
                        <DropdownMenuTrigger className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-[background-color,color] duration-150 ease-out rounded-md hover:bg-muted/50 outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70">
                          {agentMode === "plan" ? (
                            <PlanIcon className="h-3.5 w-3.5" />
                          ) : (
                            <AgentIcon className="h-3.5 w-3.5" />
                          )}
                          <span>{agentMode === "plan" ? "Plan" : "Agent"}</span>
                          <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="start"
                          sideOffset={6}
                          className="min-w-[116px]! w-[116px]!"
                          onCloseAutoFocus={(e) => e.preventDefault()}
                        >
                          <DropdownMenuItem
                            onClick={() => {
                              // Clear tooltip before closing dropdown (onMouseLeave won't fire)
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              setModeTooltip(null)
                              setAgentMode("agent")
                              setModeDropdownOpen(false)
                            }}
                            className="justify-between gap-2"
                            onMouseEnter={(e) => {
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              const rect =
                                e.currentTarget.getBoundingClientRect()
                              const showTooltip = () => {
                                setModeTooltip({
                                  visible: true,
                                  position: {
                                    top: rect.top,
                                    left: rect.right + 8,
                                  },
                                  mode: "agent",
                                })
                                hasShownTooltipRef.current = true
                                tooltipTimeoutRef.current = null
                              }
                              if (hasShownTooltipRef.current) {
                                showTooltip()
                              } else {
                                tooltipTimeoutRef.current = setTimeout(
                                  showTooltip,
                                  1000,
                                )
                              }
                            }}
                            onMouseLeave={() => {
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              setModeTooltip(null)
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <AgentIcon className="w-4 h-4 text-muted-foreground" />
                              <span>Agent</span>
                            </div>
                            {agentMode !== "plan" && (
                              <CheckIcon className="h-3.5 w-3.5 ml-auto shrink-0" />
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              // Clear tooltip before closing dropdown (onMouseLeave won't fire)
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              setModeTooltip(null)
                              setAgentMode("plan")
                              setModeDropdownOpen(false)
                            }}
                            className="justify-between gap-2"
                            onMouseEnter={(e) => {
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              const rect = e.currentTarget.getBoundingClientRect()
                              const showTooltip = () => {
                                setModeTooltip({
                                  visible: true,
                                  position: {
                                    top: rect.top,
                                    left: rect.right + 8,
                                  },
                                  mode: "plan",
                                })
                                hasShownTooltipRef.current = true
                                tooltipTimeoutRef.current = null
                              }
                              if (hasShownTooltipRef.current) {
                                showTooltip()
                              } else {
                                tooltipTimeoutRef.current = setTimeout(
                                  showTooltip,
                                  1000,
                                )
                              }
                            }}
                            onMouseLeave={() => {
                              if (tooltipTimeoutRef.current) {
                                clearTimeout(tooltipTimeoutRef.current)
                                tooltipTimeoutRef.current = null
                              }
                              setModeTooltip(null)
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <PlanIcon className="w-4 h-4 text-muted-foreground" />
                              <span>Plan</span>
                            </div>
                            {agentMode === "plan" && (
                              <CheckIcon className="h-3.5 w-3.5 ml-auto shrink-0" />
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                        {modeTooltip?.visible &&
                          createPortal(
                            <div
                              className="fixed z-100000"
                              style={{
                                top: modeTooltip.position.top + 14,
                                left: modeTooltip.position.left,
                                transform: "translateY(-50%)",
                              }}
                            >
                              <div
                                data-tooltip="true"
                                className="relative rounded-[12px] bg-popover px-2.5 py-1.5 text-xs text-popover-foreground dark max-w-[150px]"
                              >
                                <span>
                                  {modeTooltip.mode === "agent"
                                    ? "Apply changes directly without a plan"
                                    : "Create a plan before making changes"}
                                </span>
                              </div>
                            </div>,
                            document.body,
                          )}
                      </DropdownMenu>

                      {/* Model selector - shows Ollama models when offline, Claude models when online */}
                      {availableModels.isOffline && availableModels.hasOllama ? (
                        // Offline mode: show Ollama model selector
                        <DropdownMenu
                          open={isModelDropdownOpen}
                          onOpenChange={setIsModelDropdownOpen}
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              className="flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground hover:text-foreground transition-[background-color,color] duration-150 ease-out rounded-md hover:bg-muted/50 outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70 border border-border"
                            >
                              <Zap className="h-4 w-4" />
                              <span>{currentOllamaModel || "Select model"}</span>
                              <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-[240px]">
                            {availableModels.ollamaModels.map((model) => {
                              const isSelected = model === currentOllamaModel
                              const isRecommended = model === availableModels.recommendedModel
                              return (
                                <DropdownMenuItem
                                  key={model}
                                  onClick={() => setSelectedOllamaModel(model)}
                                  className="gap-2 justify-between"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span>
                                      {model}
                                      {isRecommended && (
                                        <span className="text-muted-foreground ml-1">(recommended)</span>
                                      )}
                                    </span>
                                  </div>
                                  {isSelected && (
                                    <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                                  )}
                                </DropdownMenuItem>
                              )
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        // Online mode: show Claude model selector
                        <DropdownMenu
                          open={hasCustomClaudeConfig ? false : isModelDropdownOpen}
                          onOpenChange={(open) => {
                            if (!hasCustomClaudeConfig) {
                              setIsModelDropdownOpen(open)
                            }
                          }}
                        >
                          <DropdownMenuTrigger asChild>
                            <button
                              disabled={hasCustomClaudeConfig}
                              className={cn(
                                "flex items-center gap-1.5 px-2 py-1 text-sm text-muted-foreground transition-[background-color,color] duration-150 ease-out rounded-md outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70",
                                hasCustomClaudeConfig
                                  ? "opacity-70 cursor-not-allowed"
                                  : "hover:text-foreground hover:bg-muted/50",
                              )}
                            >
                              <ClaudeCodeIcon className="h-3.5 w-3.5" />
                              <span>
                                {hasCustomClaudeConfig ? (
                                  "Custom Model"
                                ) : (
                                  <>
                                    {selectedModel?.name}{" "}
                                    <span className="text-muted-foreground">4.5</span>
                                  </>
                                )}
                              </span>
                              <IconChevronDown className="h-3 w-3 shrink-0 opacity-50" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-[200px]">
                            {availableModels.models.map((model) => {
                              const isSelected = selectedModel?.id === model.id
                              return (
                                <DropdownMenuItem
                                  key={model.id}
                                  onClick={() => {
                                    setSelectedModel(model)
                                    setLastSelectedModelId(model.id)
                                  }}
                                  className="gap-2 justify-between"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <ClaudeCodeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                    <span>
                                      {model.name}{" "}
                                      <span className="text-muted-foreground">4.5</span>
                                    </span>
                                  </div>
                                  {isSelected && (
                                    <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                                  )}
                                </DropdownMenuItem>
                              )
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>

                    <div className="flex items-center gap-0.5 ml-auto shrink-0">
                      {/* Hidden file input */}
                      <input
                        type="file"
                        ref={fileInputRef}
                        hidden
                        multiple
                        onChange={(e) => {
                          const inputFiles = Array.from(e.target.files || [])
                          handleAddAttachments(inputFiles)
                          e.target.value = "" // Reset to allow same file selection
                        }}
                      />
                      {/* Voice wave indicator or Attachment button */}
                      {isVoiceRecording ? (
                        <VoiceWaveIndicator isRecording={isVoiceRecording} audioLevel={voiceAudioLevel} />
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 rounded-sm outline-offset-2 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-ring/70"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={images.length >= 5 && files.length >= 10}
                        >
                          <AttachIcon className="h-4 w-4" />
                        </Button>
                      )}
                      <div className="ml-1">
                        <AgentSendButton
                          isStreaming={false}
                          isSubmitting={
                            createChatMutation.isPending || isUploading || pullStatus !== null
                          }
                          disabled={Boolean(
                            !hasContent || (!selectedProject && currentProjectMode !== "chat") || isUploading || pullStatus !== null,
                          )}
                          onClick={handleSend}
                          mode={agentMode}
                          hasContent={hasContent}
                          showVoiceInput={isVoiceAvailable}
                          isRecording={isVoiceRecording}
                          isTranscribing={isTranscribing}
                          onVoiceMouseDown={handleVoiceMouseDown}
                          onVoiceMouseUp={handleVoiceMouseUp}
                          onVoiceMouseLeave={handleVoiceMouseLeave}
                        />
                      </div>
                    </div>
                  </PromptInputActions>
                </PromptInput>

                {/* Project and Branch Mode selectors - directly under input (hidden in chat mode) */}
                {currentProjectMode !== "chat" && (
                  <div className="mt-1.5 md:mt-2 ml-[5px] flex items-center gap-2">
                    <ProjectSelector />

                    {/* Combined branch mode selector (only in coding mode) */}
                    {validatedProject && currentProjectMode === "coding" && (
                      <BranchModeSelector
                        workMode={workMode}
                        onWorkModeChange={setWorkMode}
                        selectedBranch={selectedBranch}
                        selectedBranchType={selectedBranchType}
                        onBranchChange={setSelectedBranch}
                        customBranchName={customBranchName}
                        onCustomBranchNameChange={handleCustomBranchNameChange}
                        branchNameError={branchNameError}
                        branches={branches}
                        defaultBranch={branchesQuery.data?.defaultBranch || "main"}
                        isLoading={branchesQuery.isLoading}
                        disabled={createChatMutation.isPending || pullStatus !== null}
                      />
                    )}

                    {/* Pull status indicator */}
                    {pullStatus && (
                      <span className="text-sm text-muted-foreground animate-[pulse_1.5s_ease-in-out_infinite]">
                        {pullStatus}
                      </span>
                    )}
                  </div>
                )}

                {/* Worktree config banner - moved to corner banner below */}

                {/* File mention dropdown */}
                {/* Desktop: use projectPath for local file search */}
                <AgentsFileMention
                  isOpen={showMentionDropdown && !!validatedProject}
                  onClose={() => {
                    setShowMentionDropdown(false)
                    // Reset subpage state when dropdown closes
                    setShowingFilesList(false)
                    setShowingSkillsList(false)
                    setShowingAgentsList(false)
                    setShowingToolsList(false)
                  }}
                  onSelect={handleMentionSelect}
                  searchText={mentionSearchText}
                  position={mentionPosition}
                  projectPath={validatedProject?.path}
                  showingFilesList={showingFilesList}
                  showingSkillsList={showingSkillsList}
                  showingAgentsList={showingAgentsList}
                  showingToolsList={showingToolsList}
                />

                {/* Slash command dropdown */}
                <AgentsSlashCommand
                  isOpen={showSlashDropdown}
                  onClose={handleCloseSlashTrigger}
                  onSelect={handleSlashSelect}
                  searchText={slashSearchText}
                  position={slashPosition}
                  projectPath={validatedProject?.path}
                  mode={agentMode}
                  disabledCommands={["clear"]}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Pull failed confirmation dialog */}
      <Dialog
        open={pullFailedDialog?.open ?? false}
        onOpenChange={(open) => {
          if (!open) {
            pullFailedDialog?.resolve?.(false)
            setPullFailedDialog(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Failed to pull latest changes</DialogTitle>
            <DialogDescription>
              {pullFailedDialog?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                pullFailedDialog?.resolve?.(false)
                setPullFailedDialog(null)
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                pullFailedDialog?.resolve?.(true)
                setPullFailedDialog(null)
              }}
            >
              Continue anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
