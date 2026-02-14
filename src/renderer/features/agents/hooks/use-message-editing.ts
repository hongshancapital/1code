import { useCallback } from "react"
import type { Message } from "@ai-sdk/react"
import type { Editor } from "@/renderer/features/agents/ui/chat-input/prompt-input/lib/slate"
import { trackClickRegenerate } from "@/lib/sensors-analytics"
import { trpcClient } from "@/lib/trpc"
import { stripFileAttachmentText } from "../lib/message-utils"

export interface UseMessageEditingOptions {
  messages: Message[]
  isStreaming: boolean
  subChatId: string
  setMessages: (messages: Message[]) => void
  regenerate: () => void
  editorRef: React.RefObject<Editor | null>
}

export interface UseMessageEditingReturn {
  handleRetryMessage: () => void
  handleEditMessage: () => void
}

/**
 * Hook for message retry and edit operations.
 *
 * handleRetryMessage: Re-sends the last user message when no response was received.
 * handleEditMessage: Removes the last user message and puts its text back in the input.
 */
export function useMessageEditing({
  messages,
  isStreaming,
  subChatId,
  setMessages,
  regenerate,
  editorRef,
}: UseMessageEditingOptions): UseMessageEditingReturn {
  // Retry message - resend the last user message when no response was received
  // Uses regenerate() to re-trigger without duplicating the user message
  const handleRetryMessage = useCallback(() => {
    // Don't retry if currently streaming
    if (isStreaming) return

    // Find the last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return

    // Don't retry if there's already an assistant response for this message
    const lastUserMsgIndex = messages.indexOf(lastUserMsg)
    const hasAssistantResponse = messages.slice(lastUserMsgIndex + 1).some((m) => m.role === "assistant")
    if (hasAssistantResponse) return

    // Track regenerate click
    trackClickRegenerate()

    // Use regenerate to re-send without duplicating user message
    regenerate()
  }, [messages, isStreaming, regenerate])

  // Edit message - remove the last user message and put its text back in the input
  const handleEditMessage = useCallback(() => {
    if (isStreaming) return

    // Find the last user message
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUserMsg) return

    // Don't edit if there's already an assistant response
    const lastUserMsgIndex = messages.indexOf(lastUserMsg)
    const hasAssistantResponse = messages.slice(lastUserMsgIndex + 1).some((m) => m.role === "assistant")
    if (hasAssistantResponse) return

    // Extract text content from the user message
    const textParts = lastUserMsg.parts?.filter((p: any) => p.type === "text") || []
    const rawText = textParts.map((p: any) => p.text).join("\n")
    const { cleanedText } = stripFileAttachmentText(rawText)

    // Truncate messages (remove the last user message and anything after)
    const truncatedMessages = messages.slice(0, lastUserMsgIndex)
    setMessages(truncatedMessages)

    // Persist to database
    trpcClient.chats.updateSubChatMessages.mutate({
      id: subChatId,
      messages: JSON.stringify(truncatedMessages),
    })

    // Put the text back in the input
    editorRef.current?.setValue(cleanedText)
    editorRef.current?.focus()
  }, [messages, isStreaming, setMessages, subChatId])

  return { handleRetryMessage, handleEditMessage }
}
