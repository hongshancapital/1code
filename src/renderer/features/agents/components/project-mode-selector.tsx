"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Sparkles, Code } from "lucide-react"
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
    const slogans = targetMode === "cowork" ? COWORK_SLOGANS : CODING_SLOGANS
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
  return mode === "cowork"
    ? <CoworkModeIcon className={className} />
    : <CodingModeIcon className={className} />
}

// ============================================================================
// Constants
// ============================================================================

const MODE_OPTIONS: ModeOption[] = [
  {
    id: "cowork",
    title: "Cowork",
    subtitle: "简化协作体验",
    icon: <CoworkModeIcon />,
    features: [
      "简洁的聊天界面",
      "任务和交付物追踪",
      "文件树浏览",
    ],
  },
  {
    id: "coding",
    title: "Coding",
    subtitle: "完整开发体验",
    icon: <CodingModeIcon />,
    features: [
      "Git 分支管理",
      "差异查看和代码审查",
      "Worktree 隔离",
    ],
  },
]

const EASING_CURVE = [0.55, 0.055, 0.675, 0.19] as const

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
  const [hoveredMode, setHoveredMode] = useState<ProjectMode | null>(null)

  if (compact) {
    return (
      <div className={cn("inline-flex items-center gap-1 p-0.5 bg-muted rounded-lg", className)}>
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => !disabled && onChange(option.id)}
            disabled={disabled}
            className={cn(
              "relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
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
        const isHovered = hoveredMode === option.id

        return (
          <motion.button
            key={option.id}
            onClick={() => !disabled && onChange(option.id)}
            onMouseEnter={() => setHoveredMode(option.id)}
            onMouseLeave={() => setHoveredMode(null)}
            disabled={disabled}
            whileHover={{ scale: disabled ? 1 : 1.02 }}
            whileTap={{ scale: disabled ? 1 : 0.98 }}
            className={cn(
              "relative flex-1 p-4 rounded-xl border-2 text-left transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
              isSelected
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50 hover:bg-accent/50",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <div
                className={cn(
                  "p-2 rounded-lg",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                )}
              >
                {option.icon}
              </div>
              <div>
                <h3 className="text-sm font-semibold">{option.title}</h3>
                <p className="text-xs text-muted-foreground">{option.subtitle}</p>
              </div>
            </div>

            {/* Features list with stagger animation */}
            <AnimatePresence mode="wait">
              {(isSelected || isHovered) && (
                <motion.ul
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: EASING_CURVE }}
                  className="mt-3 space-y-1 overflow-hidden"
                >
                  {option.features.map((feature, i) => (
                    <motion.li
                      key={feature}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-2 text-xs text-muted-foreground"
                    >
                      <span className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                      {feature}
                    </motion.li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>

            {/* Selection indicator */}
            {isSelected && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center"
              >
                <svg
                  className="w-3 h-3 text-primary-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
            )}
          </motion.button>
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
    <div className={cn("flex items-center gap-3", className)}>
      <div className="inline-flex items-center gap-1 p-0.5 bg-muted rounded-lg">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => !disabled && onChange(option.id)}
            disabled={disabled}
            className={cn(
              "relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
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
