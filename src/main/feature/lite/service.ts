/**
 * LiteService - 整合 Auth + WSS + HTTP + User
 *
 * 统一的 start/stop 入口，供 LiteExtension 调用。
 */

import { LiteHttpClient } from "./http/client"
import { LiteUserApi } from "./user/api"
import { WssManager } from "./wss/manager"
import { getAuthManager } from "./auth/manager"
import { getEnv } from "../../lib/env"

export class LiteService {
  readonly http = new LiteHttpClient()
  readonly userApi: LiteUserApi
  readonly wss: WssManager

  private started = false

  constructor() {
    this.userApi = new LiteUserApi(this.http)
    this.wss = new WssManager({
      getUrl: () => {
        return getEnv().MAIN_VITE_LITE_WSS_URL ?? null
      },
      getToken: async () => {
        const authManager = getAuthManager()
        if (!authManager) return null
        return authManager.getValidToken()
      },
      onTokenExpired: async () => {
        const authManager = getAuthManager()
        if (!authManager) return false
        return authManager.refresh()
      },
    })
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true

    // 初始化 HTTP
    this.http.initialize()

    // WSS 连接（仅在配置了 URL 时）
    const wssUrl = getEnv().MAIN_VITE_LITE_WSS_URL
    if (wssUrl) {
      await this.wss.connect().catch((err) => {
        console.error("[LiteService] WSS 连接失败:", err)
      })
    } else {
      console.log("[LiteService] WSS URL 未配置，跳过 WSS 连接")
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.wss.disconnect()
  }
}
