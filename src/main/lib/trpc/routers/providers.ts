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

// Encryption format marker for new double-base64 format
const ENCRYPTED_V2_PREFIX = "v2:"

function encryptApiKey(key: string): string {
  // First encode as base64 to handle any non-ASCII characters safely
  const base64Key = Buffer.from(key, "utf-8").toString("base64")
  if (!safeStorage.isEncryptionAvailable()) {
    return ENCRYPTED_V2_PREFIX + base64Key
  }
  return ENCRYPTED_V2_PREFIX + safeStorage.encryptString(base64Key).toString("base64")
}

function decryptApiKey(encrypted: string): string {
  // Check if it's the new v2 format (double base64)
  if (encrypted.startsWith(ENCRYPTED_V2_PREFIX)) {
    const data = encrypted.slice(ENCRYPTED_V2_PREFIX.length)
    let base64Key: string
    if (!safeStorage.isEncryptionAvailable()) {
      base64Key = data
    } else {
      base64Key = safeStorage.decryptString(Buffer.from(data, "base64"))
    }
    return Buffer.from(base64Key, "base64").toString("utf-8")
  }

  // Legacy format: directly encrypted string (no double base64)
  let decrypted: string
  if (!safeStorage.isEncryptionAvailable()) {
    decrypted = Buffer.from(encrypted, "base64").toString("utf-8")
  } else {
    decrypted = safeStorage.decryptString(Buffer.from(encrypted, "base64"))
  }

  // Check if the result looks like base64 (intermediate format from buggy code)
  // Valid API keys contain alphanumeric, dots, dashes, underscores - not padding '='
  // If it looks like base64, try decoding it once more
  if (/^[A-Za-z0-9+/]+=*$/.test(decrypted) && decrypted.length > 20) {
    try {
      const maybeKey = Buffer.from(decrypted, "base64").toString("utf-8")
      // If decoded successfully and looks like a valid key (printable ASCII), use it
      if (/^[\x20-\x7E]+$/.test(maybeKey) && maybeKey.length > 10) {
        return maybeKey
      }
    } catch {
      // Not base64, use decrypted as-is
    }
  }

  return decrypted
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

// Models not suitable for chat use (embeddings, TTS, etc.)
const MODEL_BLACKLIST = [
  "text-embedding",
  "whisper",
  "tts-1",
  "embedding",
]

function isBlacklisted(modelId: string): boolean {
  const lower = modelId.toLowerCase()
  return MODEL_BLACKLIST.some((b) => lower.includes(b))
}

// ============ Smart model filtering (whitelist + excludes) ============

// Whitelist: mainstream chat model prefixes
const CHAT_MODEL_WHITELIST = [
  /^claude-/i,       // Claude 全系列
  /^gpt-/i,          // OpenAI GPT 系列
  /^o[1234]-/i,      // OpenAI o 系列推理模型
  /^gemini-/i,       // Google Gemini 系列
  /^deepseek-/i,     // DeepSeek 系列
]

// Excludes: models that match whitelist but are not chat models
const CHAT_MODEL_EXCLUDES = [
  /-embed/i,          // 嵌入模型
  /-realtime/i,       // 实时流模型
]

/**
 * Filter models for LiteLLM/Custom providers
 * Keeps only mainstream chat models, excludes non-chat variants.
 * Anthropic models are NOT filtered by this (they use the official API list).
 */
function filterProviderModels(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => {
    const id = m.id
    const whitelisted = CHAT_MODEL_WHITELIST.some((r) => r.test(id))
    if (!whitelisted) return false
    const excluded = CHAT_MODEL_EXCLUDES.some((r) => r.test(id))
    return !excluded
  })
}

// ============ Version extraction & sorting ============

/**
 * Extract version info from model ID for sorting.
 * Handles multiple naming conventions:
 * - claude-opus-4-6-20250610    → { major: 4, minor: 6, date: 20250610 }
 * - claude-sonnet-4-5-20250929  → { major: 4, minor: 5, date: 20250929 }
 * - claude-3-5-sonnet-20241022  → { major: 3, minor: 5, date: 20241022 }
 * - gpt-4o-2024-08-06           → { major: 4, minor: 0, date: 20240806 }
 * - gpt-4.5-preview             → { major: 4, minor: 5, date: 0 }
 * - gemini-3-pro                → { major: 3, minor: 0, date: 0 }
 */
