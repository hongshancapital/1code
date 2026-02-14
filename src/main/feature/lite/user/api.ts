/**
 * Lite User API
 *
 * 用户信息查询、头像 URL 构建。
 * 通过 LiteHttpClient 访问后端 API。
 */

import type { LiteHttpClient } from "../http/client"
import type { LiteUserInfo } from "../bus-events"

export class LiteUserApi {
  constructor(private http: LiteHttpClient) {}

  /** 获取当前登录用户信息 */
  async fetchCurrentUser(): Promise<LiteUserInfo | null> {
    const res = await this.http.get<{
      id: number | string
      email?: string
      name?: string
      chineseName?: string
      accountName?: string
      avatarUpdatedAt?: string | number
    }>("/v1/api/user")

    if (!res.ok || !res.data) return null

    const u = res.data
    return {
      id: String(u.id),
      email: u.email || "",
      displayName: u.name || u.chineseName || "",
      avatarUrl: this.buildAvatarUrl(u.id, u.avatarUpdatedAt) ?? undefined,
    }
  }

  /** 通过 userId 获取用户信息 */
  async fetchUser(userId: string): Promise<LiteUserInfo | null> {
    const res = await this.http.get<{
      id: number | string
      email?: string
      name?: string
      chineseName?: string
      accountName?: string
      avatarUpdatedAt?: string | number
    }>(`/v1/api/user/${userId}`)

    if (!res.ok || !res.data) return null

    const u = res.data
    return {
      id: String(u.id),
      email: u.email || "",
      displayName: u.name || u.chineseName || "",
      avatarUrl: this.buildAvatarUrl(u.id, u.avatarUpdatedAt) ?? undefined,
    }
  }

  /** 获取用户头像 URL */
  fetchAvatarUrl(userId: string): string | null {
    return this.buildAvatarUrl(userId)
  }

  private buildAvatarUrl(
    userId: string | number,
    avatarUpdatedAt?: string | number | null,
  ): string | null {
    if (!avatarUpdatedAt) return null
    // baseUrl 从 http client 获取不方便，通过环境变量读
    try {
      const { getEnv } = require("../../../lib/env")
      const apiUrl = getEnv().MAIN_VITE_API_URL
      if (!apiUrl) return null
      return `${apiUrl}/v1/api/user/avatar/${userId}?avatarUpdatedAt=${avatarUpdatedAt}`
    } catch {
      return null
    }
  }
}
