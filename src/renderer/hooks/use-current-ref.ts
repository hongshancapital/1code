import { type MutableRefObject, useRef } from "react"

/**
 * 保持 ref.current 始终同步为最新值
 * 用于回调/effect 中避免 stale closure
 */
export function useCurrentRef<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value) as MutableRefObject<T>
  ref.current = value
  return ref
}
