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
  const env = getEnv()

  if (!env.VITE_SENSORS_SERVER_URL) {
    return undefined
  }

  return {
    serverUrl: env.VITE_SENSORS_SERVER_URL,
    isDebug: import.meta.env.DEV,
  }
}

let initialized = false

// 检查是否为开发模式：
// 1. file:// 协议下（Electron）检查 FORCE_ANALYTICS
// 2. http://localhost 下检查 __FORCE_ANALYTICS__
const isDev = (() => {
  if (typeof window === "undefined") return true
  const isFileProtocol = window.location.protocol === "file:"
  const isLocalhost = window.location.hostname === "localhost"
  // Electron file:// 使用 import.meta.env，localhost 使用 window 变量
  const forceAnalytics = isFileProtocol
    ? import.meta.env.VITE_FORCE_ANALYTICS === "true"
    : window.__FORCE_ANALYTICS__
  return (isFileProtocol || isLocalhost) && !forceAnalytics
})()

function isOptedOut(): boolean {
  try {
    const optOut = localStorage.getItem("preferences:analytics-opt-out")
    return optOut === "true"
  } catch {
    return false
  }
}

/**
 * 初始化神策 SDK
 */
export function initSensors(): void {
  if (isDev) return
  if (initialized) return

  const config = getSensorsConfig()

  if (!config) {
    console.log("[Sensors] Skipping initialization (no config)")
    return
  }

  sensors.init({
    server_url: config.serverUrl,
    is_track_single_page: false,
    show_log: config.isDebug,
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
  if (isDev || !initialized || isOptedOut()) return

  sensors.track(eventName, properties)
}

/**
 * 设置用户属性
 */
export function login(userId: string): void {
  if (isDev || !initialized || isOptedOut()) return

  sensors.login(userId)
}

/**
 * 重置用户
 */
export function logout(): void {
  if (isDev || !initialized) return

  sensors.logout()
}

/**
 * 设置公共属性
 */
export function registerCommonProps(props: Record<string, any>): void {
  if (isDev || !initialized) return

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
export function trackClickNewChat(button: "chat" | "add"): void {
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
