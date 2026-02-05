import { useRef, useEffect, useCallback, type DependencyList } from "react"

/**
 * useLatest - Always returns the latest value without causing re-renders
 *
 * Use this when you need to access the latest value of a prop or state
 * inside a callback without adding it to the dependency array.
 *
 * @example
 * ```tsx
 * const [count, setCount] = useState(0)
 * const countRef = useLatest(count)
 *
 * useEffect(() => {
 *   const timer = setInterval(() => {
 *     // Always logs the latest count
 *     console.log(countRef.current)
 *   }, 1000)
 *   return () => clearInterval(timer)
 * }, []) // Empty deps - no re-subscription
 * ```
 */
export function useLatest<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)

  useEffect(() => {
    ref.current = value
  }, [value])

  return ref
}

/**
 * useMemoizedFn - Returns a memoized function with stable reference
 *
 * The returned function reference NEVER changes, but always calls
 * the latest version of the callback. This is crucial for:
 * - Preventing unnecessary re-renders when passing callbacks to children
 * - Avoiding infinite loops in useEffect/useCallback dependency arrays
 * - Working with Radix UI components that re-initialize refs on prop changes
 *
 * @example
 * ```tsx
 * const [count, setCount] = useState(0)
 *
 * // ❌ Bad: Creates new function on every render
 * const handleClick = () => {
 *   console.log(count)
 * }
 *
 * // ❌ Better but still recreates when count changes
 * const handleClick = useCallback(() => {
 *   console.log(count)
 * }, [count])
 *
 * // ✅ Best: Stable reference, always logs latest count
 * const handleClick = useMemoizedFn(() => {
 *   console.log(count)
 * })
 *
 * return <Dialog onOpenChange={handleClick} />
 * ```
 */
export function useMemoizedFn<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useLatest(callback)

  // This function reference NEVER changes (empty dependency array)
  // but always calls the latest callback via ref
  return useCallback(
    ((...args: any[]) => {
      return callbackRef.current(...args)
    }) as T,
    [] // Empty deps - stable reference forever
  )
}

/**
 * useEvent - Alias for useMemoizedFn (React RFC naming)
 *
 * This follows the naming convention from the React useEvent RFC:
 * https://github.com/reactjs/rfcs/blob/useevent/text/0000-useevent.md
 *
 * Use whichever name you prefer - they're identical.
 */
export const useEvent = useMemoizedFn

/**
 * useStableCallback - Another alias for useMemoizedFn
 *
 * More descriptive name that emphasizes the stable reference.
 */
export const useStableCallback = useMemoizedFn

/**
 * usePersistFn - Deprecated alias, use useMemoizedFn instead
 * @deprecated Use useMemoizedFn, useEvent, or useStableCallback
 */
export const usePersistFn = useMemoizedFn
