/**
 * useMessageSending - Message sending logic for ChatViewInner
 *
 * Extracts all message sending related handlers:
 * - handleSend: Main send handler with queue support
 * - handleSendFromQueue: Send queued messages
 * - handleForceSend: Force send (bypasses queue, Opt+Enter)
 * - handleRemoveFromQueue: Remove item from queue
 * - handleRestoreFromQueue: Restore queued item to input
 * - handleRetryMessage: Retry last failed message
 * - handleEditMessage: Edit last user message
 *
 * Key design principles:
 * - Instance isolation: Each ChatView instance has independent state
 * - Dependency injection: All external deps passed via options
 * - No side effects: Returns pure handler functions
 */

import { useCallback } from "react"
import type { MutableRefObject } from "react"
import { trpcClient } from "../../../lib/trpc"
import { getQueryClient } from "../../../contexts/TRPCProvider"
import { useAgentSubChatStore } from "../stores/agent-sub-chat-store"
import { useMessageQueueStore, type AgentQueueItem } from "../stores/message-queue-store"
import {
  createQueueItem,
  generateQueueId,
  toQueuedFile,
  toQueuedImage,
  toQueuedTextContext,
  toQueuedDiffTextContext,
} from "../stores/message-queue-store"
import { buildImagePart, buildFilePart, stripFileAttachmentText } from "../lib/message-utils"
import { utf8ToBase64, waitForStreamingReady } from "../main/chat-utils"
import { BUILTIN_SLASH_COMMANDS, MENTION_PREFIXES } from "../commands"
import { trackSendMessage, trackClickRegenerate } from "../../../lib/analytics"

// =============================================================================
// Types
// =============================================================================

export interface ImageAttachment {
  id: string
  url: string | null
  mediaType: string
  filename?: string
  base64Data?: string
  isLoading: boolean
}

export interface FileAttachment {
  id: string
  url: string | null
  filename: string
  type: string
  size: number
  isLoading: boolean
}

export interface TextContext {
  id: string
  text: string
  sourceMessageId?: string
  preview: string
  createdAt: Date
}

export interface DiffTextContext {
  id: string
  text: string
  filePath: string
  lineNumber?: number
  lineType?: "old" | "new"
  preview: string
  createdAt: Date
  comment?: string
}

export interface PastedTextFile {
  id: string
  filePath: string
  size: string
  preview: string
}

export interface EditorRef {
  getValue: () => string | undefined
  setValue: (value: string) => void
  clear: () => void
  focus: () => void
}

export interface MessageSendingOptions {
  // IDs
  subChatId: string
  parentChatId: string | null
  teamId?: string | null
  projectPath?: string

  // Status
  sandboxSetupStatus: "ready" | "pending" | "loading" | "error"
  isArchived: boolean

  // Refs (for stable access in callbacks)
  editorRef: MutableRefObject<EditorRef | null>
  imagesRef: MutableRefObject<ImageAttachment[]>
  filesRef: MutableRefObject<FileAttachment[]>
  textContextsRef: MutableRefObject<TextContext[]>
  diffTextContextsRef: MutableRefObject<DiffTextContext[]>
  pastedTextsRef: MutableRefObject<PastedTextFile[]>
  fileContentsRef: MutableRefObject<Map<string, string>>
  isStreamingRef: MutableRefObject<boolean>
  shouldAutoScrollRef: MutableRefObject<boolean>
  messagesLengthRef: MutableRefObject<number>
  hasTriggeredRenameRef: MutableRefObject<boolean>
  subChatModeRef: MutableRefObject<string>
  sendMessageRef: MutableRefObject<(message: { role: string; parts: any[] }) => Promise<void>>

  // Messages state (for edit/retry)
  messages: any[]
  setMessages: (messages: any[]) => void
  regenerate: () => void
  isStreaming: boolean

  // Callbacks
  onAutoRename: (userMessage: string, subChatId: string) => void
  onRestoreWorkspace?: () => void
  handleStop: () => Promise<void>
  scrollToBottom: () => void

