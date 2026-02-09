/**
 * Providers router - unified model provider management
 *
 * Manages three types of providers in a single unified list:
 * - anthropic: Anthropic OAuth (virtual, not stored in DB)
 * - litellm: LiteLLM proxy via env vars (virtual, not stored in DB, only if env configured)
 * - custom: User-defined API endpoints (stored in model_providers table)
 *
 * Activation rules:
 * - Anthropic: activatable when OAuth account is configured
 * - LiteLLM/Custom: activatable when they have models available
 * - All providers can be enabled/disabled at any time
 */
import { z } from "zod"
import { router, publicProcedure } from "../index"
import { safeStorage } from "electron"
import { eq } from "drizzle-orm"
import { getDatabase } from "../../db"
import { modelProviders, cachedModels, anthropicAccounts, anthropicSettings } from "../../db/schema"
import { createId } from "../../db/utils"
import { getEnv } from "../../env"

// ============ Encryption helpers ============

function encryptApiKey(key: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(key).toString("base64")
  }
  return safeStorage.encryptString(key).toString("base64")
}

function decryptApiKey(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(encrypted, "base64").toString("utf-8")
  }
  return safeStorage.decryptString(Buffer.from(encrypted, "base64"))
}

// ============ URL helpers ============

/**
 * Normalize a base URL for API calls.
 * - Strips trailing slashes
 * - Appends /v1 if the URL doesn't already end with /v1 (common OpenAI-compatible pattern)
 */
function normalizeApiBaseUrl(url: string): string {
  const stripped = url.replace(/\/+$/, "")
  if (/\/v\d+$/.test(stripped)) return stripped
  return `${stripped}/v1`
}

// ============ Model filtering ============

// Models not suitable for use (embeddings, TTS, etc.)
const MODEL_BLACKLIST = [
  "text-embedding",
  "whisper",
  "tts-1",
  "embedding",
]

// Preferred default model patterns in priority order
const PREFERRED_MODEL_PATTERNS = [
  /^claude-3-5-sonnet.*$/i,
  /^claude-sonnet-4-5-\d+$/,
  /^claude-sonnet-4-\d+$/,
  /^claude-sonnet.*$/i,
  /^claude-opus.*$/i,
  /^claude.*$/i,
  /^gpt-4.*$/i,
]

function isBlacklisted(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return MODEL_BLACKLIST.some((b) => lower.includes(b))
}

function findDefaultModel(modelIds: string[]): string | null {
  for (const pattern of PREFERRED_MODEL_PATTERNS) {
    const match = modelIds.find((id) => pattern.test(id))
    if (match) return match
  }
  return modelIds[0] || null
}

// ============ Anthropic models via official API ============

/**
 * Get the active Anthropic OAuth token from DB.
 * Returns null if no active account or decryption fails.
 */
function getAnthropicOAuthToken(): string | null {
  try {
    const db = getDatabase()
    const settings = db
      .select()
      .from(anthropicSettings)
      .where(eq(anthropicSettings.id, "singleton"))
      .get()

    if (!settings?.activeAccountId) return null

    const account = db
      .select()
      .from(anthropicAccounts)
      .where(eq(anthropicAccounts.id, settings.activeAccountId))
      .get()

    if (!account) return null

    if (!safeStorage.isEncryptionAvailable()) {
      return Buffer.from(account.oauthToken, "base64").toString("utf-8")
    }
    return safeStorage.decryptString(Buffer.from(account.oauthToken, "base64"))
  } catch {
    return null
  }
}

// ============ Shared credential resolution ============

/**
 * Resolve provider credentials for any provider type.
 * Returns { model, token, baseUrl } or null if unavailable.
 * Exported for use by other routers (e.g. summary-ai).
 */
export async function getProviderCredentials(
  providerId: string,
  modelId: string,
): Promise<{ model: string; token: string; baseUrl: string } | null> {
  const env = getEnv()

  if (providerId === "anthropic") {
    const token = getAnthropicOAuthToken()
    if (!token) return null
    return { model: modelId, token, baseUrl: "https://api.anthropic.com/v1" }
  }

  if (providerId === "litellm") {
    const baseUrl = env.MAIN_VITE_LITELLM_BASE_URL
    const apiKey = env.MAIN_VITE_LITELLM_API_KEY
    if (!baseUrl) return null
    return { model: modelId, token: apiKey || "litellm", baseUrl: normalizeApiBaseUrl(baseUrl) }
  }

  // Custom provider
  const db = getDatabase()
  const provider = db
    .select()
    .from(modelProviders)
    .where(eq(modelProviders.id, providerId))
    .get()

  if (!provider) return null

  try {
    return {
      model: modelId,
      token: decryptApiKey(provider.apiKey),
      baseUrl: normalizeApiBaseUrl(provider.baseUrl),
    }
  } catch {
    return null
  }
}

