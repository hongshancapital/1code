/**
 * ChatViewLayout - 多 ChatView 布局容器
 *
 * 设计目标:
 * 1. 支持单个 ChatView (当前模式)
 * 2. 支持多个 ChatView 并列 (团队模式)
 * 3. 支持 Leader + Members 布局 (层级模式)
 * 4. 底部共享一个 ChatInput
 *
 * 布局模式:
 * - single: 单个 ChatView (默认)
 * - horizontal: 多个 ChatView 水平并列
 * - leader-members: 顶部 Leader + 下方 Members 并列
 *
 * 使用场景:
 * - 单人开发: single 模式
 * - 团队协作: leader-members 模式
 * - 对比视图: horizontal 模式 (比较两个对话)
 */

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react"
import { atom, useAtom, useAtomValue, useSetAtom } from "jotai"
import { cn } from "../../../lib/utils"

// =============================================================================
// Types
// =============================================================================

/**
 * 布局模式
 */
export type LayoutMode = "single" | "horizontal" | "leader-members"

/**
 * ChatView 槽位配置
 */
export interface ChatViewSlot {
  /** 槽位 ID */
  id: string
  /** 关联的 chatId */
  chatId: string
  /** 关联的 subChatId */
  subChatId: string
  /** 是否是 Leader (仅 leader-members 模式) */
  isLeader?: boolean
  /** 槽位标签 (显示名称) */
  label?: string
  /** 宽度权重 (用于 flex) */
  flexWeight?: number
}

/**
 * 布局状态
 */
export interface LayoutState {
  /** 当前布局模式 */
  mode: LayoutMode
  /** 所有槽位配置 */
  slots: ChatViewSlot[]
  /** 当前聚焦的槽位 ID */
  focusedSlotId: string | null
}

/**
 * Context 值
 */
export interface ChatViewLayoutContextValue {
  // ── 布局状态 ──
  mode: LayoutMode
  slots: ChatViewSlot[]
  focusedSlotId: string | null

  // ── 布局操作 ──
  setMode: (mode: LayoutMode) => void
  addSlot: (slot: ChatViewSlot) => void
  removeSlot: (slotId: string) => void
  updateSlot: (slotId: string, updates: Partial<ChatViewSlot>) => void
  setFocusedSlot: (slotId: string | null) => void

  // ── 查询 ──
  getSlot: (slotId: string) => ChatViewSlot | undefined
  getLeaderSlot: () => ChatViewSlot | undefined
  getMemberSlots: () => ChatViewSlot[]
  isSlotFocused: (slotId: string) => boolean
}

// =============================================================================
// Atoms
// =============================================================================

/**
 * 布局状态 atom
 */
export const chatViewLayoutAtom = atom<LayoutState>({
  mode: "single",
  slots: [],
  focusedSlotId: null,
})

// =============================================================================
// Context
// =============================================================================

const ChatViewLayoutContext = createContext<ChatViewLayoutContextValue | null>(null)

// =============================================================================
// Provider
// =============================================================================

export interface ChatViewLayoutProviderProps {
  children: ReactNode
  /** 初始布局模式 */
  initialMode?: LayoutMode
}

