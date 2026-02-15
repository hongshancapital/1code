/**
 * LiteLLM router - provides LiteLLM proxy configuration and model listing
 */
import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getEnv } from "../../env"
import { createLogger } from "../../logger"

const liteLLMLog = createLogger("LiteLLM")


// Model blacklist - these models are not suitable for agent use
const MODEL_BLACKLIST = [
  "text-embedding-3-small",
  "text-embedding-3-large",
  "text-embedding-ada-002",
  "whisper-1",
  "tts-1",
  "tts-1-hd",
  "dall-e-2",
  "dall-e-3",
]

// Preferred model patterns in priority order (Sonnet preferred over Opus)
// Will match the first pattern found in the model list
const PREFERRED_MODEL_PATTERNS = [
  /^claude-sonnet-4-5-\d+$/,      // claude-sonnet-4-5-20250929
  /^claude-sonnet-4-\d+$/,         // claude-sonnet-4-20250514
  /^claude-sonnet.*$/i,            // any sonnet
  /^claude-opus.*$/i,              // fallback to opus
  /^claude.*$/i,                   // any claude
]

type LiteLLMModel = {
  id: string
  object: string
  created: number
  owned_by: string
}

export const litellmRouter = router({
  /**
   * Get LiteLLM configuration status
   * Returns whether LiteLLM is configured via env
   */
  getConfig: publicProcedure.query(() => {
    const env = getEnv()
    const baseUrl = env.MAIN_VITE_LITELLM_BASE_URL
    const apiKey = env.MAIN_VITE_LITELLM_API_KEY

    return {
      available: Boolean(baseUrl),
      baseUrl: baseUrl || null,
      hasApiKey: Boolean(apiKey),
    }
  }),

  /**
   * Fetch available models from LiteLLM proxy
   */
  getModels: publicProcedure.query(async () => {
    const env = getEnv()
    const baseUrl = env.MAIN_VITE_LITELLM_BASE_URL
    const apiKey = env.MAIN_VITE_LITELLM_API_KEY

    if (!baseUrl) {
      return {
        models: [],
        defaultModel: null,
        error: "LiteLLM not configured",
      }
    }

    try {
      const normalizedUrl = baseUrl.replace(/\/+$/, "")
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`
      }

      const response = await fetch(`${normalizedUrl}/models`, {
        method: "GET",
        headers,
      })

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const allModels: LiteLLMModel[] = data.data || data.models || []

      // Filter out blacklisted models
      const filteredModels = allModels.filter(
        (m) => !MODEL_BLACKLIST.some((blacklisted) => m.id.includes(blacklisted))
      )

      // Find the best default model by matching patterns in priority order
      let defaultModel: string | null = null
      for (const pattern of PREFERRED_MODEL_PATTERNS) {
        const match = filteredModels.find((m) => pattern.test(m.id))
        if (match) {
          defaultModel = match.id
          break
        }
      }

      // If no pattern matched, use the first claude model or first model
      if (!defaultModel && filteredModels.length > 0) {
        defaultModel = filteredModels[0].id
      }

      return {
        models: filteredModels,
        defaultModel,
        error: null,
      }
    } catch (error) {
      liteLLMLog.error("Failed to fetch models:", error)
      return {
        models: [],
        defaultModel: null,
        error: error instanceof Error ? error.message : "Failed to connect",
      }
    }
  }),

  /**
   * Get LiteLLM config for use with Claude SDK
   * This returns the full config needed for customConfig
   */
  getCustomConfig: publicProcedure
    .input(z.object({ model: z.string() }))
    .query(({ input }) => {
      const env = getEnv()
      const baseUrl = env.MAIN_VITE_LITELLM_BASE_URL
      const apiKey = env.MAIN_VITE_LITELLM_API_KEY

      if (!baseUrl) {
        return null
      }

      return {
        model: input.model,
        token: apiKey || "litellm",
        baseUrl: baseUrl.replace(/\/+$/, ""),
      }
    }),
})
