"use client"

import { useState } from "react"
import { memo, useMemo } from "react"
import { useAtomValue } from "jotai"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight, Copy, Check } from "lucide-react"
import dayjs from "dayjs"
import { showDebugRequestAtom } from "../atoms"
import {
  messageAtomFamily,
  assistantIdsForUserMsgAtomFamily,
  isLastUserMessageAtomFamily,
  isStreamingAtom,
  isStreamingIdleAtom,
  currentSubChatIdAtom,
} from "../stores/message-store"
import { MemoizedAssistantMessages } from "./messages-list"
import { extractTextMentions, TextMentionBlock } from "../mentions/render-file-mentions"
import { AgentImageItem } from "../ui/agent-image-item"
import { stripFileAttachmentText } from "../lib/message-utils"
import { trpc } from "../../../lib/trpc"
import { toast } from "sonner"
import { MessageJsonDisplay } from "../ui/message-json-display"

function formatMessageTime(date: Date | string | undefined): string | null {
  if (!date) return null
  const d = dayjs(date)
  if (!d.isValid()) return null
  return d.isSame(dayjs(), "day") ? d.format("HH:mm") : d.format("M/D HH:mm")
}

function formatMessageTimeFull(date: Date | string | undefined): string | null {
  if (!date) return null
  const d = dayjs(date)
  if (!d.isValid()) return null
  return d.format("YYYY/M/D HH:mm:ss")
}

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
    fileParts?: any[]
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
  const currentSubChatId = useAtomValue(currentSubChatIdAtom)

  // Debug data state - only shown when showDebugRequest is enabled
  const showDebugRequest = useAtomValue(showDebugRequestAtom)
  const [expandedDebugSections, setExpandedDebugSections] = useState<Set<string>>(new Set())
  const [copiedDebugJson, setCopiedDebugJson] = useState(false)

  // Query debug data for this subChat
  const { data: debugData } = trpc.debug.getLastUserMessage.useQuery(
    { subChatId },
    { enabled: showDebugRequest && !!subChatId }
  )

  // Debug logs
  console.log('[IsolatedMessageGroup Debug] showDebugRequest:', showDebugRequest)
  console.log('[IsolatedMessageGroup Debug] subChatId:', subChatId)
  console.log('[IsolatedMessageGroup Debug] debugData:', debugData)
  console.log('[IsolatedMessageGroup Debug] hasRequestPayload:', !!debugData?.requestPayload)

  const toggleDebugSection = (section: string) => {
    setExpandedDebugSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        next.delete(section)
      } else {
        next.add(section)
      }
      return next
    })
  }

  const handleCopyDebugJson = async () => {
    if (debugData?.requestPayload) {
      await navigator.clipboard.writeText(JSON.stringify(debugData.requestPayload, null, 2))
      setCopiedDebugJson(true)
      toast.success("Debug request data copied")
      setTimeout(() => setCopiedDebugJson(false), 2000)
    }
  }

  const formatDebugValue = (value: unknown): string => {
    if (value === undefined || value === null) return "null"
    if (typeof value === "string") return value
    if (typeof value === "number") return String(value)
    if (typeof value === "boolean") return value ? "true" : "false"
    if (Array.isArray(value)) {
      if (value.length === 0) return "[]"
      return `[${value.length} items]`
    }
    if (typeof value === "object") {
      const keys = Object.keys(value)
      if (keys.length === 0) return "{}"
      return `{${keys.length} keys}`
    }
    return String(value)
  }

  // Extract user message content
  // Note: file-content parts are hidden from UI but sent to agent
  // stripFileAttachmentText removes AI-facing "[The user has attached...]" instructions
  // and extracts file metadata as fallback for old messages without data-file parts
  const { cleanedText: rawTextContent, parsedFiles } = stripFileAttachmentText(
    userMsg?.parts
      ?.filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("\n") || ""
  )

  const imageParts =
    userMsg?.parts?.filter((p: any) => p.type === "data-image") || []
  const dbFileParts =
    userMsg?.parts?.filter((p: any) => p.type === "data-file") || []
  // Use DB data-file parts if available, otherwise reconstruct from parsed text
  const fileParts = dbFileParts.length > 0
    ? dbFileParts
    : parsedFiles.map((f) => ({ type: "data-file", data: { filename: f.filename, size: f.size, localPath: f.localPath } }))

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
  // - Current active subChat ID matches this subChat (prevents retry during switch gap)
  const shouldShowRetry =
    isLastGroup &&
    assistantIds.length === 0 &&
    !isStreaming &&
    currentSubChatId === subChatId &&
    sandboxSetupStatus === "ready" &&
    onRetryMessage

  // Check if this is an image-only message (no text content and no text mentions)
  const isImageOnlyMessage = imageParts.length > 0 && !textContent.trim() && textMentions.length === 0 && fileParts.length === 0

  // Check if this is an attachment-only message (no text but has images, files, or text mentions)
  const isAttachmentOnlyMessage = !textContent.trim() && (imageParts.length > 0 || fileParts.length > 0 || textMentions.length > 0)

  return (
    <MessageGroupWrapper isLastGroup={isLastGroup}>
      {/* All attachments in one row - NOT sticky (only when there's also text) */}
      {((!isImageOnlyMessage && imageParts.length > 0) || fileParts.length > 0 || textMentions.length > 0) && (
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
                if (fileParts.length > 0) {
                  parts.push(fileParts.length === 1 ? "file" : `${fileParts.length} files`)
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
            fileParts={fileParts}
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

      {/* User message timestamp with hover tooltip */}
      {userMsg.createdAt && (
        <div className="flex justify-end px-2 -mt-3 mb-1">
          <span className="relative text-[10px] text-muted-foreground/40 cursor-default group/ts">
            {formatMessageTime(userMsg.createdAt)}
            <span className="absolute bottom-full right-0 mb-1 px-2 py-1 text-[10px] bg-popover text-popover-foreground border rounded-md shadow-sm whitespace-nowrap opacity-0 group-hover/ts:opacity-100 transition-opacity duration-150 pointer-events-none">
              {formatMessageTimeFull(userMsg.createdAt)}
            </span>
          </span>
        </div>
      )}

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

      {/* Debug Request display - shown when showDebugRequest is enabled */}
      {showDebugRequest && debugData && Object.keys(debugData).length > 0 && (
        <div className="pointer-events-auto mt-1 mb-2">
          <div className="rounded-lg border border-muted bg-muted/30">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-muted">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Debug Request</span>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {debugData.timestamp || "-"}
              </span>
            </div>

            {/* Request data */}
            <div className="p-3 max-h-[500px] overflow-y-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {JSON.stringify(debugData, null, 2)}
              </pre>
            </div>

            {/* Copy button */}
            <div className="p-3 border-t border-muted">
              <button
                onClick={() => {
                  const dataStr = JSON.stringify(debugData, null, 2)
                  navigator.clipboard.writeText(dataStr)
                  toast.success("Debug request data copied")
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors"
              >
                Copy Full JSON
              </button>
            </div>
          </div>
        </div>
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
