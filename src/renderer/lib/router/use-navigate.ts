import { useCallback, useRef } from "react"
import { useSetAtom } from "jotai"
import { currentRouteAtom, scrollTargetAtom } from "./atoms"
import type { NavigationRoute } from "./types"
import { SCROLL_TO_BOTTOM } from "./types"
import {
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  desktopViewAtom,
  selectedProjectAtom,
  showNewChatFormAtom,
} from "../../features/agents/atoms"
import { chatSourceModeAtom } from "../atoms"
import { useAgentSubChatStore } from "../../features/agents/stores/sub-chat-store"
import { trpc } from "../trpc"
import { agentChatStore } from "../../features/agents/stores/agent-chat-store"

/**
 * Core navigation hook for the memory router.
 *
 * Coordinates Jotai atoms, Zustand store, and tRPC to navigate
 * to any chat/subChat/message — including archived content.
 */
export function useNavigate() {
  const setRoute = useSetAtom(currentRouteAtom)
  const setScrollTarget = useSetAtom(scrollTargetAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const setSelectedProject = useSetAtom(selectedProjectAtom)
  const setChatSourceMode = useSetAtom(chatSourceModeAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const { addToOpenSubChats, setActiveSubChat, setChatId } =
    useAgentSubChatStore()
  const utils = trpc.useUtils()

  // Guard against stale async project resolution when navigating rapidly
  const navigationVersionRef = useRef(0)

  const navigateTo = useCallback(
    async (route: NavigationRoute) => {
      const version = ++navigationVersionRef.current

      // 1. Switch to chat view (clear automations/settings/home/new-chat-form)
      setDesktopView(null)
      setShowNewChatForm(false)

      // 2. Set chat ID (triggers chat data loading)
      setSelectedChatId(route.chatId)
      setSelectedChatIsRemote(false)
      setChatSourceMode("local")

      // 2.5. Update Zustand store's chatId BEFORE calling addToOpenSubChats/setActiveSubChat
      // This ensures localStorage is saved with the correct chatId key.
      // Previously, we avoided calling setChatId here to prevent race conditions with
      // active-chat.tsx's useEffect, but that caused addToOpenSubChats/setActiveSubChat
      // to save to the wrong localStorage key (old chatId).
      //
      // The fix is to call setChatId here, and active-chat.tsx's useEffect will detect
      // that chatId is already correct (isNewChat = false) and skip redundant initialization.
      const store = useAgentSubChatStore.getState()
      if (store.chatId !== route.chatId) {
        // Clear old Chat objects from cache before switching
        const oldOpenIds = store.openSubChatIds
        for (const oldId of oldOpenIds) {
          agentChatStore.delete(oldId)
        }
        setChatId(route.chatId)
      }

      // 3. Resolve project from chat data and sync selectedProject
      try {
        const chatData = await utils.chats.get.fetch({ id: route.chatId })
        // Bail if a newer navigation has started while we were awaiting
        if (navigationVersionRef.current !== version) return
        if (chatData?.project) {
          const p = chatData.project
          setSelectedProject({
            id: p.id,
            name: p.name,
            path: p.path,
            gitRemoteUrl: p.gitRemoteUrl,
            gitProvider: p.gitProvider as "github" | "gitlab" | "bitbucket" | null,
            gitOwner: p.gitOwner,
            gitRepo: p.gitRepo,
            mode: p.mode as "chat" | "cowork" | "coding",
            featureConfig: p.featureConfig,
            isPlayground: p.isPlayground ?? false,
          })
        }
      } catch (e) {
        console.warn("[MemoryRouter] Failed to resolve project for chat:", route.chatId, e)
      }

      // 5. Open and activate subChat tab if specified
      if (route.subChatId) {
        addToOpenSubChats(route.subChatId)
        setActiveSubChat(route.subChatId)
      }

      // 6. Set scroll target
      // - If messageId specified: scroll to that message after loading
      // - If subChatId specified (no messageId): scroll to bottom of chat
      // This unifies all scroll behavior through routing
      if (route.messageId) {
        setScrollTarget({
          messageId: route.messageId,
          highlight: route.highlight,
          consumed: false,
        })
      } else if (route.subChatId) {
        // No specific message - scroll to bottom after content loads
        setScrollTarget({
          messageId: SCROLL_TO_BOTTOM,
          consumed: false,
        })
      }

      // 7. Update current route
      setRoute(route)
    },
    [
      setDesktopView,
      setShowNewChatForm,
      setSelectedChatId,
      setSelectedChatIsRemote,
      setChatSourceMode,
      setChatId,
      utils.chats.get,
      setSelectedProject,
      addToOpenSubChats,
      setActiveSubChat,
      setScrollTarget,
      setRoute,
    ],
  )

  const navigateToChat = useCallback(
    (chatId: string) => navigateTo({ chatId, timestamp: Date.now() }),
    [navigateTo],
  )

  const navigateToSubChat = useCallback(
    (chatId: string, subChatId: string) =>
      navigateTo({ chatId, subChatId, timestamp: Date.now() }),
    [navigateTo],
  )

  const navigateToMessage = useCallback(
    (
      chatId: string,
      subChatId: string,
      messageId: string,
      highlight?: string,
    ) =>
      navigateTo({
        chatId,
        subChatId,
        messageId,
        highlight,
        timestamp: Date.now(),
      }),
    [navigateTo],
  )

  return { navigateTo, navigateToChat, navigateToSubChat, navigateToMessage }
}
