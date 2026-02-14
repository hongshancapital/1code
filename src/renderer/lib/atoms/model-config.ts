/**
 * Unified Model Configuration Atoms
 *
 * This module provides a unified state management for model providers and models.
 * It replaces the scattered atoms (overrideModelModeAtom, litellmSelectedModelAtom, etc.)
 * with a clean Provider + Model architecture.
 *
 * Provider Types:
 * - anthropic: Anthropic OAuth subscription
 * - litellm: LiteLLM proxy (env-configured)
 * - custom: User-defined API endpoints
 *
 * All providers are in a single unified list (no category separation).
 */

import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"
import { atomFamily } from "jotai/utils"

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

export interface ModelSelection {
  providerId: string
  modelId: string
}

// ============ Provider Configuration ============

/**
 * Active Provider ID
 * - null or "anthropic": Use Anthropic OAuth (default)
 * - "litellm": Use LiteLLM proxy
 * - other: Custom provider ID
 */
export const activeProviderIdAtom = atomWithStorage<string | null>(
  "models:active-provider-id",
  "litellm",
  undefined,
  { getOnInit: true },
)

/**
 * Active Model ID for the current provider
 * - null: Use provider's default model
 * - string: Specific model ID
 */
export const activeModelIdAtom = atomWithStorage<string | null>(
  "models:active-model-id",
  null,
  undefined,
  { getOnInit: true },
)

// ============ Multi-Provider Enable/Disable ============

/**
 * Set of enabled provider IDs.
 * Multiple providers can be enabled simultaneously.
 * Stored as an array in localStorage, used as a Set in code.
 * Default: ["litellm"] — LiteLLM is enabled by default; Anthropic requires account linking.
 */
export const enabledProviderIdsAtom = atomWithStorage<string[]>(
  "models:enabled-provider-ids",
  ["litellm"],
  undefined,
  { getOnInit: true },
)

/**
 * Check if a specific provider is enabled
 */
export const isProviderEnabledFamily = atomFamily((providerId: string) =>
  atom((get) => {
    const enabledIds = get(enabledProviderIdsAtom)
    return enabledIds.includes(providerId)
  }),
)

/**
 * Toggle a provider's enabled state
 */
export const toggleProviderEnabledAtom = atom(
  null,
  (get, set, providerId: string) => {
    const current = get(enabledProviderIdsAtom)
    const isEnabled = current.includes(providerId)
    if (isEnabled) {
      // Don't allow disabling the last provider
      if (current.length <= 1) return
      set(enabledProviderIdsAtom, current.filter((id) => id !== providerId))
      // If we disabled the active provider, switch to the first remaining
      const activeId = get(activeProviderIdAtom) || "litellm"
      if (activeId === providerId) {
        const remaining = current.filter((id) => id !== providerId)
        set(activeProviderIdAtom, remaining[0] === "anthropic" ? null : remaining[0]!)
        set(activeModelIdAtom, null)
      }
    } else {
      set(enabledProviderIdsAtom, [...current, providerId])
    }
  },
)

// ============ Per-Provider Enabled Models ============

/**
 * Enabled models per provider.
 * Key: providerId, Value: array of enabled model IDs.
 * Only models in this list are shown in the chat input model selector.
 * Stored in localStorage.
 */
export const enabledModelsPerProviderAtom = atomWithStorage<Record<string, string[]>>(
  "models:enabled-models-per-provider",
  {},
  undefined,
  { getOnInit: true },
)

/**
 * Toggle a model's enabled state for a given provider.
 * Returns new enabled state.
 */
export const toggleModelEnabledAtom = atom(
  null,
  (get, set, { providerId, modelId }: { providerId: string; modelId: string }) => {
    const current = get(enabledModelsPerProviderAtom)
    const providerModels = current[providerId] || []
    const isEnabled = providerModels.includes(modelId)

    if (isEnabled) {
      // Remove model
      const updated = providerModels.filter((id) => id !== modelId)
      set(enabledModelsPerProviderAtom, { ...current, [providerId]: updated })
      // If removing the active model for this provider, clear activeModelId
      const activeProvider = get(activeProviderIdAtom) || "litellm"
      const activeModel = get(activeModelIdAtom)
      if (activeProvider === providerId && activeModel === modelId) {
        set(activeModelIdAtom, updated[0] || null)
      }
    } else {
      // Add model
      set(enabledModelsPerProviderAtom, { ...current, [providerId]: [...providerModels, modelId] })
    }
  },
)

