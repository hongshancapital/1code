/**
 * ChatInputContext - 解耦聊天输入和消息发送
 *
 * 设计目标:
 * 1. 支持多 ChatView 同时展示，共享一个 ChatInput
 * 2. ChatInput 根据当前聚焦的 ChatView 动态切换目标
 * 3. 呈现 + 发送 + 输入 三层解耦，可自由组合
 *
 * 架构:
 * - ChatInputContext: 管理输入状态和目标选择
 * - ActiveChatTarget: 当前接收消息的 ChatView
 * - ChatInput: 纯 UI 组件，不关心发送到哪里
 * - MessageSender: 发送逻辑，接收目标信息
 *
 * 使用场景:
 * - 单窗口: ChatInput 固定绑定一个 ChatView
 * - 多窗口: ChatInput 动态绑定高亮的 ChatView
 * - 分屏: 左右两个 ChatView，底部一个 ChatInput
 */

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
  type MutableRefObject,
} from "react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"

// =============================================================================
// Types
// =============================================================================

/**
 * 聊天目标 - 消息发送的目标
 */
export interface ChatTarget {
  /** 父 Chat ID */
  chatId: string
  /** SubChat ID (当前活跃的子对话) */
  subChatId: string
  /** 项目路径 (用于命令扩展) */
  projectPath?: string
  /** 工作区路径 */
  worktreePath?: string
  /** 沙箱 ID (web 模式) */
  sandboxId?: string
  /** 团队 ID (用于缓存更新) */
  teamId?: string | null
}

/**
 * 发送消息的函数签名
 */
export type SendMessageFn = (message: {
  role: string
  parts: any[]
}) => Promise<void>

/**
 * 停止流式响应的函数签名
 */
export type StopStreamFn = () => Promise<void>

/**
 * ChatView 注册信息 - ChatView 向 Context 注册自己
 */
export interface ChatViewRegistration {
  /** ChatView 实例 ID (唯一标识，用于多实例) */
  instanceId: string
  /** 聊天目标信息 */
  target: ChatTarget
  /** 发送消息函数 */
  sendMessage: SendMessageFn
  /** 停止流式响应 */
  stopStream: StopStreamFn
  /** 是否正在流式响应 */
  isStreaming: boolean
  /** 是否已归档 */
  isArchived: boolean
  /** 沙箱设置状态 */
  sandboxSetupStatus: "ready" | "pending" | "loading" | "error"
  /** 编辑器 ref (用于获取输入内容) */
  editorRef?: MutableRefObject<EditorRef | null>
  /** 自动滚动 ref */
  shouldAutoScrollRef?: MutableRefObject<boolean>
  /** 滚动到底部 */
  scrollToBottom?: () => void
}

export interface EditorRef {
  getValue: () => string | undefined
  setValue: (value: string) => void
  clear: () => void
  focus: () => void
}

/**
 * Context 值
 */
export interface ChatInputContextValue {
  // ── 活跃目标 ──
  /** 当前活跃的 ChatView 实例 ID */
  activeInstanceId: string | null
  /** 当前活跃的 ChatTarget */
  activeTarget: ChatTarget | null
  /** 设置活跃实例 (通常在 ChatView 聚焦时调用) */
  setActiveInstance: (instanceId: string) => void

  // ── 注册管理 ──
  /** 注册一个 ChatView */
  registerChatView: (registration: ChatViewRegistration) => () => void
  /** 获取注册信息 */
  getRegistration: (instanceId: string) => ChatViewRegistration | undefined
  /** 获取所有注册的 ChatView */
  getAllRegistrations: () => ChatViewRegistration[]

  // ── 发送接口 ──
  /** 向活跃的 ChatView 发送消息 */
  sendToActive: (message: { role: string; parts: any[] }) => Promise<void>
  /** 向指定实例发送消息 */
  sendToInstance: (instanceId: string, message: { role: string; parts: any[] }) => Promise<void>
  /** 停止活跃 ChatView 的流式响应 */
  stopActive: () => Promise<void>

