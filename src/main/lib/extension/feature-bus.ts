/**
 * FeatureBus - 任意模块主动调用插件功能
 *
 * 三种通信模式：
 * - request:   请求-响应（一对一），超时返回 null
 * - notify:    单向通知（一对多），不等返回
 * - broadcast: 广播收集（一对多），收集所有 handler 返回值
 */

import { EventEmitter } from "events"
import type {
  FeatureBusEvents,
  EventArgs,
  EventResponse,
  RequestEvents,
  NotifyEvents,
  BroadcastEvents,
  IFeatureBus,
} from "./types"
import { createLogger } from "../logger"

const featureBusLog = createLogger("FeatureBus")


const REQUEST_TIMEOUT = 10_000

type RequestHandler = (args: unknown) => Promise<unknown> | unknown
type NotifyHandler = (args: unknown) => void | Promise<void>
type BroadcastHandler = (args: unknown) => Promise<unknown> | unknown

export class FeatureBus implements IFeatureBus {
  private emitter = new EventEmitter()
  private requestHandlers = new Map<string, RequestHandler>()
  private broadcastHandlers = new Map<string, Set<BroadcastHandler>>()

  constructor() {
    this.emitter.setMaxListeners(100)
  }

  // ---------------------------------------------------------------------------
  // 调用方 API
  // ---------------------------------------------------------------------------

  async request<E extends RequestEvents>(
    event: E,
    ...args: EventArgs<E> extends void ? [] : [EventArgs<E>]
  ): Promise<EventResponse<E> | null> {
    const key = event as string
    const handler = this.requestHandlers.get(key)
    if (!handler) return null

    const input = args[0] as EventArgs<E>
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const result = await Promise.race([
        Promise.resolve(handler(input)),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            featureBusLog.warn(`request "${key}" 超时 (${REQUEST_TIMEOUT}ms)`)
            resolve(null)
          }, REQUEST_TIMEOUT)
        }),
      ])
      return result as EventResponse<E> | null
    } catch (err) {
      featureBusLog.error(`request "${key}" 错误:`, err)
      return null
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  notify<E extends NotifyEvents>(
    event: E,
    ...args: EventArgs<E> extends void ? [] : [EventArgs<E>]
  ): void {
    const key = event as string
    const input = args[0]
    this.emitter.emit(key, input)
  }

  async broadcast<E extends BroadcastEvents>(
    event: E,
    ...args: EventArgs<E> extends void ? [] : [EventArgs<E>]
  ): Promise<EventResponse<E>[]> {
    const key = event as string
    const handlers = this.broadcastHandlers.get(key)
    if (!handlers || handlers.size === 0) return []

    const input = args[0]
    const results = await Promise.allSettled(
      [...handlers].map((h) => Promise.resolve(h(input))),
    )

    const collected: EventResponse<E>[] = []
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null && r.value !== undefined) {
        collected.push(r.value as unknown as EventResponse<E>)
      } else if (r.status === "rejected") {
        featureBusLog.error(`broadcast "${key}" handler 错误:`, r.reason)
      }
    }
    return collected
  }

  // ---------------------------------------------------------------------------
  // 注册方 API
  // ---------------------------------------------------------------------------

  onRequest<E extends RequestEvents>(
    event: E,
    handler: (
      args: EventArgs<E>,
    ) => Promise<EventResponse<E>> | EventResponse<E>,
  ): () => void {
    const key = event as string
    if (this.requestHandlers.has(key)) {
      featureBusLog.warn(
        `[FeatureBus] request "${key}" handler 被覆盖（仅支持单一 handler）`,
      )
    }
    this.requestHandlers.set(key, handler as RequestHandler)

    return () => {
      if (this.requestHandlers.get(key) === (handler as RequestHandler)) {
        this.requestHandlers.delete(key)
      }
    }
  }

  onNotify<E extends NotifyEvents>(
    event: E,
    handler: (args: EventArgs<E>) => void | Promise<void>,
  ): () => void {
    const key = event as string
    this.emitter.on(key, handler as NotifyHandler)

    return () => {
      this.emitter.off(key, handler as NotifyHandler)
    }
  }

  onBroadcast<E extends BroadcastEvents>(
    event: E,
    handler: (
      args: EventArgs<E>,
    ) => Promise<EventResponse<E>> | EventResponse<E>,
  ): () => void {
    const key = event as string
    if (!this.broadcastHandlers.has(key)) {
      this.broadcastHandlers.set(key, new Set())
    }
    const set = this.broadcastHandlers.get(key)!
    const h = handler as BroadcastHandler
    set.add(h)

    return () => {
      set.delete(h)
      if (set.size === 0) this.broadcastHandlers.delete(key)
    }
  }

  off<E extends keyof FeatureBusEvents>(event: E): void {
    const key = event as string
    this.requestHandlers.delete(key)
    this.emitter.removeAllListeners(key)
    this.broadcastHandlers.delete(key)
  }
}
