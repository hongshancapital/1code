"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Sparkles, Code, MessageCircle } from "lucide-react"
import { cn } from "../../../lib/utils"
import type { ProjectMode } from "../atoms"

// ============================================================================
// Types
// ============================================================================

interface ProjectModeSelectorProps {
  value: ProjectMode
  onChange: (mode: ProjectMode) => void
  disabled?: boolean
  /** Compact mode - smaller buttons without descriptions */
  compact?: boolean
  className?: string
}

interface ProjectModeToggleWithSloganProps {
  value: ProjectMode
  onChange: (mode: ProjectMode) => void
  disabled?: boolean
  className?: string
  /** Show streaming slogan */
  showSlogan?: boolean
}

interface ModeOption {
  id: ProjectMode
  title: string
  subtitle: string
  icon: React.ReactNode
  features: string[]
}

// ============================================================================
// Streaming Slogan Hook
// ============================================================================

const CHAT_SLOGANS = [
  "Just chat, no project needed",
  "Your AI conversation partner",
  "Ideas flow freely here",
  "Simple, focused conversations",
  "Chat first, code later",
]

const COWORK_SLOGANS = [
  "AI as your collaboration partner",
  "Focus on ideas, deliver results",
  "Simplify workflow, unleash creativity",
  "From concept to delivery, seamlessly",
  "You describe, AI builds",
]

const CODING_SLOGANS = [
  "Code with confidence, Git has your back",
  "Branch management at your fingertips",
  "Your professional coding companion",
  "Diff views and code review made easy",
  "Worktree isolation for safe experiments",
]

interface UseStreamingSloganOptions {
  mode: ProjectMode
  isActive: boolean
  typingSpeed?: number
  startDelay?: number
}

