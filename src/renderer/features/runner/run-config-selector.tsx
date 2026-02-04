import { useAtom, useAtomValue } from "jotai"
import { ChevronDown, Play, Bug, Square, Loader2, Hexagon } from "lucide-react"
import {
  useState,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react"

// ============================================================================
// Package Manager Icons
// ============================================================================

function NpmIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331z" />
    </svg>
  )
}

function BunIcon({ className }: { className?: string }) {
  return (
    <Hexagon className={className} />
  )
}

function YarnIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 0C5.375 0 0 5.375 0 12s5.375 12 12 12 12-5.375 12-12S18.625 0 12 0zm.768 4.105c.183 0 .363.053.525.157.125.083.287.185.755 1.154.31-.088.468-.042.551-.019.204.056.366.19.463.375.477.917.542 2.553.334 3.605-.241 1.232-.755 2.029-1.131 2.576.324.329.778.899 1.117 1.825.278.774.31 1.478.273 2.015a5.51 5.51 0 0 0 .602-.329c.593-.366 1.487-.917 2.553-.931.714-.009 1.269.445 1.353 1.103a1.23 1.23 0 0 1-.945 1.362c-.649.158-.95.278-1.821.843-1.232.799-2.539 1.242-3.012 1.39a1.686 1.686 0 0 1-.704.343c-.737.181-3.266.315-3.466.315h-.046c-.783 0-1.214-.241-1.45-.491-.658.329-1.51.19-2.122-.134a1.078 1.078 0 0 1-.58-1.153 1.243 1.243 0 0 1-.153-.195c-.162-.25-.528-.936-.454-1.946.056-.723.556-1.367.88-1.71a5.522 5.522 0 0 1 .408-2.256c.306-.727.885-1.348 1.32-1.737-.32-.537-.644-1.367-.329-2.21.227-.602.412-.936.82-1.08h-.005c.199-.074.389-.153.486-.259a3.418 3.418 0 0 1 2.298-1.103c.037-.093.079-.185.125-.283.31-.658.639-1.029 1.024-1.168a.94.94 0 0 1 .328-.06z" />
    </svg>
  )
}

function PnpmIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M0 0v7.5h7.5V0zm8.25 0v7.5h7.498V0zm8.25 0v7.5H24V0zM8.25 8.25v7.5h7.498v-7.5zm8.25 0v7.5H24v-7.5zM0 16.5V24h7.5v-7.5zm8.25 0V24h7.498v-7.5zm8.25 0V24H24v-7.5z" />
    </svg>
  )
}

function getPackageManagerIcon(pm: string, className?: string) {
  switch (pm) {
    case "bun":
      return <BunIcon className={className} />
    case "yarn":
      return <YarnIcon className={className} />
    case "pnpm":
      return <PnpmIcon className={className} />
    case "npm":
    default:
      return <NpmIcon className={className} />
  }
}
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"
import { Button } from "../../components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip"
import { Kbd } from "../../components/ui/kbd"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import {
  selectedScriptAtom,
  runSessionsAtom,
  packageManagerAtom,
  defaultDebugPortAtom,
  type RunSession,
} from "../../lib/atoms/runner"
import { useRunSessionListener } from "./use-run-session-listener"

// ============================================================================
// Ref Interface for external control (shortcuts)
// ============================================================================

export interface RunConfigSelectorRef {
  triggerRun: (isDebugMode: boolean) => void
  triggerStop: () => void
}

// ============================================================================
// Types
// ============================================================================

interface RunConfigSelectorProps {
  projectPath: string
  chatId: string
  onTerminalOpen?: (paneId: string, command: string) => void
}

// ============================================================================
// Component
// ============================================================================

export const RunConfigSelector = forwardRef<
  RunConfigSelectorRef,
  RunConfigSelectorProps
