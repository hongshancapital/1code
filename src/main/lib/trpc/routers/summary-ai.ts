/**
 * Summary AI - lightweight AI calls for name generation, commit messages, etc.
 *
 * Supports two API formats:
 * - Anthropic: Messages API (POST /v1/messages)
 * - OpenAI-compatible: Chat Completions API (POST /v1/chat/completions)
 *
 * Returns null on failure so callers can fall back to other methods.
 */
import { getProviderCredentials } from "./providers"
import { createLogger } from "../../logger"

const summaryAILog = createLogger("SummaryAI")


/** Token usage data returned from API calls */
export interface SummaryAIUsage {
  inputTokens: number
  outputTokens: number
  model: string
  costUsd?: number
}

/**
 * Model pricing table: [inputPricePerMToken, outputPricePerMToken]
 * Prices in USD per million tokens.
 * Used to estimate cost for Summary AI calls (memory, auto-name, etc.)
 */
const MODEL_PRICING: Record<string, [number, number]> = {
  // Anthropic
  "claude-haiku-3-5-20241022": [1, 5],
  "claude-3-5-haiku-20241022": [1, 5],
  "claude-3-5-haiku-latest": [1, 5],
  "claude-sonnet-4-20250514": [3, 15],
  "claude-4-sonnet-20250514": [3, 15],
  "claude-sonnet-4-latest": [3, 15],
  "claude-opus-4-20250514": [15, 75],
  "claude-4-opus-20250514": [15, 75],
  "claude-opus-4-latest": [15, 75],
  // OpenAI
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
  "gpt-4.1": [2, 8],
  // DeepSeek
  "deepseek-chat": [0.27, 1.1],
  "deepseek-reasoner": [0.55, 2.19],
}

/** Default pricing fallback: $1/M input, $5/M output */
const DEFAULT_PRICING: [number, number] = [1, 5]

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const [inputPrice, outputPrice] = MODEL_PRICING[model] || DEFAULT_PRICING
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000
}

/** Result with text content and optional usage data */
export interface SummaryAIResult {
  text: string
  usage: SummaryAIUsage | null
}

/**
 * Call a configured AI provider for quick summary tasks.
 * Returns the model's text response, or null if the call fails.
 * (Backward-compatible wrapper — returns string only)
 */
export async function callSummaryAI(
  providerId: string,
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 200,
): Promise<string | null> {
  const result = await callSummaryAIWithUsage(providerId, modelId, systemPrompt, userMessage, maxTokens)
  return result?.text ?? null
}

/**
 * Call a configured AI provider and return both text and token usage.
 * Use this when you need to track LLM consumption.
 */
export async function callSummaryAIWithUsage(
  providerId: string,
  modelId: string,
  systemPrompt: string,
  userMessage: string,
  maxTokens = 200,
): Promise<SummaryAIResult | null> {
  const credentials = await getProviderCredentials(providerId, modelId)
  if (!credentials) {
    summaryAILog.warn("No credentials for provider:", providerId)
    return null
  }

  try {
    // Detect API format: use Anthropic format for native Anthropic or Anthropic-compatible endpoints
    const isAnthropicFormat = providerId === "anthropic" ||
      credentials.baseUrl.includes("/anthropic") ||
      credentials.baseUrl.includes("api.anthropic.com")

    if (isAnthropicFormat) {
      summaryAILog.info("Using Anthropic API format for:", credentials.baseUrl)
      return await callAnthropicAPI(credentials, systemPrompt, userMessage, maxTokens)
    }
    summaryAILog.info("Using OpenAI-compatible API format for:", credentials.baseUrl)
    return await callOpenAICompatibleAPI(credentials, systemPrompt, userMessage, maxTokens)
  } catch (error) {
    summaryAILog.warn("Call failed:", (error as Error).message)
    return null
  }
}

/**
 * Call Anthropic Messages API
 */
async function callAnthropicAPI(
  credentials: { model: string; token: string; baseUrl: string },
  systemPrompt: string,
  userMessage: string,
  maxTokens = 200,
): Promise<SummaryAIResult | null> {
  const response = await fetch(`${credentials.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.token}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: credentials.model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        { role: "user", content: userMessage },
      ],
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    summaryAILog.warn(`Anthropic API returned ${response.status}`)
    return null
  }

  const data = await response.json()
  const text = data.content?.[0]?.text?.trim()
  if (!text) return null

  // Anthropic usage: { input_tokens, output_tokens }
  const inputTokens = data.usage?.input_tokens || 0
  const outputTokens = data.usage?.output_tokens || 0
  const usage: SummaryAIUsage | null = data.usage
    ? {
        inputTokens,
        outputTokens,
        model: credentials.model,
        costUsd: estimateCostUsd(credentials.model, inputTokens, outputTokens),
      }
    : null

  return { text, usage }
}

/**
 * Call OpenAI-compatible Chat Completions API
 */
async function callOpenAICompatibleAPI(
  credentials: { model: string; token: string; baseUrl: string },
  systemPrompt: string,
  userMessage: string,
  maxTokens = 200,
): Promise<SummaryAIResult | null> {
  const response = await fetch(`${credentials.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${credentials.token}`,
    },
    body: JSON.stringify({
      model: credentials.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!response.ok) {
    summaryAILog.warn(`OpenAI-compatible API returned ${response.status}`)
    return null
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) return null

  // OpenAI usage: { prompt_tokens, completion_tokens, total_tokens }
  const inputTokens = data.usage?.prompt_tokens || 0
  const outputTokens = data.usage?.completion_tokens || 0
  const usage: SummaryAIUsage | null = data.usage
    ? {
        inputTokens,
        outputTokens,
        model: credentials.model,
        costUsd: estimateCostUsd(credentials.model, inputTokens, outputTokens),
      }
    : null

  return { text, usage }
}
