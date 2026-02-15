/**
 * Agent Context Providers
 *
 * Layered context architecture for agent chat functionality.
 *
 * Provider Hierarchy:
 * ```
 * ChatInstanceProvider (chatId)
 *   └── ProjectModeProvider
 *       └── ChatCapabilitiesProvider
 *           └── SubChatProvider (subChatId)
 *               └── MessageSendProvider
 * ```
 *
 * Each layer depends on its parent and adds specific functionality:
 * - ChatInstanceContext: Chat data, worktreePath, agentChat, subChats
 * - ProjectModeContext: Project mode, enabled widgets, feature config
 * - ChatCapabilitiesContext: Feature flags (canOpenDiff, hideGitFeatures, etc.)
 * - SubChatContext: Sub-chat state, mode, streaming status
 * - MessageSendContext: Chat instance, message sending, pending messages
 */

// Chat instance (chatId level)
export {
  ChatInstanceProvider,
  useChatInstance,
  useChatInstanceSafe,
  useChatId,
  useWorktreePath,
  useAgentChat,
  type ChatInstanceContextValue,
  type ChatInstanceProviderProps,
} from "./chat-instance-context"

// Project mode (chat level)
export {
  ProjectModeProvider,
  useProjectMode,
  useProjectModeSafe,
  useWidgetEnabled,
  useEnabledWidgets,
  useHideGitWidgets,
  type ProjectModeContextValue,
  type ProjectModeProviderProps,
  type ProjectMode,
  type WidgetId,
  type ProjectFeatureConfig,
} from "./project-mode-context"

// Chat capabilities (chat level)
export {
  ChatCapabilitiesProvider,
  useChatCapabilities,
  useChatCapabilitiesSafe,
  useHideGitFeatures,
  useCanOpenDiff,
  useCanOpenTerminal,
  useCanOpenPreview,
  type ChatCapabilitiesContextValue,
  type ChatCapabilitiesProviderProps,
} from "./chat-capabilities-context"

// Sub-chat (subChatId level)
export {
  SubChatProvider,
  SubChatGate,
  useSubChat,
  useSubChatSafe,
  useSubChatId,
  useSubChatMode,
  useIsStreaming,
  type SubChatContextValue,
  type SubChatProviderProps,
} from "./sub-chat-context"

// Message send (subChatId level)
export {
  MessageSendProvider,
  useMessageSend,
  useMessageSendSafe,
  useChatFromContext,
  useIsStreamingFromContext,
  useMessagesFromContext,
  type MessageSendContextValue,
  type MessageSendProviderProps,
} from "./message-send-context"

// Text selection (existing)
export {
  TextSelectionProvider,
  useTextSelection,
  type TextSelectionContextValue,
  type TextSelectionSource,
} from "./text-selection-context"

// Chat input (multi-instance support)
export {
  ChatInputProvider,
  useChatInput,
  useChatInputSafe,
  useChatViewRegistration,
  useSetActiveChat,
  useIsActiveChat,
  activeInstanceIdAtom,
  buildUserMessage,
  type ChatInputContextValue,
  type ChatInputProviderProps,
  type ChatTarget,
  type ChatViewRegistration,
  type SendMessageFn,
  type StopStreamFn,
  type MessagePart,
  type TextPart,
  type ImagePart,
  type FilePart,
  type FileContentPart,
} from "./chat-input-context"
