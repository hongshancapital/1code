# React Hooks Library

Common React hooks for handling frequent patterns and avoiding common pitfalls.

## Stable Callback Hooks

### `useMemoizedFn` / `useEvent` / `useStableCallback`

Returns a memoized function with a **stable reference that NEVER changes**, but always calls the latest version of your callback.

**When to use:**

1. **Radix UI components** (Dialog, Popover, ContextMenu, etc.)
   - These components re-initialize internal refs when props change
   - Use `useMemoizedFn` for `onOpenChange`, `onClose`, and other event handlers
   - Prevents "Maximum update depth exceeded" errors in React 19

2. **Preventing unnecessary re-renders**
   - When passing callbacks to `React.memo` components
   - When callbacks are used in child component dependency arrays

3. **Avoiding infinite loops**
   - When callbacks are dependencies of `useEffect` or other hooks
   - When state/props used in callback change frequently

**Example:**

```tsx
function MyDialog() {
  const [isDirty, setIsDirty] = useState(false)
  const [open, setOpen] = useState(true)

  // ❌ Bad: Creates new function reference when isDirty changes
  // → Dialog re-initializes refs → "Maximum update depth exceeded"
  const handleClose = useCallback(() => {
    if (isDirty) {
      // handle dirty state
    }
    setOpen(false)
  }, [isDirty]) // Recreates when isDirty changes!

  // ✅ Good: Function reference NEVER changes, always uses latest isDirty
  const handleClose = useMemoizedFn(() => {
    if (isDirty) {
      // handle dirty state
    }
    setOpen(false)
  })

  return <Dialog open={open} onOpenChange={handleClose} />
}
```

**Real-world use cases in our codebase:**

- `file-preview-dialog.tsx`: Dialog `onOpenChange` handler
- Any Radix UI component event handler
- Callbacks passed to virtualized lists
- Event handlers in frequently re-rendering components

### `useLatest`

Always returns the latest value without causing re-renders.

**When to use:**

1. **Accessing latest state in timers/intervals**
   - `setInterval`, `setTimeout` callbacks
   - Animation frame callbacks
   - WebSocket/EventSource message handlers

2. **Event listeners**
   - DOM event listeners registered in `useEffect`
   - IPC listeners in Electron apps

3. **Implementing custom hooks**
   - Building your own `useMemoizedFn` equivalent
   - Storing latest props/state without triggering re-subscriptions

**Example:**

```tsx
function Timer() {
  const [count, setCount] = useState(0)
  const countRef = useLatest(count)

  useEffect(() => {
    // ❌ Bad: Logs stale count (0) forever
    const timer = setInterval(() => {
      console.log(count) // Always 0!
    }, 1000)
    return () => clearInterval(timer)
  }, []) // Empty deps

  useEffect(() => {
    // ✅ Good: Always logs latest count
    const timer = setInterval(() => {
      console.log(countRef.current) // Always latest!
    }, 1000)
    return () => clearInterval(timer)
  }, []) // Empty deps, no re-subscription

  return <button onClick={() => setCount(c => c + 1)}>{count}</button>
}
```

## When NOT to use these hooks

- Simple callbacks that don't change often
- Callbacks that don't cause re-render issues
- When normal `useCallback` works fine

**Rule of thumb:** Start with `useCallback`. If you see:
- "Maximum update depth exceeded" errors
- Unnecessary re-renders
- Infinite loops in useEffect

Then switch to `useMemoizedFn`.

## Aliases

These are all the same hook with different names:

- `useMemoizedFn` - Original name from ahooks
- `useEvent` - React RFC naming convention
- `useStableCallback` - Descriptive name
- `usePersistFn` - Deprecated, use one of the above

Use whichever name makes most sense in your context.

## Implementation Details

```typescript
// useMemoizedFn implementation
export function useMemoizedFn<T extends (...args: any[]) => any>(
  callback: T
): T {
  const callbackRef = useLatest(callback)

  return useCallback(
    ((...args: any[]) => {
      return callbackRef.current(...args)
    }) as T,
    [] // Empty deps - stable reference forever!
  )
}
```

The magic is in the empty dependency array combined with the ref pattern:
1. Function reference never changes (empty deps)
2. Always calls latest callback (via ref)
3. No re-renders triggered by callback changes

## Further Reading

- [React useEvent RFC](https://github.com/reactjs/rfcs/blob/useevent/text/0000-useevent.md)
- [ahooks useMemoizedFn](https://ahooks.js.org/hooks/use-memoized-fn)
- [Why dependencies matter in React](https://overreacted.io/a-complete-guide-to-useeffect/)
