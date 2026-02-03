"use client"

import { memo, useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from "react"
import { ChevronUp, ChevronDown, CornerDownLeft, Clock } from "lucide-react"
import { Button } from "../../../components/ui/button"
import { cn } from "../../../lib/utils"
import type { PendingUserQuestions } from "../atoms"

interface AgentUserQuestionProps {
  pendingQuestions: PendingUserQuestions
  onAnswer: (answers: Record<string, string>) => void
  onSkip: () => void
  hasCustomText?: boolean
}

export interface AgentUserQuestionHandle {
  getAnswers: () => Record<string, string>
}

// Format remaining seconds to display string
function formatRemainingTime(seconds: number): string {
  if (seconds <= 0) return "0s"
  if (seconds < 60) return `${seconds}s`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

export const AgentUserQuestion = memo(forwardRef<AgentUserQuestionHandle, AgentUserQuestionProps>(
  function AgentUserQuestion({
    pendingQuestions,
    onAnswer,
    onSkip,
    hasCustomText = false,
  }: AgentUserQuestionProps, ref) {
  const { questions, toolUseId, timeoutSeconds, receivedAt } = pendingQuestions
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [focusedOptionIndex, setFocusedOptionIndex] = useState(0)
  const [isVisible, setIsVisible] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    timeoutSeconds > 0 ? Math.max(0, timeoutSeconds - Math.floor((Date.now() - receivedAt) / 1000)) : 0
  )
  const [userInteracted, setUserInteracted] = useState(false) // Track if user has interacted
  const prevIndexRef = useRef(currentQuestionIndex)
  const prevToolUseIdRef = useRef(toolUseId)
  const customInputRef = useRef<HTMLInputElement>(null)

  // Expose getAnswers method to parent via ref
  useImperativeHandle(ref, () => ({
    getAnswers: () => {
      const formattedAnswers: Record<string, string> = {}
      for (const question of questions) {
        const selected = answers[question.question] || []
        const custom = customAnswers[question.question]?.trim()

        if (selected.length > 0 && custom) {
          // Both option selected and custom text
          formattedAnswers[question.question] = `${selected.join(", ")}, Other: ${custom}`
        } else if (selected.length > 0) {
          formattedAnswers[question.question] = selected.join(", ")
        } else if (custom) {
          formattedAnswers[question.question] = `Other: ${custom}`
        }
      }
      return formattedAnswers
    }
  }), [answers, customAnswers, questions])

  // Reset when toolUseId changes (new question set)
  useEffect(() => {
    if (prevToolUseIdRef.current !== toolUseId) {
      setIsSubmitting(false)
      setCurrentQuestionIndex(0)
      setAnswers({})
      setCustomAnswers({})
      setFocusedOptionIndex(0)
      setUserInteracted(false) // Reset interaction state
      setRemainingSeconds(
        timeoutSeconds > 0 ? Math.max(0, timeoutSeconds - Math.floor((Date.now() - receivedAt) / 1000)) : 0
      )
      prevToolUseIdRef.current = toolUseId
    }
  }, [toolUseId, timeoutSeconds, receivedAt])

  // Countdown timer - auto-skip when time runs out (stops when user interacts)
  useEffect(() => {
    if (timeoutSeconds <= 0) return // No timeout
    if (userInteracted) return // Stop countdown when user has interacted

    const updateRemaining = () => {
      const elapsed = Math.floor((Date.now() - receivedAt) / 1000)
      const remaining = Math.max(0, timeoutSeconds - elapsed)
      setRemainingSeconds(remaining)

      // Auto-skip when countdown reaches 0
      if (remaining <= 0 && !isSubmitting) {
        onSkip()
      }
    }

    // Update immediately
    updateRemaining()

    // Update every second
    const interval = setInterval(updateRemaining, 1000)
    return () => clearInterval(interval)
  }, [timeoutSeconds, receivedAt, isSubmitting, onSkip, userInteracted])

  // Animate on question change
  useEffect(() => {
    if (prevIndexRef.current !== currentQuestionIndex) {
      setIsVisible(false)
      const timer = setTimeout(() => {
        setIsVisible(true)
      }, 50)
      prevIndexRef.current = currentQuestionIndex
      return () => clearTimeout(timer)
    }
  }, [currentQuestionIndex])

  if (questions.length === 0) {
    return null
  }

  const currentQuestion = questions[currentQuestionIndex]
  const currentOptions = currentQuestion?.options || []
  const currentCustomAnswer = customAnswers[currentQuestion?.question] || ""

  const isOptionSelected = (questionText: string, optionLabel: string) => {
    return answers[questionText]?.includes(optionLabel) || false
  }

  // Handle custom answer change
  const handleCustomAnswerChange = (questionText: string, value: string) => {
    setUserInteracted(true) // Stop countdown when user starts typing
    setCustomAnswers((prev) => ({
      ...prev,
      [questionText]: value,
    }))
  }

  // Check if current question has any answer (option or custom)
  const questionHasAnswer = (questionText: string) => {
    const selected = answers[questionText] || []
    const custom = customAnswers[questionText]?.trim()
    return selected.length > 0 || !!custom
  }

  // Handle option click - auto-advance for single-select questions
  const handleOptionClick = useCallback(
    (questionText: string, optionLabel: string, questionIndex: number) => {
      setUserInteracted(true) // Stop countdown when user selects an option

      const question = questions[questionIndex]
      const allowMultiple = question?.multiSelect || false
      const isLastQuestion = questionIndex === questions.length - 1

      setAnswers((prev) => {
        const currentAnswers = prev[questionText] || []

        if (allowMultiple) {
          if (currentAnswers.includes(optionLabel)) {
            return {
              ...prev,
              [questionText]: currentAnswers.filter((l) => l !== optionLabel),
            }
          } else {
            return {
              ...prev,
              [questionText]: [...currentAnswers, optionLabel],
            }
          }
        } else {
          return {
            ...prev,
            [questionText]: [optionLabel],
          }
        }
      })

      // For single-select questions, auto-advance to next question
      if (!allowMultiple && !isLastQuestion) {
        setTimeout(() => {
          setCurrentQuestionIndex(questionIndex + 1)
          setFocusedOptionIndex(0)
        }, 150)
      }
    },
    [questions],
  )

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex(currentQuestionIndex - 1)
      setFocusedOptionIndex(0)
    }
  }

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
      setFocusedOptionIndex(0)
    }
  }

  const handleContinue = useCallback(() => {
    if (isSubmitting) return

    const hasAnswer = questionHasAnswer(currentQuestion?.question)
    if (!hasAnswer) return

    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1)
      setFocusedOptionIndex(0)
    } else {
      // On the last question, validate ALL questions are answered before submit
      const allAnswered = questions.every((q) => questionHasAnswer(q.question))
      if (allAnswered) {
        setIsSubmitting(true)
        // Convert answers to SDK format
        const formattedAnswers: Record<string, string> = {}
        for (const question of questions) {
          const selected = answers[question.question] || []
          const custom = customAnswers[question.question]?.trim()

          if (selected.length > 0 && custom) {
            formattedAnswers[question.question] = `${selected.join(", ")}, Other: ${custom}`
          } else if (selected.length > 0) {
            formattedAnswers[question.question] = selected.join(", ")
          } else if (custom) {
            formattedAnswers[question.question] = `Other: ${custom}`
          }
        }
        onAnswer(formattedAnswers)
      }
    }
  }, [
    onAnswer,
    answers,
    customAnswers,
    currentQuestionIndex,
    questions,
    currentQuestion?.question,
    isSubmitting,
  ])

  const handleSkipWithGuard = useCallback(() => {
    if (isSubmitting) return
    setIsSubmitting(true)
    onSkip()
  }, [isSubmitting, onSkip])

  const getOptionNumber = (index: number) => {
    return String(index + 1)
  }

  const currentQuestionHasAnswer = questionHasAnswer(currentQuestion?.question)
  const allQuestionsAnswered = questions.every((q) => questionHasAnswer(q.question))
  const isLastQuestion = currentQuestionIndex === questions.length - 1

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSubmitting) return

      const activeEl = document.activeElement
      // Allow typing in input - don't handle keyboard shortcuts when input is focused
      if (
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute("contenteditable") === "true"
      ) {
        // Only handle Enter in input to submit custom answer
        if (e.key === "Enter" && activeEl === customInputRef.current) {
          e.preventDefault()
          if (currentQuestionHasAnswer) {
            handleContinue()
          }
        }
        return
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        if (focusedOptionIndex < currentOptions.length - 1) {
          setFocusedOptionIndex(focusedOptionIndex + 1)
        } else if (currentQuestionIndex < questions.length - 1) {
          setCurrentQuestionIndex(currentQuestionIndex + 1)
          setFocusedOptionIndex(0)
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        if (focusedOptionIndex > 0) {
          setFocusedOptionIndex(focusedOptionIndex - 1)
        } else if (currentQuestionIndex > 0) {
          const prevQuestionOptions =
            questions[currentQuestionIndex - 1]?.options || []
          setCurrentQuestionIndex(currentQuestionIndex - 1)
          setFocusedOptionIndex(prevQuestionOptions.length - 1)
        }
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (currentQuestionHasAnswer) {
          handleContinue()
        } else if (currentOptions[focusedOptionIndex]) {
          handleOptionClick(
            currentQuestion.question,
            currentOptions[focusedOptionIndex].label,
            currentQuestionIndex,
          )
        }
      } else if (e.key >= "1" && e.key <= "9") {
        const numberIndex = parseInt(e.key, 10) - 1
        if (numberIndex >= 0 && numberIndex < currentOptions.length) {
          e.preventDefault()
          handleOptionClick(
            currentQuestion.question,
            currentOptions[numberIndex].label,
            currentQuestionIndex,
          )
          setFocusedOptionIndex(numberIndex)
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [
    currentOptions,
    currentQuestion,
    currentQuestionIndex,
    focusedOptionIndex,
    handleOptionClick,
    currentQuestionHasAnswer,
    handleContinue,
    questions,
    isSubmitting,
  ])

  return (
    <div className="border rounded-t-xl border-b-0 border-border bg-muted/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-muted-foreground">
            {currentQuestion?.header || "Question"}
          </span>
          <span className="text-muted-foreground/50">•</span>
          <span className="text-[12px] text-muted-foreground">
            {currentQuestion?.multiSelect ? "Multi-select" : "Single-select"}
          </span>
        </div>

        {/* Navigation */}
        {questions.length > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={handlePrevious}
              disabled={currentQuestionIndex === 0}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed outline-hidden"
            >
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            </button>
            <span className="text-xs text-muted-foreground px-1">
              {currentQuestionIndex + 1} / {questions.length}
            </span>
            <button
              onClick={handleNext}
              disabled={currentQuestionIndex === questions.length - 1}
              className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed outline-hidden"
            >
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>

      {/* Current Question */}
      <div
        className={cn(
          "px-1 pb-2 transition-opacity duration-150 ease-out",
          isVisible ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="text-[14px] font-[450] text-foreground mb-3 pt-1 px-2">
          <span className="text-muted-foreground">{currentQuestionIndex + 1}.</span> {currentQuestion?.question}
        </div>

        {/* Options */}
        <div className="flex flex-col gap-1">
          {currentOptions.map((option, optIndex) => {
            const isSelected = isOptionSelected(
              currentQuestion.question,
              option.label,
            )
            const isFocused = focusedOptionIndex === optIndex
            const number = getOptionNumber(optIndex)

            return (
              <button
                key={option.label}
                onClick={() => {
                  if (isSubmitting) return
                  handleOptionClick(
                    currentQuestion.question,
                    option.label,
                    currentQuestionIndex,
                  )
                  setFocusedOptionIndex(optIndex)
                }}
                disabled={isSubmitting}
                className={cn(
                  "w-full flex items-start gap-3 p-2 text-[13px] text-foreground rounded-md text-left transition-colors outline-hidden",
                  isFocused ? "bg-muted/70" : "hover:bg-muted/50",
                  isSubmitting && "opacity-50 cursor-not-allowed",
                )}
              >
                <div
                  className={cn(
                    "shrink-0 w-5 h-5 rounded flex items-center justify-center text-[10px] font-medium transition-colors mt-0.5",
                    isSelected
                      ? "bg-foreground text-background"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {number}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span
                    className={cn(
                      "text-[13px] transition-colors font-medium",
                      isSelected ? "text-foreground" : "text-foreground",
                    )}
                  >
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="text-[12px] text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {/* Custom Answer Input */}
        <div className="px-2 mt-2">
          <input
            ref={customInputRef}
            type="text"
            placeholder="Or type your custom answer..."
            value={currentCustomAnswer}
            onChange={(e) => handleCustomAnswerChange(currentQuestion.question, e.target.value)}
            disabled={isSubmitting}
            className={cn(
              "w-full px-3 py-2 text-[13px] border border-border rounded-md bg-background",
              "placeholder:text-muted-foreground/60",
              "focus:outline-hidden focus:ring-1 focus:ring-ring",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-2 py-2">
        {/* Countdown timer - hidden once user interacts */}
        <div className="flex items-center gap-1.5">
          {timeoutSeconds > 0 && !userInteracted && (
            <span className={cn(
              "text-xs flex items-center gap-1",
              remainingSeconds <= 10 ? "text-destructive" : "text-muted-foreground"
            )}>
              <Clock className="w-3 h-3" />
              {formatRemainingTime(remainingSeconds)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkipWithGuard}
            disabled={isSubmitting}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Skip All
          </Button>
          <Button
            size="sm"
            onClick={handleContinue}
            disabled={
              isSubmitting ||
              hasCustomText ||
              (isLastQuestion ? !allQuestionsAnswered : !currentQuestionHasAnswer)
            }
            className="h-6 text-xs px-3 rounded-md"
          >
            {isSubmitting ? (
              "Sending..."
            ) : (
              <>
                {isLastQuestion ? "Submit" : "Continue"}
                <CornerDownLeft className="w-3 h-3 ml-1 opacity-60" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}))
