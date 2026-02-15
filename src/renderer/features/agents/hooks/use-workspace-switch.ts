import { useEffect, useRef, useCallback } from "react"
import { getQueryClient } from "../../../contexts/TRPCProvider"
import { useAgentSubChatStore, type SubChatMeta } from "../stores/sub-chat-store"
import { appStore } from "../../../lib/jotai-store"
import { currentSubChatIdAtom, messageIdsAtom, isMessagesSyncedAtom } from "../stores/message-store"
import { subChatModeAtomFamily } from "../atoms"
import { createLogger } from "../../../lib/logger"

const useWorkspaceSwitchLog = createLogger("useWorkspaceSwitch")


/**
 * useWorkspaceTransition — workspace 切换协调
 *
 * 职责单一：协调 workspace 切换时的 store/query 状态重置。
 * 不关心 Chat 实例（由 ChatRegistry + getOrCreateChat 的归属检查自动处理）。
 *
 * 关键设计决策：
 * - invalidateQueries 而非 resetQueries — 标记过期但不清空数据，消除竞态窗口
 * - 不需要 isStable 门控 — 因为旧数据在新数据到达前仍可用
 * - 不需要 requestAnimationFrame — 因为没有竞态窗口需要"堵"
 */
export function useWorkspaceSwitch(chatId: string) {
  const prevChatIdRef = useRef<string | null>(null)
  const initializedChatIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (prevChatIdRef.current === chatId || !chatId) return

    const isFirstMount = prevChatIdRef.current === null

    useWorkspaceSwitchLog.info("Switching workspace", {
      from: prevChatIdRef.current?.slice(-8),
      to: chatId.slice(-8),
      isFirstMount,
    })

    // 1. Zustand: 加载新 workspace 的 tab 状态（从 localStorage）
    useAgentSubChatStore.getState().setChatId(chatId)

    if (!isFirstMount) {
      // 2. Jotai: 重置消息 atoms（新 tab 的 ChatDataSync 会填充）
      appStore.set(isMessagesSyncedAtom, false) // Guard: prevent shouldShowRetry during loading gap
      appStore.set(currentSubChatIdAtom, "default")
      appStore.set(messageIdsAtom, [])

      // 3. React Query: 标记过期（不清空！旧数据保留到新数据到达）
      //    invalidateQueries: 数据 → stale 标记 → 后台 refetch → 无竞态
      //    配合 ChatRegistry 的 LRU 策略，如果内存中有实例，getOrCreateChat 会优先使用内存实例
      const queryClient = getQueryClient()
      if (queryClient) {
        queryClient.invalidateQueries({
          queryKey: [["chats", "getSubChatMessages"]],
        })
      }
    }

    // 4. 重置 mode 初始化标记
    initializedChatIdRef.current = null

    prevChatIdRef.current = chatId
  }, [chatId])

  // 初始化 mode atoms（当 agentChat 数据加载后调用）
  const initializeModes = useCallback(
    (subChats: SubChatMeta[]) => {
      if (initializedChatIdRef.current === chatId) return
      initializedChatIdRef.current = chatId

      for (const sc of subChats) {
        if (sc.mode) {
          appStore.set(subChatModeAtomFamily(sc.id), sc.mode)
        }
      }
    },
    [chatId]
  )

  return { initializeModes }
}
