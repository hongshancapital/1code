/**
 * 神策埋点 - Main Process
 * 使用神策 Node.js SDK
 */

import SensorsAnalytics from "sa-sdk-node"
import { app } from "electron"
import { getDeviceId } from "./device-id"

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
let currentDistinctId: string | undefined // 使用 email 作为 distinctId，与 Web 端保持一致

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
  if (isDev()) return
  if (sensors) return

  // 外部传入 config 则用，否则从 env 获取
  const finalConfig = config || getSensorsConfigFromEnv()
  if (!finalConfig) return

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
  } catch (error) {
    console.error("[Sensors] Failed to initialize SDK:", error)
  }
}

/**
 * 追踪事件
 * distinctId 使用 email（与 Web 端 sensors.login(email) 保持一致）
 * 匿名用户使用 deviceId 作为 distinctId
 * $is_login_id: true 告知神策这是登录 ID
 */
export function track(
  eventName: string,
  properties?: Record<string, any>,
): void {
  if (isDev() || !sensors) return

  const distinctId = currentDistinctId || getDeviceId()
  const isLoggedIn = !!currentDistinctId

  sensors.track(distinctId, eventName, {
    ...getCommonProperties(),
    ...properties,
    $is_login_id: isLoggedIn,
  })
}

/**
 * 用户登录
 * @param email 用户邮箱，作为 distinctId（与 Web 端 sensors.login(email) 保持一致）
 * @param properties 用户属性
 *
 * Node.js SDK 没有 login() 方法，我们通过：
 * 1. 保存 email 作为 distinctId
 * 2. 后续 track() 时使用 email 作为 distinctId，带上 $is_login_id: true
 * 3. 如果之前是匿名状态，调用 trackSignup 合并匿名数据到登录用户
 */
export function login(email: string, properties?: Record<string, any>): void {
  // 无论 SDK 是否可用，都保存 email（确保后续 track 能获取 distinctId）
  const wasAnonymous = !currentDistinctId
  currentDistinctId = email

  // 以下操作需要 SDK 可用
  if (isDev() || !sensors) return

  // 如果之前是匿名状态，调用 trackSignup 合并匿名数据到登录用户
  if (wasAnonymous) {
    const deviceId = getDeviceId()
    sensors.trackSignup(email, deviceId, {
      ...getCommonProperties(),
      ...properties,
    })
  }

  // 设置用户属性
  sensors.profileSet(email, {
    ...getCommonProperties(),
    ...properties,
    $is_login_id: true,
  })
}

/**
 * 用户登出
 */
export function logout(): void {
  currentDistinctId = undefined
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
