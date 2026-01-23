"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  selectedAgentChatIdAtom,
  previousAgentChatIdAtom,
  agentsMobileViewModeAtom,
  agentsSidebarOpenAtom,
  agentsSubChatsSidebarModeAtom,
  agentsSubChatsSidebarWidthAtom,
} from "../agents/atoms"
import { selectedTeamIdAtom } from "../../lib/atoms"
import { NewChatForm } from "../agents/main/new-chat-form"
import { ChatView } from "../agents/main/active-chat"
import { CoworkChatView } from "./cowork-chat-view"
import { api } from "../../lib/mock-api"
import { trpc } from "../../lib/trpc"
import { useIsMobile } from "../../lib/hooks/use-mobile"
import { AgentsSubChatsSidebar } from "../sidebar/agents-subchats-sidebar"
import {
  useAgentSubChatStore,
  type SubChatMeta,
} from "../agents/stores/sub-chat-store"
import { useShallow } from "zustand/react/shallow"
import { ResizableSidebar } from "../../components/ui/resizable-sidebar"

// Mocks for unused features
const useSearchParams = () => ({ get: () => null })
const useRouter = () => ({ push: () => {}, replace: () => {} })
const useUser = () => ({ user: null })
const useClerk = () => ({ signOut: () => {} })
const useCombinedAuth = () => ({ userId: null })

// ============================================================================
// Types
// ============================================================================

interface CoworkContentProps {
  onToggleRightPanel: () => void
  rightPanelOpen: boolean
}

// ============================================================================
// Component
// ============================================================================

