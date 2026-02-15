/**
 * Voice TRPC router
 * Provides voice-to-text transcription using:
 * 1. Local whisper-cli (offline, privacy-first)
 * 2. OpenAI Whisper API (cloud fallback)
 *
 * Priority: local whisper → OpenAI API
 */

import { execSync } from "node:child_process"
import os from "node:os"
import { z } from "zod"
import { publicProcedure, router } from "../index"

// Import local whisper module
import {
  transcribeLocalAudio,
  isWhisperBinaryAvailable,
  isFfmpegBinaryAvailable,
  isModelDownloaded,
  WHISPER_MODELS,
  type WhisperModelId,
} from "../../whisper"
import { isTranscriptionAvailable } from "../../whisper/transcriber"
import {
  getAllModelStatus,
  getModelStatus,
  downloadModel as downloadWhisperModel,
  cancelDownload as cancelWhisperDownload,
  deleteModel as deleteWhisperModel,
  getFirstAvailableModel,
} from "../../whisper/model-manager"

// Max audio size: 25MB (Whisper API limit)
const MAX_AUDIO_SIZE = 25 * 1024 * 1024

// API request timeout: 30 seconds
const API_TIMEOUT_MS = 30000

// Voice transcription provider preference
// 'auto' = try local first, fall back to OpenAI
// 'local' = only use local whisper
// 'openai' = only use OpenAI API
type VoiceProvider = "auto" | "local" | "openai"

// User preferences (stored in memory, should be persisted via settings)
let preferredProvider: VoiceProvider = "auto"
let preferredModelId: WhisperModelId = "tiny"
let preferredLanguage: string | null = null // null = auto-detect

// Commonly used languages for voice input (Whisper supports many more)
// Note: Whisper uses ISO 639-1 codes. For Chinese variants, we use "zh" internally
// but can influence output via initial prompt text
const SUPPORTED_LANGUAGES = [
  { code: "auto", name: "Auto-detect" },
  { code: "en", name: "English" },
  { code: "zh", name: "Chinese (中文)" },
  { code: "zh-CN", name: "Simplified (简体中文)" },
  { code: "zh-TW", name: "Traditional (繁體中文)" },
  { code: "ja", name: "Japanese (日本語)" },
  { code: "ko", name: "Korean (한국어)" },
  { code: "es", name: "Spanish (Español)" },
  { code: "fr", name: "French (Français)" },
  { code: "de", name: "German (Deutsch)" },
  { code: "ru", name: "Russian (Русский)" },
  { code: "pt", name: "Portuguese (Português)" },
  { code: "it", name: "Italian (Italiano)" },
  { code: "nl", name: "Dutch (Nederlands)" },
  { code: "ar", name: "Arabic (العربية)" },
  { code: "hi", name: "Hindi (हिन्दी)" },
  { code: "th", name: "Thai (ไทย)" },
  { code: "vi", name: "Vietnamese (Tiếng Việt)" },
] as const

/**
 * Clean up transcribed text
 * - Remove leading/trailing whitespace
 * - Collapse multiple spaces/newlines into single space
 * - Remove any weird unicode whitespace characters
 * - Remove zero-width characters and other invisible unicode
 */
function cleanTranscribedText(text: string): string {
  return (
    text
      // Remove zero-width and invisible characters
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
      // Normalize unicode whitespace to regular space
      .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, " ")
      // Replace all types of newlines and line breaks with space
      .replace(/[\r\n\u2028\u2029]+/g, " ")
      // Replace tabs with space
      .replace(/\t+/g, " ")
      // Collapse multiple spaces into one
      .replace(/ +/g, " ")
      // Trim leading/trailing whitespace
      .trim()
  )
}

// Cache for OpenAI API key
let cachedOpenAIKey: string | null | undefined = undefined

// User-configured OpenAI API key (from settings, set via IPC)
let userConfiguredOpenAIKey: string | null = null

/**
 * Set OpenAI API key from user settings
 * Called from renderer via tRPC
 */
export function setUserOpenAIKey(key: string | null): void {
  userConfiguredOpenAIKey = key?.trim() || null
  // Clear env cache so next call re-evaluates
  cachedOpenAIKey = undefined
}


/**
 * Get OpenAI API key from multiple sources (priority order):
 * 1. User-configured key from settings
 * 2. Vite env vars (.env.local files)
 * 3. process.env
 * 4. Shell environment
 */
