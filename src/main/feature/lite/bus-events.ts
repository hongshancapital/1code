/**
 * Lite Extension - FeatureBus 事件声明
 *
 * 通过 interface 合并扩展 FeatureBusEvents，
 * 使任意模块可以类型安全地调用 lite 功能。
 */

import type { EventDefinition } from "../../lib/extension/types"

// =============================================================================
// 业务类型
// =============================================================================

export interface LiteUserInfo {
  id: string
  email: string
  displayName: string
  avatarUrl?: string
}

export interface LiteAuthStatus {
  isAuthenticated: boolean
  provider: "okta" | "azure" | null
  userId?: string
  email?: string
}

export interface LiteAuthChangedPayload {
  type: "login" | "logout" | "refresh"
  userId?: string
  provider?: "okta" | "azure"
}

export interface LiteApiResponse<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

export interface LiteWssMessage {
  channel: string
  data: unknown
}

// =============================================================================
// FeatureBusEvents 合并
// =============================================================================

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _EventDefinition = EventDefinition // 确保 import 不被 tree-shaking

declare module "../../lib/extension/types" {
  interface FeatureBusEvents {
    // Request: 请求-响应（一对一）
    "lite:fetch-user": EventDefinition<
      { userId: string },
      LiteUserInfo | null,
      "request"
    >
    "lite:fetch-avatar": EventDefinition<
      { userId: string },
      string | null,
      "request"
    >
    "lite:auth-status": EventDefinition<void, LiteAuthStatus, "request">
    "lite:http-get": EventDefinition<
      { path: string; params?: Record<string, string> },
      LiteApiResponse,
      "request"
    >
    "lite:http-post": EventDefinition<
      { path: string; body?: unknown },
      LiteApiResponse,
      "request"
    >

    // Notify: 单向通知（fire-and-forget）
    "lite:wss-send": EventDefinition<
      { channel: string; data: unknown },
      void,
      "notify"
    >
    "lite:auth-logout": EventDefinition<
      { reason?: string },
      void,
      "notify"
    >
    "lite:page-visible": EventDefinition<
      { visible: boolean },
      void,
      "notify"
    >

    // Broadcast: 广播收集
    "lite:wss-message": EventDefinition<LiteWssMessage, void, "broadcast">
    "lite:auth-changed": EventDefinition<
      LiteAuthChangedPayload,
      void,
      "broadcast"
    >
  }
}
