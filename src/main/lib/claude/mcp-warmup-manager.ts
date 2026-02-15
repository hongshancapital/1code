/**
 * McpWarmupManager
 *
 * 核心预热管理器,负责:
 * - 应用启动时立即预热所有 MCP 服务器
 * - 支持智能重试机制(退避策略: 2s, 30s, 30s)
 * - 实时状态推送(通过 EventEmitter)
 * - 为首次 query 提供等待 Promise
 */

import EventEmitter from "events"
import * as fs from "fs/promises"
import * as os from "os"
import path from "path"
import type { McpServerConfig, ProjectConfig } from "../claude-config"
import { GLOBAL_MCP_PATH } from "../claude-config"
import { mcpCacheKey, workingMcpServers } from "../claude"
import { ensureMcpTokensFresh } from "../mcp-auth"
import { fetchToolsForServer } from "./mcp-config"
import { createLogger } from "../logger"

const log = createLogger("mcpWarmupManager")


const RETRY_DELAYS = [2000, 30000, 30000] // 2s, 30s, 30s
const MAX_RETRIES = 3

/**
 * 服务器状态类型
 */
export type MCPServerStatus =
  | "connecting"
  | "connected"
  | "failed"
  | "timeout"
  | "retrying"
  | "needs-auth"
  | "pending"

/**
 * 服务器状态详情
 */
export interface ServerState {
  status: MCPServerStatus
  error?: string
  retryCount: number
  lastAttempt: number
  lastSuccess?: number
  tools?: string[]
  serverInfo?: Record<string, unknown>
}

/**
 * 预热上下文
 */
interface WarmupContext {
  name: string
  config: McpServerConfig
  scope: string | null // null = global, string = projectPath
}

/**
 * 预热管理器单例
 */
let managerInstance: McpWarmupManager | null = null

export class McpWarmupManager extends EventEmitter {
  private warmupPromise: Promise<void> | null = null
  private aborted = false
  private state: "idle" | "warming" | "completed" | "failed" = "idle"

  // 存储所有服务器的状态
  public serverStates = new Map<string, ServerState>()

  constructor() {
    super()
    this.setMaxListeners(100) // 支持多个订阅者
  }

  /**
   * 获取当前预热状态
   */
  getState(): "idle" | "warming" | "completed" | "failed" {
    return this.state
  }

  /**
   * 获取服务器状态
   */
  getServerState(name: string): ServerState | undefined {
    return this.serverStates.get(name)
  }

  /**
   * 获取预热 Promise(用于首次 query 等待)
   */
  getWarmupPromise(): Promise<void> | null {
    return this.warmupPromise
  }

  /**
   * 取消预热
   */
  abort(): void {
    this.aborted = true
    this.state = "failed"
    this.emit("stateChange", "failed")
    log.info("[MCP Warmup] Aborted by user")
  }

  /**
   * 启动预热(应用启动时调用)
   */
  async startWarmup(): Promise<void> {
    // 防止重复启动
    if (this.warmupPromise) {
      log.info("[MCP Warmup] Already running, reusing existing promise")
      return this.warmupPromise
    }

    this.aborted = false
    this.state = "warming"
    this.serverStates.clear()
    this.emit("stateChange", "warming")

    const startTime = Date.now()

    this.warmupPromise = (async () => {
      try {
        // 读取 ~/.claude.json (异步化避免阻塞主进程)
        const claudeJsonPath = path.join(os.homedir(), ".claude.json")
        let config: any
        try {
          const configContent = await fs.readFile(claudeJsonPath, "utf-8")
          config = JSON.parse(configContent)
        } catch {
          log.info("[MCP Warmup] No ~/.claude.json found - skipping warmup")
          this.state = "completed"
          this.emit("stateChange", "completed")
          return
        }

        // 收集所有需要预热的服务器
        const contexts: WarmupContext[] = []

        // 全局 MCP 服务器
        if (config.mcpServers) {
          for (const [name, serverConfig] of Object.entries(
            config.mcpServers,
          ) as [string, McpServerConfig][]) {
            contexts.push({ name, config: serverConfig, scope: null })
          }
        }

        // 项目级 MCP 服务器
        if (config.projects) {
          for (const [projectPath, projectConfig] of Object.entries(
            config.projects,
          ) as [string, ProjectConfig][]) {
            if (projectConfig?.mcpServers) {
              // 跳过 worktree(临时目录)
              if (
                projectPath.includes("/.hong/worktrees/") ||
                projectPath.includes("\\.hong\\worktrees\\")
              ) {
                continue
              }

              for (const [name, serverConfig] of Object.entries(
                projectConfig.mcpServers,
              ) as [string, McpServerConfig][]) {
                contexts.push({ name, config: serverConfig, scope: projectPath })
              }
            }
          }
        }

        if (contexts.length === 0) {
          log.info("[MCP Warmup] No MCP servers configured - skipping warmup")
          this.state = "completed"
          this.emit("stateChange", "completed")
          return
        }

        log.info(`[MCP Warmup] Starting warmup for ${contexts.length} servers...`)

        // 并行预热所有服务器
        await Promise.allSettled(
          contexts.map((ctx) => this._warmupServer(ctx.name, ctx.config, ctx.scope))
        )

        const duration = Date.now() - startTime
        const successCount = Array.from(this.serverStates.values()).filter(
          (s) => s.status === "connected",
        ).length

        log.info(
          `[MCP Warmup] Completed in ${duration}ms. Success: ${successCount}/${contexts.length}`,
        )

        this.state = "completed"
        this.emit("stateChange", "completed")
        this.emit("completed", { duration, successCount, total: contexts.length })
      } catch (error) {
        log.error("[MCP Warmup] Unexpected error:", error)
        this.state = "failed"
        this.emit("stateChange", "failed")
      } finally {
        // 重置 promise，允许后续重新预热（如用户新增 MCP 服务器）
        this.warmupPromise = null
      }
    })()

    return this.warmupPromise
  }