// ============ Image Model Configuration ============

/**
 * Active Image Provider ID
 * - null: No image provider configured
 * - string: Provider ID from the enabled providers list
 */
export const imageProviderIdAtom = atomWithStorage<string | null>(
  "models:image-provider-id",
  null,
  undefined,
  { getOnInit: true },
)

/**
 * Active Image Model ID
 * - null: No image model selected
 * - string: Specific model ID from the image provider
 */
export const imageModelIdAtom = atomWithStorage<string | null>(
  "models:image-model-id",
  null,
  undefined,
  { getOnInit: true },
)

// ============ Summary Model Configuration ============

/**
 * Active Summary Provider ID
 * Used for lightweight AI calls: sub-chat name generation, commit message generation
 * - null: No summary provider configured (falls back to hongshan.com API)
 * - string: Provider ID from the enabled providers list
 */
export const summaryProviderIdAtom = atomWithStorage<string | null>(
  "models:summary-provider-id",
  null,
  undefined,
  { getOnInit: true },
)

/**
 * Active Summary Model ID
 * - null: No summary model selected
 * - string: Specific model ID from the summary provider
 */
export const summaryModelIdAtom = atomWithStorage<string | null>(
  "models:summary-model-id",
  null,
  undefined,
  { getOnInit: true },
)

// ============ Agent Mode Model Configuration ============

/**
 * Agent Mode Provider ID
 * - null: Use Default Model (activeProviderIdAtom)
 * - string: Specific provider for agent mode
 */
export const agentModeProviderIdAtom = atomWithStorage<string | null>(
  "models:agent-mode-provider-id",
  null,
  undefined,
  { getOnInit: true },
)

/**
 * Agent Mode Model ID
 * - null: Use Default Model (activeModelIdAtom)
 * - string: Specific model for agent mode
 */
export const agentModeModelIdAtom = atomWithStorage<string | null>(
  "models:agent-mode-model-id",
  null,
  undefined,
  { getOnInit: true },
)

// ============ Plan Mode Model Configuration ============

/**
 * Plan Mode Provider ID
 * - null: Use Default Model (activeProviderIdAtom)
 * - string: Specific provider for plan mode
 */
export const planModeProviderIdAtom = atomWithStorage<string | null>(
  "models:plan-mode-provider-id",
  null,
  undefined,
  { getOnInit: true },
)

/**
 * Plan Mode Model ID
 * - null: Use Default Model (activeModelIdAtom)
 * - string: Specific model for plan mode
 */
export const planModeModelIdAtom = atomWithStorage<string | null>(
  "models:plan-mode-model-id",
  null,
  undefined,
  { getOnInit: true },
)

// ============ Research Mode Model Configuration ============

/**
 * Research Mode Provider ID
 * - null: Use Default Model (activeProviderIdAtom)
 * - string: Specific provider for research mode
 */
export const researchModeProviderIdAtom = atomWithStorage<string | null>(
  "models:research-mode-provider-id",
  null,
  undefined,
  { getOnInit: true },
)

/**
 * Research Mode Model ID
 * - null: Use Default Model (activeModelIdAtom)
 * - string: Specific model for research mode
 */
export const researchModeModelIdAtom = atomWithStorage<string | null>(
  "models:research-mode-model-id",
  null,
  undefined,
  { getOnInit: true },
)

// ============ Legacy aliases (backwards compatibility) ============

/** @deprecated Use activeProviderIdAtom */
export const activeLlmProviderIdAtom = activeProviderIdAtom
/** @deprecated Use activeModelIdAtom */
export const activeLlmModelIdAtom = activeModelIdAtom

// ============ Per-Chat Model Persistence ============

/**
 * Per-chat model selections (persisted to localStorage)
 * Key: chatId, Value: { providerId, modelId }
 * Used to restore model when switching back to an existing chat.
 */