function extractModelVersion(modelId: string): { major: number; minor: number; date: number } {
  // Try to find an 8-digit date (YYYYMMDD)
  const dateMatch = modelId.match(/(\d{8})/)
  const date = dateMatch ? parseInt(dateMatch[1], 10) : 0

  // Try to find date in YYYY-MM-DD format and convert
  if (!dateMatch) {
    const dashDate = modelId.match(/(\d{4})-(\d{2})-(\d{2})/)
    if (dashDate) {
      return {
        major: 0,
        minor: 0,
        date: parseInt(`${dashDate[1]}${dashDate[2]}${dashDate[3]}`, 10),
      }
    }
  }

  // Extract version numbers (the first two numeric segments that look like versions)
  // Strip the date portion first to avoid confusing date digits with version
  const withoutDate = dateMatch ? modelId.replace(dateMatch[0], "") : modelId
  // Match version patterns: "4-6", "4.5", "3-5", standalone digits in model name
  const versionMatch = withoutDate.match(/(\d+)[.-](\d+)/)
  if (versionMatch) {
    return {
      major: parseInt(versionMatch[1], 10),
      minor: parseInt(versionMatch[2], 10),
      date,
    }
  }

  // Single version number (e.g., gemini-3-pro)
  const singleMatch = withoutDate.match(/(\d+)/)
  if (singleMatch) {
    return { major: parseInt(singleMatch[1], 10), minor: 0, date }
  }

  return { major: 0, minor: 0, date }
}

/**
 * Sort model IDs by version descending (newest first).
 */
function sortByVersionDesc(modelIds: string[]): string[] {
  return [...modelIds].sort((a, b) => {
    const va = extractModelVersion(a)
    const vb = extractModelVersion(b)
    if (vb.major !== va.major) return vb.major - va.major
    if (vb.minor !== va.minor) return vb.minor - va.minor
    return vb.date - va.date
  })
}

/**
 * Find the newest model matching a pattern from a list.
 */
function findNewestMatch(modelIds: string[], pattern: RegExp): string | null {
  const matches = modelIds.filter((id) => pattern.test(id))
  if (matches.length === 0) return null
  return sortByVersionDesc(matches)[0]
}

// ============ Smart model recommendation ============

/**
 * Find the best default chat model from a list.
 * Priority: Claude Sonnet (newest) > Claude Opus > Claude Haiku > GPT-4 > Gemini Pro > first available
 */
function findDefaultModel(modelIds: string[]): string | null {
  // Claude Sonnet (primary workhorse — both old and new naming)
  const sonnet = findNewestMatch(modelIds, /^claude[-_](?:sonnet[-_]|[\d.]+-sonnet)/i)
  if (sonnet) return sonnet

  // Claude Opus
  const opus = findNewestMatch(modelIds, /^claude[-_]opus/i)
  if (opus) return opus

  // Claude Haiku
  const haiku = findNewestMatch(modelIds, /^claude[-_]haiku/i)
  if (haiku) return haiku

  // Any other Claude
  const anyClaude = findNewestMatch(modelIds, /^claude-/i)
  if (anyClaude) return anyClaude

  // GPT-4 series (including gpt-4o, gpt-4.5, etc.)
  const gpt4 = findNewestMatch(modelIds, /^gpt-4/i)
  if (gpt4) return gpt4

  // OpenAI o-series reasoning
  const oSeries = findNewestMatch(modelIds, /^o[1234]-/i)
  if (oSeries) return oSeries

  // Gemini Pro
  const geminiPro = findNewestMatch(modelIds, /^gemini-.*pro/i)
  if (geminiPro) return geminiPro

  // DeepSeek chat
  const deepseek = findNewestMatch(modelIds, /^deepseek-chat/i)
  if (deepseek) return deepseek

  return modelIds[0] || null
}

/**
 * Find the best image generation model.
 * Priority: gemini-*-image (exact) > gemini-*-image-preview > dall-e > any with "image"
 */
function findImageModel(modelIds: string[]): string | null {
  // Gemini image — prefer exact match (no suffix) over preview/4k variants
  const geminiImageExact = findNewestMatch(modelIds, /^gemini-.*image$/i)
  if (geminiImageExact) return geminiImageExact

  // Gemini image with preview suffix
  const geminiImagePreview = findNewestMatch(modelIds, /^gemini-.*image-preview$/i)
  if (geminiImagePreview) return geminiImagePreview

  // Gemini image with any suffix
  const geminiImageAny = findNewestMatch(modelIds, /^gemini-.*image/i)
  if (geminiImageAny) return geminiImageAny

  // DALL-E
  const dalle = findNewestMatch(modelIds, /^dall-e/i)
  if (dalle) return dalle

  // Fallback: any model with "image" in name
  const anyImage = modelIds.find((id) => /image/i.test(id))
  return anyImage || null
}

/**
 * Find the best lightweight/summary model.
 * Priority: Claude Haiku > GPT mini > Flash > Lite > any small model
 */