// Fallback Anthropic models when API is unavailable
const ANTHROPIC_FALLBACK_MODELS: ModelInfo[] = [
  { id: "claude-opus-4-6-20250610", name: "Opus 4.6" },
  { id: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5" },
  { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5" },
]

/**
 * Fetch Anthropic model list using the user's OAuth token.
 * Falls back to hardcoded model list if API fails.
 */
async function getAnthropicModels(): Promise<{ models: ModelInfo[]; error: string | null }> {
  const token = getAnthropicOAuthToken()
  if (!token) {
    return { models: ANTHROPIC_FALLBACK_MODELS, error: null }
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/models?limit=1000", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!response.ok) {
      console.warn(`[Anthropic] API returned ${response.status}, using fallback models`)
      return { models: ANTHROPIC_FALLBACK_MODELS, error: null }
    }

    const data = await response.json()
    const rawModels: Array<{ id: string; display_name: string }> = data.data || []

    if (rawModels.length === 0) {
      return { models: ANTHROPIC_FALLBACK_MODELS, error: null }
    }

    const models: ModelInfo[] = rawModels
      .filter((m) => m.id.startsWith("claude-") && !isBlacklisted(m.id))
      .map((m) => ({
        id: m.id,
        name: m.display_name || m.id,
      }))

    return { models: models.length > 0 ? models : ANTHROPIC_FALLBACK_MODELS, error: null }
  } catch (error) {
    console.warn("[Anthropic] Failed to fetch models, using fallback:", error)
    return { models: ANTHROPIC_FALLBACK_MODELS, error: null }
  }
}

// ============ LiteLLM model filtering ============

function filterLitellmModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => {
    const lower = m.id.toLowerCase()
    // Only keep models containing "claude"
    if (!lower.includes("claude")) return false
    // Exclude models ending with "coding"
    if (lower.endsWith("-coding")) return false
    return true
  })
}

// ============ Types ============

export type ProviderType = "anthropic" | "litellm" | "custom"

export interface ProviderInfo {
  id: string
  type: ProviderType
  name: string
  isEnabled: boolean
  isConfigured: boolean
}

export interface ModelInfo {
  id: string
  name: string
}

// ============ Router ============

