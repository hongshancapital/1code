"use client"

import { useSetAtom, useAtom } from "jotai"
import { useState, useEffect, useCallback } from "react"
import { ArrowLeft, Loader2, RefreshCw, AlertCircle, X, Info } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import {
  billingMethodAtom,
  litellmConfigAtom,
  litellmOnboardingCompletedAtom,
  customClaudeConfigAtom,
  overrideModelModeAtom,
  litellmSelectedModelAtom,
  activeProviderIdAtom,
  activeModelIdAtom,
  enabledProviderIdsAtom,
  autoPopulateRecommendedModelsAtom,
  autoSelectTaskModelsAtom,
} from "../../lib/atoms"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"
import { createLogger } from "../../lib/logger"

const liteLLMLog = createLogger("LiteLLM-Onboarding")

export function LiteLLMOnboardingPage() {
  const { t } = useTranslation('onboarding')
  const trpcUtils = trpc.useUtils()

  // --- tRPC: env-based LiteLLM config ---
  const { data: envConfig } = trpc.litellm.getConfig.useQuery()

  // --- Local form state ---
  const [baseUrl, setBaseUrl] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [selectedModel, setSelectedModel] = useState("")
  const [envInitialized, setEnvInitialized] = useState(false)

  // Pre-fill from env config on first load
  useEffect(() => {
    if (envConfig && !envInitialized) {
      if (envConfig.baseUrl) {
        setBaseUrl(envConfig.baseUrl)
      }
      setEnvInitialized(true)
    }
  }, [envConfig, envInitialized])

  // Determine if the user-entered URL matches the env-configured URL
  const isUsingEnvUrl = envConfig?.baseUrl
    ? normalizeUrl(baseUrl) === normalizeUrl(envConfig.baseUrl)
    : false

  // --- tRPC: fetch models via unified provider system (only works with env URL) ---
  const {
    data: providerModels,
    isLoading: isLoadingProviderModels,
    error: providerModelsError,
  } = trpc.providers.getModels.useQuery(
    { providerId: "litellm", forceRefresh: false },
    { enabled: isUsingEnvUrl && envInitialized },
  )

  // --- tRPC: get recommended models ---
  const { data: recommended } = trpc.providers.getRecommendedModels.useQuery(
    { providerId: "litellm" },
    { enabled: isUsingEnvUrl && envInitialized },
  )

  // --- Manual fetch for custom URLs (non-env) ---
  const [manualModels, setManualModels] = useState<Array<{ id: string }>>([])
  const [isLoadingManual, setIsLoadingManual] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualLoaded, setManualLoaded] = useState(false)

  const fetchModelsManually = useCallback(async () => {
    const normalizedUrl = normalizeUrl(baseUrl)
    if (!normalizedUrl) return

    setIsLoadingManual(true)
    setManualError(null)

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`

      const response = await fetch(`${normalizedUrl}/models`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      const modelList: Array<{ id: string }> = data.data || data.models || []
      setManualModels(modelList)
      setManualLoaded(true)

      if (modelList.length > 0 && !selectedModel) {
        setSelectedModel(modelList[0].id)
      }
    } catch (error) {
      liteLLMLog.error("Failed to fetch models manually:", error)
      setManualError(error instanceof Error ? error.message : t('litellm.connectionFailed'))
      setManualModels([])
    } finally {
      setIsLoadingManual(false)
    }
  }, [baseUrl, apiKey, selectedModel, t])

  // Auto-fetch when using custom URL (debounced)
  useEffect(() => {
    if (isUsingEnvUrl || !baseUrl || !envInitialized) return

    const timer = setTimeout(() => {
      fetchModelsManually()
    }, 600)

    return () => clearTimeout(timer)
  }, [baseUrl, apiKey, isUsingEnvUrl, envInitialized, fetchModelsManually])

  // --- Derive display data based on mode ---
  const models = isUsingEnvUrl
    ? (providerModels?.models ?? [])
    : manualModels
  const isLoading = isUsingEnvUrl ? isLoadingProviderModels : isLoadingManual
  const modelsError = isUsingEnvUrl
    ? (providerModelsError?.message ?? null)
    : manualError
  const hasLoadedModels = isUsingEnvUrl
    ? (providerModels !== undefined)
    : manualLoaded

  // Auto-select recommended default model
  useEffect(() => {
    if (recommended?.chatModelId && !selectedModel && isUsingEnvUrl) {
      setSelectedModel(recommended.chatModelId)
    }
  }, [recommended?.chatModelId, selectedModel, isUsingEnvUrl])

  // Auto-select first model when manual models loaded
  useEffect(() => {
    if (!isUsingEnvUrl && manualModels.length > 0 && !selectedModel) {
      setSelectedModel(manualModels[0].id)
    }
  }, [isUsingEnvUrl, manualModels, selectedModel])

  // --- Atom setters ---
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const setLitellmOnboardingCompleted = useSetAtom(litellmOnboardingCompletedAtom)

  // Unified provider system
  const setActiveProviderId = useSetAtom(activeProviderIdAtom)
  const setActiveModelId = useSetAtom(activeModelIdAtom)
  const [enabledProviderIds, setEnabledProviderIds] = useAtom(enabledProviderIdsAtom)
  const autoPopulate = useSetAtom(autoPopulateRecommendedModelsAtom)
  const autoSelectTasks = useSetAtom(autoSelectTaskModelsAtom)

  // Backward compat atoms (TODO: remove after consumers migrate to unified provider system)
  const setLitellmConfig = useSetAtom(litellmConfigAtom)
  const setCustomClaudeConfig = useSetAtom(customClaudeConfigAtom)
  const setOverrideModelMode = useSetAtom(overrideModelModeAtom)
  const setLitellmSelectedModel = useSetAtom(litellmSelectedModelAtom)

  const handleBack = () => {
    setBillingMethod(null)
  }

  const handleQuit = () => {
    window.desktopApi?.windowClose()
  }

  const handleRefresh = () => {
    if (isUsingEnvUrl) {
      trpcUtils.providers.getModels.invalidate({ providerId: "litellm" })
      trpcUtils.providers.getRecommendedModels.invalidate({ providerId: "litellm" })
    } else {
      fetchModelsManually()
    }
  }

  const handleContinue = () => {
    const normalizedUrl = normalizeUrl(baseUrl)

    // Write to unified provider system
    setActiveProviderId("litellm")
    setActiveModelId(selectedModel)
    if (!enabledProviderIds.includes("litellm")) {
      setEnabledProviderIds([...enabledProviderIds, "litellm"])
    }

    // Auto-populate recommended models for out-of-box experience
    if (recommended?.recommendedChatIds) {
      autoPopulate({ providerId: "litellm", recommendedIds: recommended.recommendedChatIds })
    }
    autoSelectTasks({
      providerId: "litellm",
      imageModelId: recommended?.imageModelId ?? null,
      summaryModelId: recommended?.summaryModelId ?? null,
    })

    // Backward compat writes (TODO: remove after consumers migrate to unified provider system)
    setLitellmConfig({ baseUrl: normalizedUrl, apiKey, selectedModel })
    setCustomClaudeConfig({
      baseUrl: normalizedUrl,
      token: apiKey || "litellm",
      model: selectedModel,
    })
    setOverrideModelMode("litellm")
    setLitellmSelectedModel(selectedModel)

    liteLLMLog.info("Onboarding complete:", { model: selectedModel, usingEnvUrl: isUsingEnvUrl })
    setLitellmOnboardingCompleted(true)
  }

  const canContinue = baseUrl && selectedModel && hasLoadedModels && models.length > 0

  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
      {/* Draggable title bar area */}
      <div
        className="fixed top-0 left-0 right-0 h-10"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Quit button */}
      <button
        onClick={handleQuit}
        className="fixed top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <X className="h-3.5 w-3.5" />
        {t('common.quit')}
      </button>

      <div className="w-full max-w-[480px] flex flex-col gap-6 px-4">
        {/* Back button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('common.back')}
        </button>

        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {t('litellm.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('litellm.subtitle')}
          </p>
        </div>

        {/* Configuration Form */}
        <div className="flex flex-col gap-4">
          {/* Base URL */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseUrl" className="text-sm font-medium">
              {t('litellm.baseUrlLabel')}
            </Label>
            <Input
              id="baseUrl"
              type="url"
              placeholder={t('litellm.baseUrlPlaceholder')}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="h-10"
            />
            {envConfig?.baseUrl && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="w-3 h-3 shrink-0" />
                <span>{t('litellm.envPreFilled')}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('litellm.baseUrlHint')}
            </p>
          </div>

          {/* API Key (optional) */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="apiKey" className="text-sm font-medium">
              {t('litellm.apiKeyLabel')} <span className="text-muted-foreground">{t('litellm.optional')}</span>
            </Label>
            <Input
              id="apiKey"
              type="password"
              placeholder={t('litellm.apiKeyPlaceholder')}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-10"
            />
            {envConfig?.hasApiKey && isUsingEnvUrl && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="w-3 h-3 shrink-0" />
                <span>{t('litellm.envApiKeyConfigured')}</span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('litellm.apiKeyHint')}
            </p>
          </div>

          {/* Model Selection */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="model" className="text-sm font-medium">
                {t('litellm.modelLabel')}
              </Label>
              <button
                onClick={handleRefresh}
                disabled={isLoading || !baseUrl}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
                {t('litellm.refresh')}
              </button>
            </div>

            {modelsError ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modelsError}</span>
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center p-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : models.length > 0 ? (
              <select
                id="model"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
            ) : hasLoadedModels ? (
              <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground text-center">
                {t('litellm.noModels')}
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground text-center">
                {t('litellm.enterUrl')}
              </div>
            )}

            {models.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('litellm.modelsAvailable', { count: models.length })}
              </p>
            )}
          </div>
        </div>

        {/* Continue Button */}
        <Button
          onClick={handleContinue}
          disabled={!canContinue}
          className="w-full h-10"
        >
          {t('common.continue')}
        </Button>
      </div>
    </div>
  )
}

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "")
}
