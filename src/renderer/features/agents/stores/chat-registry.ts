import type { Chat } from "@ai-sdk/react"
import { useStreamingStatusStore } from "./streaming-status-store"

/**
 * ChatRegistry — Chat 实例注册表
 *
 * 和 Linux 的 fd table 一样：纯粹的资源注册表，不含业务逻辑。
 * 每个 Chat 实例以 subChatId 为键，生命周期脱离 React。
 *
 * 替代旧的 agentChatStore（4 个独立 Map → 1 个 Map<string, ChatEntry> + 1 个 abort Map）
 */

export interface ChatEntry {
  chat: Chat<any>
  parentChatId: string // 归属哪个 workspace
  createdAt: number
  lastActiveAt: number // 用于 LRU 淘汰
  isBackground?: boolean // 是否在后台运行（Keep-Alive）
}

// 最大保留的后台会话数量（防止内存泄漏，但足够覆盖高频切换场景）
const MAX_BACKGROUND_CHATS = 50

class ChatRegistry {
  private entries = new Map<string, ChatEntry>()
  private manuallyAborted = new Map<string, boolean>()

  // ── 查询 ──

  get(subChatId: string): Chat<any> | null {
    const entry = this.entries.get(subChatId)
    if (entry) {
      entry.lastActiveAt = Date.now() // 刷新活跃时间
      if (entry.isBackground) {
        console.log(`[ChatRegistry] Instant Restore (LRU): ${subChatId.slice(-8)}`)
        entry.isBackground = false
      }
      return entry.chat
    }
    return null
  }

  getEntry(subChatId: string): ChatEntry | null {
    return this.entries.get(subChatId) ?? null
  }

  has(subChatId: string): boolean {
    return this.entries.has(subChatId)
  }

  // ── 注册/注销 ──

  register(subChatId: string, chat: Chat<any>, parentChatId: string): void {
    if (this.entries.has(subChatId)) {
      // 更新现有条目
      const entry = this.entries.get(subChatId)!
      entry.chat = chat
      entry.parentChatId = parentChatId
      entry.lastActiveAt = Date.now()
      entry.isBackground = false
      return
    }

    // 新增前尝试清理，保持水位
    this.prune()

    this.entries.set(subChatId, {
      chat,
      parentChatId,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      isBackground: false,
    })
  }

  unregister(subChatId: string): void {
    const entry = this.entries.get(subChatId)
    if (!entry) return

    // 策略升级：默认总是转入后台（Keep-Alive），而不是删除！
    // 这实现了 "假切换"：切出 workspace 时，Chat 实例保留在内存中。
    // 切回时直接复用（Instant Restore），无需从 DB 加载，状态零丢失。
    // 内存占用由 prune() 的 LRU 机制控制。
    console.log(`[ChatRegistry] Hibernate (Background): ${subChatId.slice(-8)}`)
    entry.isBackground = true

    // 触发清理
    this.prune()
  }

  // ── 批量操作 ──

  clear(): void {
    // 强制清理（通常用于退出登录或彻底重置）
    this.entries.clear()
    this.manuallyAborted.clear()
  }

  // ── LRU 垃圾回收 ──

  private prune() {
    // 获取流式状态
    const statusStore = useStreamingStatusStore.getState()

    // 1. 获取所有后台会话
    const allBackground = Array.from(this.entries.entries()).filter(
      ([_, e]) => e.isBackground,
    )

    // 2. 分类：流式中 vs 闲置
    const streamingChats: [string, ChatEntry][] = []
    const idleChats: [string, ChatEntry][] = []

    for (const item of allBackground) {
      const [id] = item
      if (statusStore.isStreaming(id)) {
        streamingChats.push(item)
      } else {
        idleChats.push(item)
      }
    }

    // 3. 计算闲置会话的留存配额
    // 策略：流式会话永远保留（可突破 MAX_BACKGROUND_CHATS 上限）
    // 剩余空间留给闲置会话 (LRU)
    let idleQuota = MAX_BACKGROUND_CHATS - streamingChats.length
    if (idleQuota < 0) idleQuota = 0

    // 4. 如果闲置会话未超标，直接返回
    if (idleChats.length <= idleQuota) return

    // 5. 排序闲置会话：按 lastActiveAt 升序（最久未使用的在前）
    idleChats.sort((a, b) => a[1].lastActiveAt - b[1].lastActiveAt)

    // 6. 清理多余的闲置会话
    const toDeleteCount = idleChats.length - idleQuota
    const toDelete = idleChats.slice(0, toDeleteCount)

    for (const [id, _] of toDelete) {
      console.log(`[ChatRegistry] GC Prune (LRU): ${id.slice(-8)}`)
      this.entries.delete(id)
      this.manuallyAborted.delete(id)
    }
  }

  // ── 手动 abort 追踪（防止完成音效） ──

  setManuallyAborted(subChatId: string, aborted: boolean): void {
    this.manuallyAborted.set(subChatId, aborted)
  }

  wasManuallyAborted(subChatId: string): boolean {
    return this.manuallyAborted.get(subChatId) ?? false
  }

  clearManuallyAborted(subChatId: string): void {
    this.manuallyAborted.delete(subChatId)
  }
}

export const chatRegistry = new ChatRegistry()
