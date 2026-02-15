/**
 * Memory Summarizer
 * Uses the configured summary model (LLM) to enhance observations
 * and generate session summaries. Falls back to rule-based parsing
 * when no summary model is configured.
 *
 * Strategy:
 * - Rule engine classifies with confidence score (0-1)
 * - High confidence (>= 0.7): use rule result directly, skip LLM
 * - Low confidence (< 0.7): call LLM to refine classification
 * - No rate limiting — if LLM is needed, it runs
 */

import type { ParsedObservation, ObservationType } from "./types"
import { OBSERVATION_TYPES, OBSERVATION_CONCEPTS } from "./types"
import { createLogger } from "../../../lib/logger"

const summarizerLog = createLogger("Summarizer")


/** Usage data from memory LLM calls, to be recorded in model_usage */
export interface MemoryLLMUsage {
  inputTokens: number
  outputTokens: number
  model: string
  purpose: "observation_enhance" | "session_summary"
}

// ============ Configuration ============

interface SummaryModelConfig {
  providerId: string
  modelId: string
}

let summaryConfig: SummaryModelConfig | null = null

/**
 * Set the summary model configuration.
 * Called from the renderer via IPC when settings change.
 */
export function setSummaryModelConfig(config: SummaryModelConfig | null): void {
  summaryConfig = config
  if (config) {
    summarizerLog.info(`Summary model configured: ${config.providerId}/${config.modelId}`)
  } else {
    summarizerLog.info("Summary model cleared, using rule-based parsing")
  }
}

/**
 * Check if LLM-based summarization is available
 */
export function isSummaryModelConfigured(): boolean {
  return summaryConfig !== null
}

// ============ Observation Enhancement ============

const VALID_TYPES = new Set(OBSERVATION_TYPES.map((t) => t.id))
const VALID_CONCEPTS = OBSERVATION_CONCEPTS as readonly string[]

/** Confidence threshold: below this, call LLM for refinement */
const CONFIDENCE_THRESHOLD = 0.7

/**
 * Minimum output size to justify LLM enhancement.
 * Very short outputs (e.g., file not found, empty search) aren't worth analyzing.
 */
const MIN_OUTPUT_LENGTH = 50

/**
 * Determine if a tool call should be enhanced with LLM.
 * Based on confidence score from rule engine + output size.
 */
function shouldEnhanceWithLLM(
  parsed: ParsedObservation,
  toolOutput: unknown,
): boolean {
  // High confidence — rule engine is sure enough, skip LLM
  if (parsed.confidence !== undefined && parsed.confidence >= CONFIDENCE_THRESHOLD) {
    return false
  }

  // Skip if output is too small to be interesting
  const outputStr = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput)
  if (outputStr.length < MIN_OUTPUT_LENGTH) return false

  return true
}

const OBSERVATION_SYSTEM_PROMPT = `You are a project activity observer. Analyze tool executions and classify them accurately.

Given a tool call (name, input, output), produce a single observation in XML format:

<observation>
  <type>one of: explore, research, implement, fix, refactor, edit, compose, analyze, decision, conversation</type>
  <title>Short, descriptive title (max 80 chars)</title>
  <narrative>1-2 sentence explanation of what was learned or changed and WHY it matters</narrative>
  <concepts>comma-separated from: how-it-works, why-it-exists, what-changed, problem-solution, gotcha, pattern, trade-off, api, testing, performance, security, user-requirement, project-context, design-rationale, data-insight, workflow, documentation</concepts>
</observation>

Type definitions:
- "explore": browsing/reading code to understand structure
- "research": deep investigation — reading docs, fetching URLs, studying references
- "implement": creating new functionality, writing new code/files
- "fix": fixing a bug, error, or broken behavior
- "refactor": restructuring code without changing behavior
- "edit": minor/generic code modifications, config tweaks
- "compose": writing documentation, text, translations, non-code content
- "analyze": running tests, profiling, benchmarking, reviewing, data analysis
- "decision": choosing between approaches, architecture decisions
- "conversation": substantive AI explanation or discussion

Rules:
- The narrative should capture INSIGHT, not just repeat the tool action
- Bad: "Read file X". Good: "Explored the auth module — uses OAuth PKCE flow with encrypted token storage"
- Pick 1-3 most relevant concepts
- Respond ONLY with the XML block, nothing else`

