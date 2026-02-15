"use client"

import { useAtom, useSetAtom } from "jotai"
import { useState, useEffect } from "react"
import { ArrowLeft, Loader2, RefreshCw, AlertCircle, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import {
  billingMethodAtom,
  litellmConfigAtom,
  litellmOnboardingCompletedAtom,
  customClaudeConfigAtom,
} from "../../lib/atoms"
import { cn } from "../../lib/utils"
import { createLogger } from "../../lib/logger"

const liteLLMLog = createLogger("LiteLLM")


type LiteLLMModel = {
  id: string
  object: string
  created: number
  owned_by: string
}

export function LiteLLMOnboardingPage() {
  const { t } = useTranslation('onboarding')
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const [litellmConfig, setLitellmConfig] = useAtom(litellmConfigAtom)
  const setLitellmOnboardingCompleted = useSetAtom(litellmOnboardingCompletedAtom)
  const setCustomClaudeConfig = useSetAtom(customClaudeConfigAtom)

  const [baseUrl, setBaseUrl] = useState(litellmConfig.baseUrl || "http://localhost:4000")
  const [apiKey, setApiKey] = useState(litellmConfig.apiKey || "")
  const [selectedModel, setSelectedModel] = useState(litellmConfig.selectedModel || "")

  const [models, setModels] = useState<LiteLLMModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [hasLoadedModels, setHasLoadedModels] = useState(false)

  // Normalize base URL (remove trailing slash)
  const normalizeUrl = (url: string) => url.replace(/\/+$/, "")

  // Fetch models from LiteLLM /models endpoint
  const fetchModels = async () => {
    const normalizedUrl = normalizeUrl(baseUrl)
    if (!normalizedUrl) {
      setModelsError(t('litellm.missingUrl'))
      return
    }

    setIsLoadingModels(true)
    setModelsError(null)

    try {
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
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()

      // LiteLLM returns { data: [...models], object: "list" }
      const modelList = data.data || data.models || []
      setModels(modelList)
      setHasLoadedModels(true)

      // Auto-select first model if none selected
      if (modelList.length > 0 && !selectedModel) {
        setSelectedModel(modelList[0].id)
      }
    } catch (error) {
      liteLLMLog.error("Failed to fetch models:", error)
      setModelsError(error instanceof Error ? error.message : t('litellm.connectionFailed'))
      setModels([])
    } finally {
      setIsLoadingModels(false)
    }
  }

  // Auto-fetch models when base URL or API key changes (with debounce)
  useEffect(() => {
    if (!baseUrl) return

    const timer = setTimeout(() => {
      fetchModels()
    }, 500)

    return () => clearTimeout(timer)
  }, [baseUrl, apiKey])

  const handleBack = () => {
    setBillingMethod(null)
  }

  const handleQuit = () => {
    window.desktopApi?.windowClose()
  }

  const handleContinue = () => {
    const normalizedUrl = normalizeUrl(baseUrl)

    // Save LiteLLM config
    setLitellmConfig({
      baseUrl: normalizedUrl,
      apiKey,
      selectedModel,
    })

    // Also save to customClaudeConfig for compatibility with existing code
    setCustomClaudeConfig({
      baseUrl: normalizedUrl,
      token: apiKey || "litellm", // Use "litellm" as placeholder if no API key
      model: selectedModel,
    })

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

      {/* Quit button - fixed in top right corner */}
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
                onClick={fetchModels}
                disabled={isLoadingModels || !baseUrl}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3 h-3", isLoadingModels && "animate-spin")} />
                {t('litellm.refresh')}
              </button>
            </div>

            {modelsError ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{modelsError}</span>
              </div>
            ) : isLoadingModels ? (
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
