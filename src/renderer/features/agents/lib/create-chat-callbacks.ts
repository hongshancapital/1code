/**
 * createChatCallbacks - 创建 Chat 实例的 onFinish / onError 回调
 *
 * getOrCreateChat 和 handleCreateNewSubChat 中使用相同的完成/错误处理逻辑：
 * - 清除 loading 状态
 * - 同步 streaming status store
 * - 标记未读变更
 * - 播放完成提示音 / 桌面通知
 * - 刷新 diff 统计
 */

import type { MutableRefObject } from "react"
import { appStore } from "../../../lib/jotai-store"
import { soundNotificationsEnabledAtom } from "../../../lib/atoms"
import {
  clearLoading,
  markSubChatUnseen,
  selectedAgentChatIdAtom,
  type SubChatStatus,
} from "../atoms"
import { chatRegistry } from "../stores/chat-registry"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import { useStreamingStatusStore } from "../stores/streaming-status-store"

interface ChatCallbackDeps {
  subChatId: string
  chatId: string
  agentName: string
  setLoadingSubChats: (fn: (prev: Map<string, string>) => Map<string, string>) => void
  setSubChatUnseenChanges: (update: (prev: Set<string>) => Set<string>) => void
  setSubChatStatus: (fn: (prev: Record<string, SubChatStatus>) => Record<string, SubChatStatus>) => void
  setUnseenChanges: (update: (prev: Set<string>) => Set<string>) => void
  notifyAgentComplete: (name: string) => void
  notifyAgentError: (name: string) => void
  fetchDiffStatsRef: MutableRefObject<() => void>
  playCompletionSound: () => void
}

export function createChatCallbacks(deps: ChatCallbackDeps) {
  const {
    subChatId,
    chatId,
    agentName,
    setLoadingSubChats,
    setSubChatUnseenChanges,
    setSubChatStatus,
    setUnseenChanges,
    notifyAgentComplete,
    notifyAgentError,
    fetchDiffStatsRef,
    playCompletionSound,
  } = deps

  return {
    onError: () => {
      clearLoading(setLoadingSubChats, subChatId)
      useStreamingStatusStore.getState().setStatus(subChatId, "ready")
      notifyAgentError(agentName)
    },

    onFinish: () => {
      clearLoading(setLoadingSubChats, subChatId)
      useStreamingStatusStore.getState().setStatus(subChatId, "ready")

      const wasManuallyAborted = chatRegistry.wasManuallyAborted(subChatId)
      chatRegistry.clearManuallyAborted(subChatId)

      const currentActiveSubChatId =
        useAgentSubChatStore.getState().activeSubChatId
      const currentSelectedChatId = appStore.get(selectedAgentChatIdAtom)

      const isViewingThisSubChat = currentActiveSubChatId === subChatId
      const isViewingThisChat = currentSelectedChatId === chatId

      if (!isViewingThisSubChat) {
        setSubChatUnseenChanges((prev: Set<string>) => {
          const next = new Set(prev)
          next.add(subChatId)
          return next
        })
        markSubChatUnseen(setSubChatStatus, subChatId)
      }

      if (!isViewingThisChat) {
        setUnseenChanges((prev: Set<string>) => {
          const next = new Set(prev)
          next.add(chatId)
          return next
        })

        if (!wasManuallyAborted) {
          const isSoundEnabled = appStore.get(soundNotificationsEnabledAtom)
          if (isSoundEnabled) {
            playCompletionSound()
          }
          notifyAgentComplete(agentName)
        }
      }

      fetchDiffStatsRef.current()
    },
  }
}
