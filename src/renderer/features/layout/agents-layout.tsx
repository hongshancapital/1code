import { useCallback, useEffect, useState, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { isDesktopApp } from "../../lib/utils/platform"
import { useIsMobile } from "../../lib/hooks/use-mobile"
import { login as sensorsLogin } from "../../lib/sensors-analytics"

import {
  agentsSidebarOpenAtom,
  agentsSidebarWidthAtom,
  agentsSettingsDialogActiveTabAtom,
  isDesktopAtom,
  isFullscreenAtom,
  anthropicOnboardingCompletedAtom,
  authSkippedAtom,
  customHotkeysAtom,
} from "../../lib/atoms"
import {
  setTrafficLightRequestAtom,
  removeTrafficLightRequestAtom,
  TRAFFIC_LIGHT_PRIORITIES,
} from "../../lib/atoms/traffic-light"
import { selectedAgentChatIdAtom, selectedProjectAtom, selectedDraftIdAtom, showNewChatFormAtom, currentProjectModeAtom, enabledWidgetsAtom, desktopViewAtom, fileSearchDialogOpenAtom, subChatStatusStorageAtom, markSubChatCommitted } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { useAgentsHotkeys } from "../agents/lib/agents-hotkeys-manager"
import { toggleSearchAtom } from "../agents/search"
import { ClaudeLoginModal } from "../../components/dialogs/claude-login-modal"
import { TooltipProvider } from "../../components/ui/tooltip"
import { ResizableSidebar } from "../../components/ui/resizable-sidebar"
import { AgentsSidebar } from "../sidebar/agents-sidebar"
import { AgentsContent } from "../agents/ui/agents-content"
import { WindowsTitleBar } from "../../components/windows-title-bar"
import { useTasksIdleNotifier } from "../../lib/hooks/use-tasks-idle-notifier"
import { useAgentSubChatStore } from "../agents/stores/sub-chat-store"
import { QueueProcessor } from "../agents/components/queue-processor"
import { useArtifactsListener } from "../cowork/use-artifacts-listener"
import { FilePreviewDialog } from "../cowork/file-preview"
import { computeEnabledWidgets, parseFeatureConfig } from "../../../shared/feature-config"
import { SettingsSidebar } from "../settings/settings-sidebar"
import { GlobalSearchDialog } from "../../components/dialogs/global-search-dialog"

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 300
const SIDEBAR_ANIMATION_DURATION = 0
const SIDEBAR_CLOSE_HOTKEY = "⌘\\"

// ============================================================================
// Component
// ============================================================================

export function AgentsLayout() {
  // No useHydrateAtoms - desktop doesn't need SSR, atomWithStorage handles persistence
  const isMobile = useIsMobile()

  // Global desktop/fullscreen state - initialized here at root level
  const [isDesktop, setIsDesktop] = useAtom(isDesktopAtom)
  const [, setIsFullscreen] = useAtom(isFullscreenAtom)

  // Initialize isDesktop on mount
  useEffect(() => {
    setIsDesktop(isDesktopApp())
  }, [setIsDesktop])

  // Subscribe to fullscreen changes from Electron
  useEffect(() => {
    if (
      !isDesktop ||
      typeof window === "undefined" ||
      !window.desktopApi?.windowIsFullscreen
    )
      return

    // Get initial fullscreen state
    window.desktopApi.windowIsFullscreen().then(setIsFullscreen)

    // In dev mode, HMR breaks IPC event subscriptions, so we poll instead
    const isDev = import.meta.env.DEV
    if (isDev) {
      const interval = setInterval(() => {
        window.desktopApi?.windowIsFullscreen?.().then(setIsFullscreen)
      }, 300)
      return () => clearInterval(interval)
    }

    // In production, use events (more efficient)
    const unsubscribe = window.desktopApi.onFullscreenChange?.(setIsFullscreen)
    return unsubscribe
  }, [isDesktop, setIsFullscreen])

  // Notify main process when all tasks become idle
  useTasksIdleNotifier()

  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const desktopView = useAtomValue(desktopViewAtom)
  const setFileSearchDialogOpen = useSetAtom(fileSearchDialogOpenAtom)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(
    anthropicOnboardingCompletedAtom
  )
  const isAuthSkipped = useAtomValue(authSkippedAtom)

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Validated project - only valid if exists in DB
  // While loading, trust localStorage value to prevent clearing on app restart
  // Playground projects are always trusted (they're not in the regular list)
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // Playground projects are always valid (they're managed separately)
    if (selectedProject.isPlayground) return selectedProject
    // While loading, trust localStorage value to prevent flicker and clearing
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  // Clear invalid project from storage (only after loading completes)
  // Skip clearing for playground projects (they're managed separately)
  useEffect(() => {
    if (
      selectedProject &&
      !selectedProject.isPlayground &&
      projects &&
      !isLoadingProjects &&
      !validatedProject
    ) {
      setSelectedProject(null)
    }
  }, [
    selectedProject,
    projects,
    isLoadingProjects,
    validatedProject,
    setSelectedProject,
  ])

  // Show/hide native traffic lights based on sidebar state
  const setTrafficLightRequest = useSetAtom(setTrafficLightRequestAtom)
  const removeTrafficLightRequest = useSetAtom(removeTrafficLightRequestAtom)

  useEffect(() => {
    if (!isDesktop) return

    setTrafficLightRequest({
      requester: "sidebar",
      visible: sidebarOpen,
      priority: TRAFFIC_LIGHT_PRIORITIES.SIDEBAR,
    })

    return () => removeTrafficLightRequest("sidebar")
  }, [sidebarOpen, isDesktop, setTrafficLightRequest, removeTrafficLightRequest])

  const setChatId = useAgentSubChatStore((state) => state.setChatId)

  // Desktop user state
  const [desktopUser, setDesktopUser] = useState<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>(null)

  // Fetch desktop user on mount
  useEffect(() => {
    async function fetchUser() {
      if (window.desktopApi?.getUser) {
        const user = await window.desktopApi.getUser()
        console.log("[UI] Got desktop user:", user?.id, "imageUrl:", user?.imageUrl)
        setDesktopUser(user)
      }
    }
    fetchUser()
  }, [])

  // Listen for auth success to update user info (e.g., after login with avatar)
  useEffect(() => {
    if (!window.desktopApi?.onAuthSuccess) return

    const unsubscribe = window.desktopApi.onAuthSuccess(async (user) => {
      // 登录成功后调用 sensors login 合并匿名数据
      if (user?.email) {
        sensorsLogin(user.email)
      }
      // Fetch full user info after auth success to get latest imageUrl
      if (window.desktopApi?.getUser) {
        const fullUser = await window.desktopApi.getUser()
        setDesktopUser(fullUser)
      } else {
        setDesktopUser(user)
      }
    })

    return () => unsubscribe()
  }, [])

  // Listen for git commit success events to mark subchat as committed
  const setSubChatStatus = useSetAtom(subChatStatusStorageAtom)
  useEffect(() => {
    if (!window.desktopApi?.onGitCommitSuccess) return

    const unsubscribe = window.desktopApi.onGitCommitSuccess((data) => {
      console.log("[Layout] Git commit success:", data)
      markSubChatCommitted(setSubChatStatus, data.subChatId, data.commitHash, data.branchInfo)
    })

    return () => unsubscribe()
  }, [setSubChatStatus])

  // Track if this is the initial load - skip auto-open on first load to respect saved state
  const isInitialLoadRef = useRef(true)

  // Get current project mode
  const currentProjectMode = useAtomValue(currentProjectModeAtom)

  // Auto-open sidebar when project is selected, close when no project
  // Only react to validatedProject changes, not mode changes
  // Skip on initial load to preserve user's saved sidebar preference
  const prevProjectRef = useRef<typeof validatedProject>(undefined)
  useEffect(() => {
    if (!projects) return // Don't change sidebar state while loading

    // On initial load, just mark as loaded and don't change sidebar state
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      prevProjectRef.current = validatedProject
      return
    }

    // Only react when validatedProject actually changes (not on mode change)
    if (prevProjectRef.current === validatedProject) {
      return
    }
    prevProjectRef.current = validatedProject

    // Chat mode: don't auto-control sidebar based on project state
    if (currentProjectMode === "chat") {
      return
    }

    // After initial load, react to project changes (cowork/coding only)
    if (validatedProject) {
      setSidebarOpen(true)
    } else {
      setSidebarOpen(false)
    }
  }, [validatedProject, projects, setSidebarOpen, currentProjectMode])

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    // Clear selected project and anthropic onboarding on logout
    setSelectedProject(null)
    setSelectedChatId(null)
    setAnthropicOnboardingCompleted(false)
    if (window.desktopApi?.logout) {
      await window.desktopApi.logout()
    }
  }, [setSelectedProject, setSelectedChatId, setAnthropicOnboardingCompleted])

  // Clear sub-chat store when no chat is selected.
  // Initialization for non-null chatId is handled by navigateToChat() and
  // active-chat.tsx's init effect — we only need cleanup here.
  useEffect(() => {
    if (!selectedChatId) {
      console.log('[agents-layout] selectedChatId is null, clearing sub-chat store')
      setChatId(null)
    }
  }, [selectedChatId, setChatId])

  // Chat search toggle
  const toggleChatSearch = useSetAtom(toggleSearchAtom)

  // Custom hotkeys config
  const customHotkeysConfig = useAtomValue(customHotkeysAtom)

  // Initialize hotkeys manager
  useAgentsHotkeys({
    setSelectedChatId,
    setSelectedDraftId,
    setShowNewChatForm,
    setDesktopView,
    setSidebarOpen,
    setSettingsActiveTab,
    setFileSearchDialogOpen,
    toggleChatSearch,
    selectedChatId,
    customHotkeysConfig,
  })

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [setSidebarOpen])

  // Get project mode and enabled features
  const projectMode = useAtomValue(currentProjectModeAtom)
  const setCurrentProjectMode = useSetAtom(currentProjectModeAtom)
  const featureConfig = useMemo(
    () => parseFeatureConfig(selectedProject?.featureConfig),
    [selectedProject?.featureConfig]
  )
  const enabledWidgets = useMemo(
    () => computeEnabledWidgets(projectMode, featureConfig),
    [projectMode, featureConfig]
  )

  // Sync currentProjectModeAtom when validatedProject changes
  // This handles app startup (localStorage restore) and other project setters
  // Don't override mode if no project is selected (keep default "chat" mode)
  useEffect(() => {
    if (validatedProject?.mode) {
      setCurrentProjectMode(validatedProject.mode as "chat" | "cowork" | "coding")
    }
  }, [validatedProject?.mode, setCurrentProjectMode])

  // Sync enabledWidgets to atom for DetailsSidebar and WidgetSettingsPopup
  const setEnabledWidgets = useSetAtom(enabledWidgetsAtom)
  useEffect(() => {
    setEnabledWidgets(enabledWidgets)
  }, [enabledWidgets, setEnabledWidgets])

  // Listen for file changes when artifacts feature is enabled
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  useArtifactsListener(enabledWidgets.has("artifacts") ? activeSubChatId : null)

  const isSettingsView = desktopView === "settings"

  return (
    <TooltipProvider delayDuration={300}>
      {/* Global queue processor - handles message queues for all sub-chats */}
      <QueueProcessor />
      <ClaudeLoginModal />
      {/* File Preview Dialog - shown when artifacts feature is enabled */}
      {enabledWidgets.has("artifacts") && <FilePreviewDialog />}
      <div className="flex flex-col w-full h-full relative overflow-hidden bg-background select-none">
        {/* Windows Title Bar (only shown on Windows with frameless window) */}
        <WindowsTitleBar />
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - switches between chat list and settings nav */}
          <ResizableSidebar
          isOpen={!isMobile && sidebarOpen}
          onClose={handleCloseSidebar}
          widthAtom={agentsSidebarWidthAtom}
          minWidth={SIDEBAR_MIN_WIDTH}
          maxWidth={SIDEBAR_MAX_WIDTH}
          side="left"
          closeHotkey={SIDEBAR_CLOSE_HOTKEY}
          animationDuration={SIDEBAR_ANIMATION_DURATION}
          initialWidth={0}
          exitWidth={0}
          showResizeTooltip={!isSettingsView}
          className="overflow-hidden bg-background border-r"
          style={{ borderRightWidth: "0.5px" }}
        >
          {isSettingsView ? (
            <SettingsSidebar />
          ) : (
            <AgentsSidebar
              desktopUser={desktopUser}
              isAuthSkipped={isAuthSkipped}
              onSignOut={handleSignOut}
              onToggleSidebar={handleCloseSidebar}
            />
          )}
        </ResizableSidebar>

          {/* Main Content */}
          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            <AgentsContent />
          </div>
        </div>

        {/* Global Search Dialog (Cmd+K) */}
        <GlobalSearchDialog />
      </div>
    </TooltipProvider>
  )
}
