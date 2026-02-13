"use client"

import { memo } from "react"
import { useAtomValue } from "jotai"
import { userMessageIdsAtom, currentSubChatIdAtom } from "../stores/message-store"
import { IsolatedMessageGroup } from "./isolated-message-group"

// ============================================================================
// ISOLATED MESSAGES SECTION (LAYER 3)
// ============================================================================
// Renders ALL message groups by subscribing to userMessageIdsAtom.
// Only re-renders when a new user message is added (new conversation turn).
// Each group independently subscribes to its own data via IsolatedMessageGroup.
//
// During streaming:
// - This component does NOT re-render (userMessageIds don't change)
// - Individual groups don't re-render (their user msg + assistant IDs don't change)
// - Only the AssistantMessageItem for the streaming message re-renders
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
  onEditMessage?: () => void
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
    prev.onEditMessage === next.onEditMessage &&
    prev.UserBubbleComponent === next.UserBubbleComponent &&
    prev.ToolCallComponent === next.ToolCallComponent &&
    prev.MessageGroupWrapper === next.MessageGroupWrapper &&
    prev.toolRegistry === next.toolRegistry
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
  onEditMessage,
  UserBubbleComponent,
  ToolCallComponent,
  MessageGroupWrapper,
  toolRegistry,
}: IsolatedMessagesSectionProps) {
  // CRITICAL: Check if global atoms are synced for THIS subChat FIRST
  // With keep-alive tabs, multiple ChatViewInner instances exist simultaneously.
  // Global atoms (messageIdsAtom, etc.) contain data from the ACTIVE tab only.
  // When a tab becomes active, useLayoutEffect syncs its messages to global atoms,
  // but that happens AFTER this component renders. So on first render after activation,
  // we might read stale data from the previous active tab.
  //
  // Solution: Check currentSubChatIdAtom BEFORE reading userMessageIdsAtom.
  // If it doesn't match our subChatId, return empty to avoid showing wrong messages.
  // The useLayoutEffect will sync and update currentSubChatIdAtom, which triggers
  // a re-render of this component (since we're subscribed to it).
  const currentSubChatId = useAtomValue(currentSubChatIdAtom)

  // Subscribe to user message IDs - but only use them if we're the active chat
  const userMsgIds = useAtomValue(userMessageIdsAtom)

  // 修复：当切换 workspace 时，currentSubChatIdAtom 可能还是旧值
  // 如果 subChatId 不匹配，且没有消息，说明可能是新的空 chat 或切换中的状态
  // 此时应该允许渲染空内容，而不是返回 null（否则 UI 会卡住）
  if (currentSubChatId !== subChatId) {
    // 如果有消息但 ID 不匹配，说明是旧数据，跳过渲染
    if (userMsgIds.length > 0) {
      return null
    }
    // 如果没有消息，可能是新 chat 或切换中，允许继续渲染空内容
  }

  return (
    <>
      {userMsgIds.map((userMsgId) => (
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
          onEditMessage={onEditMessage}
          UserBubbleComponent={UserBubbleComponent}
          ToolCallComponent={ToolCallComponent}
          MessageGroupWrapper={MessageGroupWrapper}
          toolRegistry={toolRegistry}
        />
      ))}
    </>
  )
}, areSectionPropsEqual)
