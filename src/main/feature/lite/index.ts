/**
 * Lite Extension - ExtensionModule 实现
 *
 * 整合 WSS 实时通道、HTTP API、Auth 认证。
 */

import type { ExtensionModule, ExtensionContext } from "../../lib/extension/types"
import { LiteService } from "./service"
import { getAuthManager } from "./auth/manager"
import { getEffectiveAuthProvider } from "./auth/providers"

// 加载 bus-events 声明（interface 合并副作用）
import "./bus-events"

class LiteExtension implements ExtensionModule {
  name = "lite" as const
  description = "Lite WSS + HTTP + Auth integration"

  private cleanupFns: Array<() => void> = []
  private ctx: ExtensionContext | null = null
  private service = new LiteService()

  async initialize(ctx: ExtensionContext): Promise<void> {
    this.ctx = ctx

    // ----- Hook handlers（生命周期注入）-----

    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:collectMcpServers",
        async (_payload) => {
          // lite 可以贡献自己的 MCP server（按需扩展）
          return []
        },
        { source: this.name },
      ),
    )

    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:enhancePrompt",
        (payload) => {
          // lite 可以往 appendSections 注入上下文（按需扩展）
          return payload
        },
        { source: this.name },
      ),
    )

    this.cleanupFns.push(
      ctx.hooks.on(
        "chat:sessionStart",
        async (_payload) => {
          // 通知 lite 后端会话开始（按需扩展）
        },
        { source: this.name },
      ),
    )

    // ----- Bus handlers（主动调用响应）-----

    this.cleanupFns.push(
      ctx.bus.onRequest("lite:auth-status", async () => {
        const authManager = getAuthManager()
        if (!authManager || !authManager.isAuthenticated()) {
          return { isAuthenticated: false, provider: null }
        }
        const user = authManager.getUser()
        const provider = getEffectiveAuthProvider()
        return {
          isAuthenticated: true,
          provider: provider === "none" ? null : provider,
          userId: user?.id,
          email: user?.email,
        }
      }),
    )

    this.cleanupFns.push(
      ctx.bus.onRequest("lite:fetch-user", async (args) => {
        return this.service.userApi.fetchUser(args.userId)
      }),
    )

    this.cleanupFns.push(
      ctx.bus.onRequest("lite:fetch-avatar", async (args) => {
        return this.service.userApi.fetchAvatarUrl(args.userId)
      }),
    )

    this.cleanupFns.push(
      ctx.bus.onRequest("lite:http-get", async (args) => {
        const res = await this.service.http.get(args.path)
        return { ok: res.ok, status: res.status, data: res.data, error: res.error }
      }),
    )

    this.cleanupFns.push(
      ctx.bus.onRequest("lite:http-post", async (args) => {
        const res = await this.service.http.post(args.path, args.body)
        return { ok: res.ok, status: res.status, data: res.data, error: res.error }
      }),
    )

    this.cleanupFns.push(
      ctx.bus.onNotify("lite:wss-send", (args) => {
        this.service.wss.send(args.channel, args.data)
      }),
    )

    this.cleanupFns.push(
      ctx.bus.onNotify("lite:auth-logout", (args) => {
        const authManager = getAuthManager()
        if (authManager) {
          authManager.logout(args?.reason === "session_expired" ? "session_expired" : "manual")
        }
      }),
    )

    // WSS 消息转发到 Bus broadcast
    this.service.wss.on("message", (msg: { channel: string; data: unknown }) => {
      ctx.bus.broadcast("lite:wss-message", { channel: msg.channel, data: msg.data })
    })

    // 启动服务
    await this.service.start()
    ctx.log("初始化完成")
  }

  async cleanup(): Promise<void> {
    await this.service.stop()
    for (const fn of this.cleanupFns) fn()
    this.cleanupFns = []
    this.ctx?.log("已清理")
    this.ctx = null
  }
}

export const liteExtension = new LiteExtension()
