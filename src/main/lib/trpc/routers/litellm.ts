/**
 * LiteLLM router - provides LiteLLM proxy configuration and model listing
 */
import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getEnv } from "../../env"

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

// Default model to select if available (Sonnet, not Opus)
const DEFAULT_MODEL = "claude-sonnet-4-20250514"

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

      // Check if default model is available
      const hasDefaultModel = filteredModels.some((m) => m.id === DEFAULT_MODEL)

      return {
        models: filteredModels,
        defaultModel: hasDefaultModel ? DEFAULT_MODEL : null,
        error: null,
      }
    } catch (error) {
      console.error("[LiteLLM] Failed to fetch models:", error)
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
