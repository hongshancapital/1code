/**
 * ExtensionManager - Extension 生命周期管理
 *
 * 单例，负责：
 * - 注册 ExtensionModule
 * - 统一 initialize / cleanup
 * - 收集 tRPC routers
 * - 暴露 HookRegistry 和 FeatureBus 实例
 */

import type { AnyRouter } from "@trpc/server"
import type { ExtensionModule, ExtensionContext, CleanupFn } from "./types"
import { HookRegistry } from "./hook-registry"
import { FeatureBus } from "./feature-bus"

export class ExtensionManager {
  private static instance: ExtensionManager | null = null

  private extensions: ExtensionModule[] = []
  private hookRegistry = new HookRegistry()
  private featureBus = new FeatureBus()
  private initialized = false
  /** initialize 返回的 cleanup 函数，按注册顺序存储 */
  private cleanups = new Map<string, CleanupFn>()

  private constructor() {}

  static getInstance(): ExtensionManager {
    if (!ExtensionManager.instance) {
      ExtensionManager.instance = new ExtensionManager()
    }
    return ExtensionManager.instance
  }

  /** 仅测试用，重置单例 */
  static resetInstance(): void {
    ExtensionManager.instance = null
  }

  getHookRegistry(): HookRegistry {
    return this.hookRegistry
  }

  getFeatureBus(): FeatureBus {
    return this.featureBus
  }

  /**
   * 注册 Extension，必须在 initializeAll 之前调用
   */
  register(ext: ExtensionModule): void {
    if (this.initialized) {
      throw new Error(
        `[ExtensionManager] 已初始化，无法注册 "${ext.name}"。请在 initializeAll() 前注册。`,
      )
    }
    if (this.extensions.some((e) => e.name === ext.name)) {
      throw new Error(
        `[ExtensionManager] Extension "${ext.name}" 已注册，name 不可重复。`,
      )
    }
    this.extensions.push(ext)
  }

  /**
   * 按注册顺序初始化所有 Extension
   * 单个失败不阻塞其他
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) {
      console.warn("[ExtensionManager] 重复调用 initializeAll()，已跳过。")
      return
    }
    this.initialized = true

    for (const ext of this.extensions) {
      if (!ext.initialize) continue

      const ctx = this._createContext(ext.name)
      try {
        const cleanup = await ext.initialize(ctx)
        if (typeof cleanup === "function") {
          this.cleanups.set(ext.name, cleanup)
        }
        console.log(`[Extension:${ext.name}] 初始化完成`)
      } catch (err) {
        console.error(`[Extension:${ext.name}] 初始化失败:`, err)
      }
    }
  }

  /**
   * 逆序清理所有 Extension
   */
  async cleanupAll(): Promise<void> {
    const reversed = [...this.extensions].reverse()
    for (const ext of reversed) {
      try {
        const cleanup = this.cleanups.get(ext.name)
        if (cleanup) await cleanup()
        this.hookRegistry.removeBySource(ext.name)
        console.log(`[Extension:${ext.name}] 已清理`)
      } catch (err) {
        console.error(`[Extension:${ext.name}] 清理失败:`, err)
      }
    }
    this.cleanups.clear()
    this.extensions = []
    this.initialized = false
  }

  /**
   * 收集所有 Extension 的 tRPC router
   * 用于合并到 AppRouter
   */
  getRouters(): Record<string, AnyRouter> {
    const routers: Record<string, AnyRouter> = {}
    // 记录 key → 来源 Extension，用于碰撞时给出精确报错
    const keyOwners: Record<string, string> = {}
    for (const ext of this.extensions) {
      if (ext.router) {
        const key = ext.routerKey ?? ext.name
        if (routers[key]) {
          throw new Error(
            `[ExtensionManager] Router key "${key}" 碰撞: "${ext.name}" 与 "${keyOwners[key]}" 注册了相同的 key。请修改 routerKey 或 Extension name 避免冲突。`
          )
        }
        routers[key] = ext.router
        keyOwners[key] = ext.name
      }
      if (ext.routers) {
        for (const [key, r] of Object.entries(ext.routers)) {
          if (routers[key]) {
            throw new Error(
              `[ExtensionManager] Router key "${key}" 碰撞: "${ext.name}.routers" 与 "${keyOwners[key]}" 注册了相同的 key。请修改 router key 避免冲突。`
            )
          }
          routers[key] = r
          keyOwners[key] = `${ext.name}.routers`
        }
      }
    }
    return routers
  }

  /** 获取已注册的 Extension 名称列表 */
  getExtensionNames(): string[] {
    return this.extensions.map((e) => e.name)
  }

  /**
   * 收集所有 Extension 声明的内部 Tools
   * 用于 internal-tools 发现，替代硬编码导入
   */
  async listAllTools(): Promise<
    Record<string, { name: string; description: string; inputSchema: Record<string, unknown> }[]>
  > {
    const results: Record<string, { name: string; description: string; inputSchema: Record<string, unknown> }[]> = {}
    for (const ext of this.extensions) {
      if (!ext.listTools) continue
      try {
        const categories = await ext.listTools()
        for (const { category, tools } of categories) {
          results[category] = tools
        }
      } catch (err) {
        console.error(`[Extension:${ext.name}] listTools() failed:`, err)
      }
    }
    return results
  }

  // ---------------------------------------------------------------------------
  // 内部方法
  // ---------------------------------------------------------------------------

  private _createContext(extName: string): ExtensionContext {
    const prefix = `[Extension:${extName}]`
    return {
      hooks: this.hookRegistry,
      bus: this.featureBus,
      log: (...args: unknown[]) => console.log(prefix, ...args),
      warn: (...args: unknown[]) => console.warn(prefix, ...args),
      error: (...args: unknown[]) => console.error(prefix, ...args),
    }
  }
}

/** 便捷函数 */
export const getExtensionManager = (): ExtensionManager =>
  ExtensionManager.getInstance()

export const getHooks = (): HookRegistry =>
  ExtensionManager.getInstance().getHookRegistry()

export const getBus = (): FeatureBus =>
  ExtensionManager.getInstance().getFeatureBus()
