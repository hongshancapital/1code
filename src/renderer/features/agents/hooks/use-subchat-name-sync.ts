/**
 * useSubChatNameSync - Listens for AI-generated sub-chat names from backend
 *
 * Extracted from active-chat.tsx to improve maintainability.
 * Handles:
 * - IPC event listener for onSubChatAINameReady
 * - Confirming names (stopping shimmer)
 * - Updating sub-chat name in Zustand store
 * - Optimistic tRPC cache updates for sub-chat and parent chat
 */

import { useEffect } from "react"
import { useSetAtom } from "jotai"
import { api } from "../../../lib/mock-api"
import {
  unconfirmedNameSubChatsAtom,
  confirmName,
} from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"

export interface UseSubChatNameSyncOptions {
  selectedTeamId: string | null
}

/**
 * Hook that syncs AI-generated sub-chat names from backend via IPC.
 *
 * When the backend finishes generating a sub-chat name (success or failure),
 * it sends an IPC event. This hook:
 * 1. Confirms the name (stops shimmer animation)
 * 2. Updates the Zustand store
 * 3. Updates tRPC cache optimistically (sub-chat + parent chat if first)
 */
export function useSubChatNameSync({
  selectedTeamId,
}: UseSubChatNameSyncOptions): void {
  const setUnconfirmedNameSubChats = useSetAtom(unconfirmedNameSubChatsAtom)
  const utils = api.useUtils()

  useEffect(() => {
    if (!window.desktopApi.onSubChatAINameReady) return
    const cleanup = window.desktopApi.onSubChatAINameReady((data) => {
      console.log("[active-chat] AI name confirmed via IPC:", data)
      // Confirm the name (stop shimmer) - this happens for both AI success and AI failure
      confirmName(setUnconfirmedNameSubChats, data.subChatId)
      // Update the sub-chat name in the store
      useAgentSubChatStore.getState().updateSubChatName(data.subChatId, data.name)
      // Optimistic update for sub-chat in single chat query
      utils.agents.getAgentChat.setData(
        { chatId: data.chatId },
        (old) => {
          if (!old) return old
          return {
            ...old,
            subChats: old.subChats.map((sc: { id: string; name: string }) =>
              sc.id === data.subChatId ? { ...sc, name: data.name } : sc,
            ),
          }
        },
      )
      // If it's the first sub-chat, also update the parent chat name
      if (data.isFirstSubChat && data.chatId) {
        // Update sidebar list
        utils.agents.getAgentChats.setData(
          { teamId: selectedTeamId },
          (old: { id: string; name: string | null }[] | undefined) => {
            if (!old) return old
            return old.map((c) =>
              c.id === data.chatId ? { ...c, name: data.name } : c,
            )
          },
        )
        // Update single chat header
        utils.agents.getAgentChat.setData(
          { chatId: data.chatId },
          (old) => {
            if (!old) return old
            return { ...old, name: data.name }
          },
        )
      }
    })
    return cleanup
  }, [setUnconfirmedNameSubChats, utils.agents.getAgentChat, utils.agents.getAgentChats, selectedTeamId])
}
