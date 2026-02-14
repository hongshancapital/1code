/**
 * useChatViewSetup - 设置 ChatView 与 ChatInputContext 的集成
 *
 * 这个 hook 负责:
 * 1. 将 ChatView 注册到 ChatInputContext
 * 2. 在 ChatView 聚焦/激活时设置为活跃实例
 * 3. 在卸载时取消注册
 *
 * 设计原则:
 * - 渐进式迁移: 可以选择性启用，不影响现有功能
 * - 向后兼容: 即使 ChatInputContext 不存在也能工作
 */

import { useEffect, useMemo, useCallback } from "react"
import type { MutableRefObject } from "react"
import {
  useChatInputSafe,
  type ChatTarget,
  type ChatViewRegistration,
  type SendMessageFn,
  type StopStreamFn,
} from "../context/chat-input-context"

export interface ChatViewSetupOptions {
  // 标识
  instanceId?: string // 可选，默认使用 subChatId

  // 目标信息
  chatId: string
  subChatId: string
  projectPath?: string
  worktreePath?: string
  sandboxId?: string
  teamId?: string | null

  // 状态
  isActive: boolean
  isStreaming: boolean
  isArchived: boolean
  sandboxSetupStatus: "ready" | "pending" | "loading" | "error" | "cloning"

  // Refs (用于发送消息)
  sendMessageRef: MutableRefObject<SendMessageFn>
  stopRef: MutableRefObject<StopStreamFn>
  editorRef?: MutableRefObject<any>
  shouldAutoScrollRef?: MutableRefObject<boolean>

  // 回调
  scrollToBottom?: () => void
}

export interface ChatViewSetupResult {
  /** 实例 ID (用于标识这个 ChatView) */
  instanceId: string
  /** 当前是否是活跃的 ChatView */
  isActiveInstance: boolean
  /** 手动设置为活跃 (通常不需要，会自动处理) */
  setAsActive: () => void
}

/**
 * 设置 ChatView 与 ChatInputContext 的集成
 *
 * 使用方式:
 * ```tsx
 * const { instanceId, isActiveInstance } = useChatViewSetup({
 *   chatId,
 *   subChatId,
 *   isActive,
 *   isStreaming,
 *   isArchived,
 *   sandboxSetupStatus,
 *   sendMessageRef,
 *   stopRef,
 * })
 * ```
 */
export function useChatViewSetup(options: ChatViewSetupOptions): ChatViewSetupResult {
  const {
    instanceId: providedInstanceId,
    chatId,
    subChatId,
    projectPath,
    worktreePath,
    sandboxId,
    teamId,
    isActive,
    isStreaming,
    isArchived,
    sandboxSetupStatus,
    sendMessageRef,
    stopRef,
    editorRef,
    shouldAutoScrollRef,
    scrollToBottom,
  } = options

  // 生成稳定的实例 ID
  const instanceId = useMemo(
    () => providedInstanceId ?? `chatview-${subChatId}`,
    [providedInstanceId, subChatId]
  )

  // 获取 ChatInputContext (可能不存在)
  const chatInput = useChatInputSafe()

  // 构建目标信息
  const target = useMemo<ChatTarget>(
    () => ({
      chatId,
      subChatId,
      projectPath,
      worktreePath,
      sandboxId,
      teamId,
    }),
    [chatId, subChatId, projectPath, worktreePath, sandboxId, teamId]
  )

  // 构建注册信息
  const registration = useMemo<ChatViewRegistration>(
    () => ({
      instanceId,
      target,
      sendMessage: async (message) => {
        await sendMessageRef.current(message)
      },
      stopStream: async () => {
        await stopRef.current()
      },
      isStreaming,
      isArchived,
      sandboxSetupStatus: sandboxSetupStatus === "cloning" ? "loading" : sandboxSetupStatus,
      editorRef,
      shouldAutoScrollRef,
      scrollToBottom,
    }),
    [
      instanceId,
      target,
      sendMessageRef,
      stopRef,
      isStreaming,
      isArchived,
      sandboxSetupStatus,
      editorRef,
      shouldAutoScrollRef,
      scrollToBottom,
    ]
  )

  // 注册到 ChatInputContext
  useEffect(() => {
    if (!chatInput) return

    // 注册并获取取消函数
    const unregister = chatInput.registerChatView(registration)

    return () => {
      unregister()
    }
  }, [chatInput, registration])

  // 当 isActive 变为 true 时，设置为活跃实例
  useEffect(() => {
    if (!chatInput) return
    if (!isActive) return

    chatInput.setActiveInstance(instanceId)
  }, [chatInput, isActive, instanceId])

  // 检查是否是活跃实例
  const isActiveInstance = chatInput?.activeInstanceId === instanceId

  // 手动设置为活跃
  const setAsActive = useCallback(() => {
    chatInput?.setActiveInstance(instanceId)
  }, [chatInput, instanceId])

  return {
    instanceId,
    isActiveInstance,
    setAsActive,
  }
}

/**
 * 简化版 - 只检查是否是活跃实例，不做注册
 * 用于只需要知道激活状态的子组件
 */
export function useIsActiveChatView(subChatId: string): boolean {
  const chatInput = useChatInputSafe()
  const instanceId = `chatview-${subChatId}`
  return chatInput?.activeInstanceId === instanceId
}
