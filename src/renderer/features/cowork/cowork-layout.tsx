import { useCallback, useEffect, useState, useMemo, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { isDesktopApp } from "../../lib/utils/platform"
import { useIsMobile } from "../../lib/hooks/use-mobile"

import {
  agentsSidebarOpenAtom,
  agentsSidebarWidthAtom,
  agentsSettingsDialogOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  isDesktopAtom,
  isFullscreenAtom,
  anthropicOnboardingCompletedAtom,
  customHotkeysAtom,
} from "../../lib/atoms"
import { selectedAgentChatIdAtom, selectedProjectAtom } from "../agents/atoms"
import { trpc } from "../../lib/trpc"
import { useAgentsHotkeys } from "../agents/lib/agents-hotkeys-manager"
import { toggleSearchAtom } from "../agents/search"
import { AgentsSettingsDialog } from "../../components/dialogs/agents-settings-dialog"
import { ClaudeLoginModal } from "../../components/dialogs/claude-login-modal"
import { TooltipProvider } from "../../components/ui/tooltip"
import { ResizableSidebar } from "../../components/ui/resizable-sidebar"
import { AgentsSidebar } from "../sidebar/agents-sidebar"
import { UpdateBanner } from "../../components/update-banner"
import { WindowsTitleBar } from "../../components/windows-title-bar"
import { useUpdateChecker } from "../../lib/hooks/use-update-checker"
import { useAgentSubChatStore } from "../../lib/stores/sub-chat-store"
import { QueueProcessor } from "../agents/components/queue-processor"

import {
  coworkRightPanelWidthAtom,
  coworkRightPanelOpenAtom,
} from "./atoms"
import { CoworkRightPanel } from "./cowork-right-panel"
import { CoworkContent } from "./cowork-content"
import { useArtifactsListener } from "./use-artifacts-listener"
import { FilePreviewDialog } from "./file-preview"

// ============================================================================
// Constants
// ============================================================================

const SIDEBAR_MIN_WIDTH = 160
const SIDEBAR_MAX_WIDTH = 300
const SIDEBAR_ANIMATION_DURATION = 0
const SIDEBAR_CLOSE_HOTKEY = "⌘\\"

const RIGHT_PANEL_MIN_WIDTH = 240
const RIGHT_PANEL_MAX_WIDTH = 500

// ============================================================================
// Component
// ============================================================================

export function CoworkLayout() {
  const isMobile = useIsMobile()

  // Global desktop/fullscreen state
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

    window.desktopApi.windowIsFullscreen().then(setIsFullscreen)

    const isDev = import.meta.env.DEV
    if (isDev) {
      const interval = setInterval(() => {
        window.desktopApi?.windowIsFullscreen?.().then(setIsFullscreen)
      }, 300)
      return () => clearInterval(interval)
    }

    const unsubscribe = window.desktopApi.onFullscreenChange?.(setIsFullscreen)
    return unsubscribe
  }, [isDesktop, setIsFullscreen])

  // Check for updates
  useUpdateChecker()

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [settingsOpen, setSettingsOpen] = useAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)

  // Right panel state
  const [rightPanelOpen, setRightPanelOpen] = useAtom(coworkRightPanelOpenAtom)

  // Fetch projects
  const { data: projects, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Validated project
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    if (isLoadingProjects) return selectedProject
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  // Clear invalid project
  useEffect(() => {
    if (
      selectedProject &&
      projects &&
      !isLoadingProjects &&
      !validatedProject
    ) {
      setSelectedProject(null)
    }
  }, [selectedProject, projects, isLoadingProjects, validatedProject, setSelectedProject])

  // Hide native traffic lights when sidebar is closed
  useEffect(() => {
    if (!isDesktop) return
    if (typeof window === "undefined" || !window.desktopApi?.setTrafficLightVisibility) return
    if (!sidebarOpen) {
      window.desktopApi.setTrafficLightVisibility(false)
    }
  }, [sidebarOpen, isDesktop])

  const setChatId = useAgentSubChatStore((state) => state.setChatId)
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)

  // Listen for file changes from Claude tools and add to artifacts
  useArtifactsListener(activeSubChatId)

  // Desktop user state
  const [desktopUser, setDesktopUser] = useState<{
    id: string
    email: string
    name: string | null
    imageUrl: string | null
    username: string | null
  } | null>(null)

  useEffect(() => {
    async function fetchUser() {
      if (window.desktopApi?.getUser) {
        const user = await window.desktopApi.getUser()
        setDesktopUser(user)
      }
    }
    fetchUser()
  }, [])

  // Auto-open sidebar when project is selected
  const isInitialLoadRef = useRef(true)
  useEffect(() => {
    if (!projects) return
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false
      return
    }
    if (validatedProject) {
      setSidebarOpen(true)
    } else {
      setSidebarOpen(false)
    }
  }, [validatedProject, projects, setSidebarOpen])

  // Handle sign out
  const handleSignOut = useCallback(async () => {
    setSelectedProject(null)
    setSelectedChatId(null)
    setAnthropicOnboardingCompleted(false)
    if (window.desktopApi?.logout) {
      await window.desktopApi.logout()
    }
  }, [setSelectedProject, setSelectedChatId, setAnthropicOnboardingCompleted])

  // Initialize sub-chats when chat is selected
  useEffect(() => {
    if (selectedChatId) {
      setChatId(selectedChatId)
    } else {
      setChatId(null)
    }
  }, [selectedChatId, setChatId])

  // Chat search toggle
  const toggleChatSearch = useSetAtom(toggleSearchAtom)

  // Custom hotkeys
  const customHotkeysConfig = useAtomValue(customHotkeysAtom)

  // Initialize hotkeys
  useAgentsHotkeys({
    setSelectedChatId,
    setSidebarOpen,
    setSettingsDialogOpen: setSettingsOpen,
    setSettingsActiveTab,
    toggleChatSearch,
    selectedChatId,
    customHotkeysConfig,
  })

  const handleCloseSidebar = useCallback(() => {
    setSidebarOpen(false)
  }, [setSidebarOpen])

  const handleCloseRightPanel = useCallback(() => {
    setRightPanelOpen(false)
  }, [setRightPanelOpen])

  const handleToggleRightPanel = useCallback(() => {
    setRightPanelOpen((prev) => !prev)
  }, [setRightPanelOpen])

  return (
    <TooltipProvider delayDuration={300}>
      {/* Global queue processor */}
      <QueueProcessor />
      <AgentsSettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <ClaudeLoginModal />
      <FilePreviewDialog />

      <div className="flex flex-col w-full h-full relative overflow-hidden bg-background select-none">
        {/* Windows Title Bar */}
        <WindowsTitleBar />

        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar - Projects & Chats */}
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
            showResizeTooltip={true}
            className="overflow-hidden bg-background border-r"
            style={{ borderRightWidth: "0.5px" }}
          >
            <AgentsSidebar
              desktopUser={desktopUser ? {
                id: desktopUser.id,
                email: desktopUser.email,
                name: desktopUser.name ?? undefined,
              } : null}
              onSignOut={handleSignOut}
              onToggleSidebar={handleCloseSidebar}
            />
          </ResizableSidebar>

          {/* Main Content - Chat (simplified, no Git/Diff) */}
          <div className="flex-1 overflow-hidden flex flex-col min-w-0">
            <CoworkContent
              onToggleRightPanel={handleToggleRightPanel}
              rightPanelOpen={rightPanelOpen}
            />
          </div>

          {/* Right Panel - Tasks & Files */}
          <ResizableSidebar
            isOpen={!isMobile && rightPanelOpen}
            onClose={handleCloseRightPanel}
            widthAtom={coworkRightPanelWidthAtom}
            minWidth={RIGHT_PANEL_MIN_WIDTH}
            maxWidth={RIGHT_PANEL_MAX_WIDTH}
            side="right"
            closeHotkey="⌘]"
            animationDuration={SIDEBAR_ANIMATION_DURATION}
            initialWidth={0}
            exitWidth={0}
            showResizeTooltip={true}
            className="overflow-hidden bg-background border-l"
            style={{ borderLeftWidth: "0.5px" }}
          >
            <CoworkRightPanel />
          </ResizableSidebar>
        </div>

        {/* Update Banner */}
        <UpdateBanner />
      </div>
    </TooltipProvider>
  )
}
