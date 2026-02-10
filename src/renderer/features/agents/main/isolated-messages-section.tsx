"use client"

import { memo, useLayoutEffect, useRef } from "react"
import { useAtomValue } from "jotai"
import { Virtuoso, type VirtuosoHandle, type Components } from "react-virtuoso"
import { userMessageIdsAtom, currentSubChatIdAtom } from "../stores/message-store"
import { IsolatedMessageGroup } from "./isolated-message-group"
import { agentsChatFullWidthAtom } from "../../agents/atoms"
import { cn } from "../../../lib/utils"

// ============================================================================
// ISOLATED MESSAGES SECTION (LAYER 3)
// ============================================================================
// Renders ALL message groups by subscribing to userMessageIdsAtom.
// Uses react-virtuoso for virtualization to handle long conversations efficiently.
// ============================================================================

interface IsolatedMessagesSectionProps {
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
  virtuosoRef?: React.RefObject<VirtuosoHandle>
  onAtBottomStateChange?: (atBottom: boolean) => void
  onScroll?: (e: Event) => void
}

function areSectionPropsEqual(
  prev: IsolatedMessagesSectionProps,
  next: IsolatedMessagesSectionProps
): boolean {
  return (
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
    prev.toolRegistry === next.toolRegistry &&
    prev.virtuosoRef === next.virtuosoRef &&
    prev.onAtBottomStateChange === next.onAtBottomStateChange &&
    prev.onScroll === next.onScroll
  )
}

export const IsolatedMessagesSection = memo(function IsolatedMessagesSection({
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
  virtuosoRef,
  onAtBottomStateChange,
  onScroll,
}: IsolatedMessagesSectionProps) {
  // Global atoms
  const currentSubChatId = useAtomValue(currentSubChatIdAtom)
  const userMsgIds = useAtomValue(userMessageIdsAtom)
  const isChatFullWidth = useAtomValue(agentsChatFullWidthAtom)

  // Performance logging
  const _renderStart = performance.now()
  useLayoutEffect(() => {
    const duration = performance.now() - _renderStart
    if (duration > 10) {
      console.log(`[IsolatedMessagesSection] RENDER: ${duration.toFixed(0)}ms (msgs=${userMsgIds.length})`)
    }
  })

  // Guard: sync check
  if (currentSubChatId !== subChatId) {
    if (userMsgIds.length > 0) {
      return null
    }
  }

  // Define components for Virtuoso
  const Scroller = useRef<Components["Scroller"]>(
    ({ style, ...props }: any) => {
      return (
        <div
          style={{ ...style }}
          className="w-full h-full overflow-y-auto relative allow-text-selection outline-hidden scroll-smooth"
          tabIndex={-1}
          data-chat-container
          {...props}
        />
      )
    }
  ).current

  const List = useRef<Components["List"]>(
    ({ style, children, ...props }: any) => {
      return (
        <div
          style={{ ...style, paddingBottom: "32px" }}
          className="w-full"
          {...props}
        >
          {children}
        </div>
      )
    }
  ).current

  return (
    <Virtuoso
      ref={virtuosoRef}
      style={{ height: "100%", width: "100%" }}
      data={userMsgIds}
      initialTopMostItemIndex={userMsgIds.length - 1}
      // Follow output: "auto" works well for chat, but we can control it if needed
      followOutput="auto"
      alignToBottom={false} // We don't force align to bottom because we want natural scroll
      atBottomThreshold={60}
      atBottomStateChange={onAtBottomStateChange}
      // Pass raw scroll events for header/auto-scroll logic in parent
      onScroll={onScroll}
      components={{ Scroller, List }}
      itemContent={(index, userMsgId) => (
        <div
          className={cn(
            "px-2 mx-auto mb-4", // Added mb-4 to replicate space-y-4
            !isChatFullWidth && "max-w-2xl"
          )}
        >
          <IsolatedMessageGroup
            key={userMsgId}
            userMsgId={userMsgId}
            subChatId={subChatId}
            chatId={chatId}
            isMobile={isMobile}
            sandboxSetupStatus={sandboxSetupStatus}
            stickyTopClass={stickyTopClass}
            sandboxSetupError={sandboxSetupError}
            onRetrySetup={onRetrySetup}
            onRetryMessage={onRetryMessage}
            UserBubbleComponent={UserBubbleComponent}
            ToolCallComponent={ToolCallComponent}
            MessageGroupWrapper={MessageGroupWrapper}
            toolRegistry={toolRegistry}
          />
        </div>
      )}
    />
  )
}, areSectionPropsEqual)
