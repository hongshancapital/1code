import { useCallback, useRef, startTransition } from "react"
import { useSetAtom } from "jotai"
import { currentRouteAtom, navigatedProjectIdAtom, scrollTargetAtom } from "./atoms"
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

// Module-level tracker for the last project ID set via navigation.
// We can't use appStore.get(selectedProjectAtom) because atomWithStorage
// initializes asynchronously and may use a different Jotai store than the
// React Provider tree, making its value unreliable.
let _lastNavigatedProjectId: string | null = null
import { useAgentSubChatStore } from "../../features/agents/stores/sub-chat-store"
import { trpc } from "../trpc"
import { getQueryClient } from "../../contexts/TRPCProvider"
import { chatRegistry } from "../../features/agents/stores/chat-registry"

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
  const setNavigatedProjectId = useSetAtom(navigatedProjectIdAtom)
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
        // With LRU registry, we now hibernate them instead of deleting
        const oldOpenIds = store.openSubChatIds
        for (const oldId of oldOpenIds) {
          chatRegistry.unregister(oldId)
        }
        setChatId(route.chatId)
      }

      // 3. Resolve project from chat data and sync selectedProject
      // Set the target project ID so the sidebar knows this project change
      // is intentional (navigation) and doesn't clear the selected chat.
      const t0 = performance.now()
      console.log('[navigate] resolving project...')
      try {
        // OPTIMIZATION: Try to get from cache first (Instant Project Switch)
        // This avoids the 3s blocking delay when switching back to a recently visited workspace
        let chatData = utils.chats.get.getData({ id: route.chatId })
        const t1 = performance.now()
        console.log(`[navigate] getData: ${(t1 - t0).toFixed(0)}ms, hit=${!!chatData}`)

        if (!chatData) {
             // Fallback to fetch if not in cache, but allow stale data (10s) to avoid unnecessary network calls
             chatData = await utils.chats.get.fetch({ id: route.chatId }, { staleTime: 10000 })
             const t2 = performance.now()
             console.log(`[navigate] fetch fallback: ${(t2 - t1).toFixed(0)}ms`)
        }

        // Bail if a newer navigation has started while we were awaiting
        if (navigationVersionRef.current !== version) return

        if (chatData?.project) {
          const p = chatData.project

          // Use module-level tracker to skip redundant updates if project ID matches.
          // This avoids the heavy AgentsLayout re-render for same-project navigation.
          if (_lastNavigatedProjectId !== p.id) {
            console.log('[navigate] setSelectedProject (changed)', { from: _lastNavigatedProjectId?.slice(-8), to: p.id.slice(-8) })
            _lastNavigatedProjectId = p.id

            // 1. Mark this project ID as the navigation target
            setNavigatedProjectId(p.id)

            // 2. Schedule the heavy update with startTransition (low priority)
            // This prevents the 3s UI freeze. The Sidebar will compare selectedProject.id
            // with navigatedProjectId to know it should KEEP the chat.
            startTransition(() => {
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
            })
          } else {
            console.log('[navigate] setSelectedProject SKIP (same project)', { id: p.id.slice(-8) })
          }
        }
      } catch (e) {
        console.warn("[MemoryRouter] Failed to resolve project for chat:", route.chatId, e)
      }
      // Note: We don't clear navigatedProjectId here. It's fine to leave it set.
      // It will just be overwritten by the next navigation.
      // Clearing it via setTimeout was the cause of the race condition.

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
      setNavigatedProjectId,
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
