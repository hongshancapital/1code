/**
 * Hong Extension System - Core Types
 *
 * 两套互补机制：
 * - HookRegistry: 插件在核心生命周期中的注入（emit/collect/waterfall）
 * - FeatureBus:   任意模块主动调用插件功能（request/notify/broadcast）
 *
 * ExtensionModule 统一管理两者。
 */

import type { AnyRouter } from "@trpc/server"

// =============================================================================
// HookRegistry 类型系统
// =============================================================================

export type HookMode = "emit" | "collect" | "waterfall"

/**
 * Hook 定义泛型
 *
 * @example
 * 'chat:sessionStart': HookDefinition<'emit', SessionPayload, void>
 * 'chat:collectMcp':   HookDefinition<'collect', McpPayload, McpServerEntry>
 * 'chat:enhancePrompt': HookDefinition<'waterfall', PromptPayload, void>
 */
export interface HookDefinition<
  TMode extends HookMode = HookMode,
  TInput = unknown,
  TOutput = unknown,
> {
  mode: TMode
  input: TInput
  output: TOutput
}

/**
 * Hook 映射表 — 通过 TypeScript interface 合并扩展
 *
 * 各模块通过 `declare module` 扩展此接口：
 * ```typescript
 * declare module '../../lib/extension/types' {
 *   interface HookMap {
 *     'chat:sessionStart': HookDefinition<'emit', SessionPayload, void>
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface HookMap {}

export type HookInputOf<K extends keyof HookMap> =
  HookMap[K] extends HookDefinition<HookMode, infer I, unknown> ? I : never

export type HookOutputOf<K extends keyof HookMap> =
  HookMap[K] extends HookDefinition<HookMode, unknown, infer O> ? O : never

export type HookModeOf<K extends keyof HookMap> =
  HookMap[K] extends HookDefinition<infer M, unknown, unknown> ? M : never

/**
 * Hook handler 签名（根据模式自动推导）
 * - emit:      (input) => void | Promise<void>
 * - collect:   (input) => TOutput | TOutput[] | Promise<...>
 * - waterfall: (input) => TInput | Promise<TInput>
 */
export type HookHandler<K extends keyof HookMap> =
  HookModeOf<K> extends "emit"
    ? (input: HookInputOf<K>) => void | Promise<void>
    : HookModeOf<K> extends "collect"
      ? (
          input: HookInputOf<K>,
        ) =>
          | HookOutputOf<K>
          | HookOutputOf<K>[]
          | Promise<HookOutputOf<K> | HookOutputOf<K>[]>
      : HookModeOf<K> extends "waterfall"
        ? (input: HookInputOf<K>) => HookInputOf<K> | Promise<HookInputOf<K>>
        : never

/**
 * Hook 触发结果（根据模式自动推导）
 * - emit:      void
 * - collect:   TOutput[]
 * - waterfall: TInput
 */
export type HookResult<K extends keyof HookMap> =
  HookModeOf<K> extends "emit"
    ? void
    : HookModeOf<K> extends "collect"
      ? HookOutputOf<K>[]
      : HookModeOf<K> extends "waterfall"
        ? HookInputOf<K>
        : never

export interface HookHandlerOptions {
  /** 数字越小越先执行，默认 100 */
  priority?: number
  /** 来源标识（通常是 extension name），用于批量清理 */
  source?: string
}

export interface IHookRegistry {
  on<K extends keyof HookMap>(
    hookName: K,
    handler: HookHandler<K>,
    options?: HookHandlerOptions,
  ): () => void

  call<K extends keyof HookMap>(
    hookName: K,
    input: HookInputOf<K>,
  ): Promise<HookResult<K>>

  removeBySource(source: string): void
  hasHandlers(hookName: keyof HookMap): boolean
}

// =============================================================================
// FeatureBus 类型系统
// =============================================================================

export type EventType = "request" | "notify" | "broadcast"

