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

import { useEffect, useMemo, useCallback, useRef } from "react"
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

  // 使用 refs 保存需要在注册中使用的回调，避免依赖变化导致重新注册
  const scrollToBottomRef = useRef(scrollToBottom)
  scrollToBottomRef.current = scrollToBottom

  // 规范化 sandboxSetupStatus
  const normalizedSetupStatus = sandboxSetupStatus === "cloning" ? "loading" : sandboxSetupStatus

  // 注册到 ChatInputContext - 只在关键标识变化时重新注册
  // 使用 useRef 避免频繁的注册/取消注册循环
  const registrationRef = useRef<ChatViewRegistration | null>(null)
  const unregisterRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!chatInput) return

    // 构建注册信息
    const registration: ChatViewRegistration = {
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
      sandboxSetupStatus: normalizedSetupStatus,
      editorRef,
      shouldAutoScrollRef,
      scrollToBottom: () => scrollToBottomRef.current?.(),
    }

    // 检查是否需要重新注册（只有关键字段变化才重新注册）
    const prev = registrationRef.current
    const needsReregister =
      !prev ||
      prev.instanceId !== registration.instanceId ||
      prev.target.chatId !== registration.target.chatId ||
      prev.target.subChatId !== registration.target.subChatId

    if (needsReregister) {
      // 先取消旧注册
      unregisterRef.current?.()

      // 注册新的
      unregisterRef.current = chatInput.registerChatView(registration)
      registrationRef.current = registration
    } else {
      // 只更新状态字段（不触发重新注册）
      // 这需要 ChatInputContext 支持更新，暂时跳过
    }

    return () => {
      // 组件卸载时取消注册
      unregisterRef.current?.()
      unregisterRef.current = null
      registrationRef.current = null
    }
  }, [
    chatInput,
    instanceId,
    target,
    // 以下字段变化时也需要更新，但不需要完全重新注册
    // 暂时简化处理，只在关键字段变化时重新注册
  ])

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
