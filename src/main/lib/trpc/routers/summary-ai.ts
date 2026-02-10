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

/** Token usage data returned from API calls */
export interface SummaryAIUsage {
  inputTokens: number
  outputTokens: number
  model: string
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
    console.warn("[SummaryAI] No credentials for provider:", providerId)
    return null
  }

  try {
    if (providerId === "anthropic") {
      return await callAnthropicAPI(credentials, systemPrompt, userMessage, maxTokens)
    }
    return await callOpenAICompatibleAPI(credentials, systemPrompt, userMessage, maxTokens)
  } catch (error) {
    console.warn("[SummaryAI] Call failed:", (error as Error).message)
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
    console.warn(`[SummaryAI] Anthropic API returned ${response.status}`)
    return null
  }

  const data = await response.json()
  const text = data.content?.[0]?.text?.trim()
  if (!text) return null

  // Anthropic usage: { input_tokens, output_tokens }
  const usage: SummaryAIUsage | null = data.usage
    ? {
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
        model: credentials.model,
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
    console.warn(`[SummaryAI] OpenAI-compatible API returned ${response.status}`)
    return null
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) return null

  // OpenAI usage: { prompt_tokens, completion_tokens, total_tokens }
  const usage: SummaryAIUsage | null = data.usage
    ? {
        inputTokens: data.usage.prompt_tokens || 0,
        outputTokens: data.usage.completion_tokens || 0,
        model: credentials.model,
      }
    : null

  return { text, usage }
}