>(function RunConfigSelector({ projectPath, chatId, onTerminalOpen }, ref) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedScripts, setSelectedScripts] = useAtom(selectedScriptAtom)
  const [runSessions, setRunSessions] = useAtom(runSessionsAtom)
  const packageManager = useAtomValue(packageManagerAtom)
  const debugPort = useAtomValue(defaultDebugPortAtom)

  // Get package.json scripts - refetch when projectPath changes
  const { data: packageData, isLoading: _isLoadingScripts } =
    trpc.runner.getPackageScripts.useQuery(
      { projectPath },
      {
        enabled: !!projectPath,
        staleTime: 0, // Always refetch on mount
      }
    )

  // Detect package manager for this project
  const { data: pmData } = trpc.runner.detectPackageManager.useQuery(
    { projectPath },
    { enabled: !!projectPath }
  )

  // Determine which package manager to show
  const detectedPm = pmData?.detected || "npm"
  const effectivePm = packageManager === "auto" ? detectedPm : packageManager

  // Build command query
  const buildCommandMutation = trpc.runner.buildRunCommand.useMutation()

  // Current selected script for this project
  const selectedScript = selectedScripts[projectPath] || null

  // Current run session
  const currentSession = runSessions[projectPath]
  const isRunning =
    currentSession?.status === "running" ||
    currentSession?.status === "starting"
  const isStopping = currentSession?.status === "stopping"

  // Listen for process exit events and auto-clear session
  useRunSessionListener(projectPath)

  // Script list
  const scripts = useMemo(() => {
    if (!packageData?.scripts) return []
    return Object.entries(packageData.scripts).map(([name, command]) => ({
      name,
      command: command as string,
    }))
  }, [packageData])

  // Select script
  const handleSelectScript = useCallback(
    (scriptName: string) => {
      setSelectedScripts((prev) => ({
        ...prev,
        [projectPath]: scriptName,
      }))
      setIsOpen(false)
    },
    [projectPath, setSelectedScripts]
  )

  // Start run
  const handleRun = useCallback(
    async (isDebugMode: boolean) => {
      if (!selectedScript || isRunning) return

      // Build the command
      const commandData = await buildCommandMutation.mutateAsync({
        projectPath,
        scriptName: selectedScript,
        packageManager,
        isDebugMode,
        debugPort,
      })

      // Generate terminal ID
      const terminalId = crypto.randomUUID().slice(0, 8)
      const paneId = `${chatId}:run:${terminalId}`

      // Create run session
      const session: RunSession = {
        id: terminalId,
        scriptName: selectedScript,
        command: commandData.command,
        status: "starting",
        paneId,
        startedAt: Date.now(),
        isDebugMode,
        debugPort: isDebugMode ? debugPort : undefined,
      }

      setRunSessions((prev) => ({
        ...prev,
        [projectPath]: session,
      }))

      // Notify parent to open terminal
      onTerminalOpen?.(paneId, commandData.command)

      // Mark as running after a short delay (terminal will confirm via stream)
      setTimeout(() => {
        setRunSessions((prev) => {
          const current = prev[projectPath]
          if (current?.id === terminalId && current.status === "starting") {
            return {
              ...prev,
              [projectPath]: { ...current, status: "running" },
            }
          }
          return prev
        })
      }, 300)
    },
    [
      selectedScript,
      isRunning,
      projectPath,
      chatId,
      packageManager,
      debugPort,
      buildCommandMutation,
      setRunSessions,
      onTerminalOpen,
    ]
  )

  // tRPC mutations for terminal control
  const signalMutation = trpc.terminal.signal.useMutation()
  const killMutation = trpc.terminal.kill.useMutation()

  // Stop run - send SIGTERM signal to terminal
  const handleStop = useCallback(async () => {
    const session = runSessions[projectPath]
    if (!session) return

    setRunSessions((prev) => ({
      ...prev,
      [projectPath]: { ...session, status: "stopping" },
    }))

    try {
      // Send SIGTERM signal
      await signalMutation.mutateAsync({
        paneId: session.paneId,
        signal: "SIGTERM",
      })

      // Give process 2 seconds to exit gracefully, then force kill
      setTimeout(async () => {
        const current = runSessions[projectPath]
        if (current?.status === "stopping" && current.id === session.id) {
          try {
            await killMutation.mutateAsync({ paneId: session.paneId })
          } catch {
            // Ignore errors if process already exited
          }
          // Clear session
          setRunSessions((prev) => ({
            ...prev,
            [projectPath]: null,
          }))
        }
      }, 2000)
    } catch (error) {
      console.error("[Runner] Failed to stop:", error)
      // Clear session anyway on error
      setRunSessions((prev) => ({
        ...prev,
        [projectPath]: null,
      }))
    }
  }, [runSessions, projectPath, setRunSessions, signalMutation, killMutation])

  // Expose methods via ref for keyboard shortcuts
  useImperativeHandle(
    ref,
    () => ({
      triggerRun: handleRun,
      triggerStop: handleStop,
    }),
    [handleRun, handleStop]
  )

  // Don't render if no package.json or no scripts
  if (!packageData?.hasPackageJson || scripts.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-0.5">
      {/* Script selector dropdown */}
      <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-sm rounded-md transition-colors",
              "hover:bg-muted/50 outline-offset-2",
              "min-w-[100px] max-w-[180px]",
              isRunning
                ? "text-muted-foreground cursor-not-allowed"
                : "text-foreground"
            )}
            disabled={isRunning}
          >
            {/* Package manager icon */}
            <span className="shrink-0 opacity-70">
              {getPackageManagerIcon(effectivePm, "h-3.5 w-3.5")}
            </span>
            {/* Script name - fills available space */}
            <span className="flex-1 text-left truncate text-xs">
              {selectedScript || "Select script"}
            </span>
            {/* Dropdown arrow - always right aligned */}
            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[280px] max-h-[300px] overflow-y-auto"
        >
          {scripts.map(({ name, command }) => (
            <DropdownMenuItem
              key={name}
              onClick={() => handleSelectScript(name)}
              className="flex flex-col items-start gap-0.5 py-2"
            >
              <span className="font-medium text-sm">{name}</span>
              <span className="text-xs text-muted-foreground truncate w-full">
                {command}
              </span>
            </DropdownMenuItem>
          ))}
          {packageData.name && (
            <>
              <DropdownMenuSeparator />
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {packageData.name}
                {packageData.version && ` v${packageData.version}`}
              </div>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Run button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => handleRun(false)}
            disabled={!selectedScript || isRunning || isStopping}
          >
            {buildCommandMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5 text-green-500" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          Run
          <Kbd className="ml-1">⌘R</Kbd>
        </TooltipContent>
      </Tooltip>

      {/* Debug button */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => handleRun(true)}
            disabled={!selectedScript || isRunning || isStopping}
          >
            <Bug className="h-3.5 w-3.5 text-orange-500" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-2">
          Debug
          <Kbd className="ml-1">⌘⇧R</Kbd>
        </TooltipContent>
      </Tooltip>

      {/* Stop button - only shown when running */}
      {(isRunning || isStopping) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleStop}
              disabled={isStopping}
            >
              {isStopping ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-red-500" />
              ) : (
                <Square className="h-3.5 w-3.5 text-red-500" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-2">
            Stop
            <Kbd className="ml-1">⌘.</Kbd>
          </TooltipContent>
        </Tooltip>
      )}

      {/* Running indicator */}
      {isRunning && currentSession && (
        <span className="text-xs text-muted-foreground ml-1">
          {currentSession.isDebugMode ? "Debugging" : "Running"}:{" "}
          {currentSession.scriptName}
        </span>
      )}
    </div>
  )
})
