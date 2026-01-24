import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// ============================================================================
// Types
// ============================================================================

export type PackageManager = "auto" | "bun" | "npm" | "yarn" | "pnpm"

export type PreferredRuntime = "auto" | "node" | "bun"

export type RuntimePaths = {
  node: string | null
  bun: string | null
  npm: string | null
  yarn: string | null
  pnpm: string | null
}

export type RunSessionStatus = "idle" | "starting" | "running" | "stopping"

export type RunSession = {
  id: string
  scriptName: string
  command: string
  status: RunSessionStatus
  paneId: string
  startedAt: number
  isDebugMode: boolean
  debugPort?: number
}

// ============================================================================
// Persistent Settings Atoms (localStorage)
// ============================================================================

/**
 * Default package manager preference
 * "auto" will detect from lock file
 */
export const packageManagerAtom = atomWithStorage<PackageManager>(
  "runner:package-manager",
  "auto",
  undefined,
  { getOnInit: true }
)

/**
 * Custom runtime paths (override auto-detected paths)
 */
export const runtimePathsAtom = atomWithStorage<RuntimePaths>(
  "runner:runtime-paths",
  {
    node: null,
    bun: null,
    npm: null,
    yarn: null,
    pnpm: null,
  },
  undefined,
  { getOnInit: true }
)

/**
 * Default debug port for Node.js inspector
 */
export const defaultDebugPortAtom = atomWithStorage<number>(
  "runner:default-debug-port",
  9229,
  undefined,
  { getOnInit: true }
)

/**
 * Preferred runtime for JavaScript/TypeScript projects
 * "auto" will detect based on project configuration (bun.lockb, package-lock.json, etc.)
 */
export const preferredRuntimeAtom = atomWithStorage<PreferredRuntime>(
  "runner:preferred-runtime",
  "auto",
  undefined,
  { getOnInit: true }
)

/**
 * Selected script per project path
 */
export const selectedScriptAtom = atomWithStorage<Record<string, string | null>>(
  "runner:selected-script",
  {},
  undefined,
  { getOnInit: true }
)

// ============================================================================
// Runtime State Atoms (non-persistent)
// ============================================================================

/**
 * Active run sessions per project path
 */
export const runSessionsAtom = atom<Record<string, RunSession | null>>({})

/**
 * Helper to get run session for a specific project
 */
export const getRunSessionAtom = (projectPath: string) =>
  atom((get) => get(runSessionsAtom)[projectPath] || null)

/**
 * Helper to check if a project has a running session
 */
export const isRunningAtom = (projectPath: string) =>
  atom((get) => {
    const session = get(runSessionsAtom)[projectPath]
    return session?.status === "running" || session?.status === "starting"
  })
