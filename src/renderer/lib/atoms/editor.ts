import { atomWithStorage } from "jotai/utils"

// ============================================================================
// Types
// ============================================================================

/**
 * Supported editor IDs
 */
export type EditorId =
  | "code" // VS Code
  | "cursor" // Cursor
  | "windsurf" // Windsurf
  | "agy" // Antigravity
  | "zed" // Zed
  | "subl" // Sublime Text
  | "idea" // IntelliJ IDEA
  | "webstorm" // WebStorm

/**
 * Editor configuration stored in localStorage
 */
export interface EditorConfig {
  /** User-selected default editor (null = auto-detect first available) */
  defaultEditor: EditorId | null
  /** Custom command-line arguments */
  customArgs: string
}

/**
 * Editor info returned from detection API
 */
export interface EditorInfo {
  id: string
  name: string
  command: string
  installed: boolean
  path: string | null
  version: string | null
}

// ============================================================================
// Atoms
// ============================================================================

/**
 * Editor configuration (persisted to localStorage)
 */
export const editorConfigAtom = atomWithStorage<EditorConfig>(
  "preferences:editor-config",
  {
    defaultEditor: null, // null = auto-select first available editor
    customArgs: "",
  },
  undefined,
  { getOnInit: true }
)
