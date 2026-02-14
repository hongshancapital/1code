/**
 * Layout components for multi-ChatView support
 */

export {
  // Types
  type LayoutMode,
  type ChatViewSlot,
  type LayoutState,
  type ChatViewLayoutContextValue,

  // Atoms
  chatViewLayoutAtom,

  // Provider
  ChatViewLayoutProvider,
  type ChatViewLayoutProviderProps,

  // Hooks
  useChatViewLayout,
  useChatViewLayoutSafe,
  useChatViewSlot,

  // Layout Components
  ChatViewContainer,
  type ChatViewContainerProps,
  LeaderArea,
  type LeaderAreaProps,
  MembersArea,
  type MembersAreaProps,
  ChatViewSlotWrapper,
  type ChatViewSlotWrapperProps,

  // Utility Components
  LayoutModeSwitcher,
  type LayoutModeSwitcherProps,
} from "./chat-view-layout"