  // Clear functions
  clearAll: () => void
  clearTextContexts: () => void
  clearDiffTextContexts: () => void
  clearPastedTexts: () => void
  clearFileContents: () => void
  clearSubChatDraft: (chatId: string, subChatId: string) => void

  // Restore functions (for queue restore)
  setImagesFromDraft: (images: any[]) => void
  setFilesFromDraft: (files: any[]) => void
  setTextContextsFromDraft: (contexts: any[]) => void
  setDiffTextContextsFromDraft: (contexts: any[]) => void

  // Expired questions cleanup
  setExpiredQuestionsMap: React.Dispatch<React.SetStateAction<Map<string, any>>>

  // tRPC utils for cache updates
  utils: {
    agents: {
      getAgentChats: {
        setData: (key: any, updater: any) => void
      }
    }
  }
}

export interface MessageSendingResult {
  handleSend: () => Promise<void>
  handleSendFromQueue: (itemId: string) => Promise<void>
  handleForceSend: () => Promise<void>
  handleRemoveFromQueue: (itemId: string) => void
  handleRestoreFromQueue: (item: AgentQueueItem) => void
  handleRetryMessage: () => void
  handleEditMessage: () => void
}

// =============================================================================
// Hook Implementation
// =============================================================================

export function useMessageSending(options: MessageSendingOptions): MessageSendingResult {
  const {
    subChatId,
    parentChatId,
    teamId,
    projectPath,
    sandboxSetupStatus,
    isArchived,
    editorRef,
    imagesRef,
    filesRef,
    textContextsRef,
    diffTextContextsRef,
    pastedTextsRef,
    fileContentsRef,
    isStreamingRef,
    shouldAutoScrollRef,
    messagesLengthRef,
    hasTriggeredRenameRef,
    subChatModeRef,
    sendMessageRef,
    messages,
    setMessages,
    regenerate,
    isStreaming,
    onAutoRename,
    onRestoreWorkspace,
    handleStop,
    scrollToBottom,
    clearAll,
    clearTextContexts,
    clearDiffTextContexts,
    clearPastedTexts,
    clearFileContents,
    clearSubChatDraft,
    setImagesFromDraft,
    setFilesFromDraft,
    setTextContextsFromDraft,
    setDiffTextContextsFromDraft,
    setExpiredQuestionsMap,
    utils,
  } = options

  // Queue store access
  const { addToQueue, removeFromQueue, popItemFromQueue } = useMessageQueueStore()

  // ---------------------------------------------------------------------------
  // Expand custom slash commands
  // ---------------------------------------------------------------------------
  const expandSlashCommand = useCallback(
    async (text: string): Promise<string> => {
      const slashMatch = text.match(/^\/(\S+)\s*(.*)$/s)
      if (!slashMatch) return text

      const [, commandName, args] = slashMatch
      const builtinNames = new Set(BUILTIN_SLASH_COMMANDS.map((cmd) => cmd.name))

      if (builtinNames.has(commandName)) return text

      try {
        const commands = await trpcClient.commands.list.query({ projectPath })
        const cmd = commands.find(
          (c) => c.name.toLowerCase() === commandName.toLowerCase()
        )
        if (cmd) {
          const { content } = await trpcClient.commands.getContent.query({
            path: cmd.path,
          })
          return content.replace(/\$ARGUMENTS/g, args.trim())
        }
      } catch (error) {
        console.error("Failed to expand custom slash command:", error)
      }

      return text
    },
    [projectPath]
  )

  // ---------------------------------------------------------------------------
  // Build mention prefix from contexts
  // ---------------------------------------------------------------------------
  const buildMentionPrefix = useCallback(
    (
      textContexts: TextContext[],
      diffTextContexts: DiffTextContext[],
      pastedTexts: PastedTextFile[]
    ): string => {
      if (
        textContexts.length === 0 &&
        diffTextContexts.length === 0 &&
        pastedTexts.length === 0
      ) {
        return ""
      }

      const quoteMentions = textContexts.map((tc) => {
        const preview = tc.preview.replace(/[:[\]]/g, "")
        const encodedText = utf8ToBase64(tc.text)
        return `@[${MENTION_PREFIXES.QUOTE}${preview}:${encodedText}]`
      })

      const diffMentions = diffTextContexts.map((dtc) => {
        const preview = dtc.preview.replace(/[:[\]]/g, "")
        const encodedText = utf8ToBase64(dtc.text)
        const lineNum = dtc.lineNumber || 0
        const encodedComment = dtc.comment ? utf8ToBase64(dtc.comment) : ""
        return `@[${MENTION_PREFIXES.DIFF}${dtc.filePath}:${lineNum}:${preview}:${encodedText}:${encodedComment}]`
      })

      const pastedTextMentions = pastedTexts.map((pt) => {
        const sanitizedPreview = pt.preview.replace(/[:[\]|]/g, "")
        return `@[${MENTION_PREFIXES.PASTED}${pt.size}:${sanitizedPreview}|${pt.filePath}]`
      })

      return [...quoteMentions, ...diffMentions, ...pastedTextMentions].join(" ") + " "
    },
    []
  )

  // ---------------------------------------------------------------------------
  // Update chat timestamps in query cache
  // ---------------------------------------------------------------------------
  const updateChatTimestamps = useCallback(() => {
    // Optimistic update: update chat's updated_at for sidebar sorting
    if (teamId) {
      const now = new Date()
      utils.agents.getAgentChats.setData({ teamId }, (old: any) => {
        if (!old) return old
        const updated = old.map((c: any) =>
          c.id === parentChatId ? { ...c, updated_at: now } : c
        )
        return updated.sort(
          (a: any, b: any) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
      })
    }

    // Desktop app: Optimistic update for chats.list
    const queryClient = getQueryClient()
    if (queryClient) {
      const now = new Date()
      const queries = queryClient.getQueryCache().getAll()
      const chatsListQuery = queries.find(
        (q) =>
          Array.isArray(q.queryKey) &&
          Array.isArray(q.queryKey[0]) &&
          q.queryKey[0][0] === "chats" &&
          q.queryKey[0][1] === "list"
      )
      if (chatsListQuery) {
        queryClient.setQueryData(chatsListQuery.queryKey, (old: any[] | undefined) => {
          if (!old) return old
          const updated = old.map((c: any) =>
            c.id === parentChatId ? { ...c, updatedAt: now } : c
          )
          return updated.sort(
            (a: any, b: any) =>
              new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )
        })
      }
    }

    // Update sub-chat timestamp in store
    useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)
  }, [teamId, parentChatId, subChatId, utils.agents.getAgentChats])

  // ---------------------------------------------------------------------------
  // Main send handler
  // ---------------------------------------------------------------------------
  const handleSend = useCallback(async () => {
    if (sandboxSetupStatus !== "ready") return

    // Clear expired questions
    setExpiredQuestionsMap((current) => {
      if (current.has(subChatId)) {
        const newMap = new Map(current)
        newMap.delete(subChatId)
        return newMap
      }
      return current
    })

    const inputValue = editorRef.current?.getValue() || ""
    const hasText = inputValue.trim().length > 0
    const currentImages = imagesRef.current
    const currentFiles = filesRef.current
    const currentTextContexts = textContextsRef.current
    const currentPastedTexts = pastedTextsRef.current
    const currentDiffTextContexts = diffTextContextsRef.current
    const hasImages = currentImages.filter((img) => !img.isLoading && img.url).length > 0
    const hasTextContexts = currentTextContexts.length > 0
    const hasPastedTexts = currentPastedTexts.length > 0
    const hasDiffTextContexts = currentDiffTextContexts.length > 0

    if (!hasText && !hasImages && !hasTextContexts && !hasPastedTexts && !hasDiffTextContexts) {
      return
    }

    // If streaming, add to queue
    if (isStreamingRef.current) {
      const queuedImages = currentImages
        .filter((img) => !img.isLoading && img.url)
        .map(toQueuedImage)
      const queuedFiles = currentFiles
        .filter((f) => !f.isLoading && f.url)
        .map(toQueuedFile)
      const queuedTextContexts = currentTextContexts.map(toQueuedTextContext)
      const queuedDiffTextContexts = currentDiffTextContexts.map(toQueuedDiffTextContext)

      const item = createQueueItem(
        generateQueueId(),
        inputValue.trim(),
        queuedImages.length > 0 ? queuedImages : undefined,
        queuedFiles.length > 0 ? queuedFiles : undefined,
        queuedTextContexts.length > 0 ? queuedTextContexts : undefined,
        queuedDiffTextContexts.length > 0 ? queuedDiffTextContexts : undefined
      )
      addToQueue(subChatId, item)

      editorRef.current?.clear()
      if (parentChatId) {
        clearSubChatDraft(parentChatId, subChatId)
      }
      clearAll()
      clearTextContexts()
      clearDiffTextContexts()
      clearPastedTexts()
      return
    }

    // Auto-restore archived workspace
    if (isArchived && onRestoreWorkspace) {
      onRestoreWorkspace()
    }

    const text = inputValue.trim()
    const finalText = await expandSlashCommand(text)

    // Clear editor and draft
    editorRef.current?.clear()
    if (parentChatId) {
      clearSubChatDraft(parentChatId, subChatId)
    }

    // Trigger auto-rename on first message
    if (messagesLengthRef.current === 0 && !hasTriggeredRenameRef.current) {
      hasTriggeredRenameRef.current = true
      onAutoRename(finalText || "Image message", subChatId)
    }

    // Build message parts
    const parts: any[] = [
      ...currentImages.filter((img) => !img.isLoading && img.url).map(buildImagePart),
      ...currentFiles.filter((f) => !f.isLoading && f.url).map(buildFilePart),
    ]

    const mentionPrefix = buildMentionPrefix(
      currentTextContexts,
      currentDiffTextContexts,
      currentPastedTexts
    )

    if (finalText || mentionPrefix) {
      parts.push({ type: "text", text: mentionPrefix + (finalText || "") })
    }

    // Add cached file contents
    if (fileContentsRef.current.size > 0) {
      for (const [mentionId, content] of fileContentsRef.current.entries()) {
        const filePath = mentionId.replace(/^file:(local|external):/, "")
        parts.push({
          type: "data-file-content" as const,
          data: { filePath, content },
        })
      }
    }

    clearAll()
    clearTextContexts()
    clearDiffTextContexts()
    clearPastedTexts()
    clearFileContents()

    updateChatTimestamps()

    shouldAutoScrollRef.current = true
    scrollToBottom()

    const hasAt = parts.some((p: any) => p.type === "text" && p.text?.includes("@"))
    trackSendMessage(subChatModeRef.current, hasAt)

    await sendMessageRef.current({ role: "user", parts })
  }, [
    sandboxSetupStatus,
    isArchived,
    onRestoreWorkspace,
    parentChatId,
    subChatId,
    onAutoRename,
    clearAll,
    clearTextContexts,
    clearPastedTexts,
    clearDiffTextContexts,
    clearFileContents,
    clearSubChatDraft,
    addToQueue,
    setExpiredQuestionsMap,
    expandSlashCommand,
    buildMentionPrefix,
    updateChatTimestamps,
    scrollToBottom,
  ])

  // ---------------------------------------------------------------------------
  // Send from queue
  // ---------------------------------------------------------------------------
  const handleSendFromQueue = useCallback(
    async (itemId: string) => {
      const item = popItemFromQueue(subChatId, itemId)
      if (!item) return

      try {
        if (isStreamingRef.current) {
          await handleStop()
          await waitForStreamingReady(subChatId)
        }

        const parts: any[] = [
          ...(item.images || []).map(buildImagePart),
          ...(item.files || []).map(buildFilePart),
        ]

        let mentionPrefix = ""
        if (item.textContexts && item.textContexts.length > 0) {
          const quoteMentions = item.textContexts.map((tc) => {
            const preview = tc.text.slice(0, 50).replace(/[:[\]]/g, "")
            const encodedText = utf8ToBase64(tc.text)
            return `@[${MENTION_PREFIXES.QUOTE}${preview}:${encodedText}]`
          })
          mentionPrefix = quoteMentions.join(" ") + " "
        }

        if (item.diffTextContexts && item.diffTextContexts.length > 0) {
          const diffMentions = item.diffTextContexts.map((dtc) => {
            const preview = dtc.text.slice(0, 50).replace(/[:[\]]/g, "")
            const encodedText = utf8ToBase64(dtc.text)
            const lineNum = dtc.lineNumber || 0
            return `@[${MENTION_PREFIXES.DIFF}${dtc.filePath}:${lineNum}:${preview}:${encodedText}]`
          })
          mentionPrefix += diffMentions.join(" ") + " "
        }

        if (item.message || mentionPrefix) {
          parts.push({ type: "text", text: mentionPrefix + (item.message || "") })
        }

        useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)

        shouldAutoScrollRef.current = true
        scrollToBottom()

        const hasAt = parts.some((p: any) => p.type === "text" && p.text?.includes("@"))
        trackSendMessage(subChatModeRef.current, hasAt)

        await sendMessageRef.current({ role: "user", parts })
      } catch (error) {
        console.error("[handleSendFromQueue] Error:", error)
        useMessageQueueStore.getState().prependItem(subChatId, item)
      }
    },
    [subChatId, popItemFromQueue, handleStop, scrollToBottom]
  )

  // ---------------------------------------------------------------------------
  // Remove from queue
  // ---------------------------------------------------------------------------
  const handleRemoveFromQueue = useCallback(
    (itemId: string) => {
      removeFromQueue(subChatId, itemId)
    },
    [subChatId, removeFromQueue]
  )

  // ---------------------------------------------------------------------------
  // Restore from queue
  // ---------------------------------------------------------------------------
  const handleRestoreFromQueue = useCallback(
    (item: AgentQueueItem) => {
      removeFromQueue(subChatId, item.id)

      if (item.message) {
        editorRef.current?.setValue(item.message)
      }

      if (item.images && item.images.length > 0) {
        const restoredImages = item.images.map((img) => ({
          id: img.id,
          url: img.url,
          mediaType: img.mediaType,
          filename: img.filename || "image",
          base64Data: img.base64Data,
          isLoading: false,
        }))
        setImagesFromDraft(restoredImages)
      }

      if (item.files && item.files.length > 0) {
        const restoredFiles = item.files.map((f) => ({
          id: f.id,
          url: f.url,
          filename: f.filename,
          type: f.mediaType || "application/octet-stream",
          size: f.size || 0,
          isLoading: false,
        }))
        setFilesFromDraft(restoredFiles)
      }

      if (item.textContexts && item.textContexts.length > 0) {
        const restoredTextContexts = item.textContexts.map((tc) => ({
          id: tc.id,
          text: tc.text,
          sourceMessageId: tc.sourceMessageId,
          preview: tc.text.slice(0, 50) + (tc.text.length > 50 ? "..." : ""),
          createdAt: new Date(),
        }))
        setTextContextsFromDraft(restoredTextContexts)
      }

      if (item.diffTextContexts && item.diffTextContexts.length > 0) {
        const restoredDiffTextContexts = item.diffTextContexts.map((dtc) => ({
          id: dtc.id,
          text: dtc.text,
          filePath: dtc.filePath,
          lineNumber: dtc.lineNumber,
          lineType: dtc.lineType,
          preview: dtc.text.slice(0, 50) + (dtc.text.length > 50 ? "..." : ""),
          createdAt: new Date(),
          comment: dtc.comment,
        }))
        setDiffTextContextsFromDraft(restoredDiffTextContexts)
      }

      editorRef.current?.focus()
    },
    [
      subChatId,
      removeFromQueue,
      setImagesFromDraft,
      setFilesFromDraft,
      setTextContextsFromDraft,
      setDiffTextContextsFromDraft,
    ]
  )

  // ---------------------------------------------------------------------------
  // Force send (Opt+Enter)
  // ---------------------------------------------------------------------------
  const handleForceSend = useCallback(async () => {
    if (sandboxSetupStatus !== "ready") return

    const inputValue = editorRef.current?.getValue() || ""
    const hasText = inputValue.trim().length > 0
    const currentImages = imagesRef.current
    const currentFiles = filesRef.current
    const hasImages = currentImages.filter((img) => !img.isLoading && img.url).length > 0

    if (!hasText && !hasImages) return

    if (isStreamingRef.current) {
      await handleStop()
      await waitForStreamingReady(subChatId)
    }

    if (isArchived && onRestoreWorkspace) {
      onRestoreWorkspace()
    }

    const text = inputValue.trim()
    const finalText = await expandSlashCommand(text)

    editorRef.current?.clear()
    if (parentChatId) {
      clearSubChatDraft(parentChatId, subChatId)
    }

    const parts: any[] = [
      ...currentImages.filter((img) => !img.isLoading && img.url).map(buildImagePart),
      ...currentFiles.filter((f) => !f.isLoading && f.url).map(buildFilePart),
    ]

    if (finalText) {
      parts.push({ type: "text", text: finalText })
    }

    clearAll()

    useAgentSubChatStore.getState().updateSubChatTimestamp(subChatId)

    shouldAutoScrollRef.current = true
    scrollToBottom()

    const hasAt = parts.some((p: any) => p.type === "text" && p.text?.includes("@"))
    trackSendMessage(subChatModeRef.current, hasAt)

    try {
      await sendMessageRef.current({ role: "user", parts })
    } catch (error) {
      console.error("[handleForceSend] Error:", error)
      editorRef.current?.setValue(finalText)
    }
  }, [
    sandboxSetupStatus,
    isArchived,
    onRestoreWorkspace,
    parentChatId,
    subChatId,
    handleStop,
    clearAll,
    clearSubChatDraft,
    expandSlashCommand,
    scrollToBottom,
  ])

  // ---------------------------------------------------------------------------
  // Retry message
  // ---------------------------------------------------------------------------
  const handleRetryMessage = useCallback(() => {
    if (isStreaming) return

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return

    const lastUserMsgIndex = messages.indexOf(lastUserMsg)
    const hasAssistantResponse = messages
      .slice(lastUserMsgIndex + 1)
      .some((m) => m.role === "assistant")
    if (hasAssistantResponse) return

    trackClickRegenerate()
    regenerate()
  }, [messages, isStreaming, regenerate])

  // ---------------------------------------------------------------------------
  // Edit message
  // ---------------------------------------------------------------------------
  const handleEditMessage = useCallback(() => {
    if (isStreaming) return

    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return

    const lastUserMsgIndex = messages.indexOf(lastUserMsg)
    const hasAssistantResponse = messages
      .slice(lastUserMsgIndex + 1)
      .some((m) => m.role === "assistant")
    if (hasAssistantResponse) return

    const textParts = lastUserMsg.parts?.filter((p: any) => p.type === "text") || []
    const rawText = textParts.map((p: any) => p.text).join("\n")
    const { cleanedText } = stripFileAttachmentText(rawText)

    const truncatedMessages = messages.slice(0, lastUserMsgIndex)
    setMessages(truncatedMessages)

    trpcClient.chats.updateSubChatMessages.mutate({
      id: subChatId,
      messages: JSON.stringify(truncatedMessages),
    })

    editorRef.current?.setValue(cleanedText)
    editorRef.current?.focus()
  }, [messages, isStreaming, setMessages, subChatId])

  return {
    handleSend,
    handleSendFromQueue,
    handleForceSend,
    handleRemoveFromQueue,
    handleRestoreFromQueue,
    handleRetryMessage,
    handleEditMessage,
  }
}
