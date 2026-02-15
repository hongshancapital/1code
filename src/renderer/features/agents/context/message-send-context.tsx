/**
 * MessageSendContext - Chat instance and message sending
 *
 * This context provides:
 * 1. Chat instance management (getOrCreateChat from registry)
 * 2. Pending message atoms (PR, review, auth retry, conflict resolution)
 * 3. Message sending status
 *
 * Usage:
 *   const { chat, getOrCreateChat, pendingPrMessage } = useMessageSend()
 *
 * Note: This context depends on SubChatContext for subChatId and
 * ChatInstanceContext for worktreePath and agentChat data.
 *
 * The heavy UI-level logic (editor refs, images, files, text contexts)
 * stays in the component level (ChatInputArea) since they're tightly
 * coupled with DOM refs and controlled/uncontrolled input states.
 */

import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { Chat, useChat } from "@ai-sdk/react"
import { chatRegistry, type ChatEntry } from "../stores/chat-registry"
import { useStreamingStatusStore } from "../stores/streaming-status-store"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import {
  pendingPrMessageAtom,
  pendingReviewMessageAtom,
  pendingAuthRetryMessageAtom,
  pendingConflictResolutionMessageAtom,
  selectedAgentChatIdAtom,
  MODEL_ID_MAP,
  subChatModeAtomFamily,
  soundNotificationsEnabledAtom,
  clearLoading,
  loadingSubChatsAtom,
  agentsSubChatUnseenChangesAtom,
  agentsUnseenChangesAtom,
  subChatStatusStorageAtom,
  markSubChatUnseen,
  type PendingAuthRetryMessage,
} from "../atoms"
import { useChatInstance } from "./chat-instance-context"
import { useSubChat } from "./sub-chat-context"
import { IPCChatTransport } from "../lib/ipc-chat-transport"
import { RemoteChatTransport } from "../lib/remote-chat-transport"
import { isRemoteChat, getSandboxId, getProjectPath } from "../types"
import type { AgentChat } from "../types"
import { appStore } from "../../../lib/jotai-store"
import { createLogger } from "../../../lib/logger"

const getOrCreateChatLog = createLogger("getOrCreateChat")


// ============================================================================
// Types
// ============================================================================

export interface MessageSendContextValue {
  // Chat instance
  chat: Chat<any> | null
  getOrCreateChat: () => Chat<any> | null

  // useChat hook values
  messages: any[]
  status: "streaming" | "submitted" | "ready" | "error"
  isStreaming: boolean
  sendMessage: (message: { role: string; parts: any[] }) => Promise<void>
  stop: () => Promise<void>
  regenerate: () => Promise<void>
  setMessages: (messages: any[]) => void

  // Pending messages (for PR, review, etc.)
  pendingPrMessage: string | null
  setPendingPrMessage: (message: string | null) => void
  pendingReviewMessage: string | null
  setPendingReviewMessage: (message: string | null) => void
  pendingAuthRetryMessage: PendingAuthRetryMessage | null
  setPendingAuthRetryMessage: (message: PendingAuthRetryMessage | null) => void
  pendingConflictResolutionMessage: string | null
  setPendingConflictResolutionMessage: (message: string | null) => void
}

// ============================================================================
// Context
// ============================================================================

const MessageSendContext = createContext<MessageSendContextValue | null>(null)

// ============================================================================
// Provider
// ============================================================================

export interface MessageSendProviderProps {
  children: ReactNode
}

