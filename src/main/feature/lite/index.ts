/**
 * Lite Extension - ExtensionModule 实现
 *
 * 整合 WSS 实时通道、HTTP API、Auth 认证。
 */

import type { ExtensionModule, ExtensionContext, CleanupFn } from "../../lib/extension/types"
import { ChatHook } from "../../lib/extension/hooks/chat-lifecycle"
import { LiteService } from "./service"
import { getAuthManager } from "./auth/manager"
import { getEffectiveAuthProvider } from "./auth/providers"

// 加载 bus-events 声明（interface 合并副作用）
import "./bus-events"

class LiteExtension implements ExtensionModule {
  name = "lite" as const
  description = "Lite WSS + HTTP + Auth integration"

  private service = new LiteService()

  async initialize(ctx: ExtensionContext): Promise<CleanupFn> {
    const offs: Array<() => void> = []

    // ----- Hook handlers（生命周期注入）-----

    offs.push(
      ctx.hooks.on(
        ChatHook.CollectMcpServers,
        async (_payload) => {
          // lite 可以贡献自己的 MCP server（按需扩展）
          return []
        },
        { source: this.name },
      ),
    )

    offs.push(
      ctx.hooks.on(
        ChatHook.EnhancePrompt,
        (payload) => {
          // lite 可以往 appendSections 注入上下文（按需扩展）
          return payload
        },
        { source: this.name },
      ),
    )

    offs.push(
      ctx.hooks.on(
        ChatHook.SessionStart,
        async (_payload) => {
          // 通知 lite 后端会话开始（按需扩展）
        },
        { source: this.name },
      ),
    )

    // ----- Bus handlers（主动调用响应）-----

    offs.push(
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

    offs.push(
      ctx.bus.onRequest("lite:fetch-user", async (args) => {
        return this.service.userApi.fetchUser(args.userId)
      }),
    )

    offs.push(
      ctx.bus.onRequest("lite:fetch-avatar", async (args) => {
        return this.service.userApi.fetchAvatarUrl(args.userId)
      }),
    )

    offs.push(
      ctx.bus.onRequest("lite:http-get", async (args) => {
        const res = await this.service.http.get(args.path)
        return { ok: res.ok, status: res.status, data: res.data, error: res.error }
      }),
    )

    offs.push(
      ctx.bus.onRequest("lite:http-post", async (args) => {
        const res = await this.service.http.post(args.path, args.body)
        return { ok: res.ok, status: res.status, data: res.data, error: res.error }
      }),
    )

    offs.push(
      ctx.bus.onNotify("lite:wss-send", (args) => {
        this.service.wss.send(args.channel, args.data)
      }),
    )

    offs.push(
      ctx.bus.onNotify("lite:auth-logout", (args) => {
        const authManager = getAuthManager()
        if (authManager) {
          authManager.logout(args?.reason === "session_expired" ? "session_expired" : "manual")
        }
      }),
    )

    // WSS 消息转发到 Bus broadcast
    const wssMessageHandler = (msg: { channel: string; data: unknown }) => {
      ctx.bus.broadcast("lite:wss-message", { channel: msg.channel, data: msg.data })
    }
    this.service.wss.on("message", wssMessageHandler)

    // 启动服务
    await this.service.start()
    ctx.log("初始化完成")

    return async () => {
      this.service.wss.off("message", wssMessageHandler)
      await this.service.stop()
      for (const fn of offs) fn()
      ctx.log("已清理")
    }
  }
}

export const liteExtension = new LiteExtension()