function findSummaryModel(modelIds: string[]): string | null {
  const haiku = findNewestMatch(modelIds, /haiku/i)
  if (haiku) return haiku

  const mini = findNewestMatch(modelIds, /mini/i)
  if (mini) return mini

  const flash = findNewestMatch(modelIds, /flash/i)
  if (flash) return flash

  const lite = findNewestMatch(modelIds, /lite/i)
  if (lite) return lite

  return null
}

/**
 * Get recommended chat models for a provider (one per series/tier).
 * Returns a curated list of the newest model from each major series.
 * This is the "out-of-box" selection for normal users.
 */
function findRecommendedChatModels(modelIds: string[]): string[] {
  const recommended: string[] = []

  // Claude — one per tier (sonnet, opus, haiku)
  const sonnet = findNewestMatch(modelIds, /^claude[-_](?:sonnet[-_]|[\d.]+-sonnet)/i)
  if (sonnet) recommended.push(sonnet)
  const opus = findNewestMatch(modelIds, /^claude[-_]opus/i)
  if (opus) recommended.push(opus)
  const haiku = findNewestMatch(modelIds, /^claude[-_]haiku/i)
  if (haiku) recommended.push(haiku)

  // GPT — newest gpt-4 variant
  const gpt4 = findNewestMatch(modelIds, /^gpt-4/i)
  if (gpt4) recommended.push(gpt4)

  // OpenAI o-series
  const oSeries = findNewestMatch(modelIds, /^o[1234]-/i)
  if (oSeries) recommended.push(oSeries)

  // Gemini Pro
  const geminiPro = findNewestMatch(modelIds, /^gemini-.*pro(?!.*image)/i)
  if (geminiPro) recommended.push(geminiPro)

  // DeepSeek
  const deepseek = findNewestMatch(modelIds, /^deepseek-chat/i)
  if (deepseek) recommended.push(deepseek)

  // If nothing matched, return all (don't leave empty)
  return recommended.length > 0 ? recommended : modelIds.slice(0, 10)
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
  { id: "claude-opus-4-6", name: "Opus 4.6" },
  { id: "claude-sonnet-4-5", name: "Sonnet 4.5" },
  { id: "claude-haiku-4-5", name: "Haiku 4.5" },
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

        // Filter blacklisted models (embeddings, TTS, etc.)
        // Note: We no longer apply whitelist filtering for custom providers,
        // allowing users to see all available chat models from their provider.
        const models: ModelInfo[] = rawModels
          .filter((m) => !isBlacklisted(m.id))
          .map((m) => ({
            id: m.id,
            name: m.id,
          }))

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
   * Get recommended models for a provider.
   * Returns the best model for each task category (chat, image, summary)
   * plus a curated list of recommended chat models for "out-of-box" experience.
   */
  getRecommendedModels: publicProcedure
    .input(z.object({ providerId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const env = getEnv()
      let allModels: ModelInfo[] = []

      if (input.providerId === "anthropic") {
        const result = await getAnthropicModels()
        allModels = result.models
      } else {
        // For LiteLLM/Custom, fetch all models (unfiltered) to find image/summary candidates
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
          if (provider) {
            baseUrl = provider.baseUrl
            try { apiKey = decryptApiKey(provider.apiKey) } catch { /* skip */ }
          }
        }

        if (baseUrl) {
          // Try cache first
          const cached = db
            .select()
            .from(cachedModels)
            .where(eq(cachedModels.providerId, input.providerId))
            .all()

          if (cached.length > 0) {
            allModels = cached.map((c) => ({ id: c.modelId, name: c.name }))
          } else {
            try {
              const headers: Record<string, string> = {}
              if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`
              const apiUrl = normalizeApiBaseUrl(baseUrl)
              const response = await fetch(`${apiUrl}/models`, {
                method: "GET",
                headers,
                signal: AbortSignal.timeout(10000),
              })
              if (response.ok) {
                const data = await response.json()
                const rawModels: Array<{ id: string }> = data.data || data.models || []
                allModels = rawModels
                  .filter((m) => !isBlacklisted(m.id))
                  .map((m) => ({ id: m.id, name: m.id }))
              }
            } catch { /* skip */ }
          }
        }
      }

      const allIds = allModels.map((m) => m.id)
      const chatIds = input.providerId === "anthropic"
        ? allIds
        : filterProviderModels(allModels).map((m) => m.id)

      return {
        chatModelId: findDefaultModel(chatIds),
        imageModelId: findImageModel(allIds),
        summaryModelId: findSummaryModel(allIds),
        recommendedChatIds: findRecommendedChatModels(chatIds),
      }
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
