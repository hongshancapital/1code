import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// Custom Claude configuration
export type CustomClaudeConfig = {
  model: string
  token: string
  baseUrl: string
}

// Model profile system
export type ModelProfile = {
  id: string
  name: string
  config: CustomClaudeConfig
  isOffline?: boolean
}

// Selected Ollama model for offline mode
export const selectedOllamaModelAtom = atomWithStorage<string | null>(
  "agents:selected-ollama-model",
  null,
  undefined,
  { getOnInit: true },
)

// Helper to get offline profile with selected model
export const getOfflineProfile = (modelName?: string | null): ModelProfile => ({
  id: 'offline-ollama',
  name: 'Offline (Ollama)',
  isOffline: true,
  config: {
    model: modelName || 'qwen2.5-coder:7b',
    token: 'ollama',
    baseUrl: 'http://localhost:11434',
  },
})

// Predefined offline profile for Ollama (legacy)
export const OFFLINE_PROFILE: ModelProfile = {
  id: 'offline-ollama',
  name: 'Offline (Ollama)',
  isOffline: true,
  config: {
    model: 'qwen2.5-coder:7b',
    token: 'ollama',
    baseUrl: 'http://localhost:11434',
  },
}

// OpenAI API key for voice transcription
export const openaiApiKeyAtom = atomWithStorage<string>(
  "agents:openai-api-key",
  "",
  undefined,
  { getOnInit: true },
)

// @deprecated Use providers system instead
export type OverrideModelMode = "litellm" | "custom" | null
export const overrideModelModeAtom = atomWithStorage<OverrideModelMode>(
  "agents:override-model-mode",
  null,
  undefined,
  { getOnInit: true },
)

// @deprecated Use activeLlmModelIdAtom from model-config.ts instead
export const litellmSelectedModelAtom = atomWithStorage<string>(
  "agents:litellm-selected-model",
  "",
  undefined,
  { getOnInit: true },
)

// @deprecated Use providers.addCustom() tRPC mutation instead
export const customClaudeConfigAtom = atomWithStorage<CustomClaudeConfig>(
  "agents:claude-custom-config",
  {
    model: "",
    token: "",
    baseUrl: "",
  },
  undefined,
  { getOnInit: true },
)

// @deprecated Use providers system instead
export const modelProfilesAtom = atomWithStorage<ModelProfile[]>(
  "agents:model-profiles",
  [OFFLINE_PROFILE],
  undefined,
  { getOnInit: true },
)

// @deprecated Use activeLlmProviderIdAtom from model-config.ts instead
export const activeProfileIdAtom = atomWithStorage<string | null>(
  "agents:active-profile-id",
  null,
  undefined,
  { getOnInit: true },
)

// Auto-fallback to offline mode
export const autoOfflineModeAtom = atomWithStorage<boolean>(
  "agents:auto-offline-mode",
  true,
  undefined,
  { getOnInit: true },
)

// Simulate offline mode (debug)
export const simulateOfflineAtom = atomWithStorage<boolean>(
  "agents:simulate-offline",
  false,
  undefined,
  { getOnInit: true },
)

// Show offline mode UI (debug)
export const showOfflineModeFeaturesAtom = atomWithStorage<boolean>(
  "agents:show-offline-mode-features",
  false,
  undefined,
  { getOnInit: true },
)

// Network status
export const networkOnlineAtom = atom<boolean>(true)

export function normalizeCustomClaudeConfig(
  config: CustomClaudeConfig,
): CustomClaudeConfig | undefined {
  const model = config.model.trim()
  const token = config.token.trim()
  const baseUrl = config.baseUrl.trim()

  if (!model || !token || !baseUrl) return undefined

  return { model, token, baseUrl }
}

// Get active config (considering network status and auto-fallback)
export const activeConfigAtom = atom((get) => {
  const activeProfileId = get(activeProfileIdAtom)
  const profiles = get(modelProfilesAtom)
  const legacyConfig = get(customClaudeConfigAtom)
  const networkOnline = get(networkOnlineAtom)
  const autoOffline = get(autoOfflineModeAtom)

  if (!networkOnline && autoOffline) {
    const offlineProfile = profiles.find(p => p.isOffline)
    if (offlineProfile) {
      return offlineProfile.config
    }
  }

  if (activeProfileId) {
    const profile = profiles.find(p => p.id === activeProfileId)
    if (profile) {
      return profile.config
    }
  }

  const normalized = normalizeCustomClaudeConfig(legacyConfig)
  if (normalized) {
    return normalized
  }

  return undefined
})
