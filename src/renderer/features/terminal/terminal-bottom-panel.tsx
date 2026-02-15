import { useEffect, useCallback, useMemo, useRef, useState } from "react"
import { useAtom, useAtomValue } from "jotai"
import { useTheme } from "next-themes"
import { fullThemeDataAtom } from "@/lib/atoms"
import { motion } from "motion/react"
import { ResizableBottomPanel } from "@/components/ui/resizable-bottom-panel"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { IconDoubleChevronDown } from "@/icons/icons"
import { Kbd } from "@/components/ui/kbd"
import { Terminal, type TerminalRef } from "./terminal"
import { TerminalTabs } from "./terminal-tabs"
import { RunTerminalHeader } from "./run-terminal-header"
import { getDefaultTerminalBg } from "./helpers"
import {
  terminalSidebarOpenAtom,
  terminalsAtom,
  activeTerminalIdAtom,
  terminalCwdAtom,
} from "./atoms"
import { codingTerminalPanelHeightAtom } from "@/lib/atoms"
import { trpc } from "@/lib/trpc"
import type { TerminalInstance } from "./types"

// Animation constants
const PANEL_ANIMATION_DURATION_MS = 0
const ANIMATION_BUFFER_MS = 50 // Small buffer to ensure DOM layout is complete before xterm init

interface TerminalBottomPanelProps {
  /** Chat ID - used to scope terminals to this chat */
  chatId: string
  cwd: string
  workspaceId: string
  tabId?: string
  initialCommands?: string[]
  /** Project path for Run functionality - enables script detection */
  projectPath?: string
}

/**
 * Generate a unique terminal ID
 */
function generateTerminalId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/**
 * Generate a paneId for TerminalManager
 */
function generatePaneId(chatId: string, terminalId: string, type: "shell" | "run" = "shell"): string {
  const prefix = type === "run" ? "run" : "term"
  return `${chatId}:${prefix}:${terminalId}`
}

/**
 * Get the next terminal name based on existing terminals
 */
function getNextTerminalName(terminals: TerminalInstance[]): string {
  const existingNumbers = terminals
    .map((t) => {
      const match = t.name.match(/^Terminal (\d+)$/)
      return match ? parseInt(match[1], 10) : 0
    })
    .filter((n) => n > 0)

  const maxNumber =
    existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0
  return `Terminal ${maxNumber + 1}`
}