/** Result of enhanceObservation — includes usage for tracking */
export interface EnhanceResult {
  observation: ParsedObservation
  usage: MemoryLLMUsage | null
}

/**
 * Enhance a rule-based observation using LLM.
 * Only called when confidence is below threshold.
 * Returns enhanced observation + usage data for tracking.
 */
export async function enhanceObservation(
  ruleBased: ParsedObservation,
  toolInput: unknown,
  toolOutput: unknown,
): Promise<EnhanceResult> {
  if (!summaryConfig) return { observation: ruleBased, usage: null }

  // Check confidence + output size
  if (!shouldEnhanceWithLLM(ruleBased, toolOutput)) {
    return { observation: ruleBased, usage: null }
  }

  try {
    const { callSummaryAIWithUsage } = await import("../../../lib/trpc/routers/summary-ai")

    // Build context for LLM
    const inputStr = truncate(JSON.stringify(toolInput), 1500)
    const outputStr = truncate(
      typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput),
      2000,
    )

    const userMessage = `Tool: ${ruleBased.toolName}
Input: ${inputStr}
Output: ${outputStr}`

    const result = await callSummaryAIWithUsage(
      summaryConfig.providerId,
      summaryConfig.modelId,
      OBSERVATION_SYSTEM_PROMPT,
      userMessage,
      300,
    )

    if (!result) return { observation: ruleBased, usage: null }

    // Build usage data for tracking
    const usage: MemoryLLMUsage | null = result.usage
      ? { ...result.usage, purpose: "observation_enhance" }
      : null

    // Parse XML response
    const enhanced = parseObservationXml(result.text)
    if (!enhanced) return { observation: ruleBased, usage }

    // Merge: keep file info from rule-based, use LLM for semantics
    return {
      observation: {
        ...ruleBased,
        type: enhanced.type,
        title: enhanced.title || ruleBased.title,
        narrative: enhanced.narrative || ruleBased.narrative,
        concepts: enhanced.concepts.length > 0 ? enhanced.concepts : ruleBased.concepts,
        confidence: 0.95, // LLM-enhanced — high confidence
      },
      usage,
    }
  } catch (error) {
    summarizerLog.warn("Enhancement failed, using rule-based:", (error as Error).message)
    return { observation: ruleBased, usage: null }
  }
}

// ============ Session Summary ============

const SESSION_SUMMARY_SYSTEM_PROMPT = `You are a project session analyst. Given a list of observations from a work session, generate a structured summary.

Respond with XML:

<summary>
  <request>What the user was trying to accomplish (1 sentence)</request>
  <investigated>What was explored/read to understand the problem (1-2 sentences)</investigated>
  <learned>Key insights or discoveries (1-2 sentences)</learned>
  <completed>What was actually done/changed (1-2 sentences)</completed>
  <next_steps>What could be done next, if anything (1 sentence, or "none")</next_steps>
</summary>

Rules:
- Be concise and specific
- Focus on WHAT and WHY, not HOW
- If the session was just exploration with no changes, say so
- Respond ONLY with the XML block`

export interface SessionSummary {
  request: string
  investigated: string
  learned: string
  completed: string
  nextSteps: string
}

/** Result of generateSessionSummary — includes usage for tracking */
export interface SessionSummaryResult {
  summary: SessionSummary
  usage: MemoryLLMUsage | null
}

/**
 * Generate a session summary from its observations.
 * Returns null if LLM is not configured or call fails.
 */
