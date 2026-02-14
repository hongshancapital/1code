/**
 * 神策埋点 - Renderer Process
 * 使用神策 Web SDK
 */

import sensors from "sa-sdk-javascript"
import { getEnv } from "./env"

interface SensorsConfig {
  serverUrl: string
  isDebug?: boolean
}

function getSensorsConfig(): SensorsConfig | undefined {
  const serverUrl = import.meta.env.VITE_SENSORS_SERVER_URL

  if (!serverUrl) {
    return undefined
  }

  return {
    serverUrl,
    isDebug: import.meta.env.DEV,
  }
}

let initialized = false

const MAIL_SEPARATOR = "@"

/**
 * 从 email 提取登录 ID（去掉邮箱后缀）
 */
const getLoginIdByEmail = (email: string): string =>
  email.substring(0, email.indexOf(MAIL_SEPARATOR)) || email

// 检查是否为开发模式
// 打包后通过 loadFile() 加载，协议是 file:，不能用协议判断
// 有 VITE_SENSORS_SERVER_URL 说明构建时注入了神策地址，应该上报
function isDev(): boolean {
  if (typeof window === "undefined") return true
  if (import.meta.env.VITE_FORCE_ANALYTICS === "true") return false
  if (import.meta.env.VITE_SENSORS_SERVER_URL) return false
  return true
}

/**
 * 初始化神策 SDK
 */
export function initSensors(): void {
  if (isDev()) return
  if (initialized) return

  const config = getSensorsConfig()
  if (!config) return

  sensors.init({
    server_url: config.serverUrl,
    is_track_single_page: false,
    show_log: config.isDebug,
    send_type: "beacon",
    heatmap: {
      clickmap: "not_collect",
      scroll_notice_map: "not_collect",
    },
  })

  initialized = true
}

/**
 * 追踪事件
 */
export function track(
  eventName: string,
  properties?: Record<string, any>,
): void {
  if (isDev() || !initialized) return

  sensors.track(eventName, properties)
}

/**
 * 用户登录（使用 email 去掉后缀作为登录 ID）
 */
export function login(email: string): void {
  if (isDev() || !initialized) return

  const loginId = getLoginIdByEmail(email)
  sensors.login(loginId)
}

/**
 * 重置用户
 */
export function logout(): void {
  if (isDev() || !initialized) return

  sensors.logout()
}

/**
 * 设置公共属性
 */
export function registerCommonProps(props: Record<string, any>): void {
  if (isDev() || !initialized) return

  sensors.registerPage(props)
}

/**
 * 关闭 SDK（用于组件卸载）
 */
export function shutdown(): void {
  // Web SDK 无需显式关闭
  initialized = false
}

// ============================================================================
// 业务埋点事件
// ============================================================================

/**
 * 应用使用时长 (需在 renderer 计时)
 */
export function trackAppDuration(durationMs: number): void {
  track("Cowork_App_Duration", {
    DurationMs: durationMs,
  })
}

/**
 * 点击创建新工作区
 */
export function trackClickNewWorkspace(): void {
  track("Cowork_Click_New_Workspace")
}

/**
 * 点击 New Chat 按钮
 */
export function trackClickNewChat(button: "chat" | "add" | "shortcut" | "new-chat-form"): void {
  track("Cowork_Click_New_Chat", {
    Button: button,
  })
}

/**
 * 点击选择文件夹
 */
export function trackClickSelectFolder(): void {
  track("Cowork_Click_Select_Folder")
}

/**
 * 点击 plan comment
 */
export function trackClickPlanComment(): void {
  track("Cowork_Click_Plan_Comment")
}

/**
 * 点击 plan approve
 */
export function trackClickPlanApprove(): void {
  track("Cowork_Click_Plan_Approve")
}

/**
 * 点击重新生成
 */
export function trackClickRegenerate(): void {
  track("Cowork_Click_Regenerate")
}

/**
 * 点击复制
 */
export function trackClickCopy(): void {
  track("Cowork_Click_Copy")
}

/**
 * 发送消息
 */
export function trackSendMessage(mode: "agent" | "plan", at: boolean): void {
  track("Cowork_Send_Message", {
    Mode: mode,
    At: at,
  })
}

/**
 * AI 回复用时（每轮对话独立记录）
 */
export function trackAIResponseDuration(durationMs: number, status: "success" | "error"): void {
  track("Cowork_AI_Response_Duration", {
    DurationMs: durationMs,
    Status: status,
  })
}
