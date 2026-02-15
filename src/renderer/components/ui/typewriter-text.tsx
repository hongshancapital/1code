"use client"

import { useState, useEffect, useRef, memo } from "react"
import { cn } from "../../lib/utils"
import { createLogger } from "../../lib/logger"

const typewriterTextLog = createLogger("TypewriterText")


interface TypewriterTextProps {
  text: string
  placeholder?: string
  id?: string
  className?: string
  /** If true (item created in this session), show placeholder until name generates, then typewriter */
  isJustCreated?: boolean
  /** If true, show placeholder when text is empty */
  showPlaceholder?: boolean
}

export const TypewriterText = memo(function TypewriterText({
  text,
  placeholder = "New workspace",
  id,
  className,
  isJustCreated = false,
  showPlaceholder = false,
}: TypewriterTextProps) {
  const [isTyping, setIsTyping] = useState(false)
  const [typedLength, setTypedLength] = useState(0)
  const prevIdRef = useRef(id)
  // Track the last animated text to detect real changes
  const lastAnimatedTextRef = useRef<string | null>(null)

  // Reset state when id changes
  useEffect(() => {
    if (id !== prevIdRef.current) {
      setIsTyping(false)
      setTypedLength(0)
      lastAnimatedTextRef.current = null
      prevIdRef.current = id
    }
  }, [id, text])

  // Detect when text CHANGES - trigger typewriter for new text
  useEffect(() => {
    // Skip if not just created or text is empty/placeholder
    if (!isJustCreated || !text || text === placeholder) return

    // Skip if we're already typing this text or already animated this exact text
    if (isTyping || text === lastAnimatedTextRef.current) return

    // Text changed to something new - trigger typewriter
    typewriterTextLog.info("Text changed, triggering typewriter:", { id, text, lastAnimated: lastAnimatedTextRef.current })
    setIsTyping(true)
    setTypedLength(1)
    lastAnimatedTextRef.current = text
  }, [text, isJustCreated, isTyping, placeholder, id])

  // Typewriter animation
  useEffect(() => {
    if (!isTyping || !text) return

    if (typedLength < text.length) {
      const timeout = setTimeout(() => {
        setTypedLength((prev) => prev + 1)
      }, 30) // 30ms per character
      return () => clearTimeout(timeout)
    } else {
      setIsTyping(false)
    }
  }, [isTyping, typedLength, text])

  // Show placeholder for empty text
  if (!text || text === placeholder) {
    if (showPlaceholder) {
      return <span className={cn("text-muted-foreground/50", className)}>{placeholder}</span>
    }
    return <span className={className}></span>
  }

  // Not animating - show final text
  if (!isTyping) {
    return <span className={className}>{text}</span>
  }

  // Typewriter animation in progress
  const visibleText = text.slice(0, typedLength)

  return (
    <span className={className}>
      {visibleText}
    </span>
  )
})