export function ChatViewLayoutProvider({
  children,
  initialMode = "single",
}: ChatViewLayoutProviderProps) {
  const [layoutState, setLayoutState] = useAtom(chatViewLayoutAtom)

  // 设置布局模式
  const setMode = useCallback((mode: LayoutMode) => {
    setLayoutState((prev) => ({ ...prev, mode }))
  }, [setLayoutState])

  // 添加槽位
  const addSlot = useCallback((slot: ChatViewSlot) => {
    setLayoutState((prev) => {
      // 避免重复添加
      if (prev.slots.some((s) => s.id === slot.id)) {
        return prev
      }
      const newSlots = [...prev.slots, slot]
      // 如果是第一个槽位，自动聚焦
      const focusedSlotId = prev.focusedSlotId ?? slot.id
      return { ...prev, slots: newSlots, focusedSlotId }
    })
  }, [setLayoutState])

  // 移除槽位
  const removeSlot = useCallback((slotId: string) => {
    setLayoutState((prev) => {
      const newSlots = prev.slots.filter((s) => s.id !== slotId)
      // 如果移除的是聚焦槽位，切换到第一个槽位
      const focusedSlotId =
        prev.focusedSlotId === slotId
          ? newSlots[0]?.id ?? null
          : prev.focusedSlotId
      return { ...prev, slots: newSlots, focusedSlotId }
    })
  }, [setLayoutState])

  // 更新槽位
  const updateSlot = useCallback((slotId: string, updates: Partial<ChatViewSlot>) => {
    setLayoutState((prev) => ({
      ...prev,
      slots: prev.slots.map((s) =>
        s.id === slotId ? { ...s, ...updates } : s
      ),
    }))
  }, [setLayoutState])

  // 设置聚焦槽位
  const setFocusedSlot = useCallback((slotId: string | null) => {
    setLayoutState((prev) => ({ ...prev, focusedSlotId: slotId }))
  }, [setLayoutState])

  // 获取槽位
  const getSlot = useCallback(
    (slotId: string) => layoutState.slots.find((s) => s.id === slotId),
    [layoutState.slots]
  )

  // 获取 Leader 槽位
  const getLeaderSlot = useCallback(
    () => layoutState.slots.find((s) => s.isLeader),
    [layoutState.slots]
  )

  // 获取 Member 槽位
  const getMemberSlots = useCallback(
    () => layoutState.slots.filter((s) => !s.isLeader),
    [layoutState.slots]
  )

  // 检查槽位是否聚焦
  const isSlotFocused = useCallback(
    (slotId: string) => layoutState.focusedSlotId === slotId,
    [layoutState.focusedSlotId]
  )

  const value = useMemo<ChatViewLayoutContextValue>(
    () => ({
      mode: layoutState.mode,
      slots: layoutState.slots,
      focusedSlotId: layoutState.focusedSlotId,

      setMode,
      addSlot,
      removeSlot,
      updateSlot,
      setFocusedSlot,

      getSlot,
      getLeaderSlot,
      getMemberSlots,
      isSlotFocused,
    }),
    [
      layoutState.mode,
      layoutState.slots,
      layoutState.focusedSlotId,
      setMode,
      addSlot,
      removeSlot,
      updateSlot,
      setFocusedSlot,
      getSlot,
      getLeaderSlot,
      getMemberSlots,
      isSlotFocused,
    ]
  )

  return (
    <ChatViewLayoutContext.Provider value={value}>
      {children}
    </ChatViewLayoutContext.Provider>
  )
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * 获取布局 Context
 */
export function useChatViewLayout(): ChatViewLayoutContextValue {
  const context = useContext(ChatViewLayoutContext)
  if (!context) {
    throw new Error("useChatViewLayout must be used within ChatViewLayoutProvider")
  }
  return context
}

/**
 * 安全版本
 */
export function useChatViewLayoutSafe(): ChatViewLayoutContextValue | null {
  return useContext(ChatViewLayoutContext)
}

/**
 * 注册槽位 hook
 * 在 ChatView 挂载时自动注册槽位
 */
export function useChatViewSlot(slot: ChatViewSlot) {
  const layout = useChatViewLayoutSafe()

  // 注册槽位（副作用放在 useEffect 中，而非 useMemo）
  useEffect(() => {
    if (!layout) return
    layout.addSlot(slot)
  }, [layout, slot.id, slot.chatId, slot.subChatId])

  // 聚焦处理
  const focus = useCallback(() => {
    layout?.setFocusedSlot(slot.id)
  }, [layout, slot.id])

  const isFocused = layout?.isSlotFocused(slot.id) ?? false

  return { focus, isFocused }
}

// =============================================================================
// Layout Components
// =============================================================================

export interface ChatViewContainerProps {
  children: ReactNode
  className?: string
}

/**
 * ChatView 容器 - 根据布局模式渲染子组件
 */
export function ChatViewContainer({ children, className }: ChatViewContainerProps) {
  const layout = useChatViewLayoutSafe()
  const mode = layout?.mode ?? "single"

  return (
    <div
      className={cn(
        "flex flex-1 overflow-hidden",
        mode === "single" && "flex-col",
        mode === "horizontal" && "flex-row",
        mode === "leader-members" && "flex-col",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * Leader 区域 - leader-members 模式下的顶部区域
 */
export interface LeaderAreaProps {
  children: ReactNode
  className?: string
  /** 高度比例 (0-1) */
  heightRatio?: number
}

export function LeaderArea({ children, className, heightRatio = 0.4 }: LeaderAreaProps) {
  const layout = useChatViewLayoutSafe()

  // 只在 leader-members 模式下渲染
  if (layout?.mode !== "leader-members") {
    return null
  }

  return (
    <div
      className={cn("flex-shrink-0 border-b overflow-hidden", className)}
      style={{ height: `${heightRatio * 100}%` }}
    >
      {children}
    </div>
  )
}

/**
 * Members 区域 - leader-members 模式下的底部区域
 */
export interface MembersAreaProps {
  children: ReactNode
  className?: string
}

export function MembersArea({ children, className }: MembersAreaProps) {
  const layout = useChatViewLayoutSafe()

  // 只在 leader-members 模式下渲染
  if (layout?.mode !== "leader-members") {
    return null
  }

  return (
    <div className={cn("flex-1 flex flex-row overflow-hidden", className)}>
      {children}
    </div>
  )
}

/**
 * ChatView 槽位包装器 - 为每个 ChatView 提供槽位样式
 */
export interface ChatViewSlotWrapperProps {
  slotId: string
  children: ReactNode
  className?: string
  /** 是否显示聚焦边框 */
  showFocusBorder?: boolean
}

export function ChatViewSlotWrapper({
  slotId,
  children,
  className,
  showFocusBorder = true,
}: ChatViewSlotWrapperProps) {
  const layout = useChatViewLayoutSafe()
  const slot = layout?.getSlot(slotId)
  const isFocused = layout?.isSlotFocused(slotId) ?? false
  const setFocused = layout?.setFocusedSlot

  const handleFocus = useCallback(() => {
    setFocused?.(slotId)
  }, [setFocused, slotId])

  return (
    <div
      className={cn(
        "flex-1 overflow-hidden relative",
        showFocusBorder && isFocused && "ring-2 ring-primary ring-inset",
        className
      )}
      style={{ flex: slot?.flexWeight ?? 1 }}
      onClick={handleFocus}
      onFocus={handleFocus}
    >
      {/* 槽位标签 */}
      {slot?.label && (
        <div className="absolute top-2 left-2 z-10 px-2 py-0.5 text-xs bg-muted rounded">
          {slot.label}
        </div>
      )}
      {children}
    </div>
  )
}

// =============================================================================
// Utility Components
// =============================================================================

/**
 * 布局模式切换器
 */
export interface LayoutModeSwitcherProps {
  className?: string
}

export function LayoutModeSwitcher({ className }: LayoutModeSwitcherProps) {
  const layout = useChatViewLayout()

  return (
    <div className={cn("flex gap-1", className)}>
      <button
        className={cn(
          "px-2 py-1 text-xs rounded",
          layout.mode === "single" ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
        onClick={() => layout.setMode("single")}
      >
        Single
      </button>
      <button
        className={cn(
          "px-2 py-1 text-xs rounded",
          layout.mode === "horizontal" ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
        onClick={() => layout.setMode("horizontal")}
      >
        Split
      </button>
      <button
        className={cn(
          "px-2 py-1 text-xs rounded",
          layout.mode === "leader-members" ? "bg-primary text-primary-foreground" : "bg-muted"
        )}
        onClick={() => layout.setMode("leader-members")}
      >
        Team
      </button>
    </div>
  )
}
