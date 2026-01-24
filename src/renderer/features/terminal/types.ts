export interface TerminalDataEvent {
  type: "data"
  data: string
}

export interface TerminalExitEvent {
  type: "exit"
  exitCode: number
  signal?: number
}

export type TerminalEvent = TerminalDataEvent | TerminalExitEvent

export interface TerminalProps {
  paneId: string
  cwd: string
  workspaceId?: string
  tabId?: string
  initialCommands?: string[]
  initialCwd?: string
}

export interface TerminalStreamEvent {
  type: "data" | "exit"
  data?: string
  exitCode?: number
  signal?: number
}

/**
 * Terminal type: shell for regular terminal, run for script execution
 */
export type TerminalType = "shell" | "run"

/**
 * Run configuration for "run" type terminals
 */
export interface RunConfig {
  /** Script name from package.json (e.g., "dev", "build") */
  scriptName: string
  /** Full command to execute (e.g., "npm run dev") */
  command: string
  /** Project path where package.json is located */
  projectPath: string
  /** Package manager used (npm, yarn, pnpm, bun) */
  packageManager: string
  /** Whether running in debug mode */
  isDebugMode: boolean
  /** Debug port if in debug mode */
  debugPort?: number
}

/**
 * Run status for "run" type terminals
 */
export type RunStatus = "idle" | "running" | "stopped"

/**
 * Represents a terminal instance in the multi-terminal system.
 * Each chat can have multiple terminal instances.
 */
export interface TerminalInstance {
  /** Unique terminal id (nanoid) */
  id: string
  /** Full paneId for TerminalManager: `${chatId}:term:${id}` or `${chatId}:run:${id}` */
  paneId: string
  /** Display name: "Terminal 1", "dev", etc. */
  name: string
  /** Creation timestamp */
  createdAt: number
  /** Terminal type: shell or run */
  type: TerminalType
  /** Run configuration (only for type: "run") */
  runConfig?: RunConfig
  /** Run status (only for type: "run") */
  status?: RunStatus
}