export function TerminalBottomPanel({
  chatId,
  cwd,
  workspaceId,
  tabId,
  initialCommands,
  projectPath: _projectPath,
}: TerminalBottomPanelProps) {
  const [isOpen, setIsOpen] = useAtom(terminalSidebarOpenAtom)
  const [allTerminals, setAllTerminals] = useAtom(terminalsAtom)
  const [allActiveIds, setAllActiveIds] = useAtom(activeTerminalIdAtom)
  const terminalCwds = useAtomValue(terminalCwdAtom)

  // Theme detection for terminal background
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === "dark"
  const fullThemeData = useAtomValue(fullThemeDataAtom)

  const terminalBg = useMemo(() => {
    // Use VS Code theme terminal background if available
    if (fullThemeData?.colors?.["terminal.background"]) {
      return fullThemeData.colors["terminal.background"]
    }
    if (fullThemeData?.colors?.["editor.background"]) {
      return fullThemeData.colors["editor.background"]
    }
    return getDefaultTerminalBg(isDark)
  }, [isDark, fullThemeData])

  // Get terminals for this chat
  const terminals = useMemo(
    () => allTerminals[chatId] || [],
    [allTerminals, chatId],
  )

  // Get active terminal ID for this chat
  const activeTerminalId = useMemo(
    () => allActiveIds[chatId] || null,
    [allActiveIds, chatId],
  )

  // Get the active terminal instance
  const activeTerminal = useMemo(
    () => terminals.find((t) => t.id === activeTerminalId) || null,
    [terminals, activeTerminalId],
  )

  // tRPC mutations
  const killMutation = trpc.terminal.kill.useMutation()
  const signalMutation = trpc.terminal.signal.useMutation()
  const clearMutation = trpc.terminal.clearScrollback.useMutation()
  const writeMutation = trpc.terminal.write.useMutation()

  // Refs to avoid callback recreation
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId
  const terminalsRef = useRef(terminals)
  terminalsRef.current = terminals
  const activeTerminalIdRef = useRef(activeTerminalId)
  activeTerminalIdRef.current = activeTerminalId

  // Create a new shell terminal - stable callback
  const createTerminal = useCallback(() => {
    const currentChatId = chatIdRef.current
    const currentTerminals = terminalsRef.current

    const id = generateTerminalId()
    const paneId = generatePaneId(currentChatId, id, "shell")
    const name = getNextTerminalName(currentTerminals)

    const newTerminal: TerminalInstance = {
      id,
      paneId,
      name,
      createdAt: Date.now(),
      type: "shell",
    }

    setAllTerminals((prev) => ({
      ...prev,
      [currentChatId]: [...(prev[currentChatId] || []), newTerminal],
    }))

    // Set as active
    setAllActiveIds((prev) => ({
      ...prev,
      [currentChatId]: id,
    }))
  }, [setAllTerminals, setAllActiveIds])

  // Update run terminal status
  const updateRunStatus = useCallback((terminalId: string, status: "idle" | "running" | "stopped") => {
    const currentChatId = chatIdRef.current
    setAllTerminals((prev) => ({
      ...prev,
      [currentChatId]: (prev[currentChatId] || []).map((t) =>
        t.id === terminalId ? { ...t, status } : t
      ),
    }))
  }, [setAllTerminals])

  // Select a terminal - stable callback
  const selectTerminal = useCallback(
    (id: string) => {
      const currentChatId = chatIdRef.current
      setAllActiveIds((prev) => ({
        ...prev,
        [currentChatId]: id,
      }))
    },
    [setAllActiveIds],
  )

  // Close a terminal - stable callback
  const closeTerminal = useCallback(
    (id: string) => {
      const currentChatId = chatIdRef.current
      const currentTerminals = terminalsRef.current
      const currentActiveId = activeTerminalIdRef.current

      const terminal = currentTerminals.find((t) => t.id === id)
      if (!terminal) return

      // Kill the session on the backend
      killMutation.mutate({ paneId: terminal.paneId })

      // Remove from state
      const newTerminals = currentTerminals.filter((t) => t.id !== id)
      setAllTerminals((prev) => ({
        ...prev,
        [currentChatId]: newTerminals,
      }))

      // If we closed the active terminal, switch to another
      if (currentActiveId === id) {
        const newActive = newTerminals[newTerminals.length - 1]?.id || null
        setAllActiveIds((prev) => ({
          ...prev,
          [currentChatId]: newActive,
        }))
      }
    },
    [setAllTerminals, setAllActiveIds, killMutation],
  )

  // Rename a terminal - stable callback
  const renameTerminal = useCallback(
    (id: string, name: string) => {
      const currentChatId = chatIdRef.current
      setAllTerminals((prev) => ({
        ...prev,
        [currentChatId]: (prev[currentChatId] || []).map((t) =>
          t.id === id ? { ...t, name } : t,
        ),
      }))
    },
    [setAllTerminals],
  )

  // Close other terminals - stable callback
  const closeOtherTerminals = useCallback(
    (id: string) => {
      const currentChatId = chatIdRef.current
      const currentTerminals = terminalsRef.current

      // Kill all terminals except the one with the given id
      currentTerminals.forEach((terminal) => {
        if (terminal.id !== id) {
          killMutation.mutate({ paneId: terminal.paneId })
        }
      })

      // Keep only the terminal with the given id
      const remainingTerminal = currentTerminals.find((t) => t.id === id)
      setAllTerminals((prev) => ({
        ...prev,
        [currentChatId]: remainingTerminal ? [remainingTerminal] : [],
      }))

      // Set the remaining terminal as active
      setAllActiveIds((prev) => ({
        ...prev,
        [currentChatId]: id,
      }))
    },
    [setAllTerminals, setAllActiveIds, killMutation],
  )

  // Close terminals to the right - stable callback
  const closeTerminalsToRight = useCallback(
    (id: string) => {
      const currentChatId = chatIdRef.current
      const currentTerminals = terminalsRef.current

      const index = currentTerminals.findIndex((t) => t.id === id)
      if (index === -1) return

      // Kill terminals to the right
      const terminalsToClose = currentTerminals.slice(index + 1)
      terminalsToClose.forEach((terminal) => {
        killMutation.mutate({ paneId: terminal.paneId })
      })

      // Keep only terminals up to and including the one with the given id
      const remainingTerminals = currentTerminals.slice(0, index + 1)
      setAllTerminals((prev) => ({
        ...prev,
        [currentChatId]: remainingTerminals,
      }))

      // If active terminal was closed, switch to the last remaining one
      const currentActiveId = activeTerminalIdRef.current
      if (
        currentActiveId &&
        !remainingTerminals.find((t) => t.id === currentActiveId)
      ) {
        setAllActiveIds((prev) => ({
          ...prev,
          [currentChatId]:
            remainingTerminals[remainingTerminals.length - 1]?.id || null,
        }))
      }
    },
    [setAllTerminals, setAllActiveIds, killMutation],
  )

  // Close panel callback - stable
  const closePanel = useCallback(() => {
    setIsOpen(false)
  }, [setIsOpen])

  // Terminal ref for scroll control
  const terminalRef = useRef<TerminalRef | null>(null)

  // Run terminal control handlers
  const handleRunRestart = useCallback(async () => {
    if (!activeTerminal?.runConfig || activeTerminal.type !== "run") return

    // Update status to running
    updateRunStatus(activeTerminal.id, "running")

    // Send SIGTERM to stop current process
    try {
      await signalMutation.mutateAsync({ paneId: activeTerminal.paneId, signal: "SIGTERM" })
    } catch {
      // Ignore errors if process already exited
    }

    // Wait for process to exit
    await new Promise(resolve => setTimeout(resolve, 500))

    // Clear and re-execute command
    await clearMutation.mutateAsync({ paneId: activeTerminal.paneId })
    await writeMutation.mutateAsync({
      paneId: activeTerminal.paneId,
      data: activeTerminal.runConfig.command + "\n"
    })
  }, [activeTerminal, updateRunStatus, signalMutation, clearMutation, writeMutation])

  const handleRunStop = useCallback(async () => {
    if (!activeTerminal || activeTerminal.type !== "run") return

    // Update status to stopped
    updateRunStatus(activeTerminal.id, "stopped")

    try {
      await signalMutation.mutateAsync({ paneId: activeTerminal.paneId, signal: "SIGTERM" })
    } catch {
      // Ignore errors if process already exited
    }
  }, [activeTerminal, updateRunStatus, signalMutation])

  const handleRunClear = useCallback(async () => {
    if (!activeTerminal) return
    // Clear scrollback on the backend - this will clear the terminal output
    // Note: We don't call xterm.clear() directly due to potential crash with _renderService.dimensions
    await clearMutation.mutateAsync({ paneId: activeTerminal.paneId })
  }, [activeTerminal, clearMutation])

  const handleScrollToBottom = useCallback(() => {
    terminalRef.current?.scrollToBottom()
  }, [])

  // Delay terminal rendering until animation completes to avoid xterm.js sizing issues
  const [canRenderTerminal, setCanRenderTerminal] = useState(false)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // Panel just opened - delay terminal render until animation completes
      setCanRenderTerminal(false)
      const timer = setTimeout(() => {
        setCanRenderTerminal(true)
      }, PANEL_ANIMATION_DURATION_MS + ANIMATION_BUFFER_MS)
      wasOpenRef.current = true
      return () => clearTimeout(timer)
    } else if (!isOpen) {
      // Panel closed - reset state
      wasOpenRef.current = false
      setCanRenderTerminal(false)
    }
  }, [isOpen])

  // Auto-create first terminal when panel opens and no terminals exist
  useEffect(() => {
    if (isOpen && terminals.length === 0) {
      createTerminal()
    }
  }, [isOpen, terminals.length, createTerminal])

  // Keyboard shortcut: Cmd+J to toggle terminal panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.metaKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.ctrlKey &&
        e.code === "KeyJ"
      ) {
        e.preventDefault()
        e.stopPropagation()
        setIsOpen((prev) => !prev)
      }
    }

    window.addEventListener("keydown", handleKeyDown, true)
    return () => window.removeEventListener("keydown", handleKeyDown, true)
  }, [setIsOpen])

  return (
    <ResizableBottomPanel
      isOpen={isOpen}
      onClose={closePanel}
      heightAtom={codingTerminalPanelHeightAtom}
      minHeight={100}
      maxHeight={600}
      className="bg-background border-t"
      style={{ borderTopWidth: "0.5px", overflow: "hidden" }}
    >
      <div className="flex flex-col h-full min-w-0 overflow-hidden">
        {/* Header with tabs */}
        <div
          className="flex items-center gap-1 pl-1 pr-2 py-1.5 shrink-0"
          style={{ backgroundColor: terminalBg }}
        >
          {/* Close button - on the left */}
          <div className="flex items-center shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={closePanel}
                  className="h-6 w-6 p-0 hover:bg-foreground/10 transition-[background-color,transform] duration-150 ease-out active:scale-[0.97] text-foreground shrink-0 rounded-md"
                  aria-label="Close terminal"
                >
                  <IconDoubleChevronDown className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                Close terminal
                <Kbd>⌘J</Kbd>
              </TooltipContent>
            </Tooltip>
          </div>

          {/* Terminal Tabs */}
          {terminals.length > 0 && (
            <TerminalTabs
              terminals={terminals}
              activeTerminalId={activeTerminalId}
              cwds={terminalCwds}
              initialCwd={cwd}
              terminalBg={terminalBg}
              onSelectTerminal={selectTerminal}
              onCloseTerminal={closeTerminal}
              onCloseOtherTerminals={closeOtherTerminals}
              onCloseTerminalsToRight={closeTerminalsToRight}
              onCreateTerminal={createTerminal}
              onRenameTerminal={renameTerminal}
            />
          )}
        </div>

        {/* Run Terminal Header - only for run type terminals */}
        {activeTerminal?.type === "run" && (
          <RunTerminalHeader
            terminal={activeTerminal}
            isRunning={activeTerminal.status === "running"}
            terminalBg={terminalBg}
            onRestart={handleRunRestart}
            onStop={handleRunStop}
            onClear={handleRunClear}
            onScrollToBottom={handleScrollToBottom}
          />
        )}

        {/* Terminal Content */}
        <div
          className="flex-1 min-h-0 min-w-0 overflow-hidden"
          style={{ backgroundColor: terminalBg }}
        >
          {activeTerminal && canRenderTerminal ? (
            <motion.div
              key={activeTerminal.paneId}
              className="h-full flex flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0 }}
            >
              <Terminal
                ref={terminalRef}
                paneId={activeTerminal.paneId}
                cwd={activeTerminal.type === "run" && activeTerminal.runConfig?.projectPath
                  ? activeTerminal.runConfig.projectPath
                  : cwd}
                workspaceId={workspaceId}
                tabId={tabId}
                initialCommands={activeTerminal.type === "run" && activeTerminal.runConfig
                  ? [activeTerminal.runConfig.command]
                  : initialCommands}
                initialCwd={activeTerminal.type === "run" && activeTerminal.runConfig?.projectPath
                  ? activeTerminal.runConfig.projectPath
                  : cwd}
              />
            </motion.div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {!canRenderTerminal ? "" : "No terminal open"}
            </div>
          )}
        </div>
      </div>
    </ResizableBottomPanel>
  )
}