function getOpenAIApiKey(): string | null {
  // First check user-configured key (highest priority, not cached)
  if (userConfiguredOpenAIKey && userConfiguredOpenAIKey.startsWith("sk-")) {
    return userConfiguredOpenAIKey
  }

  // Return cached value if already fetched from env
  if (cachedOpenAIKey !== undefined) {
    return cachedOpenAIKey
  }

  // Check Vite env vars (works with .env.local files)
  const viteKey = (import.meta.env as Record<string, string | undefined>)
    .MAIN_VITE_OPENAI_API_KEY
  if (viteKey) {
    cachedOpenAIKey = viteKey
    console.log(
      "[Voice] Using OPENAI_API_KEY from Vite env (MAIN_VITE_OPENAI_API_KEY)"
    )
    return cachedOpenAIKey
  }

  // Check process.env (works in dev mode)
  if (process.env.OPENAI_API_KEY) {
    cachedOpenAIKey = process.env.OPENAI_API_KEY
    console.log("[Voice] Using OPENAI_API_KEY from process.env")
    return cachedOpenAIKey
  }

  // Try to get from shell environment (for production builds)
  // Skip on Windows - shell invocation doesn't work the same way
  if (process.platform !== "win32") {
    try {
      const shell = process.env.SHELL || "/bin/zsh"
      const result = execSync(`${shell} -ilc 'echo $OPENAI_API_KEY'`, {
        encoding: "utf8",
        timeout: 15000,
        env: {
          HOME: os.homedir(),
          USER: os.userInfo().username,
          SHELL: shell,
        } as unknown as NodeJS.ProcessEnv,
      })

      const key = result.trim()
      if (key && key !== "$OPENAI_API_KEY" && key.startsWith("sk-")) {
        cachedOpenAIKey = key
        console.log("[Voice] Using OPENAI_API_KEY from shell environment")
        return cachedOpenAIKey
      }
    } catch (err) {
      console.error("[Voice] Failed to read OPENAI_API_KEY from shell:", err)
    }
  }

  cachedOpenAIKey = null
  return null
}

/**
 * Clear cached API key (for testing)
 */
export function clearOpenAIKeyCache(): void {
  cachedOpenAIKey = undefined
}

/**
 * Transcribe audio using OpenAI Whisper API directly (for open-source users)
 */
async function transcribeWithWhisper(
  audioBuffer: Buffer,
  format: string,
  language?: string
): Promise<string> {
  const key = getOpenAIApiKey()
  if (!key) {
    throw new Error(
      "OpenAI API key not configured. Set OPENAI_API_KEY environment variable."
    )
  }

  // Check audio size limit
  if (audioBuffer.length > MAX_AUDIO_SIZE) {
    throw new Error(
      `Audio too large (${Math.round(audioBuffer.length / 1024 / 1024)}MB). Maximum is 25MB.`
    )
  }

  // Create form data for the API request
  const formData = new FormData()

  // Convert buffer to blob (need to convert to Uint8Array for Blob constructor)
  const uint8Array = new Uint8Array(audioBuffer)
  const blob = new Blob([uint8Array], { type: `audio/${format}` })
  formData.append("file", blob, `audio.${format}`)
  formData.append("model", "whisper-1")
  formData.append("response_format", "text")

  // Handle Chinese variants - Whisper only supports "zh" but we can influence
  // output via prompt to prefer simplified or traditional characters
  let prompt: string | undefined
  if (language === "zh-CN" || language === "zh-Simplified") {
    // Map to standard code but add prompt for simplified Chinese
    formData.append("language", "zh")
    prompt = "请使用简体中文输出"
  } else if (language === "zh-TW" || language === "zh-Traditional") {
    // Map to standard code but add prompt for traditional Chinese
    formData.append("language", "zh")
    prompt = "請使用繁體中文輸出"
  } else if (language) {
    formData.append("language", language)
  }

  // Add prompt if set (guides the model to use specific script/vocabulary)
  if (prompt) {
    formData.append("prompt", prompt)
  }

  // Create abort controller for timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

  try {
    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
        },
        body: formData,
        signal: controller.signal,
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[Voice] Whisper API error:", response.status, errorText)

      // Provide user-friendly error messages
      if (response.status === 401) {
        throw new Error("Invalid OpenAI API key")
      } else if (response.status === 429) {
        throw new Error("Rate limit exceeded. Please try again later.")
      } else if (response.status >= 500) {
        throw new Error("OpenAI service temporarily unavailable")
      }
      throw new Error(`Transcription failed (${response.status})`)
    }

    const text = await response.text()
    return cleanTranscribedText(text)
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Transcription timed out. Please try again.", { cause: err })
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
}