export function MessageSendProvider({ children }: MessageSendProviderProps) {
  // Get data from parent contexts
  const {
    chatId,
    worktreePath,
    agentChat,
    agentSubChats,
  } = useChatInstance()

  const { subChatId, mode: currentMode } = useSubChat()

  // Force update trigger for chat registry changes
  const [, forceUpdate] = useState({})

  // Get selectedModelId from chat model selections
  const selectedModelId = "sonnet" // Default, can be enhanced later

  // Pending message atoms
  const [pendingPrMessage, setPendingPrMessage] = useAtom(pendingPrMessageAtom)
  const [pendingReviewMessage, setPendingReviewMessage] = useAtom(pendingReviewMessageAtom)
  const [pendingAuthRetryMessage, setPendingAuthRetryMessage] = useAtom(pendingAuthRetryMessageAtom)
  const [pendingConflictResolutionMessage, setPendingConflictResolutionMessage] = useAtom(
    pendingConflictResolutionMessageAtom
  )

  // Setters for loading and unseen state
  const setLoadingSubChats = useSetAtom(loadingSubChatsAtom)
  const setSubChatUnseenChanges = useSetAtom(agentsSubChatUnseenChangesAtom)
  const setUnseenChanges = useSetAtom(agentsUnseenChangesAtom)
  const setSubChatStatus = useSetAtom(subChatStatusStorageAtom)

  // Lazy-loaded messages query data (simplified - actual implementation uses tRPC)
  const subChatMessagesData = useMemo(() => {
    const subChat = agentSubChats.find((sc) => sc.id === subChatId)
    if (subChat?.messages) {
      return {
        messages: typeof subChat.messages === "string"
          ? subChat.messages
          : JSON.stringify(subChat.messages),
      }
    }
    return null
  }, [agentSubChats, subChatId])

  // Desktop notification helpers (simplified stubs)
  const notifyAgentComplete = useCallback((name: string) => {
    // Desktop notification is handled elsewhere
  }, [])

  const notifyAgentError = useCallback((name: string) => {
    // Desktop notification is handled elsewhere
  }, [])

  // Ref for diff stats refresh
  const fetchDiffStatsRef = useRef(() => {})

  // Create or get Chat instance for a sub-chat
  const getOrCreateChat = useCallback((): Chat<any> | null => {
    // Desktop uses worktreePath, web uses sandboxUrl
    const chatWorkingDir = worktreePath || (agentChat ? getSandboxId(agentChat as AgentChat) : null)
    if (!chatWorkingDir || !agentChat) {
      return null
    }

    // Return existing chat if we have it
    const existing = chatRegistry.get(subChatId)
    if (existing) {
      // Check if CWD changed (playground to project transition)
      const entry = chatRegistry.getEntry(subChatId)
      if (worktreePath && entry?.cwd && entry.cwd !== worktreePath) {
        getOrCreateChatLog.info("CWD changed, hot-updating transport", {
          subChatId: subChatId.slice(-8),
          oldCwd: entry.cwd,
          newCwd: worktreePath,
        })
        chatRegistry.updateCwdByParentChatId(entry.parentChatId, worktreePath)
        return existing
      }
      return existing
    }

    // Find sub-chat data
    const subChat = agentSubChats.find((sc) => sc.id === subChatId)

    // Parse messages
    let messages: unknown[] = []
    if (subChatMessagesData?.messages) {
      try {
        const parsed = JSON.parse(subChatMessagesData.messages)
        messages = parsed.map((msg: any) => {
          if (!msg.parts) return msg
          return {
            ...msg,
            parts: msg.parts.map((part: any) => {
              if (part.type === "tool-invocation" && part.toolName) {
                return {
                  ...part,
                  type: `tool-${part.toolName}`,
                  toolCallId: part.toolCallId || part.toolInvocationId,
                  input: part.input || part.args,
                }
              }
              if (part.type === "tool-Thinking") {
                return {
                  type: "reasoning",
                  text: part.input?.text || "",
                  state: "done",
                }
              }
              if (part.type?.startsWith("tool-") && part.state) {
                let normalizedState = part.state
                if (part.state === "result") {
                  normalizedState = part.result?.success === false ? "output-error" : "output-available"
                }
                return { ...part, state: normalizedState, output: part.output || part.result }
              }
              return part
            }),
          }
        })
      } catch (err) {
        getOrCreateChatLog.warn("Failed to parse messages", err)
      }
    } else if (Array.isArray(subChat?.messages)) {
      messages = subChat.messages as unknown[]
    }

    // Get mode from store metadata
    const subChatMeta = useAgentSubChatStore
      .getState()
      .allSubChats.find((sc) => sc.id === subChatId)
    const subChatMode = subChatMeta?.mode || currentMode

    // Create transport based on chat type
    const projectPath = getProjectPath(agentChat as AgentChat | null)
    const chatSandboxId = getSandboxId(agentChat as AgentChat | null)
    const chatSandboxUrl = chatSandboxId ? `https://3003-${chatSandboxId}.e2b.app` : null
    const isChatRemote = isRemoteChat(agentChat as AgentChat | null) || !!chatSandboxId

    let transport: IPCChatTransport | RemoteChatTransport | null = null

    if (isChatRemote && chatSandboxUrl) {
      const subChatName = subChat?.name || "Chat"
      const modelString = MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP["sonnet"]
      transport = new RemoteChatTransport({
        chatId,
        subChatId,
        subChatName,
        sandboxUrl: chatSandboxUrl,
        mode: subChatMode,
        model: modelString,
      })
    } else if (worktreePath) {
      transport = new IPCChatTransport({
        chatId,
        subChatId,
        cwd: worktreePath,
        projectPath,
        mode: subChatMode,
      })
    }

    if (!transport) {
      getOrCreateChatLog.error("No transport available")
      return null
    }

    const newChat = new Chat<any>({
      id: subChatId,
      messages,
      transport,
      onError: () => {
        clearLoading(setLoadingSubChats, subChatId)
        useStreamingStatusStore.getState().setStatus(subChatId, "ready")
        notifyAgentError(agentChat?.name || "Agent")
      },
      onFinish: () => {
        clearLoading(setLoadingSubChats, subChatId)
        useStreamingStatusStore.getState().setStatus(subChatId, "ready")

        const wasManuallyAborted = chatRegistry.wasManuallyAborted(subChatId)
        chatRegistry.clearManuallyAborted(subChatId)

        const currentActiveSubChatId = useAgentSubChatStore.getState().activeSubChatId
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
              try {
                const audio = new Audio("./sound.mp3")
                audio.volume = 1.0
                audio.play().catch(() => {})
              } catch {
                // Ignore audio errors
              }
            }
            notifyAgentComplete(agentChat?.name || "Agent")
          }
        }

        fetchDiffStatsRef.current()
      },
    })

    chatRegistry.register(
      subChatId,
      newChat,
      chatId,
      worktreePath || undefined,
      transport instanceof IPCChatTransport ? transport : undefined
    )
    chatRegistry.registerStreamId(subChatId, subChat?.stream_id || null)
    forceUpdate({})
    return newChat
  }, [
    agentChat,
    worktreePath,
    chatId,
    subChatId,
    currentMode,
    agentSubChats,
    subChatMessagesData,
    setLoadingSubChats,
    setSubChatUnseenChanges,
    setSubChatStatus,
    setUnseenChanges,
    notifyAgentComplete,
    notifyAgentError,
    selectedModelId,
  ])

  // Get current chat instance
  const chat = useMemo(() => {
    return getOrCreateChat()
  }, [getOrCreateChat])

  // useChat hook for the current chat instance
  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    setMessages,
  } = useChat({
    id: subChatId,
    chat,
    resume: false,
    experimental_throttle: 50,
  })

  const isStreaming = status === "streaming" || status === "submitted"

  // Refs for stable callbacks
  const sendMessageRef = useRef(sendMessage)
  sendMessageRef.current = sendMessage
  const stopRef = useRef(stop)
  stopRef.current = stop

  // Stable wrappers
  const handleSendMessage = useCallback(
    async (message: { role: string; parts: any[] }) => {
      await sendMessageRef.current(message)
    },
    []
  )

  const handleStop = useCallback(async () => {
    chatRegistry.setManuallyAborted(subChatId, true)
    await stopRef.current()
  }, [subChatId])

  const value = useMemo<MessageSendContextValue>(
    () => ({
      chat,
      getOrCreateChat,
      messages,
      status,
      isStreaming,
      sendMessage: handleSendMessage,
      stop: handleStop,
      regenerate,
      setMessages,
      pendingPrMessage,
      setPendingPrMessage,
      pendingReviewMessage,
      setPendingReviewMessage,
      pendingAuthRetryMessage,
      setPendingAuthRetryMessage,
      pendingConflictResolutionMessage,
      setPendingConflictResolutionMessage,
    }),
    [
      chat,
      getOrCreateChat,
      messages,
      status,
      isStreaming,
      handleSendMessage,
      handleStop,
      regenerate,
      setMessages,
      pendingPrMessage,
      setPendingPrMessage,
      pendingReviewMessage,
      setPendingReviewMessage,
      pendingAuthRetryMessage,
      setPendingAuthRetryMessage,
      pendingConflictResolutionMessage,
      setPendingConflictResolutionMessage,
    ]
  )

  return (
    <MessageSendContext.Provider value={value}>
      {children}
    </MessageSendContext.Provider>
  )
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Access message send context
 * @throws Error if used outside MessageSendProvider
 */
export function useMessageSend(): MessageSendContextValue {
  const context = useContext(MessageSendContext)
  if (!context) {
    throw new Error("useMessageSend must be used within a MessageSendProvider")
  }
  return context
}

/**
 * Access message send context safely (returns null if outside provider)
 */
export function useMessageSendSafe(): MessageSendContextValue | null {
  return useContext(MessageSendContext)
}

/**
 * Get current chat instance
 */
export function useChatFromContext(): Chat<any> | null {
  const { chat } = useMessageSend()
  return chat
}

/**
 * Check if currently streaming
 */
export function useIsStreamingFromContext(): boolean {
  const { isStreaming } = useMessageSend()
  return isStreaming
}

/**
 * Get messages from context
 */
export function useMessagesFromContext(): any[] {
  const { messages } = useMessageSend()
  return messages
}
