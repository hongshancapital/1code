import React, { useCallback } from 'react'
import { cn } from '@/lib/utils'

export interface ImeAwareTextareaProps extends React.ComponentProps<'textarea'> {
  onEnter?: () => void
  allowCompose?: boolean  // 默认 false，只在非组合状态下触发
}

/**
 * IME-aware Textarea 组件
 *
 * 正确处理中文/日文/韩文等输入法（IME）的 Enter 事件。
 * 只有在非组合状态下（!isComposing）才会触发 onEnter，
 * 避免在输入法确认候选词时误触提交。
 */
export const ImeAwareTextarea = React.forwardRef<
  HTMLTextAreaElement,
  ImeAwareTextareaProps
>(function ImeAwareTextarea(
  { onEnter, allowCompose = false, onKeyDown, className, ...props },
  ref,
) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key === 'Enter' &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        (allowCompose || !e.nativeEvent.isComposing)
      ) {
        e.preventDefault()
        onEnter?.()
      }
      onKeyDown?.(e)
    },
    [onEnter, allowCompose, onKeyDown],
  )

  return (
    <textarea
      ref={ref}
      className={cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
        'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'resize-none',
        className,
      )}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
})

ImeAwareTextarea.displayName = 'ImeAwareTextarea'
