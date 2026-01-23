"use client"

import { useAtom, useSetAtom } from "jotai"
import { useState, useEffect } from "react"
import { ArrowLeft, Loader2, RefreshCw, AlertCircle } from "lucide-react"

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

type LiteLLMModel = {
  id: string
  object: string
  created: number
  owned_by: string
}

export function LiteLLMOnboardingPage() {
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
      setModelsError("Please enter a base URL")
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
      console.error("[LiteLLM] Failed to fetch models:", error)
      setModelsError(error instanceof Error ? error.message : "Failed to connect to LiteLLM")
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

      <div className="w-full max-w-[480px] space-y-6 px-4">
        {/* Back button */}
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">
            Connect to LiteLLM
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure your LiteLLM proxy connection and select a model.
          </p>
        </div>

        {/* Configuration Form */}
        <div className="space-y-4">
          {/* Base URL */}
          <div className="space-y-2">
            <Label htmlFor="baseUrl" className="text-sm font-medium">
              LiteLLM Base URL
            </Label>
            <Input
              id="baseUrl"
              type="url"
              placeholder="http://localhost:4000"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              The URL of your LiteLLM proxy server
            </p>
          </div>

          {/* API Key (optional) */}
          <div className="space-y-2">
            <Label htmlFor="apiKey" className="text-sm font-medium">
              API Key <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="apiKey"
              type="password"
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="h-10"
            />
            <p className="text-xs text-muted-foreground">
              Required if your LiteLLM proxy has authentication enabled
            </p>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="model" className="text-sm font-medium">
                Model
              </Label>
              <button
                onClick={fetchModels}
                disabled={isLoadingModels || !baseUrl}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3 h-3", isLoadingModels && "animate-spin")} />
                Refresh
              </button>
            </div>

            {modelsError ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
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
                className="w-full h-10 px-3 rounded-lg border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                  </option>
                ))}
              </select>
            ) : hasLoadedModels ? (
              <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground text-center">
                No models available
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-muted text-sm text-muted-foreground text-center">
                Enter a base URL to load available models
              </div>
            )}

            {models.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {models.length} model{models.length !== 1 ? "s" : ""} available
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
          Continue
        </Button>
      </div>
    </div>
  )
}
