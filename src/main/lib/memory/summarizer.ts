/**
 * Memory Summarizer
 * Uses the configured summary model (LLM) to enhance observations
 * and generate session summaries. Falls back to rule-based parsing
 * when no summary model is configured.
 *
 * Borrowed from claude-mem architecture (SDKAgent + ResponseProcessor)
 */

import type { ParsedObservation, ObservationType } from "./types"
import { OBSERVATION_TYPES, OBSERVATION_CONCEPTS } from "./types"

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
    console.log(`[Summarizer] Summary model configured: ${config.providerId}/${config.modelId}`)
  } else {
    console.log("[Summarizer] Summary model cleared, using rule-based parsing")
  }
}

/**
 * Check if LLM-based summarization is available
 */
export function isSummaryModelConfigured(): boolean {
  return summaryConfig !== null
}

// ============ Observation Enhancement ============

const VALID_TYPES = OBSERVATION_TYPES.map((t) => t.id)
const VALID_CONCEPTS = OBSERVATION_CONCEPTS as readonly string[]

/**
 * Tools that are too routine to warrant LLM enhancement.
 * These produce simple, predictable observations that rules handle fine.
 */
const SKIP_LLM_TOOLS = new Set(["Glob", "WebSearch"])

/**
 * Minimum output size to justify LLM enhancement.
 * Very short outputs (e.g., file not found, empty search) aren't worth analyzing.
 */
const MIN_OUTPUT_LENGTH = 50

/**
 * Rate limiting: track recent LLM calls to avoid bursts.
 * Max N calls per window to prevent runaway API costs.
 */
const LLM_RATE_LIMIT = 10 // max calls per window
const LLM_RATE_WINDOW_MS = 60_000 // 1 minute
const recentLlmCalls: number[] = []

function isRateLimited(): boolean {
  const now = Date.now()
  // Remove calls outside the window
  while (recentLlmCalls.length > 0 && recentLlmCalls[0]! < now - LLM_RATE_WINDOW_MS) {
    recentLlmCalls.shift()
  }
  return recentLlmCalls.length >= LLM_RATE_LIMIT
}

function recordLlmCall(): void {
  recentLlmCalls.push(Date.now())
}

/**
 * Determine if a tool call should be enhanced with LLM.
 * Returns false for routine operations that rules handle well enough.
 */
function shouldEnhanceWithLLM(
  toolName: string,
  toolOutput: unknown,
): boolean {
  // Skip tools that produce predictable observations
  if (SKIP_LLM_TOOLS.has(toolName)) return false

  // Skip if output is too small to be interesting
  const outputStr = typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput)
  if (outputStr.length < MIN_OUTPUT_LENGTH) return false

  // Rate limiting
  if (isRateLimited()) {
    console.log("[Summarizer] Rate limited, skipping LLM enhancement")
    return false
  }

  return true
}

const OBSERVATION_SYSTEM_PROMPT = `You are a code intelligence observer. Your job is to analyze tool executions from a coding session and produce structured observations.

Given a tool call (name, input, output), produce a single observation in XML format:

<observation>
  <type>one of: discovery, decision, bugfix, feature, refactor, change</type>
  <title>Short, descriptive title (max 80 chars)</title>
  <narrative>1-2 sentence explanation of what was learned or changed and WHY it matters</narrative>
  <concepts>comma-separated from: how-it-works, why-it-exists, what-changed, problem-solution, gotcha, pattern, trade-off, api, testing, performance, security</concepts>
</observation>

Rules:
- "discovery": reading/searching/exploring code to understand it
- "decision": choosing between approaches, architecture choices
- "bugfix": fixing a bug or error
- "feature": adding new functionality
- "refactor": restructuring without changing behavior
- "change": generic code modification
- The narrative should capture INSIGHT, not just repeat the tool action. Bad: "Read file X". Good: "Explored the auth module - uses OAuth PKCE flow with encrypted token storage"
- Keep titles concise and meaningful
- Pick 1-3 most relevant concepts
- Respond ONLY with the XML block, nothing else`

/**
 * Enhance a rule-based observation using LLM.
 * Returns enhanced observation, or the original if LLM fails or is skipped.
 */
export async function enhanceObservation(
  ruleBased: ParsedObservation,
  toolInput: unknown,
  toolOutput: unknown,
): Promise<ParsedObservation> {
  if (!summaryConfig) return ruleBased

  // Skip routine tools and small outputs
  if (!shouldEnhanceWithLLM(ruleBased.toolName, toolOutput)) {
    return ruleBased
  }

  try {
    const { callSummaryAI } = await import("../trpc/routers/summary-ai")

    recordLlmCall()

    // Build context for LLM
    const inputStr = truncate(JSON.stringify(toolInput), 1500)
    const outputStr = truncate(
      typeof toolOutput === "string" ? toolOutput : JSON.stringify(toolOutput),
      2000,
    )

    const userMessage = `Tool: ${ruleBased.toolName}
Input: ${inputStr}
Output: ${outputStr}`

    const result = await callSummaryAI(
      summaryConfig.providerId,
      summaryConfig.modelId,
      OBSERVATION_SYSTEM_PROMPT,
      userMessage,
      300,
    )

    if (!result) return ruleBased

    // Parse XML response
    const enhanced = parseObservationXml(result)
    if (!enhanced) return ruleBased

    // Merge: keep file info from rule-based, use LLM for semantics
    return {
      ...ruleBased,
      type: enhanced.type,
      title: enhanced.title || ruleBased.title,
      narrative: enhanced.narrative || ruleBased.narrative,
      concepts: enhanced.concepts.length > 0 ? enhanced.concepts : ruleBased.concepts,
    }
  } catch (error) {
    console.warn("[Summarizer] Enhancement failed, using rule-based:", (error as Error).message)
    return ruleBased
  }
}

// ============ Session Summary ============

const SESSION_SUMMARY_SYSTEM_PROMPT = `You are a code session analyst. Given a list of observations from a coding session, generate a structured summary.

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

/**
 * Generate a session summary from its observations.
 * Returns null if LLM is not configured or call fails.
 */
export async function generateSessionSummary(
  userPrompts: string[],
  observationTitles: string[],
  observationNarratives: string[],
): Promise<SessionSummary | null> {
  if (!summaryConfig) return null

  try {
    const { callSummaryAI } = await import("../trpc/routers/summary-ai")

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

    const result = await callSummaryAI(
      summaryConfig.providerId,
      summaryConfig.modelId,
      SESSION_SUMMARY_SYSTEM_PROMPT,
      userMessage,
      500,
    )

    if (!result) return null

    return parseSummaryXml(result)
  } catch (error) {
    console.warn("[Summarizer] Session summary failed:", (error as Error).message)
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
  if (!raw) return "discovery"

  const cleaned = raw.trim().toLowerCase().replace(/[_\s-]/g, "")

  // Map common variations
  const typeMap: Record<string, ObservationType> = {
    discovery: "discovery",
    decision: "decision",
    bugfix: "bugfix",
    bug_fix: "bugfix",
    fix: "bugfix",
    feature: "feature",
    featureimpl: "feature",
    feature_impl: "feature",
    refactor: "refactor",
    coderefactor: "refactor",
    code_refactor: "refactor",
    change: "change",
    response: "response",
  }

  return typeMap[cleaned] || (VALID_TYPES.includes(cleaned as ObservationType) ? cleaned as ObservationType : "discovery")
}

/**
 * Truncate string to max length
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + "..."
}