  // ── 状态查询 ──
  /** 活跃 ChatView 是否正在流式响应 */
  isActiveStreaming: boolean
  /** 活跃 ChatView 是否可以发送 (ready && !archived) */
  canSendToActive: boolean
}

// =============================================================================
// Atoms (全局状态)
// =============================================================================

/**
 * 活跃实例 ID atom
 * 全局只有一个活跃实例（接收键盘输入的那个）
 */
export const activeInstanceIdAtom = atom<string | null>(null)

/**
 * 注册表 atom
 * Map<instanceId, ChatViewRegistration>
 */
export const chatViewRegistrationsAtom = atom<Map<string, ChatViewRegistration>>(
  new Map()
)

// =============================================================================
// Context
// =============================================================================

const ChatInputContext = createContext<ChatInputContextValue | null>(null)

// =============================================================================
// Provider
// =============================================================================

export interface ChatInputProviderProps {
  children: ReactNode
}

export function ChatInputProvider({ children }: ChatInputProviderProps) {
  const [activeInstanceId, setActiveInstanceId] = useAtom(activeInstanceIdAtom)
  const [registrations, setRegistrations] = useAtom(chatViewRegistrationsAtom)

  // ---------------------------------------------------------------------------
  // 注册管理
  // ---------------------------------------------------------------------------

  const registerChatView = useCallback(
    (registration: ChatViewRegistration) => {
      setRegistrations((prev) => {
        const next = new Map(prev)
        next.set(registration.instanceId, registration)
        return next
      })

      // 如果没有活跃实例，自动设置为活跃
      setActiveInstanceId((prev) => prev ?? registration.instanceId)

      // 返回取消注册函数
      return () => {
        setRegistrations((prev) => {
          const next = new Map(prev)
          next.delete(registration.instanceId)
          return next
        })

        // 如果取消注册的是活跃实例，清除活跃状态
        setActiveInstanceId((prev) =>
          prev === registration.instanceId ? null : prev
        )
      }
    },
    [setRegistrations, setActiveInstanceId]
  )

  const getRegistration = useCallback(
    (instanceId: string) => registrations.get(instanceId),
    [registrations]
  )

  const getAllRegistrations = useCallback(
    () => Array.from(registrations.values()),
    [registrations]
  )

  // ---------------------------------------------------------------------------
  // 活跃目标
  // ---------------------------------------------------------------------------

  const activeTarget = useMemo(() => {
    if (!activeInstanceId) return null
    const reg = registrations.get(activeInstanceId)
    return reg?.target ?? null
  }, [activeInstanceId, registrations])

  const activeRegistration = useMemo(() => {
    if (!activeInstanceId) return null
    return registrations.get(activeInstanceId) ?? null
  }, [activeInstanceId, registrations])

  // ---------------------------------------------------------------------------
  // 发送接口
  // ---------------------------------------------------------------------------

  const sendToActive = useCallback(
    async (message: { role: string; parts: any[] }) => {
      if (!activeInstanceId) {
        console.warn("[ChatInputContext] No active instance to send to")
        return
      }

      const reg = registrations.get(activeInstanceId)
      if (!reg) {
        console.warn("[ChatInputContext] Active instance not found in registrations")
        return
      }

      if (reg.sandboxSetupStatus !== "ready") {
        console.warn("[ChatInputContext] Sandbox not ready, cannot send")
        return
      }

      await reg.sendMessage(message)
    },
    [activeInstanceId, registrations]
  )

  const sendToInstance = useCallback(
    async (instanceId: string, message: { role: string; parts: any[] }) => {
      const reg = registrations.get(instanceId)
      if (!reg) {
        console.warn(`[ChatInputContext] Instance ${instanceId} not found`)
        return
      }

      await reg.sendMessage(message)
    },
    [registrations]
  )

  const stopActive = useCallback(async () => {
    if (!activeRegistration) return
    await activeRegistration.stopStream()
  }, [activeRegistration])

  // ---------------------------------------------------------------------------
  // 状态查询
  // ---------------------------------------------------------------------------

  const isActiveStreaming = activeRegistration?.isStreaming ?? false

  const canSendToActive = useMemo(() => {
    if (!activeRegistration) return false
    if (activeRegistration.sandboxSetupStatus !== "ready") return false
    if (activeRegistration.isArchived) return false
    return true
  }, [activeRegistration])

  // ---------------------------------------------------------------------------
  // Context Value
  // ---------------------------------------------------------------------------

  const value = useMemo<ChatInputContextValue>(
    () => ({
      activeInstanceId,
      activeTarget,
      setActiveInstance: setActiveInstanceId,

      registerChatView,
      getRegistration,
      getAllRegistrations,

      sendToActive,
      sendToInstance,
      stopActive,

      isActiveStreaming,
      canSendToActive,
    }),
    [
      activeInstanceId,
      activeTarget,
      setActiveInstanceId,
      registerChatView,
      getRegistration,
      getAllRegistrations,
      sendToActive,
      sendToInstance,
      stopActive,
      isActiveStreaming,
      canSendToActive,
    ]
  )

  return (
    <ChatInputContext.Provider value={value}>
      {children}
    </ChatInputContext.Provider>
  )
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * 获取 ChatInputContext (必须在 Provider 内)
 */
export function useChatInput(): ChatInputContextValue {
  const context = useContext(ChatInputContext)
  if (!context) {
    throw new Error("useChatInput must be used within ChatInputProvider")
  }
  return context
}

/**
 * 安全版本 - 可以在 Provider 外使用
 */
export function useChatInputSafe(): ChatInputContextValue | null {
  return useContext(ChatInputContext)
}

/**
 * 注册 ChatView 到 ChatInputContext
 * 通常在 ChatViewInner 组件中使用
 */
export function useChatViewRegistration(
  registration: Omit<ChatViewRegistration, "instanceId"> & { instanceId?: string }
) {
  const context = useChatInputSafe()

  // 生成稳定的实例 ID (如果没有提供)
  const instanceId = useMemo(
    () => registration.instanceId ?? `chatview-${registration.target.subChatId}`,
    [registration.instanceId, registration.target.subChatId]
  )

  // 注册效果
  const fullRegistration = useMemo<ChatViewRegistration>(
    () => ({
      ...registration,
      instanceId,
    }),
    [registration, instanceId]
  )

  // 注册到 Context
  useMemo(() => {
    if (!context) return
    return context.registerChatView(fullRegistration)
  }, [context, fullRegistration])

  return instanceId
}

/**
 * 标记当前 ChatView 为活跃 (通常在聚焦时调用)
 */
export function useSetActiveChat(instanceId: string) {
  const setActiveInstance = useSetAtom(activeInstanceIdAtom)

  return useCallback(() => {
    setActiveInstance(instanceId)
  }, [instanceId, setActiveInstance])
}

/**
 * 检查当前 ChatView 是否是活跃的
 */
export function useIsActiveChat(instanceId: string): boolean {
  const activeId = useAtomValue(activeInstanceIdAtom)
  return activeId === instanceId
}

// =============================================================================
// Utility Types for Message Building
// =============================================================================

/**
 * 消息部分类型
 */
export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "data-image"
  data: {
    url?: string
    base64Data?: string
    mediaType: string
    filename?: string
  }
}

export interface FilePart {
  type: "data-file"
  data: {
    url: string
    filename: string
    mediaType: string
    size?: number
  }
}

export interface FileContentPart {
  type: "data-file-content"
  data: {
    filePath: string
    content: string
  }
}

export type MessagePart = TextPart | ImagePart | FilePart | FileContentPart

/**
 * 构建用户消息
 */
export function buildUserMessage(parts: MessagePart[]): { role: "user"; parts: MessagePart[] } {
  return { role: "user", parts }
}