export function CoworkContent({
  onToggleRightPanel,
  rightPanelOpen,
}: CoworkContentProps) {
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const [selectedTeamId] = useAtom(selectedTeamIdAtom)
  const [sidebarOpen, setSidebarOpen] = useAtom(agentsSidebarOpenAtom)
  const [mobileViewMode, setMobileViewMode] = useAtom(agentsMobileViewModeAtom)
  const [subChatsSidebarMode, setSubChatsSidebarMode] = useAtom(
    agentsSubChatsSidebarModeAtom
  )

  const hasOpenedSubChatsSidebar = useRef(false)
  const wasSubChatsSidebarOpen = useRef(false)
  const [shouldAnimateSubChatsSidebar, setShouldAnimateSubChatsSidebar] =
    useState(subChatsSidebarMode !== "sidebar")
  const isInitialized = useRef(false)
  const newChatFormKeyRef = useRef(0)
  const isMobile = useIsMobile()
  const [isHydrated, setIsHydrated] = useState(false)
  const { userId } = useCombinedAuth()

  // Get sub-chats from store
  const { allSubChats, openSubChatIds, activeSubChatId, setActiveSubChat } =
    useAgentSubChatStore(
      useShallow((state) => ({
        allSubChats: state.allSubChats,
        openSubChatIds: state.openSubChatIds,
        activeSubChatId: state.activeSubChatId,
        setActiveSubChat: state.setActiveSubChat,
      }))
    )

  // Fetch teams for header (minimal)
  const { data: teams } = api.teams.getUserTeams.useQuery()
  const selectedTeam = teams?.find((t: any) => t.id === selectedTeamId) as any

  // Fetch current chat data
  const { data: chatData } = api.agents.getAgentChat.useQuery(
    { chatId: selectedChatId! },
    { enabled: !!selectedChatId }
  )

  // Track previous chat ID
  const [previousChatId, setPreviousChatId] = useAtom(previousAgentChatIdAtom)
  const prevSelectedChatIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (
      prevSelectedChatIdRef.current &&
      prevSelectedChatIdRef.current !== selectedChatId
    ) {
      setPreviousChatId(prevSelectedChatIdRef.current)
    }
    prevSelectedChatIdRef.current = selectedChatId
  }, [selectedChatId, setPreviousChatId])

  // Track hydration
  useEffect(() => {
    setIsHydrated(true)
  }, [])

  // Check if sub-chats data is loaded
  const subChatsStoreChatId = useAgentSubChatStore((state) => state.chatId)
  const subChatsCount = useAgentSubChatStore(
    (state) => state.allSubChats.length
  )

  const isLoadingSubChats =
    selectedChatId !== null &&
    (subChatsStoreChatId !== selectedChatId || subChatsCount === 0)

  // Track sub-chats sidebar open state
  const isSubChatsSidebarOpen =
    selectedChatId && subChatsSidebarMode === "sidebar" && !isMobile

  useEffect(() => {
    if (!isSubChatsSidebarOpen && wasSubChatsSidebarOpen.current) {
      hasOpenedSubChatsSidebar.current = false
      setShouldAnimateSubChatsSidebar(true)
    }
    wasSubChatsSidebarOpen.current = !!isSubChatsSidebarOpen

    if (isSubChatsSidebarOpen && !hasOpenedSubChatsSidebar.current) {
      const timer = setTimeout(() => {
        hasOpenedSubChatsSidebar.current = true
        setShouldAnimateSubChatsSidebar(false)
      }, 150 + 50)
      return () => clearTimeout(timer)
    } else if (isSubChatsSidebarOpen && hasOpenedSubChatsSidebar.current) {
      setShouldAnimateSubChatsSidebar(false)
    }
  }, [isSubChatsSidebarOpen])

  // Mobile layout - simplified (no preview, diff, terminal)
  if (isMobile) {
    return (
      <div
        className="flex h-full bg-background"
        data-agents-page
        data-mobile-view
      >
        {mobileViewMode === "chats" ? (
          <div className="h-full w-full flex flex-col overflow-hidden">
            <div className="text-center text-muted-foreground p-4">
              请使用桌面端
            </div>
          </div>
        ) : (
          <div
            className="h-full w-full flex flex-col overflow-hidden select-text"
            data-mobile-chat-mode
          >
            {selectedChatId ? (
              <ChatView
                key={selectedChatId}
                chatId={selectedChatId}
                isSidebarOpen={false}
                onToggleSidebar={() => {}}
                selectedTeamName={selectedTeam?.name}
                selectedTeamImageUrl={selectedTeam?.image_url}
                isMobileFullscreen={true}
                onBackToChats={() => {
                  setMobileViewMode("chats")
                  setSelectedChatId(null)
                }}
              />
            ) : (
              <div className="h-full flex flex-col relative overflow-hidden">
                <NewChatForm
                  isMobileFullscreen={true}
                  onBackToChats={() => setMobileViewMode("chats")}
                />
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Desktop layout - simplified (no Git/Diff/Terminal sidebars)
  return (
    <>
      <div className="flex h-full">
        {/* Sub-chats sidebar - only show in sidebar mode */}
        <ResizableSidebar
          isOpen={!!isSubChatsSidebarOpen}
          onClose={() => {
            setShouldAnimateSubChatsSidebar(true)
            setSubChatsSidebarMode("tabs")
          }}
          widthAtom={agentsSubChatsSidebarWidthAtom}
          minWidth={160}
          maxWidth={300}
          side="left"
          animationDuration={0}
          initialWidth={0}
          exitWidth={0}
          disableClickToClose={true}
        >
          <AgentsSubChatsSidebar
            onClose={() => {
              setShouldAnimateSubChatsSidebar(true)
              setSubChatsSidebarMode("tabs")
            }}
            isMobile={isMobile}
            isSidebarOpen={sidebarOpen}
            onBackToChats={() => setSidebarOpen((prev) => !prev)}
            isLoading={isLoadingSubChats}
            agentName={chatData?.name ?? undefined}
          />
        </ResizableSidebar>

        {/* Main content */}
        <div
          className="flex-1 min-w-0 overflow-hidden flex flex-col"
          style={{ minWidth: "400px" }}
        >
          {/* Chat content */}
          <div className="flex-1 overflow-hidden">
            {selectedChatId ? (
              <CoworkChatView
                key={selectedChatId}
                chatId={selectedChatId}
                isSidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
                selectedTeamName={selectedTeam?.name}
                selectedTeamImageUrl={selectedTeam?.image_url}
                rightPanelOpen={rightPanelOpen}
                onToggleRightPanel={onToggleRightPanel}
              />
            ) : (
              <div className="h-full flex flex-col relative overflow-hidden">
                <NewChatForm key={`new-chat-${newChatFormKeyRef.current}`} />
                {/* No right panel button on start page - panel only shows in chat */}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
