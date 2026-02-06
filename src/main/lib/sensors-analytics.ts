/**
 * 神策埋点 - Main Process
 * 使用神策 Node.js SDK
 */

import SensorsAnalytics from "sa-sdk-node"
import { app } from "electron"

interface SensorsConfig {
  serverUrl: string
  isDebug?: boolean
}

// 从 env 获取配置（Hong 独立运行场景）
function getSensorsConfigFromEnv(): SensorsConfig | undefined {
  const { getEnv } = require("./env")
  const env = getEnv()
  if (!env.MAIN_VITE_SENSORS_SERVER_URL) {
    return undefined
  }
  return {
    serverUrl: env.MAIN_VITE_SENSORS_SERVER_URL,
    isDebug: process.env.NODE_ENV === "development",
  }
}

let sensors: SensorsAnalytics | undefined
let currentUserId: string | undefined
let userOptedOut = false

const isDev = (): boolean => {
  try {
    return !app.isPackaged && process.env.FORCE_ANALYTICS !== "true"
  } catch {
    return process.env.FORCE_ANALYTICS !== "true"
  }
}

/**
 * 获取公共属性
 */
function getCommonProperties(): Record<string, any> {
  return {
    app_version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron_version: process.versions.electron,
  }
}

/**
 * 初始化神策 SDK
 * @param config 可选配置，外部传入时优先使用（用于 Tinker 等嵌入场景）
 */
export function initSensors(config?: SensorsConfig): void {
  console.log(`[Sensors] isDev check: app.isPackaged=${app.isPackaged}, FORCE_ANALYTICS=${process.env.FORCE_ANALYTICS}, isDev()=${isDev()}`)
  if (isDev()) {
    console.log("[Sensors] Skipping initialization (dev mode)")
    return
  }
  if (sensors) return

  // 外部传入 config 则用，否则从 env 获取
  const finalConfig = config || getSensorsConfigFromEnv()

  if (!finalConfig) {
    console.log("[Sensors] Skipping initialization (no config)")
    return
  }

  try {
    sensors = new SensorsAnalytics()
    // 必须调用 submitTo 才会实际发送数据
    const submitter = sensors.submitTo(finalConfig.serverUrl, {
      mode: finalConfig.isDebug ? "debug" : "track",
    })
    // 监听发送结果
    submitter.catch((err: Error) => {
      console.error("[Sensors] Submit error:", err.message)
    })
    console.log("[Sensors] SDK initialized successfully, serverUrl:", finalConfig.serverUrl)
  } catch (error) {
    console.error("[Sensors] Failed to initialize SDK:", error)
  }
}

/**
 * 设置 opt-out 状态
 */
export function setOptOut(optedOut: boolean): void {
  userOptedOut = optedOut
}

/**
 * 追踪事件
 * 当用户已登录时，$is_login_id: true 告知神策 distinctId 是登录 ID
 */
export function track(
  eventName: string,
  properties?: Record<string, any>,
): void {
  if (isDev() || !sensors || userOptedOut) return

  const distinctId = currentUserId || "anonymous"
  const isLoggedIn = !!currentUserId

  sensors.track(distinctId, eventName, {
    ...getCommonProperties(),
    ...properties,
    $is_login_id: isLoggedIn,
  })
  console.log(`[Sensors] Event tracked: ${eventName}, isLoggedIn: ${isLoggedIn}`)
}

/**
 * 用户登录
 * $is_login_id: true 告知神策 userId 是登录 ID，后续埋点会与此用户绑定
 */
export function login(userId: string, properties?: Record<string, any>): void {
  currentUserId = userId

  if (isDev() || !sensors || userOptedOut) return

  sensors.profileSet(userId, {
    ...getCommonProperties(),
    ...properties,
    $is_login_id: true,
  })
  console.log(`[Sensors] User logged in: ${userId}`)
}

/**
 * 用户登出
 */
export function logout(): void {
  currentUserId = undefined
}

/**
 * 关闭并刷新事件
 */
export async function shutdown(): Promise<void> {
  if (sensors) {
    await sensors.close()
    sensors = undefined
  }
}
