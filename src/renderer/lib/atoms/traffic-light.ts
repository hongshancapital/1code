import { atom } from "jotai"

/**
 * 红绿灯（macOS 窗口按钮）状态管理
 *
 * 多个组件可能需要控制红绿灯可见性：
 * - Sidebar 折叠时隐藏
 * - FilePreviewDialog 全屏时隐藏
 * - SettingsSidebar 打开时隐藏
 * - ActiveChat diff/file 全屏时隐藏
 *
 * 使用优先级系统来决定最终状态，优先级越高的请求越优先。
 */

export interface TrafficLightRequest {
  requester: string // 组件标识
  visible: boolean // 请求的可见性
  priority: number // 优先级（越高越优先）
}

/**
 * 优先级常量
 * - 数字越大优先级越高
 * - 系统全屏有最高优先级
 */
export const TRAFFIC_LIGHT_PRIORITIES = {
  DEFAULT: 10,
  SIDEBAR: 20,
  ACTIVE_CHAT_VIEWER: 30,
  SETTINGS_SIDEBAR: 40,
  FILE_PREVIEW_FULLPAGE: 50,
  SYSTEM_FULLSCREEN: 100,
} as const

// 所有活跃的请求
export const trafficLightRequestsAtom = atom<Map<string, TrafficLightRequest>>(
  new Map()
)

// 派生的最终可见性状态
export const trafficLightVisibleAtom = atom((get) => {
  const requests = get(trafficLightRequestsAtom)
  if (requests.size === 0) return true // 默认显示

  // 按优先级排序，取最高优先级的请求
  const sorted = Array.from(requests.values()).sort(
    (a, b) => b.priority - a.priority
  )
  return sorted[0]?.visible ?? true
})

// 注册/更新请求的 atom
export const setTrafficLightRequestAtom = atom(
  null,
  (get, set, request: TrafficLightRequest) => {
    const requests = new Map(get(trafficLightRequestsAtom))
    requests.set(request.requester, request)
    set(trafficLightRequestsAtom, requests)
  }
)

// 移除请求的 atom
export const removeTrafficLightRequestAtom = atom(
  null,
  (get, set, requester: string) => {
    const requests = new Map(get(trafficLightRequestsAtom))
    requests.delete(requester)
    set(trafficLightRequestsAtom, requests)
  }
)