/**
 * Bus 事件定义泛型
 *
 * @example
 * 'lite:fetch-user': EventDefinition<{ userId: string }, UserInfo | null, 'request'>
 * 'lite:wss-send':   EventDefinition<{ channel: string; data: unknown }, void, 'notify'>
 * 'lite:auth-changed': EventDefinition<AuthPayload, void, 'broadcast'>
 */
export interface EventDefinition<
  TArgs = void,
  TResponse = void,
  TType extends EventType = "request",
> {
  args: TArgs
  response: TResponse
  type: TType
}

/**
 * Bus 事件映射表 — 通过 interface 合并扩展
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FeatureBusEvents {}

export type EventArgs<E extends keyof FeatureBusEvents> =
  FeatureBusEvents[E]["args"]
export type EventResponse<E extends keyof FeatureBusEvents> =
  FeatureBusEvents[E]["response"]
export type GetEventType<E extends keyof FeatureBusEvents> =
  FeatureBusEvents[E]["type"]

export type RequestEvents = {
  [K in keyof FeatureBusEvents]: FeatureBusEvents[K]["type"] extends "request"
    ? K
    : never
}[keyof FeatureBusEvents]

export type NotifyEvents = {
  [K in keyof FeatureBusEvents]: FeatureBusEvents[K]["type"] extends "notify"
    ? K
    : never
}[keyof FeatureBusEvents]

export type BroadcastEvents = {
  [K in keyof FeatureBusEvents]: FeatureBusEvents[K]["type"] extends "broadcast"
    ? K
    : never
}[keyof FeatureBusEvents]

export interface IFeatureBus {
  request<E extends RequestEvents>(
    event: E,
    ...args: EventArgs<E> extends void ? [] : [EventArgs<E>]
  ): Promise<EventResponse<E> | null>

  notify<E extends NotifyEvents>(
    event: E,
    ...args: EventArgs<E> extends void ? [] : [EventArgs<E>]
  ): void

  broadcast<E extends BroadcastEvents>(
    event: E,
    ...args: EventArgs<E> extends void ? [] : [EventArgs<E>]
  ): Promise<EventResponse<E>[]>

  onRequest<E extends RequestEvents>(
    event: E,
    handler: (
      args: EventArgs<E>,
    ) => Promise<EventResponse<E>> | EventResponse<E>,
  ): () => void

  onNotify<E extends NotifyEvents>(
    event: E,
    handler: (args: EventArgs<E>) => void | Promise<void>,
  ): () => void

  onBroadcast<E extends BroadcastEvents>(
    event: E,
    handler: (
      args: EventArgs<E>,
    ) => Promise<EventResponse<E>> | EventResponse<E>,
  ): () => void

  off<E extends keyof FeatureBusEvents>(event: E): void
}

// =============================================================================
// ExtensionModule
// =============================================================================

export interface ExtensionContext {
  hooks: IHookRegistry
  bus: IFeatureBus
  log: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** initialize 返回的清理函数，类似 React useEffect 的 cleanup */
export type CleanupFn = () => void | Promise<void>

export interface ExtensionModule {
  name: string
  description?: string
  /** 单个 router（与 routerKey 配合使用） */
  router?: AnyRouter
  /** router 在 AppRouter 中的 key，默认用 name */
  routerKey?: string
  /** 多个 router（key → router 映射，适用于聚合多个子系统的 Extension） */
  routers?: Record<string, AnyRouter>
  /** 声明此 Extension 提供的内部 Tools（供 internal-tools 发现） */
  listTools?(): Promise<{ category: string; tools: ToolDefinition[] }[]>
  /**
   * 初始化 Extension，可返回 cleanup 函数（类似 React useEffect）。
   * ExtensionManager 会在 cleanupAll 时自动调用返回的 cleanup。
   */
  initialize?(ctx: ExtensionContext): void | CleanupFn | Promise<void | CleanupFn>
}
