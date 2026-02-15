/**
 * useAutoRename - Auto-rename sub-chat and parent chat based on user message
 *
 * Extracts the auto-rename logic from ChatView:
 * - Triggers rename on first user message in a sub-chat
 * - Updates both local store and query cache
 * - Manages shimmer effect for pending name confirmation
 * - Handles retry logic when DB record isn't ready yet
 *
 * This hook wraps the autoRenameAgentChat utility with proper context dependencies.
 */

import { useCallback, useMemo } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { api } from "../../../lib/mock-api"
import { appStore } from "../../../lib/jotai-store"
import { autoRenameAgentChat } from "../utils/auto-rename"
import {
  unconfirmedNameSubChatsAtom,
  markNameUnconfirmed,
  confirmName,
} from "../atoms"
import { summaryProviderIdAtom, summaryModelIdAtom } from "../../../lib/atoms/model-config"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { getFirstSubChatId } from "../main/chat-utils"

interface SubChat {
  id: string
  name: string | null
  manually_renamed?: boolean
  created_at?: string | Date | null
  updated_at?: string | Date | null
}

export interface UseAutoRenameOptions {
  /** Parent chat ID */
  chatId: string
  /** Array of sub-chats for the chat */
  subChats: SubChat[]
  /** Project ID (for summary model selection) */
  projectId?: string
  /** Selected team ID (for query cache key) */
  selectedTeamId?: string | null
}

export interface UseAutoRenameResult {
  /** Handler to trigger auto-rename for a sub-chat */
  handleAutoRename: (userMessage: string, subChatId: string) => void
  /** Set of sub-chat IDs with unconfirmed names (showing shimmer) */
  unconfirmedNameSubChats: Set<string>
  /** Setter for unconfirmed names (for external confirmation via IPC) */
  setUnconfirmedNameSubChats: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void
}

export function useAutoRename({
  chatId,
  subChats,
  projectId,
  selectedTeamId,
}: UseAutoRenameOptions): UseAutoRenameResult {
  // tRPC utils for cache management
  const utils = api.useUtils()

  // Name confirmation state (shimmer effect)
  const unconfirmedNameSubChats = useAtomValue(unconfirmedNameSubChatsAtom)
  const setUnconfirmedNameSubChats = useSetAtom(unconfirmedNameSubChatsAtom)

  // Mutations for renaming
  const renameSubChatMutation = api.agents.renameSubChat.useMutation()
  const renameChatMutation = api.agents.renameChat.useMutation()
  const generateSubChatNameMutation = api.agents.generateSubChatName.useMutation()

  // Memoize subChats for stable reference in callback
  const stableSubChats = useMemo(() => subChats, [subChats])

  const handleAutoRename = useCallback(
    (userMessage: string, subChatId: string) => {
      // Check if this is the first sub-chat using agentSubChats directly
      // to avoid race condition with store initialization
      const firstSubChatId = getFirstSubChatId(stableSubChats)
      const isFirst = firstSubChatId === subChatId

      // Get the sub-chat to check manuallyRenamed flag
      const subChat = stableSubChats.find((sc) => sc.id === subChatId)
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
            projectId,
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
          useAgentSubChatStore.getState().updateSubChatName(subChatIdToUpdate, name)

          // Also update query cache so init effect doesn't overwrite
          utils.agents.getAgentChat.setData({ chatId }, (old) => {
            if (!old) return old
            const existsInCache = old.subChats.some(
              (sc: { id: string }) => sc.id === subChatIdToUpdate
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
                sc.id === subChatIdToUpdate ? { ...sc, name } : sc
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
                c.id === chatIdToUpdate ? { ...c, name } : c
              )
            }
          )
          // Optimistic update for header (single chat query)
          utils.agents.getAgentChat.setData({ chatId: chatIdToUpdate }, (old) => {
            if (!old) return old
            return { ...old, name }
          })
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
      stableSubChats,
      generateSubChatNameMutation,
      renameSubChatMutation,
      renameChatMutation,
      selectedTeamId,
      utils.agents.getAgentChats,
      utils.agents.getAgentChat,
      projectId,
      setUnconfirmedNameSubChats,
    ]
  )

  return {
    handleAutoRename,
    unconfirmedNameSubChats,
    setUnconfirmedNameSubChats,
  }
}