export const voiceRouter = router({
  /**
   * Transcribe audio to text
   * Priority: local whisper → OpenAI API (based on provider setting)
   */
  transcribe: publicProcedure
    .input(
      z.object({
        audio: z.string(), // base64 encoded audio
        format: z.enum(["webm", "wav", "mp3", "m4a", "ogg"]).default("webm"),
        language: z.string().optional(), // ISO 639-1 code (e.g., "en", "zh")
        provider: z.enum(["auto", "local", "openai"]).optional(), // Override preference
        modelId: z.enum(["tiny", "base", "small"]).optional(), // Override model for this request (useful for interim transcription)
      })
    )
    .mutation(async ({ input }) => {
      const audioBuffer = Buffer.from(input.audio, "base64")
      const provider = input.provider || preferredProvider
      const language = input.language || preferredLanguage || undefined
      // Use specified model or fall back to preferred/default
      let modelId = input.modelId || getFirstAvailableModel() || preferredModelId

      // If a specific model was requested but not downloaded, fall back to an available model
      if (input.modelId && !isModelDownloaded(input.modelId)) {
        console.warn(`[Voice] Requested model '${input.modelId}' not downloaded, falling back to available model`)
        modelId = getFirstAvailableModel() || preferredModelId
      }

      console.log(
        `[Voice] Transcribing ${audioBuffer.length} bytes of ${input.format} audio (provider: ${provider}, model: ${modelId})`
      )

      // Check audio size limit
      if (audioBuffer.length > MAX_AUDIO_SIZE) {
        throw new Error(
          `Audio too large (${Math.round(audioBuffer.length / 1024 / 1024)}MB). Maximum is 25MB.`
        )
      }

      // Try local whisper first (if enabled)
      if (provider === "local" || provider === "auto") {
        const localStatus = isTranscriptionAvailable()

        if (localStatus.available) {
          try {
            console.log(`[Voice] Using local whisper with model: ${modelId}`)

            const result = await transcribeLocalAudio(audioBuffer, input.format, {
              modelId,
              language,
            })

            console.log(`[Voice] Local transcription: "${result.text.slice(0, 100)}..." (${result.processingTime}ms)`)

            return {
              text: cleanTranscribedText(result.text),
              provider: "local" as const,
              processingTime: result.processingTime,
              detectedLanguage: result.detectedLanguage,
            }
          } catch (err) {
            console.error("[Voice] Local whisper failed:", err)

            // If provider is 'local', don't fall back
            if (provider === "local") {
              throw new Error(`Local transcription failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
            }

            // Fall through to OpenAI
            console.log("[Voice] Falling back to OpenAI API")
          }
        } else if (provider === "local") {
          throw new Error(`Local whisper not available: ${localStatus.reason}`)
        }
      }

      // Try OpenAI API
      if (provider === "openai" || provider === "auto") {
        const hasLocalKey = !!getOpenAIApiKey()

        if (hasLocalKey) {
          const text = await transcribeWithWhisper(
            audioBuffer,
            input.format,
            language
          )
          console.log(`[Voice] OpenAI transcription result: "${text.slice(0, 100)}..."`)
          return {
            text,
            provider: "openai" as const,
          }
        }

        if (provider === "openai") {
          throw new Error("OpenAI API key not configured. Set OPENAI_API_KEY in Settings > Models.")
        }
      }

      // No transcription method available
      throw new Error(
        "Voice transcription not available. Download a whisper model or configure an OpenAI API key."
      )
    }),

  /**
   * Check if voice transcription is available
   * Available if: has local whisper model OR OpenAI API key
   */
  isAvailable: publicProcedure.query(async () => {
    const localStatus = isTranscriptionAvailable()
    const hasOpenAIKey = !!getOpenAIApiKey()

    // Local whisper available
    if (localStatus.available) {
      return {
        available: true,
        method: "local" as const,
        hasLocalWhisper: true,
        hasOpenAI: hasOpenAIKey,
        reason: undefined,
      }
    }

    // OpenAI API key available
    if (hasOpenAIKey) {
      return {
        available: true,
        method: "openai" as const,
        hasLocalWhisper: false,
        hasOpenAI: true,
        reason: undefined,
      }
    }

    // Neither available
    return {
      available: false,
      method: null,
      hasLocalWhisper: false,
      hasOpenAI: false,
      reason: localStatus.reason || "Download a whisper model or add OpenAI API key in Settings",
    }
  }),

  /**
   * Set OpenAI API key from user settings
   * This allows users without a paid subscription to use their own API key
   */
  setOpenAIKey: publicProcedure
    .input(z.object({ key: z.string() }))
    .mutation(({ input }) => {
      const key = input.key.trim()

      // Validate key format if provided
      if (key && !key.startsWith("sk-")) {
        throw new Error("Invalid OpenAI API key format. Key should start with 'sk-'")
      }

      setUserOpenAIKey(key || null)

      return { success: true }
    }),

  /**
   * Check if user has configured an OpenAI API key
   */
  hasOpenAIKey: publicProcedure.query(() => {
    return { hasKey: !!getOpenAIApiKey() }
  }),

  // ===========================================
  // Local Whisper Management
  // ===========================================

  /**
   * Get comprehensive whisper status
   * Returns binary availability, model status, and current configuration
   */
  whisperStatus: publicProcedure.query(() => {
    const binaryAvailable = isWhisperBinaryAvailable()
    const ffmpegAvailable = isFfmpegBinaryAvailable()
    const models = getAllModelStatus()
    const transcriptionStatus = isTranscriptionAvailable()

    return {
      binaryAvailable,
      ffmpegAvailable,
      ready: transcriptionStatus.available,
      readyReason: transcriptionStatus.reason,
      models,
      config: {
        provider: preferredProvider,
        modelId: preferredModelId,
        language: preferredLanguage,
      },
      availableModels: Object.keys(WHISPER_MODELS) as WhisperModelId[],
    }
  }),

  /**
   * Get status of a specific model
   */
  getModelStatus: publicProcedure
    .input(z.object({ modelId: z.enum(["tiny", "base", "small"]) }))
    .query(({ input }) => {
      return getModelStatus(input.modelId)
    }),

  /**
   * Download a whisper model
   * Progress is tracked internally and can be queried via getModelStatus
   */
  downloadModel: publicProcedure
    .input(z.object({ modelId: z.enum(["tiny", "base", "small"]) }))
    .mutation(async ({ input }) => {
      const model = WHISPER_MODELS[input.modelId]
      if (!model) {
        throw new Error(`Unknown model: ${input.modelId}`)
      }

      // Check if already downloaded
      if (isModelDownloaded(input.modelId)) {
        return { success: true, alreadyDownloaded: true }
      }

      console.log(`[Voice] Starting download of model: ${input.modelId}`)

      try {
        await downloadWhisperModel(input.modelId, (progress) => {
          // Progress is tracked in model-manager, can be queried via getModelStatus
          if (progress % 20 === 0) {
            console.log(`[Voice] Download progress for ${input.modelId}: ${progress}%`)
          }
        })

        return { success: true, alreadyDownloaded: false }
      } catch (err) {
        console.error(`[Voice] Failed to download model ${input.modelId}:`, err)
        throw new Error(`Download failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err })
      }
    }),

  /**
   * Cancel an active model download
   */
  cancelDownload: publicProcedure
    .input(z.object({ modelId: z.enum(["tiny", "base", "small"]) }))
    .mutation(({ input }) => {
      const cancelled = cancelWhisperDownload(input.modelId)
      return { success: cancelled }
    }),

  /**
   * Delete a downloaded model
   */
  deleteModel: publicProcedure
    .input(z.object({ modelId: z.enum(["tiny", "base", "small"]) }))
    .mutation(({ input }) => {
      const deleted = deleteWhisperModel(input.modelId)
      return { success: deleted }
    }),

  /**
   * Set whisper configuration
   */
  setWhisperConfig: publicProcedure
    .input(
      z.object({
        provider: z.enum(["auto", "local", "openai"]).optional(),
        modelId: z.enum(["tiny", "base", "small"]).optional(),
        language: z.string().nullable().optional(), // null for auto-detect
      })
    )
    .mutation(({ input }) => {
      if (input.provider !== undefined) {
        preferredProvider = input.provider
      }
      if (input.modelId !== undefined) {
        preferredModelId = input.modelId
      }
      if (input.language !== undefined) {
        preferredLanguage = input.language
      }

      console.log(`[Voice] Config updated: provider=${preferredProvider}, model=${preferredModelId}, language=${preferredLanguage || "auto"}`)

      return {
        provider: preferredProvider,
        modelId: preferredModelId,
        language: preferredLanguage,
      }
    }),

  /**
   * Get current whisper configuration
   */
  getWhisperConfig: publicProcedure.query(() => {
    return {
      provider: preferredProvider,
      modelId: preferredModelId,
      language: preferredLanguage,
      availableLanguages: SUPPORTED_LANGUAGES,
    }
  }),
})
