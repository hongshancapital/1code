/**
 * Browser Console Output
 * Lightweight read-only terminal output viewer using xterm.js for console messages.
 * Based on the preview-sidebar/terminal-output.tsx implementation from 1code.
 */

import { useEffect, useRef, useMemo } from "react"
import type { Terminal as XTerm } from "xterm"
import type { FitAddon } from "@xterm/addon-fit"
import { useAtomValue } from "jotai"
import { useTheme } from "next-themes"
import { createTerminalInstance, getDefaultTerminalBg } from "../terminal/helpers"
import { getTerminalThemeFromVSCode } from "../terminal/config"
import { fullThemeDataAtom } from "@/lib/atoms"
import "xterm/css/xterm.css"

interface BrowserConsoleOutputProps {
  /** Console messages to display */
  messages: ConsoleMessage[]
  /** Called when URL is clicked in output */
  onUrlClick?: (url: string) => void
}

interface ConsoleMessage {
  id: number
  type: "log" | "info" | "warn" | "error" | "debug"
  args: string[]
  timestamp: number
}

/**
 * Format a console message with ANSI colors based on type
 */
function formatMessage(msg: ConsoleMessage): string {
  const timestamp = new Date(msg.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  })

  // ANSI color codes
  const colors: Record<ConsoleMessage["type"], string> = {
    error: "\x1b[31m",   // Red
    warn: "\x1b[33m",    // Yellow
    info: "\x1b[34m",    // Blue
    debug: "\x1b[90m",   // Gray
    log: "\x1b[0m",      // Default
  }

  const reset = "\x1b[0m"
  const dimGray = "\x1b[90m"
  const color = colors[msg.type] || colors.log

  // Format: [timestamp] message
  return `${dimGray}${timestamp}${reset} ${color}${msg.args.join(" ")}${reset}\r\n`
}

/**
 * Lightweight read-only terminal output viewer using xterm.js.
 * Displays console messages with ANSI colors.
 */
export function BrowserConsoleOutput({ messages, onUrlClick }: BrowserConsoleOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const lastMessageCountRef = useRef(0)

  // Use ref for callback to avoid recreating xterm on every render
  const onUrlClickRef = useRef(onUrlClick)
  onUrlClickRef.current = onUrlClick

  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const fullThemeData = useAtomValue(fullThemeDataAtom)

  // Initialize xterm once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const { xterm, fitAddon, cleanup } = createTerminalInstance(container, {
      isDark,
      onUrlClick: (url) => onUrlClickRef.current?.(url),
    })

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    // Resize observer for auto-fit
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit()
        } catch {
          // Ignore fit errors during rapid resize
        }
      })
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      cleanup()
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
  }, [isDark])

  // Write new messages incrementally
  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm || messages.length === 0) return

    // Only write new messages since last update
    const newMessages = messages.slice(lastMessageCountRef.current)
    if (newMessages.length > 0) {
      for (const msg of newMessages) {
        xterm.write(formatMessage(msg))
      }
      lastMessageCountRef.current = messages.length
    }
  }, [messages])

  // Reset when messages are cleared
  useEffect(() => {
    if (messages.length === 0 && lastMessageCountRef.current > 0) {
      xtermRef.current?.clear()
      lastMessageCountRef.current = 0
    }
  }, [messages.length])

  // Update theme dynamically
  useEffect(() => {
    if (xtermRef.current) {
      const newTheme = getTerminalThemeFromVSCode(fullThemeData?.colors, isDark)
      xtermRef.current.options.theme = newTheme
    }
  }, [isDark, fullThemeData])

  const terminalBg = useMemo(() => {
    if (fullThemeData?.colors?.["terminal.background"]) {
      return fullThemeData.colors["terminal.background"]
    }
    if (fullThemeData?.colors?.["editor.background"]) {
      return fullThemeData.colors["editor.background"]
    }
    return getDefaultTerminalBg(isDark)
  }, [isDark, fullThemeData])

  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{ backgroundColor: terminalBg }}
    >
      <div ref={containerRef} className="h-full w-full p-2" />
    </div>
  )
}
