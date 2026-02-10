/**
 * Memory Types
 * Observation type system for coding + cowork scenarios
 */

// ============ OBSERVATION TYPES ============
// 10 types covering both coding and cowork activities
export const OBSERVATION_TYPES = [
  { id: "explore", name: "Explore", icon: "Search" },
  { id: "research", name: "Research", icon: "BookOpen" },
  { id: "implement", name: "Implement", icon: "Sparkles" },
  { id: "fix", name: "Fix", icon: "Bug" },
  { id: "refactor", name: "Refactor", icon: "RefreshCw" },
  { id: "edit", name: "Edit", icon: "FileEdit" },
  { id: "compose", name: "Compose", icon: "PenLine" },
  { id: "analyze", name: "Analyze", icon: "BarChart3" },
  { id: "decision", name: "Decision", icon: "Target" },
  { id: "conversation", name: "Conversation", icon: "MessageCircle" },
] as const

export type ObservationType = (typeof OBSERVATION_TYPES)[number]["id"]

// Legacy type mapping for backward compatibility with existing DB data
export const LEGACY_TYPE_MAP: Record<string, ObservationType> = {
  discovery: "explore",
  change: "edit",
  feature: "implement",
  bugfix: "fix",
  response: "conversation",
}

// Concept tags system
export const OBSERVATION_CONCEPTS = [
  // Technical
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
  // Collaboration
  "user-requirement",
  "project-context",
  "design-rationale",
  "data-insight",
  "workflow",
  "documentation",
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
  /** Confidence of rule-based classification (0-1). Low confidence triggers LLM enhancement. */
  confidence?: number
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