  /**
   * 预热单个服务器(带重试逻辑)
   */
  private async _warmupServer(
    name: string,
    config: McpServerConfig,
    scope: string | null,
  ): Promise<void> {
    const cacheKey = mcpCacheKey(scope, name)
    const serverStartTime = Date.now()

    // 初始化状态
    this._updateServerState(name, {
      status: "connecting",
      retryCount: 0,
      lastAttempt: Date.now(),
    })

    let retryCount = 0

    while (retryCount <= MAX_RETRIES) {
      if (this.aborted) {
        log.info(`[MCP Warmup] ${name} - Aborted`)
        return
      }

      try {
        // 刷新 OAuth token(如果需要)
        let freshConfig = config
        if (scope === null) {
          // 全局服务器
          const freshServers = await ensureMcpTokensFresh(
            { [name]: config },
            GLOBAL_MCP_PATH,
          )
          freshConfig = freshServers[name] || config
        } else {
          // 项目服务器
          const freshServers = await ensureMcpTokensFresh({ [name]: config }, scope)
          freshConfig = freshServers[name] || config
        }

        // 拉取工具列表
        const tools = await fetchToolsForServer(freshConfig)

        if (tools.length > 0) {
          // 成功
          workingMcpServers.set(cacheKey, true)
          this._updateServerState(name, {
            status: "connected",
            retryCount,
            lastAttempt: Date.now(),
            lastSuccess: Date.now(),
            tools: tools.map((t) => t.name),
          })
          log.info(`[MCP Warmup] ${name} - Connected (${tools.length} tools) in ${Date.now() - serverStartTime}ms`)
          return
        }

        // 没有工具,但可能是服务器配置问题(不重试)
        workingMcpServers.set(cacheKey, false)
        this._updateServerState(name, {
          status: "failed",
          error: "No tools available",
          retryCount,
          lastAttempt: Date.now(),
        })
        log.warn(`[MCP Warmup] ${name} - No tools found (${Date.now() - serverStartTime}ms)`)
        return
      } catch (error: any) {
        const isTimeout = error?.message?.includes("Timeout")

        if (retryCount < MAX_RETRIES) {
          // 重试
          retryCount++
          this._updateServerState(name, {
            status: "retrying",
            error: error?.message || String(error),
            retryCount,
            lastAttempt: Date.now(),
          })

          const delay = RETRY_DELAYS[retryCount - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
          log.info(
            `[MCP Warmup] ${name} - Retry ${retryCount}/${MAX_RETRIES} in ${delay}ms (${isTimeout ? "timeout" : "error"})`,
          )

          await new Promise((resolve) => setTimeout(resolve, delay))
        } else {
          // 达到最大重试次数
          workingMcpServers.set(cacheKey, false)
          this._updateServerState(name, {
            status: isTimeout ? "timeout" : "failed",
            error: error?.message || String(error),
            retryCount,
            lastAttempt: Date.now(),
          })
          log.error(`[MCP Warmup] ${name} - Failed after ${MAX_RETRIES} retries (${Date.now() - serverStartTime}ms total)`)
          return
        }
      }
    }
  }

  /**
   * 更新服务器状态并发出事件
   */
  private _updateServerState(name: string, update: Partial<ServerState>): void {
    const current = this.serverStates.get(name) || {
      status: "connecting" as const,
      retryCount: 0,
      lastAttempt: Date.now(),
    }

    const next: ServerState = { ...current, ...update }
    this.serverStates.set(name, next)

    // 发出状态变化事件(供 tRPC subscription 监听)
    this.emit("serverStatusChange", {
      name,
      status: next.status,
      error: next.error,
      retryCount: next.retryCount,
      lastAttempt: next.lastAttempt,
      lastSuccess: next.lastSuccess,
      tools: next.tools,
    })
  }
}

/**
 * 获取全局单例
 */
export function getMcpWarmupManager(): McpWarmupManager {
  if (!managerInstance) {
    managerInstance = new McpWarmupManager()
  }
  return managerInstance
}