export const chatModelSelectionsAtom = atomWithStorage<Record<string, ModelSelection>>(
  "models:chat-selections",
  {},
  undefined,
  { getOnInit: true },
)

// ============ Per-SubChat Model Persistence ============

/**
 * Per-subChat model selections (persisted to localStorage)
 * Key: subChatId, Value: { providerId, modelId }
 * Each sub-chat remembers its own model independently.
 */
export const subChatModelSelectionsAtom = atomWithStorage<Record<string, ModelSelection>>(
  "models:subchat-selections",
  {},
  undefined,
  { getOnInit: true },
)

// ============ Session Model Override (Chat-time switching) ============

/**
 * Temporary model override for the current chat session
 * - When set, overrides the global provider/model settings
 * - Not persisted (resets on page refresh or new chat)
 * - Allows users to switch models during a conversation
 */
export const sessionModelOverrideAtom = atom<ModelSelection | null>(null)

/**
 * Effective selection (considering session override)
 * Use this in chat transport to get the actual provider/model to use
 */
export const effectiveLlmSelectionAtom = atom((get) => {
  const override = get(sessionModelOverrideAtom)
  if (override) {
    return override
  }

  const providerId = get(activeProviderIdAtom) || "litellm"
  const modelId = get(activeModelIdAtom)

  return {
    providerId,
    modelId: modelId || null, // null means use provider default
  }
})

// ============ Provider Models Cache ============

/**
 * Cached models list per provider
 * Key: providerId
 * Value: Array of ModelInfo
 * This is populated by tRPC queries and used for UI selection
 */
export const providerModelsAtom = atom<Record<string, ModelInfo[]>>({})

/**
 * Get models for a specific provider
 */
export const providerModelsFamily = atomFamily((providerId: string) =>
  atom((get) => {
    const allModels = get(providerModelsAtom)
    return allModels[providerId] || []
  }),
)

/**
 * Strip trailing date suffix (YYYYMMDD) from model ID to get base ID.
 * e.g. "claude-opus-4-6-20250610" → "claude-opus-4-6"
 */
function getBaseModelId(id: string): string {
  return id.replace(/-\d{8}$/, "")
}

/**
 * Update models for a specific provider.
 * Also reconciles enabledModelsPerProvider: migrates stale IDs
 * (e.g. dated → non-dated or vice versa) to match the current model list.
 */
export const updateProviderModelsAtom = atom(
  null,
  (get, set, { providerId, models }: { providerId: string; models: ModelInfo[] }) => {
    const current = get(providerModelsAtom)
    set(providerModelsAtom, {
      ...current,
      [providerId]: models,
    })

    // Reconcile enabled models: migrate old IDs to current ones
    const enabledMap = get(enabledModelsPerProviderAtom)
    const enabledIds = enabledMap[providerId]
    if (!enabledIds || enabledIds.length === 0) return

    const currentModelIds = new Set(models.map((m) => m.id))
    // Build base→currentId lookup for fuzzy matching
    const baseToCurrentId = new Map<string, string>()
    for (const m of models) {
      baseToCurrentId.set(getBaseModelId(m.id), m.id)
    }

    let changed = false
    const reconciled = enabledIds
      .map((id) => {
        // Exact match — keep as-is
        if (currentModelIds.has(id)) return id
        // Try base-ID match (dated ↔ non-dated migration)
        const mapped = baseToCurrentId.get(getBaseModelId(id))
        if (mapped) {
          changed = true
          return mapped
        }
        // No match — stale entry, remove
        changed = true
        return null
      })
      .filter((id): id is string => id !== null)

    // Deduplicate (in case old + new both resolved to the same current ID)
    const deduped = [...new Set(reconciled)]
    if (changed || deduped.length !== enabledIds.length) {
      set(enabledModelsPerProviderAtom, { ...enabledMap, [providerId]: deduped })
    }
  },
)

// ============ Derived Atoms ============

/**
 * Available models for the current active provider
 */
export const availableModelsAtom = atom((get) => {
  const providerId = get(activeProviderIdAtom) || "litellm"
  const allModels = get(providerModelsAtom)
  return allModels[providerId] || []
})

