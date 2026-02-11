"use client"

import { memo, useMemo } from "react"
import { useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import { RotateCcw } from "lucide-react"
import {
  messageAtomFamily,
  assistantIdsForUserMsgAtomFamily,
  isLastUserMessageAtomFamily,
  isStreamingAtom,
  isStreamingIdleAtom,
  isMessagesSyncedAtom,
} from "../stores/message-store"
import { MemoizedAssistantMessages } from "./messages-list"
import { extractTextMentions, TextMentionBlock } from "../mentions/render-file-mentions"
import { AgentImageItem } from "../ui/agent-image-item"

// ============================================================================
// ISOLATED MESSAGE GROUP (LAYER 4)
// ============================================================================
// Renders ONE user message and its associated assistant messages.
// Subscribes to Jotai atoms for:
// - The specific user message
// - Assistant message IDs for this group
// - Whether this is the last user message
// - Streaming status
//
// Only re-renders when:
// - User message content changes (rare)
// - New assistant message is added to this group
// - This becomes/stops being the last group
// - Streaming starts/stops (for planning indicator)
// ============================================================================

interface IsolatedMessageGroupProps {
  userMsgId: string
  subChatId: string
  chatId: string
  isMobile: boolean
  sandboxSetupStatus: "cloning" | "ready" | "error"
  stickyTopClass: string
  sandboxSetupError?: string
  onRetrySetup?: () => void
  onRetryMessage?: () => void
  // Components passed from parent - must be stable references
  UserBubbleComponent: React.ComponentType<{
    messageId: string
    textContent: string
    imageParts: any[]
    skipTextMentionBlocks?: boolean
  }>
  ToolCallComponent: React.ComponentType<{
    icon: any
    title: string
    isPending: boolean
    isError: boolean
  }>
  MessageGroupWrapper: React.ComponentType<{ children: React.ReactNode; isLastGroup?: boolean }>
  toolRegistry: Record<string, { icon: any; title: (args: any) => string }>
}

function areGroupPropsEqual(
  prev: IsolatedMessageGroupProps,
  next: IsolatedMessageGroupProps
): boolean {
  return (
    prev.userMsgId === next.userMsgId &&
    prev.subChatId === next.subChatId &&
    prev.chatId === next.chatId &&
    prev.isMobile === next.isMobile &&
    prev.sandboxSetupStatus === next.sandboxSetupStatus &&
    prev.stickyTopClass === next.stickyTopClass &&
    prev.sandboxSetupError === next.sandboxSetupError &&
    prev.onRetrySetup === next.onRetrySetup &&
    prev.onRetryMessage === next.onRetryMessage &&
    prev.UserBubbleComponent === next.UserBubbleComponent &&
    prev.ToolCallComponent === next.ToolCallComponent &&
    prev.MessageGroupWrapper === next.MessageGroupWrapper &&
    prev.toolRegistry === next.toolRegistry
  )
}

export const IsolatedMessageGroup = memo(function IsolatedMessageGroup({
  userMsgId,
  subChatId,
  chatId,
  isMobile,
  sandboxSetupStatus,
  stickyTopClass,
  sandboxSetupError,
  onRetrySetup,
  onRetryMessage,
  UserBubbleComponent,
  ToolCallComponent,
  MessageGroupWrapper,
  toolRegistry,
}: IsolatedMessageGroupProps) {
  const { t } = useTranslation("chat")

  // Subscribe to specific atoms - NOT the whole messages array
  const userMsg = useAtomValue(messageAtomFamily(userMsgId))
  const assistantIds = useAtomValue(assistantIdsForUserMsgAtomFamily(userMsgId))
  const isLastGroup = useAtomValue(isLastUserMessageAtomFamily(userMsgId))
  const isStreaming = useAtomValue(isStreamingAtom)
  const isStreamingIdle = useAtomValue(isStreamingIdleAtom)
  const isMessagesSynced = useAtomValue(isMessagesSyncedAtom)

  // Extract user message content
  // Note: file-content parts are hidden from UI but sent to agent
  const rawTextContent =
    userMsg?.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") || ""

  const imageParts =
    userMsg?.parts?.filter((p: any) => p.type === "data-image") || []

  // Extract text mentions (quote/diff) to render separately above sticky block
  // NOTE: useMemo must be called before any early returns to follow Rules of Hooks
  const { textMentions, cleanedText: textContent } = useMemo(
    () => extractTextMentions(rawTextContent),
    [rawTextContent]
  )

  if (!userMsg) return null

  // Show cloning when sandbox is being set up
  const shouldShowCloning =
    sandboxSetupStatus === "cloning" && isLastGroup && assistantIds.length === 0

  // Show setup error if sandbox setup failed
  const shouldShowSetupError =
    sandboxSetupStatus === "error" && isLastGroup && assistantIds.length === 0

  // Show retry option when:
  // - This is the last user message
  // - No assistant response received
  // - Not currently streaming
  // - Not a sandbox setup issue (cloning or error)
  // - Messages have been synced (not in workspace switch loading gap)
  const shouldShowRetry =
    isLastGroup &&
    assistantIds.length === 0 &&
    !isStreaming &&
    isMessagesSynced &&
    sandboxSetupStatus === "ready" &&
    onRetryMessage

  // Check if this is an image-only message (no text content and no text mentions)
  const isImageOnlyMessage = imageParts.length > 0 && !textContent.trim() && textMentions.length === 0

  // Check if this is an attachment-only message (no text but has images or text mentions)
  const isAttachmentOnlyMessage = !textContent.trim() && (imageParts.length > 0 || textMentions.length > 0)

  return (
    <MessageGroupWrapper isLastGroup={isLastGroup}>
      {/* All attachments in one row - NOT sticky (only when there's also text) */}
      {((!isImageOnlyMessage && imageParts.length > 0) || textMentions.length > 0) && (
        <div className="mb-2 pointer-events-auto flex flex-wrap items-end gap-1.5">
          {imageParts.length > 0 && !isImageOnlyMessage && (() => {
            const allImages = imageParts
              .filter((img: any) => img.data?.url)
              .map((img: any, idx: number) => ({
                id: `${userMsgId}-img-${idx}`,
                filename: img.data?.filename || "image",
                url: img.data?.url || "",
              }))
            return imageParts.map((img: any, idx: number) => (
              <AgentImageItem
                key={`${userMsgId}-img-${idx}`}
                id={`${userMsgId}-img-${idx}`}
                filename={img.data?.filename || "image"}
                url={img.data?.url || ""}
                allImages={allImages}
                imageIndex={idx}
              />
            ))
          })()}
          {textMentions.map((mention, idx) => (
            <TextMentionBlock key={`mention-${idx}`} mention={mention} />
          ))}
        </div>
      )}

      {/* User message text - sticky (or attachment-only summary bubble) */}
      <div
        data-user-message-id={userMsgId}
        className={`[&>div]:mb-4! pointer-events-auto sticky z-10 ${stickyTopClass}`}
      >
        {/* Show "Using X" summary when no text but have attachments */}
        {isAttachmentOnlyMessage && !isImageOnlyMessage ? (
          <div className="flex justify-start drop-shadow-[0_10px_20px_hsl(var(--background))]" data-user-bubble>
            <div className="flex flex-col gap-2 w-full">
              <div className="bg-input-background border px-3 py-2 rounded-xl text-sm text-muted-foreground italic">
              {(() => {
                const parts: string[] = []
                if (imageParts.length > 0) {
                  parts.push(imageParts.length === 1 ? "image" : `${imageParts.length} images`)
                }
                const quoteCount = textMentions.filter(m => m.type === "quote" || m.type === "pasted").length
                const codeCount = textMentions.filter(m => m.type === "diff").length
                if (quoteCount > 0) {
                  parts.push(quoteCount === 1 ? "selected text" : `${quoteCount} text selections`)
                }
                if (codeCount > 0) {
                  parts.push(codeCount === 1 ? "code selection" : `${codeCount} code selections`)
                }
                return `Using ${parts.join(", ")}`
              })()}
              </div>
            </div>
          </div>
        ) : (
          <UserBubbleComponent
            messageId={userMsgId}
            textContent={textContent}
            imageParts={isImageOnlyMessage ? imageParts : []}
            skipTextMentionBlocks={!isImageOnlyMessage}
          />
        )}

        {/* Cloning indicator */}
        {shouldShowCloning && (
          <div className="mt-4">
            <ToolCallComponent
              icon={toolRegistry["tool-cloning"]?.icon}
              title={toolRegistry["tool-cloning"]?.title({}) || "Cloning..."}
              isPending={true}
              isError={false}
            />
          </div>
        )}

        {/* Setup error with retry */}
        {shouldShowSetupError && (
          <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
            <div className="flex items-center gap-2 text-destructive text-sm">
              <span>
                Failed to set up sandbox
                {sandboxSetupError ? `: ${sandboxSetupError}` : ""}
              </span>
              {onRetrySetup && (
                <button
                  className="px-2 py-1 text-sm hover:bg-destructive/20 rounded"
                  onClick={onRetrySetup}
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Assistant messages - memoized, only re-renders when IDs change */}
      {assistantIds.length > 0 && (
        <MemoizedAssistantMessages
          assistantMsgIds={assistantIds}
          subChatId={subChatId}
          chatId={chatId}
          isMobile={isMobile}
          sandboxSetupStatus={sandboxSetupStatus}
        />
      )}

      {/* Working indicator - shown when AI is streaming but between visible tool calls */}
      {isStreamingIdle && isLastGroup && assistantIds.length > 0 && (
        <div className="mt-4">
          <ToolCallComponent
            icon={toolRegistry["tool-planning"]?.icon}
            title={toolRegistry["tool-planning"]?.title({}) || "Working..."}
            isPending={true}
            isError={false}
          />
        </div>
      )}

      {/* Planning indicator */}
      {isStreaming &&
        isLastGroup &&
        assistantIds.length === 0 &&
        sandboxSetupStatus === "ready" && (
          <div className="mt-4">
            <ToolCallComponent
              icon={toolRegistry["tool-planning"]?.icon}
              title={toolRegistry["tool-planning"]?.title({}) || "Planning..."}
              isPending={true}
              isError={false}
            />
          </div>
        )}

      {/* No response - retry option */}
      {shouldShowRetry && (
        <div className="mt-4 p-3 bg-muted/50 border border-border rounded-lg">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {t("status.noResponse")}
            </span>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors"
              onClick={onRetryMessage}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("actions.retry")}
            </button>
          </div>
        </div>
      )}
    </MessageGroupWrapper>
  )
}, areGroupPropsEqual)
