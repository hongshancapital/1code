/**
 * Lite HTTP Client
 *
 * 统一 HTTP 客户端，自动附加 auth token，401 拦截触发 refresh。
 */

import { getEnv, getApiOrigin } from "../../../lib/env"
import { BROWSER_USER_AGENT } from "../../../lib/constants"
import { getAuthManager } from "../auth/manager"
import { createLogger } from "../../../lib/logger"

const liteHttpLog = createLogger("LiteHttp")


export interface LiteHttpResponse<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

export interface LiteHttpRequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  body?: unknown
  headers?: Record<string, string>
  /** 跳过 auth token 注入 */
  noAuth?: boolean
  /** 401 时自动 refresh 并重试（默认 true） */
  autoRetry?: boolean
}

export class LiteHttpClient {
  private baseUrl: string | null = null

  initialize(): void {
    this.baseUrl = getEnv().MAIN_VITE_API_URL ?? null
    if (!this.baseUrl) {
      liteHttpLog.warn("API URL 未配置，HTTP 功能不可用")
    }
  }

  async request<T = unknown>(
    path: string,
    options: LiteHttpRequestOptions = {},
  ): Promise<LiteHttpResponse<T>> {
    if (!this.baseUrl) {
      return { ok: false, status: 0, error: "API not configured" }
    }

    const {
      method = "GET",
      body,
      headers: extraHeaders,
      noAuth = false,
      autoRetry = true,
    } = options

    const token = noAuth ? null : await this._getToken()
    const result = await this._fetch<T>(path, method, token, body, extraHeaders)

    // 401 自动 refresh 重试
    if (result.status === 401 && autoRetry && !noAuth) {
      const authManager = getAuthManager()
      if (authManager) {
        const refreshed = await authManager.refresh()
        if (refreshed) {
          const newToken = await this._getToken()
          return this._fetch<T>(path, method, newToken, body, extraHeaders)
        }
      }
    }

    return result
  }

  async get<T = unknown>(
    path: string,
    options?: Omit<LiteHttpRequestOptions, "method" | "body">,
  ): Promise<LiteHttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "GET" })
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    options?: Omit<LiteHttpRequestOptions, "method" | "body">,
  ): Promise<LiteHttpResponse<T>> {
    return this.request<T>(path, { ...options, method: "POST", body })
  }

  // ---------------------------------------------------------------------------
  // 内部方法
  // ---------------------------------------------------------------------------

  private async _getToken(): Promise<string | null> {
    const authManager = getAuthManager()
    if (!authManager) return null
    return authManager.getValidToken()
  }

  private _buildHeaders(
    token: string | null,
    hasBody: boolean,
    extraHeaders?: Record<string, string>,
  ): Record<string, string> {
    const origin = getApiOrigin() || this.baseUrl!
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      Origin: origin,
      Referer: `${origin}/`,
      "User-Agent": BROWSER_USER_AGENT,
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    }

    if (token) {
      headers["Authorization"] = `Bearer ${token}`
    }

    // Azure 特殊 header
    try {
      const { getAzureAuthHeaders } = require("../auth/manager")
      Object.assign(headers, getAzureAuthHeaders())
    } catch {
      // ignore
    }

    return headers
  }

  private async _fetch<T>(
    path: string,
    method: string,
    token: string | null,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<LiteHttpResponse<T>> {
    const url = `${this.baseUrl}${path}`
    const headers = this._buildHeaders(token, !!body, extraHeaders)

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => "")
        return {
          ok: false,
          status: response.status,
          error: `HTTP ${response.status}: ${errorText}`,
        }
      }

      const data = await response.json().catch(() => null)
      return { ok: true, status: response.status, data: data as T }
    } catch (error) {
      liteHttpLog.error(`${method} ${path} 错误:`, error)
      return { ok: false, status: 0, error: String(error) }
    }
  }
}