// ============ Auto-populate Recommended Models ============

/**
 * Auto-populate recommended models for a provider.
 * Only fills when the provider has no enabled models configured yet (first-time setup).
 * This powers the "out-of-box" experience — users get a curated model list immediately.
 */
export const autoPopulateRecommendedModelsAtom = atom(
  null,
  (get, set, { providerId, recommendedIds }: { providerId: string; recommendedIds: string[] }) => {
    const current = get(enabledModelsPerProviderAtom)
    // Only auto-fill if this provider has NO configured models yet
    if (!current[providerId] || current[providerId].length === 0) {
      set(enabledModelsPerProviderAtom, { ...current, [providerId]: recommendedIds })
    }
  },
)

/**
 * Auto-select task-specific models (image, summary) if not already configured.
 * Called after fetching recommended models for a provider.
 * Respects user's manual selections — never overwrites existing choices.
 */
export const autoSelectTaskModelsAtom = atom(
  null,
  (get, set, { providerId, imageModelId, summaryModelId }: {
    providerId: string
    imageModelId: string | null
    summaryModelId: string | null
  }) => {
    // Auto-fill image model only if user hasn't set one
    if (!get(imageProviderIdAtom) && !get(imageModelIdAtom) && imageModelId) {
      set(imageProviderIdAtom, providerId)
      set(imageModelIdAtom, imageModelId)
    }
    // Auto-fill summary model only if user hasn't set one
    if (!get(summaryProviderIdAtom) && !get(summaryModelIdAtom) && summaryModelId) {
      set(summaryProviderIdAtom, providerId)
      set(summaryModelIdAtom, summaryModelId)
    }
  },
)

// ============ Migration Support ============

const MIGRATION_KEY = "models:migration-v2-done"

export function isMigrationDone(): boolean {
  if (typeof window === "undefined") return true
  return localStorage.getItem(MIGRATION_KEY) === "true"
}

export function markMigrationDone(): void {
  if (typeof window === "undefined") return
  localStorage.setItem(MIGRATION_KEY, "true")
}

/**
 * Migrate from old atoms to new model config system
 * Call this once in App.tsx on startup
 */
export function migrateOldModelConfig(): void {
  if (typeof window === "undefined") return
  if (isMigrationDone()) return

  try {
    const oldModeRaw = localStorage.getItem("agents:override-model-mode")
    const oldLitellmModel = localStorage.getItem("agents:litellm-selected-model")
    const oldCustomConfig = localStorage.getItem("agents:claude-custom-config")

    let oldMode: string | null = null
    if (oldModeRaw) {
      try {
        oldMode = JSON.parse(oldModeRaw)
      } catch {
        // Invalid JSON, skip
      }
    }

    if (oldMode === "litellm") {
      localStorage.setItem(
        "models:active-provider-id",
        JSON.stringify("litellm"),
      )

      if (oldLitellmModel) {
        try {
          const model = JSON.parse(oldLitellmModel)
          if (model) {
            localStorage.setItem(
              "models:active-model-id",
              JSON.stringify(model),
            )
          }
        } catch {
          // Invalid JSON, skip
        }
      }

      console.log("[model-config] Migrated from litellm mode")
    } else if (oldMode === "custom" && oldCustomConfig) {
      localStorage.setItem("models:pending-custom-migration", oldCustomConfig)
      console.log("[model-config] Pending custom provider migration")
    }

    markMigrationDone()
    console.log("[model-config] Migration completed")
  } catch (error) {
    console.error("[model-config] Migration failed:", error)
    markMigrationDone()
  }
}

export function getPendingCustomMigration(): {
  model: string
  token: string
  baseUrl: string
} | null {
  if (typeof window === "undefined") return null

  const pending = localStorage.getItem("models:pending-custom-migration")
  if (!pending) return null

  try {
    const config = JSON.parse(pending)
    if (config.model && config.token && config.baseUrl) {
      return config
    }
  } catch {
    // Invalid JSON
  }

  return null
}

export function clearPendingCustomMigration(): void {
  if (typeof window === "undefined") return
  localStorage.removeItem("models:pending-custom-migration")
}
