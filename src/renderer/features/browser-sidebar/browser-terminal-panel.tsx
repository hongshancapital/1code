/**
 * Browser Terminal Panel
 * Console output panel for browser developer mode using xterm.js
 * Based on the preview-sidebar implementation from 1code project.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useTheme } from "next-themes"
import { ResizableBottomPanel } from "@/components/ui/resizable-bottom-panel"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Trash2, ChevronDown, Copy } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  browserTerminalVisibleAtomFamily,
  browserTerminalHeightAtomFamily,
} from "./atoms"
import { BrowserConsoleOutput } from "./browser-console-output"
import { fullThemeDataAtom } from "@/lib/atoms"
import { getDefaultTerminalBg } from "../terminal/helpers"

interface BrowserTerminalPanelProps {
  chatId: string
  webviewRef: React.RefObject<Electron.WebviewTag | null>
}

interface ConsoleMessage {
  id: number
  type: "log" | "info" | "warn" | "error" | "debug"
  args: string[]
  timestamp: number
}

export function BrowserTerminalPanel({
  chatId,
  webviewRef,
}: BrowserTerminalPanelProps) {
  const { t } = useTranslation("common")
  const [isOpen, setIsOpen] = useAtom(browserTerminalVisibleAtomFamily(chatId))
  const heightAtom = browserTerminalHeightAtomFamily(chatId)
  const [messages, setMessages] = useState<ConsoleMessage[]>([])
  const messageIdRef = useRef(0)

  // Theme for background color
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const fullThemeData = useAtomValue(fullThemeDataAtom)

  const terminalBg = useMemo(() => {
    if (fullThemeData?.colors?.["terminal.background"]) {
      return fullThemeData.colors["terminal.background"]
    }
    if (fullThemeData?.colors?.["editor.background"]) {
      return fullThemeData.colors["editor.background"]
    }
    return getDefaultTerminalBg(isDark)
  }, [isDark, fullThemeData])

  // Listen for console messages from webview
  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const handleConsoleMessage = (event: Electron.ConsoleMessageEvent) => {
      const typeMap: Record<number, ConsoleMessage["type"]> = {
        0: "debug",
        1: "log",
        2: "warn",
        3: "error",
      }

      const newMessage: ConsoleMessage = {
        id: messageIdRef.current++,
        type: typeMap[event.level] || "log",
        args: [event.message],
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev.slice(-499), newMessage]) // Keep last 500 messages
    }

    webview.addEventListener("console-message", handleConsoleMessage)
    return () => {
      webview.removeEventListener("console-message", handleConsoleMessage)
    }
  }, [webviewRef])

  // Clear console messages
  const handleClear = useCallback(() => {
    setMessages([])
  }, [])

  // Copy all logs to clipboard
  const handleCopyLogs = useCallback(() => {
    const logs = messages
      .map((msg) => {
        const timestamp = new Date(msg.timestamp).toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          fractionalSecondDigits: 3,
        })
        return `[${timestamp}] [${msg.type.toUpperCase()}] ${msg.args.join(" ")}`
      })
      .join("\n")
    window.desktopApi?.clipboardWrite(logs)
  }, [messages])

  // Close panel
  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [setIsOpen])

  // Handle URL clicks in console output
  const handleUrlClick = useCallback((url: string) => {
    window.desktopApi?.openExternal(url)
  }, [])

  return (
    <ResizableBottomPanel
      isOpen={isOpen}
      onClose={handleClose}
      heightAtom={heightAtom}
      minHeight={100}
      maxHeight={400}
      className="border-t border-border"
      style={{ backgroundColor: terminalBg }}
    >
      <div className="flex flex-col h-full">
        {/* Header */}
        <div
          className="flex items-center justify-between px-2 py-1 border-b border-border/50 shrink-0"
          style={{ backgroundColor: terminalBg }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClose}
                  className="h-5 w-5 p-0 hover:bg-foreground/10"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t("browser.console.close")}</TooltipContent>
            </Tooltip>
            <span className="text-xs text-muted-foreground font-medium">
              {t("browser.console.title")}
            </span>
            <span className="text-xs text-muted-foreground/50">
              ({messages.length})
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopyLogs}
                  disabled={messages.length === 0}
                  className="h-5 w-5 p-0 hover:bg-foreground/10"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t("browser.console.copy")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleClear}
                  className="h-5 w-5 p-0 hover:bg-foreground/10"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{t("browser.console.clear")}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Console Output using xterm.js */}
        <div className="flex-1 overflow-hidden">
          {messages.length === 0 ? (
            <div
              className="flex items-center justify-center h-full text-muted-foreground text-sm"
              style={{ backgroundColor: terminalBg }}
            >
              {t("browser.console.empty")}
            </div>
          ) : (
            <BrowserConsoleOutput
              messages={messages}
              onUrlClick={handleUrlClick}
            />
          )}
        </div>
      </div>
    </ResizableBottomPanel>
  )
}
