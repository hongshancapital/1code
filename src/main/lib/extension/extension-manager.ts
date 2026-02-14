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
import type { ExtensionModule, ExtensionContext } from "./types"
import { HookRegistry } from "./hook-registry"
import { FeatureBus } from "./feature-bus"

export class ExtensionManager {
  private static instance: ExtensionManager | null = null

  private extensions: ExtensionModule[] = []
  private hookRegistry = new HookRegistry()
  private featureBus = new FeatureBus()
  private initialized = false

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
        await ext.initialize(ctx)
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
        await ext.cleanup?.()
        this.hookRegistry.removeBySource(ext.name)
        console.log(`[Extension:${ext.name}] 已清理`)
      } catch (err) {
        console.error(`[Extension:${ext.name}] 清理失败:`, err)
      }
    }
    this.extensions = []
    this.initialized = false
  }

  /**
   * 收集所有 Extension 的 tRPC router
   * 用于合并到 AppRouter
   */
  getRouters(): Record<string, AnyRouter> {
    const routers: Record<string, AnyRouter> = {}
    for (const ext of this.extensions) {
      if (ext.router) {
        const key = ext.routerKey ?? ext.name
        routers[key] = ext.router
      }
    }
    return routers
  }

  /** 获取已注册的 Extension 名称列表 */
  getExtensionNames(): string[] {
    return this.extensions.map((e) => e.name)
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
