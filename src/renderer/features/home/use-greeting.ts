import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night"
export type DayType = "weekday" | "weekend"

export interface GreetingConfig {
  timeOfDay: TimeOfDay
  dayType: DayType
  greetingKey: string // i18n key
}

/**
 * Get the time of day based on the current hour
 * - morning: 5:00 - 11:59
 * - afternoon: 12:00 - 17:59
 * - evening: 18:00 - 21:59
 * - night: 22:00 - 4:59
 */
function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning"
  if (hour >= 12 && hour < 18) return "afternoon"
  if (hour >= 18 && hour < 22) return "evening"
  return "night"
}

/**
 * Get the day type (weekday or weekend)
 */
function getDayType(day: number): DayType {
  return day === 0 || day === 6 ? "weekend" : "weekday"
}

/**
 * Hook to get the current greeting configuration
 * Updates when the time period changes
 */
export function useGreeting(): GreetingConfig {
  const [config, setConfig] = useState<GreetingConfig>(() => {
    const now = new Date()
    const timeOfDay = getTimeOfDay(now.getHours())
    const dayType = getDayType(now.getDay())
    return {
      timeOfDay,
      dayType,
      greetingKey: `greetings.${timeOfDay}.${dayType}`,
    }
  })

  useEffect(() => {
    // Check every minute for time period changes
    const interval = setInterval(() => {
      const now = new Date()
      const timeOfDay = getTimeOfDay(now.getHours())
      const dayType = getDayType(now.getDay())
      const newKey = `greetings.${timeOfDay}.${dayType}`

      if (newKey !== config.greetingKey) {
        setConfig({
          timeOfDay,
          dayType,
          greetingKey: newKey,
        })
      }
    }, 60000) // Check every minute

    return () => clearInterval(interval)
  }, [config.greetingKey])

  return config
}

/**
 * Hook to get a random greeting message from the greeting array
 * Returns a new random greeting each time the component mounts
 */
export function useGreetingMessage(): string {
  const { t } = useTranslation("home")
  const { greetingKey } = useGreeting()

  // Get greeting array and pick a random one on mount
  const [greeting, setGreeting] = useState("")

  useEffect(() => {
    const greetings = t(greetingKey, { returnObjects: true })
    if (Array.isArray(greetings) && greetings.length > 0) {
      const index = Math.floor(Math.random() * greetings.length)
      setGreeting(greetings[index])
    } else {
      setGreeting(typeof greetings === "string" ? greetings : "")
    }
  }, [t, greetingKey])

  return greeting
}

/**
 * Hook that provides a typing animation effect for text
 * @param text - The full text to type out
 * @param speed - Typing speed in ms per character (default: 30)
 * @param startDelay - Delay before starting to type (default: 300)
 */
export function useTypingEffect(
  text: string,
  speed: number = 30,
  startDelay: number = 300
): { displayText: string; isTyping: boolean } {
  const [displayText, setDisplayText] = useState("")
  const [isTyping, setIsTyping] = useState(true)

  useEffect(() => {
    setDisplayText("")
    setIsTyping(true)

    // Start delay
    const startTimeout = setTimeout(() => {
      let currentIndex = 0

      const typeInterval = setInterval(() => {
        if (currentIndex < text.length) {
          setDisplayText(text.slice(0, currentIndex + 1))
          currentIndex++
        } else {
          clearInterval(typeInterval)
          setIsTyping(false)
        }
      }, speed)

      return () => clearInterval(typeInterval)
    }, startDelay)

    return () => clearTimeout(startTimeout)
  }, [text, speed, startDelay])

  return { displayText, isTyping }
}

/**
 * Combined hook that gets the greeting and provides typing effect
 */
export function useTypingGreeting(
  speed: number = 30,
  startDelay: number = 300
): { displayText: string; isTyping: boolean; fullText: string } {
  const fullText = useGreetingMessage()
  const { displayText, isTyping } = useTypingEffect(fullText, speed, startDelay)

  return { displayText, isTyping, fullText }
}