export async function generateSessionSummary(
  userPrompts: string[],
  observationTitles: string[],
  observationNarratives: string[],
): Promise<SessionSummaryResult | null> {
  if (!summaryConfig) return null

  try {
    const { callSummaryAIWithUsage } = await import("../../../lib/trpc/routers/summary-ai")

    const promptsSummary = userPrompts.length > 0
      ? `User prompts:\n${userPrompts.map((p, i) => `${i + 1}. ${truncate(p, 200)}`).join("\n")}`
      : "No user prompts recorded."

    const obsSummary = observationTitles.length > 0
      ? `Observations:\n${observationTitles.map((t, i) => {
          const narrative = observationNarratives[i]
          return narrative ? `- ${t}: ${truncate(narrative, 150)}` : `- ${t}`
        }).join("\n")}`
      : "No observations recorded."

    const userMessage = `${promptsSummary}\n\n${obsSummary}`

    const result = await callSummaryAIWithUsage(
      summaryConfig.providerId,
      summaryConfig.modelId,
      SESSION_SUMMARY_SYSTEM_PROMPT,
      userMessage,
      500,
    )

    if (!result) return null

    const summary = parseSummaryXml(result.text)
    if (!summary) return null

    const usage: MemoryLLMUsage | null = result.usage
      ? { ...result.usage, purpose: "session_summary" }
      : null

    return { summary, usage }
  } catch (error) {
    summarizerLog.warn("Session summary failed:", (error as Error).message)
    return null
  }
}

// ============ XML Parsers ============

function parseObservationXml(xml: string): {
  type: ObservationType
  title: string | null
  narrative: string | null
  concepts: string[]
} | null {
  try {
    const type = extractTag(xml, "type")
    const title = extractTag(xml, "title")
    const narrative = extractTag(xml, "narrative")
    const conceptsRaw = extractTag(xml, "concepts")

    if (!type && !title && !narrative) return null

    // Validate and normalize type
    const normalizedType = normalizeType(type)

    // Parse concepts
    const concepts = conceptsRaw
      ? conceptsRaw
          .split(",")
          .map((c) => c.trim())
          .filter((c) => VALID_CONCEPTS.includes(c))
      : []

    return {
      type: normalizedType,
      title,
      narrative,
      concepts,
    }
  } catch {
    return null
  }
}

function parseSummaryXml(xml: string): SessionSummary | null {
  try {
    const request = extractTag(xml, "request")
    const investigated = extractTag(xml, "investigated")
    const learned = extractTag(xml, "learned")
    const completed = extractTag(xml, "completed")
    const nextSteps = extractTag(xml, "next_steps")

    if (!request && !learned && !completed) return null

    return {
      request: request || "",
      investigated: investigated || "",
      learned: learned || "",
      completed: completed || "",
      nextSteps: nextSteps || "",
    }
  } catch {
    return null
  }
}

/**
 * Extract content between XML tags (non-greedy)
 */
function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i")
  const match = xml.match(regex)
  return match?.[1]?.trim() || null
}

/**
 * Normalize observation type string to valid ObservationType
 */
function normalizeType(raw: string | null): ObservationType {
  if (!raw) return "explore"

  const cleaned = raw.trim().toLowerCase().replace(/[_\s-]/g, "")

  // Map common variations and legacy types
  const typeMap: Record<string, ObservationType> = {
    // New types (direct match)
    explore: "explore",
    research: "research",
    implement: "implement",
    fix: "fix",
    refactor: "refactor",
    edit: "edit",
    compose: "compose",
    analyze: "analyze",
    decision: "decision",
    conversation: "conversation",
    // Legacy types
    discovery: "explore",
    change: "edit",
    feature: "implement",
    bugfix: "fix",
    bugfixed: "fix",
    response: "conversation",
    // Common LLM variations
    implementation: "implement",
    analysis: "analyze",
    writing: "compose",
    documentation: "compose",
    investigation: "research",
    exploration: "explore",
    fixing: "fix",
    refactoring: "refactor",
    editing: "edit",
  }

  return typeMap[cleaned] || (VALID_TYPES.has(cleaned as ObservationType) ? cleaned as ObservationType : "explore")
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + "..."
}
