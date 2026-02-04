import { useEffect } from "react"
import { useAtomValue } from "jotai"
import { trafficLightVisibleAtom } from "../atoms/traffic-light"

/**
 * 同步红绿灯状态到原生窗口
 *
 * 在 App 根组件调用一次，监听 trafficLightVisibleAtom 的变化，
 * 并将最终状态同步到 macOS 原生窗口按钮。
 */
export function useTrafficLightSync() {
  const visible = useAtomValue(trafficLightVisibleAtom)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!window.desktopApi?.setTrafficLightVisibility) return

    window.desktopApi.setTrafficLightVisibility(visible)
  }, [visible])
}