function useStreamingSlogan({
  mode,
  isActive,
  typingSpeed = 30,
  startDelay = 200,
}: UseStreamingSloganOptions) {
  const [displayText, setDisplayText] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [isComplete, setIsComplete] = useState(false)

  const selectedSloganRef = useRef<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const charIndexRef = useRef(0)
  const lastModeRef = useRef<ProjectMode | null>(null)

  const selectRandomSlogan = useCallback((targetMode: ProjectMode) => {
    const slogans = targetMode === "chat"
      ? CHAT_SLOGANS
      : targetMode === "cowork"
        ? COWORK_SLOGANS
        : CODING_SLOGANS
    const randomIndex = Math.floor(Math.random() * slogans.length)
    return slogans[randomIndex]
  }, [])

  const typeNextChar = useCallback(() => {
    const targetText = selectedSloganRef.current
    if (!targetText) return

    if (charIndexRef.current < targetText.length) {
      const nextChar = targetText[charIndexRef.current]
      setDisplayText((prev) => prev + nextChar)
      charIndexRef.current++

      // Variable speed: slower for Chinese characters and punctuation
      let delay = typingSpeed
      if (/[\u4e00-\u9fa5]/.test(nextChar)) {
        delay = typingSpeed * (Math.random() * 0.5 + 0.8)
      }
      if ([" ", "，", "。", "！", "？", ",", ".", "!", "?"].includes(nextChar)) {
        delay = typingSpeed * 2
      }

      timeoutRef.current = setTimeout(typeNextChar, delay)
    } else {
      setIsTyping(false)
      setIsComplete(true)
    }
  }, [typingSpeed])

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Only start typing when mode changes or becomes active
    if (isActive && (lastModeRef.current !== mode || !selectedSloganRef.current)) {
      lastModeRef.current = mode
      setDisplayText("")
      setIsTyping(true)
      setIsComplete(false)
      charIndexRef.current = 0

      selectedSloganRef.current = selectRandomSlogan(mode)

      if (selectedSloganRef.current) {
        timeoutRef.current = setTimeout(typeNextChar, startDelay)
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [isActive, mode, selectRandomSlogan, typeNextChar, startDelay])

  return {
    slogan: displayText,
    isTyping,
    isComplete,
  }
}

// ============================================================================
// Mode Icons - exported for reuse across the app
// ============================================================================

interface ModeIconProps {
  className?: string
}

/** Chat mode icon - MessageCircle representing pure conversation */
export function ChatModeIcon({ className = "w-4 h-4" }: ModeIconProps) {
  return <MessageCircle className={className} />
}

/** Cowork mode icon - Sparkles representing AI-powered collaboration */
export function CoworkModeIcon({ className = "w-4 h-4" }: ModeIconProps) {
  return <Sparkles className={className} />
}

/** Coding mode icon - Code representing full development features */
export function CodingModeIcon({ className = "w-4 h-4" }: ModeIconProps) {
  return <Code className={className} />
}

/** Get the appropriate icon component for a project mode */
export function ProjectModeIcon({ mode, className }: { mode: ProjectMode; className?: string }) {
  switch (mode) {
    case "chat":
      return <ChatModeIcon className={className} />
    case "cowork":
      return <CoworkModeIcon className={className} />
    case "coding":
      return <CodingModeIcon className={className} />
  }
}

// ============================================================================
// Constants
// ============================================================================

const MODE_OPTIONS: ModeOption[] = [
  {
    id: "chat",
    title: "Chat",
    subtitle: "纯对话模式",
    icon: <ChatModeIcon />,
    features: [
      "无需选择项目",
      "纯粹的 AI 对话",
      "随时转为项目",
    ],
  },
  {
    id: "cowork",
    title: "Cowork",
    subtitle: "Simplified mode for collaboration. No Git features.",
    icon: <CoworkModeIcon />,
    features: [],
  },
  {
    id: "coding",
    title: "Coding",
    subtitle: "Full developer experience with Git, branches, and worktrees.",
    icon: <CodingModeIcon />,
    features: [],
  },
]

// ============================================================================
// Component
// ============================================================================

export function ProjectModeSelector({
  value,
  onChange,
  disabled = false,
  compact = false,
  className,
}: ProjectModeSelectorProps) {
  if (compact) {
    return (
      <div className={cn("inline-flex items-center gap-1 p-0.5 bg-muted rounded-lg", className)}>
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => !disabled && onChange(option.id)}
            disabled={disabled}
            className={cn(
              "relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors outline-none",
              value === option.id
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {/* Background indicator with animation */}
            {value === option.id && (
              <motion.div
                layoutId="mode-indicator"
                className="absolute inset-0 bg-primary rounded-md"
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 30,
                }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {option.icon}
              {option.title}
            </span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={cn("flex gap-3", className)}>
      {MODE_OPTIONS.map((option) => {
        const isSelected = value === option.id

        return (
          <button
            key={option.id}
            onClick={() => !disabled && onChange(option.id)}
            disabled={disabled}
            className={cn(
              "relative flex-1 p-4 rounded-xl border-2 text-left transition-colors outline-none",
              isSelected
                ? "border-primary bg-primary/10"
                : "border-border hover:border-primary/50",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "p-2 rounded-lg",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                )}
              >
                {option.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold">{option.title}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{option.subtitle}</p>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ============================================================================
// Inline Mode Toggle (for use in forms)
// ============================================================================

export function ProjectModeToggle({
  value,
  onChange,
  disabled = false,
  className,
}: Omit<ProjectModeSelectorProps, "compact">) {
  return (
    <ProjectModeSelector
      value={value}
      onChange={onChange}
      disabled={disabled}
      compact
      className={className}
    />
  )
}

// ============================================================================
// Mode Toggle with Streaming Slogan (for new-chat-form header)
// ============================================================================

export function ProjectModeToggleWithSlogan({
  value,
  onChange,
  disabled = false,
  className,
  showSlogan = true,
}: ProjectModeToggleWithSloganProps) {
  const { slogan, isTyping } = useStreamingSlogan({
    mode: value,
    isActive: showSlogan,
    typingSpeed: 35,
    startDelay: 300,
  })

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="inline-flex items-center gap-0.5 p-0.5 bg-muted rounded-md">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => !disabled && onChange(option.id)}
            disabled={disabled}
            className={cn(
              "relative px-2 py-1 text-xs font-medium rounded transition-colors outline-none",
              value === option.id
                ? "text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {/* Background indicator with animation */}
            {value === option.id && (
              <motion.div
                layoutId="mode-indicator-with-slogan"
                className="absolute inset-0 bg-primary rounded"
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 30,
                }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {option.icon}
              {option.title}
            </span>
          </button>
        ))}
      </div>

      {/* Streaming Slogan */}
      {showSlogan && (
        <AnimatePresence mode="wait">
          <motion.span
            key={value}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.2 }}
            className="text-xs text-muted-foreground"
          >
            {slogan}
            {isTyping && (
              <motion.span
                animate={{ opacity: [1, 0] }}
                transition={{ duration: 0.5, repeat: Infinity, repeatType: "reverse" }}
                className="ml-0.5"
              >
                |
              </motion.span>
            )}
          </motion.span>
        </AnimatePresence>
      )}
    </div>
  )
}
