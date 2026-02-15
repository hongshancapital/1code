/**
 * HookRegistry - 插件在核心生命周期中的注入
 *
 * 三种模式：
 * - emit:      并行通知，错误不中断，无返回值
 * - collect:   并行收集，返回扁平化数组
 * - waterfall: 串行管道，前一个输出传给下一个
 */

import type {
  HookMode,
  HookMap,
  HookHandler,
  HookHandlerOptions,
  HookInputOf,
  HookResult,
  IHookRegistry,
} from "./types"
import { createLogger } from "../logger"

const hookRegistryLog = createLogger("HookRegistry")

interface RegisteredHandler {
  handler: HookHandler<keyof HookMap>
  priority: number
  source?: string
}

/**
 * 运行时 Hook 模式注册表
 * TypeScript interface 合并是编译时的，运行时需要显式注册模式
 */
const hookModes = new Map<string, HookMode>()

export function registerHookMode<K extends keyof HookMap>(
  hookName: K,
  mode: HookMode,
): void {
  hookModes.set(hookName as string, mode)
}

export class HookRegistry implements IHookRegistry {
  private handlers = new Map<string, RegisteredHandler[]>()

  on<K extends keyof HookMap>(
    hookName: K,
    handler: HookHandler<K>,
    options?: HookHandlerOptions,
  ): () => void {
    const key = hookName as string
    const entry: RegisteredHandler = {
      handler: handler as HookHandler<keyof HookMap>,
      priority: options?.priority ?? 100,
      source: options?.source,
    }

    if (!this.handlers.has(key)) {
      this.handlers.set(key, [])
    }
    const list = this.handlers.get(key)!
    list.push(entry)
    list.sort((a, b) => a.priority - b.priority)

    return () => {
      const idx = list.indexOf(entry)
      if (idx !== -1) list.splice(idx, 1)
    }
  }

  async call<K extends keyof HookMap>(
    hookName: K,
    input: HookInputOf<K>,
  ): Promise<HookResult<K>> {
    const key = hookName as string
    const mode = hookModes.get(key)
    if (!mode) {
      throw new Error(
        `[HookRegistry] Hook "${key}" 未注册模式，请先调用 registerHookMode()`,
      )
    }

    const list = this.handlers.get(key)
    if (!list || list.length === 0) {
      return this._emptyResult(mode, input) as HookResult<K>
    }

    switch (mode) {
      case "emit":
        return this._callEmit(key, list, input) as Promise<HookResult<K>>
      case "collect":
        return this._callCollect(key, list, input) as Promise<HookResult<K>>
      case "waterfall":
        return this._callWaterfall(key, list, input) as Promise<HookResult<K>>
      default:
        throw new Error(`[HookRegistry] 未知模式: ${mode}`)
    }
  }

  removeBySource(source: string): void {
    for (const [key, list] of this.handlers) {
      const filtered = list.filter((h) => h.source !== source)
      if (filtered.length === 0) {
        this.handlers.delete(key)
      } else {
        this.handlers.set(key, filtered)
      }
    }
  }

  hasHandlers(hookName: keyof HookMap): boolean {
    const list = this.handlers.get(hookName as string)
    return !!list && list.length > 0
  }

  // ---------------------------------------------------------------------------
  // 内部方法
  // ---------------------------------------------------------------------------

  /** emit: 并行执行，错误只 log，不等返回 */
  private async _callEmit(
    hookName: string,
    list: RegisteredHandler[],
    input: unknown,
  ): Promise<void> {
    const results = await Promise.allSettled(
      list.map((h) => Promise.resolve((h.handler as (i: unknown) => unknown)(input))),
    )
    for (const r of results) {
      if (r.status === "rejected") {
        hookRegistryLog.error(`emit "${hookName}" handler 错误:`, r.reason)
      }
    }
  }

  /** collect: 并行执行，收集返回值扁平化 */
  private async _callCollect(
    hookName: string,
    list: RegisteredHandler[],
    input: unknown,
  ): Promise<unknown[]> {
    const results = await Promise.allSettled(
      list.map((h) => Promise.resolve((h.handler as (i: unknown) => unknown)(input))),
    )
    const collected: unknown[] = []
    for (const r of results) {
      if (r.status === "fulfilled" && r.value !== null && r.value !== undefined) {
        if (Array.isArray(r.value)) {
          collected.push(...r.value)
        } else {
          collected.push(r.value)
        }
      } else if (r.status === "rejected") {
        hookRegistryLog.error(
          `[HookRegistry] collect "${hookName}" handler 错误:`,
          r.reason,
        )
      }
    }
    return collected
  }

  /** waterfall: 串行执行（按 priority），管道传递，错误中断 */
  private async _callWaterfall(
    hookName: string,
    list: RegisteredHandler[],
    input: unknown,
  ): Promise<unknown> {
    let current = input
    for (const h of list) {
      try {
        current = await Promise.resolve(
          (h.handler as (i: unknown) => unknown)(current),
        )
      } catch (err) {
        hookRegistryLog.error(
          `[HookRegistry] waterfall "${hookName}" handler 错误（中断管道）:`,
          err,
        )
        throw err
      }
    }
    return current
  }

  /** 无 handler 时的默认返回值 */
  private _emptyResult(mode: HookMode, input: unknown): unknown {
    switch (mode) {
      case "emit":
        return undefined
      case "collect":
        return []
      case "waterfall":
        return input
    }
  }
}
