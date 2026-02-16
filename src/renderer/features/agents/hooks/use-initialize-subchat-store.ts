/**
 * useInitializeSubChatStore - 初始化/同步 SubChat Zustand store
 *
 * 当 agentChat 数据加载后，将 DB 子聊天同步到 Zustand store：
 * - 设置 chatId 并清理旧缓存
 * - 映射 DB 子聊天到 store 格式
 * - 初始化 mode atomFamily
 * - 验证 openSubChatIds 和 activeSubChatId
 */

import { useEffect, useRef } from "react"
import { chatRegistry } from "../stores/chat-registry"
import {
  useAgentSubChatStore,
  type SubChatMeta,
} from "../stores/sub-chat-store"
import { appStore } from "../../../lib/jotai-store"
import { subChatModeAtomFamily } from "../atoms"
import { currentSubChatIdAtom } from "../stores/message-store"

interface AgentSubChat {
  id: string
  name?: string | null
  mode?: "plan" | "agent" | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
  messages?: unknown
  stream_id?: string | null
}

export function useInitializeSubChatStore(
  agentChat: unknown | null,
  chatId: string,
  agentSubChats: AgentSubChat[],
) {
  const initializedChatIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!agentChat) return

    const store = useAgentSubChatStore.getState()
    const isNewChat = store.chatId !== chatId

    if (isNewChat) {
      // 清除旧 workspace 的 Chat 缓存，防止旧的空 Chat 对象被复用
      const oldOpenIds = store.openSubChatIds
      for (const oldId of oldOpenIds) {
        chatRegistry.unregister(oldId)
      }

      store.setChatId(chatId)
      // 重置全局消息状态，防止旧的 currentSubChatIdAtom 导致 IsolatedMessagesSection 跳过渲染
      appStore.set(currentSubChatIdAtom, "default")
    }

    // Re-get fresh state after setChatId may have loaded from localStorage
    const freshState = useAgentSubChatStore.getState()

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

    // DB is the source of truth
    freshState.setAllSubChats(dbSubChats)

    // Initialize atomFamily mode for each sub-chat from database
    // IMPORTANT: Only do this when chatId changes (new chat loaded), not on every agentChat update
    if (initializedChatIdRef.current !== chatId) {
      initializedChatIdRef.current = chatId
      for (const sc of dbSubChats) {
        if (sc.mode) {
          appStore.set(subChatModeAtomFamily(sc.id), sc.mode)
        }
      }

      // Initialize openSubChatIds from DB
      if (dbSubChats.length > 0) {
        freshState.setOpenSubChats(dbSubChats.map((sc) => sc.id))
      }
    }

    // Validate openSubChatIds — remove any IDs that no longer exist in DB
    const currentOpenIds = freshState.openSubChatIds
    const validOpenIds = currentOpenIds.filter((id) => dbSubChatIds.has(id))
    if (validOpenIds.length !== currentOpenIds.length) {
      freshState.setOpenSubChats(validOpenIds)
    }

    // Validate activeSubChatId
    const currentActive = freshState.activeSubChatId
    if (!currentActive || !dbSubChatIds.has(currentActive)) {
      const candidates =
        validOpenIds.length > 0
          ? (validOpenIds
              .map((id) => dbSubChats.find((sc) => sc.id === id))
              .filter(Boolean) as SubChatMeta[])
          : dbSubChats
      if (candidates.length > 0) {
        const latest = candidates.reduce((a, b) => {
          const aTime = a.updated_at || a.created_at || ""
          const bTime = b.updated_at || b.created_at || ""
          return bTime > aTime ? b : a
        })
        freshState.setActiveSubChat(latest.id)
        if (validOpenIds.length === 0) {
          freshState.setOpenSubChats([latest.id])
        }
      } else {
        freshState.setActiveSubChat(null as unknown as string)
      }
    }
  }, [agentChat, chatId])
}
