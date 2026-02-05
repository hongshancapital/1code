/**
 * Memory Types
 * Borrowed from claude-mem architecture
 */

// ============ OBSERVATION TYPES ============
// Observation type system (borrowed from claude-mem ModeManager)
export const OBSERVATION_TYPES = [
  { id: "discovery", name: "Discovery", icon: "Search" },
  { id: "decision", name: "Decision", icon: "Target" },
  { id: "bugfix", name: "Bug Fix", icon: "Bug" },
  { id: "feature", name: "Feature", icon: "Sparkles" },
  { id: "refactor", name: "Refactor", icon: "RefreshCw" },
  { id: "change", name: "Change", icon: "FileEdit" },
  { id: "response", name: "AI Response", icon: "MessageCircle" },
] as const

export type ObservationType = (typeof OBSERVATION_TYPES)[number]["id"]

// Concept tags system
export const OBSERVATION_CONCEPTS = [
  "how-it-works",
  "why-it-exists",
  "what-changed",
  "problem-solution",
  "gotcha",
  "pattern",
  "trade-off",
  "api",
  "testing",
  "performance",
  "security",
] as const

export type ObservationConcept = (typeof OBSERVATION_CONCEPTS)[number]

// ============ PARSED OBSERVATION ============
export interface ParsedObservation {
  type: ObservationType
  title: string | null
  subtitle: string | null
  narrative: string | null
  facts: string[]
  concepts: string[]
  filesRead: string[]
  filesModified: string[]
  toolName: string
  toolCallId?: string
}

// ============ HOOK DATA TYPES ============
export interface SessionStartData {
  subChatId: string
  projectId: string
  chatId: string
}

export interface UserPromptData {
  sessionId: string
  prompt: string
  promptNumber: number
}

export interface ToolOutputData {
  sessionId: string
  projectId: string
  toolName: string
  toolInput: unknown
  toolOutput: unknown
  toolCallId?: string
  promptNumber?: number
}

export interface SessionEndData {
  sessionId: string
  subChatId: string
}

// ============ SEARCH TYPES ============
export interface SearchOptions {
  query: string
  projectId?: string
  type?: "all" | "observations" | "prompts" | "sessions"
  limit?: number
  dateRange?: {
    start?: number
    end?: number
  }
}

export interface ObservationSearchResult {
  id: string
  sessionId: string
  projectId: string | null
  type: string
  title: string | null
  subtitle: string | null
  narrative: string | null
  facts: string | null
  concepts: string | null
  filesRead: string | null
  filesModified: string | null
  toolName: string | null
  createdAt: Date | null
  createdAtEpoch: number | null
  rank?: number
  score?: number
}

export interface UserPromptSearchResult {
  id: string
  sessionId: string
  promptNumber: number
  promptText: string
  createdAt: Date | null
  createdAtEpoch: number | null
  rank?: number
  score?: number
}

export interface SessionSearchResult {
  id: string
  projectId: string | null
  chatId: string | null
  subChatId: string | null
  status: string
  summaryRequest: string | null
  summaryLearned: string | null
  summaryCompleted: string | null
  summaryNextSteps: string | null
  startedAt: Date | null
  startedAtEpoch: number | null
  rank?: number
  score?: number
}

export interface SearchResult {
  observations: ObservationSearchResult[]
  prompts: UserPromptSearchResult[]
  sessions: SessionSearchResult[]
}

// ============ STATS TYPES ============
export interface MemoryStats {
  observations: number
  sessions: number
  prompts: number
}