export const providersRouter = router({
  /**
   * List all providers in a unified list
   * - Anthropic always present
   * - LiteLLM only if env configured
   * - Custom providers from DB
   */
  list: publicProcedure
    .query(async () => {
      const db = getDatabase()
      const env = getEnv()
      const providers: ProviderInfo[] = []

      // 1. LiteLLM (only if env configured)
      if (env.MAIN_VITE_LITELLM_BASE_URL) {
        providers.push({
          id: "litellm",
          type: "litellm",
          name: "LiteLLM",
          isEnabled: true,
          isConfigured: true,
        })
      }

      // 2. Anthropic OAuth (always present)
      providers.push({
        id: "anthropic",
        type: "anthropic",
        name: "Anthropic",
        isEnabled: true,
        isConfigured: true, // Actual OAuth status checked by UI
      })

      // 3. Custom providers from DB (all of them, no category filter)
      try {
        const customProviders = db
          .select()
          .from(modelProviders)
          .all()

        for (const p of customProviders) {
          providers.push({
            id: p.id,
            type: "custom",
            name: p.name,
            isEnabled: p.isEnabled ?? true,
            isConfigured: true,
          })
        }
      } catch (error) {
        console.error("[Providers] Failed to query custom providers:", error)
        // Continue with virtual providers (anthropic, litellm)
      }

      return providers
    }),

  /**
   * Get a single provider by ID
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      if (input.id === "anthropic") {
        return {
          id: "anthropic",
          type: "anthropic" as const,
          name: "Anthropic",
          isEnabled: true,
        }
      }

      if (input.id === "litellm") {
        const env = getEnv()
        return {
          id: "litellm",
          type: "litellm" as const,
          name: "LiteLLM",
          isEnabled: Boolean(env.MAIN_VITE_LITELLM_BASE_URL),
        }
      }

      const db = getDatabase()
      const provider = db
        .select()
        .from(modelProviders)
        .where(eq(modelProviders.id, input.id))
        .get()

      if (!provider) return null

      return {
        id: provider.id,
        type: "custom" as const,
        name: provider.name,
        baseUrl: provider.baseUrl,
        isEnabled: provider.isEnabled ?? true,
      }
    }),

  /**
   * Add a custom provider
   * Validates connection by testing /models endpoint
   */
  addCustom: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        baseUrl: z.string().url(),
        apiKey: z.string().min(1),
        skipValidation: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input }) => {
      const normalizedUrl = input.baseUrl.replace(/\/+$/, "")
      const apiUrl = normalizeApiBaseUrl(normalizedUrl)

      // Validate connection unless skipped
      if (!input.skipValidation) {
        try {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.apiKey}`,
          }

          const response = await fetch(`${apiUrl}/models`, {
            method: "GET",
            headers,
            signal: AbortSignal.timeout(10000),
          })

          if (!response.ok) {
            return {
              success: false,
              error: `Connection failed: ${response.status} ${response.statusText}`,
            }
          }
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error
                ? `Connection failed: ${error.message}`
                : "Connection failed",
          }
        }
      }

      // Save to database
      const db = getDatabase()
      const id = createId()

      db.insert(modelProviders)
        .values({
          id,
          type: "custom",
          category: "llm", // Keep default for DB column compatibility
          name: input.name,
          baseUrl: normalizedUrl,
          apiKey: encryptApiKey(input.apiKey),
          isEnabled: true,
        })
        .run()

      return { success: true, id }
    }),

  /**
   * Update a custom provider
   */
  updateCustom: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        baseUrl: z.string().url().optional(),
        apiKey: z.string().optional(),
        isEnabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      const updates: Record<string, unknown> = {
        updatedAt: new Date(),
      }

      if (input.name !== undefined) updates.name = input.name
      if (input.baseUrl !== undefined)
        updates.baseUrl = input.baseUrl.replace(/\/+$/, "")
      if (input.apiKey !== undefined)
        updates.apiKey = encryptApiKey(input.apiKey)
      if (input.isEnabled !== undefined) updates.isEnabled = input.isEnabled

      db.update(modelProviders)
        .set(updates)
        .where(eq(modelProviders.id, input.id))
        .run()

      return { success: true }
    }),

  /**
   * Remove a custom provider
   */
  removeCustom: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      db.delete(modelProviders)
        .where(eq(modelProviders.id, input.id))
        .run()

      db.delete(cachedModels)
        .where(eq(cachedModels.providerId, input.id))
        .run()

      return { success: true }
    }),

  // ============ Model management ============

  /**
   * Get models for a provider
   * Uses cache with 5-minute expiry, can force refresh
   */
  getModels: publicProcedure
    .input(
      z.object({
        providerId: z.string(),
        forceRefresh: z.boolean().default(false),
      }),
    )
    .query(async ({ input }) => {
      const db = getDatabase()
      const env = getEnv()

      // Anthropic: fetch from official API using OAuth token (no fallback)
      if (input.providerId === "anthropic") {
        // Check cache first (5 minutes)
        if (!input.forceRefresh) {
          try {
            const cached = db
              .select()
              .from(cachedModels)
              .where(eq(cachedModels.providerId, "anthropic"))
              .all()

            if (cached.length > 0) {
              const cacheAge = Date.now() - (cached[0].cachedAt?.getTime() || 0)
              if (cacheAge < 5 * 60 * 1000) {
                const models: ModelInfo[] = cached.map((c) => ({
                  id: c.modelId,
                  name: c.name,
                }))
                return {
                  models,
                  defaultModelId: findDefaultModel(models.map((m) => m.id)),
                  error: null,
                }
              }
            }
          } catch {
            // Cache table might not exist yet, continue to fetch
          }
        }

        const result = await getAnthropicModels()

        if (result.error) {
          return { models: [], defaultModelId: null, error: result.error }
        }

        // Update cache
        try {
          db.delete(cachedModels)
            .where(eq(cachedModels.providerId, "anthropic"))
            .run()
          for (const m of result.models) {
            db.insert(cachedModels)
              .values({
                id: createId(),
                providerId: "anthropic",
                modelId: m.id,
                name: m.name,
                category: "llm",
              })
              .run()
          }
        } catch {
          // Cache write failed, non-critical
        }

        return {
          models: result.models,
          defaultModelId: findDefaultModel(result.models.map((m) => m.id)),
          error: null,
        }
      }

      // Determine base URL and API key
      let baseUrl: string | null = null
      let apiKey: string | null = null

      if (input.providerId === "litellm") {
        baseUrl = env.MAIN_VITE_LITELLM_BASE_URL || null
        apiKey = env.MAIN_VITE_LITELLM_API_KEY || null
      } else {
        const provider = db
          .select()
          .from(modelProviders)
          .where(eq(modelProviders.id, input.providerId))
          .get()

        if (!provider) {
          return { models: [], defaultModelId: null, error: "Provider not found" }
        }

        baseUrl = provider.baseUrl
        try {
          apiKey = decryptApiKey(provider.apiKey)
        } catch {
          return { models: [], defaultModelId: null, error: "Failed to decrypt API key" }
        }
      }

      if (!baseUrl) {
        return { models: [], defaultModelId: null, error: "Provider not configured" }
      }

      // Check cache (5 minutes)
      if (!input.forceRefresh) {
        const cached = db
          .select()
          .from(cachedModels)
          .where(eq(cachedModels.providerId, input.providerId))
          .all()

        if (cached.length > 0) {
          const cacheAge = Date.now() - (cached[0].cachedAt?.getTime() || 0)
          if (cacheAge < 5 * 60 * 1000) {
            const models: ModelInfo[] = cached.map((c) => ({
              id: c.modelId,
              name: c.name,
            }))
            return {
              models,
              defaultModelId: findDefaultModel(models.map((m) => m.id)),
              error: null,
            }
          }
        }
      }

      // Fetch from /models endpoint
      try {
        const headers: Record<string, string> = {}
        if (apiKey) {
          headers["Authorization"] = `Bearer ${apiKey}`
        }

        const apiUrl = normalizeApiBaseUrl(baseUrl)
        const response = await fetch(`${apiUrl}/models`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }

        // Check content type to avoid parsing HTML as JSON
        const contentType = response.headers.get("content-type") || ""
        if (!contentType.includes("application/json") && contentType.includes("text/html")) {
          throw new Error("服务器返回了 HTML 而非 JSON，请检查 Base URL 是否正确（通常需要以 /v1 结尾）")
        }

        const text = await response.text()
        let data: { data?: Array<{ id: string }>; models?: Array<{ id: string }> }
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error("服务器返回了非 JSON 响应，请检查 Base URL 是否正确（通常需要以 /v1 结尾）")
        }

        const rawModels: Array<{ id: string }> = data.data || data.models || []

        // Filter blacklisted models, then apply provider-specific filters
        let models: ModelInfo[] = rawModels
          .filter((m) => !isBlacklisted(m.id))
          .map((m) => ({
            id: m.id,
            name: m.id,
          }))

        // LiteLLM: only keep claude models, exclude coding variants
        if (input.providerId === "litellm") {
          models = filterLitellmModels(models)
        }

        // Update cache
        try {
          db.delete(cachedModels)
            .where(eq(cachedModels.providerId, input.providerId))
            .run()

          for (const m of models) {
            db.insert(cachedModels)
              .values({
                id: createId(),
                providerId: input.providerId,
                modelId: m.id,
                name: m.name,
                category: "llm",
              })
              .run()
          }
        } catch {
          // Cache write failed, non-critical
        }

        return {
          models,
          defaultModelId: findDefaultModel(models.map((m) => m.id)),
          error: null,
        }
      } catch (error) {
        console.error(`[Providers] Failed to fetch models for ${input.providerId}:`, error)
        return {
          models: [],
          defaultModelId: null,
          error: error instanceof Error ? error.message : "Failed to fetch models",
        }
      }
    }),

  /**
   * Get full config for Claude SDK
   * Returns { model, token, baseUrl } or null for Anthropic OAuth
   */
  getConfig: publicProcedure
    .input(
      z.object({
        providerId: z.string(),
        modelId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      const env = getEnv()

      // Anthropic OAuth - return null (use OAuth token)
      if (input.providerId === "anthropic") {
        return null
      }

      // LiteLLM
      if (input.providerId === "litellm") {
        const baseUrl = env.MAIN_VITE_LITELLM_BASE_URL
        const apiKey = env.MAIN_VITE_LITELLM_API_KEY

        if (!baseUrl) return null

        return {
          model: input.modelId,
          token: apiKey || "litellm",
          baseUrl: baseUrl.replace(/\/+$/, ""),
        }
      }

      // Custom provider
      const db = getDatabase()
      const provider = db
        .select()
        .from(modelProviders)
        .where(eq(modelProviders.id, input.providerId))
        .get()

      if (!provider) return null

      try {
        return {
          model: input.modelId,
          token: decryptApiKey(provider.apiKey),
          baseUrl: provider.baseUrl,
        }
      } catch {
        return null
      }
    }),

  /**
   * Get image API config for a provider.
   * Unlike getConfig (which returns null for Anthropic), this always returns
   * { model, token, baseUrl } for any provider type, since image generation
   * APIs need explicit credentials even for Anthropic.
   */
  getImageConfig: publicProcedure
    .input(
      z.object({
        providerId: z.string(),
        modelId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      return getProviderCredentials(input.providerId, input.modelId)
    }),

  /**
   * Test connection to a provider
   */
  testConnection: publicProcedure
    .input(
      z.object({
        baseUrl: z.string().url(),
        apiKey: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const apiUrl = normalizeApiBaseUrl(input.baseUrl)
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        }

        const response = await fetch(`${apiUrl}/models`, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
          return {
            success: false,
            error: `${response.status} ${response.statusText}`,
          }
        }

        const data = await response.json()
        const modelCount = (data.data || data.models || []).length

        return {
          success: true,
          modelCount,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Connection failed",
        }
      }
    }),
})
