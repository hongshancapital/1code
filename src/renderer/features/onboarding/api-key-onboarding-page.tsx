"use client"

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { useState, useEffect } from "react"
import { ChevronLeft, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { IconSpinner, KeyFilledIcon, SettingsFilledIcon } from "../../icons/icons"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import { Logo } from "../../components/ui/logo"
import {
  apiKeyOnboardingCompletedAtom,
  billingMethodAtom,
  customClaudeConfigAtom,
  type CustomClaudeConfig,
} from "../../lib/atoms"
import { cn } from "../../lib/utils"

// Check if the key looks like a valid Anthropic API key
const isValidApiKey = (key: string) => {
  const trimmed = key.trim()
  return trimmed.startsWith("sk-ant-") && trimmed.length > 20
}

export function ApiKeyOnboardingPage() {
  const { t } = useTranslation('onboarding')
  const [storedConfig, setStoredConfig] = useAtom(customClaudeConfigAtom)
  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)

  const isCustomModel = billingMethod === "custom-model"

  // Default values for API key mode (not custom model)
  const defaultModel = "claude-sonnet-4-20250514"
  const defaultBaseUrl = "https://api.anthropic.com"

  const [apiKey, setApiKey] = useState(storedConfig.token)
  const [model, setModel] = useState(storedConfig.model || "")
  const [token, setToken] = useState(storedConfig.token)
  const [baseUrl, setBaseUrl] = useState(storedConfig.baseUrl || "")
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Sync from stored config on mount
  useEffect(() => {
    if (storedConfig.token) {
      setApiKey(storedConfig.token)
      setToken(storedConfig.token)
    }
    if (storedConfig.model) setModel(storedConfig.model)
    if (storedConfig.baseUrl) setBaseUrl(storedConfig.baseUrl)
  }, [])

  const handleBack = () => {
    setBillingMethod(null)
  }

  const handleQuit = () => {
    window.desktopApi?.windowClose()
  }

  // Submit for API key mode (simple - just the key)
  const submitApiKey = (key: string) => {
    if (!isValidApiKey(key)) return

    setIsSubmitting(true)

    const config: CustomClaudeConfig = {
      model: defaultModel,
      token: key.trim(),
      baseUrl: defaultBaseUrl,
    }
    setStoredConfig(config)
    setApiKeyOnboardingCompleted(true)

    setIsSubmitting(false)
  }

  // Submit for custom model mode (all three fields)
  const submitCustomModel = () => {
    const trimmedModel = model.trim()
    const trimmedToken = token.trim()
    const trimmedBaseUrl = baseUrl.trim()

    if (!trimmedModel || !trimmedToken || !trimmedBaseUrl) return

    setIsSubmitting(true)

    const config: CustomClaudeConfig = {
      model: trimmedModel,
      token: trimmedToken,
      baseUrl: trimmedBaseUrl,
    }
    setStoredConfig(config)
    setApiKeyOnboardingCompleted(true)

    setIsSubmitting(false)
  }

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setApiKey(value)

    // Auto-submit if valid API key is pasted
    if (isValidApiKey(value)) {
      setTimeout(() => submitApiKey(value), 100)
    }
  }

  const handleApiKeyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing && apiKey.trim()) {
      submitApiKey(apiKey)
    }
  }

  const canSubmitCustomModel = Boolean(
    model.trim() && token.trim() && baseUrl.trim()
  )

  // Simple API key input mode
  if (!isCustomModel) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
        {/* Draggable title bar area */}
        <div
          className="fixed top-0 left-0 right-0 h-10"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />

        {/* Back button - fixed in top left corner below traffic lights */}
        <button
          onClick={handleBack}
          className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        {/* Quit button - fixed in top right corner */}
        <button
          onClick={handleQuit}
          className="fixed top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <X className="h-3.5 w-3.5" />
          {t('common.quit')}
        </button>

        <div className="w-full max-w-[440px] flex flex-col gap-8 px-4">
          {/* Header with dual icons */}
          <div className="text-center flex flex-col gap-4">
            <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <Logo className="w-5 h-5" fill="white" />
              </div>
              <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
                <KeyFilledIcon className="w-5 h-5 text-background" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-base font-semibold tracking-tight">
                {t('apiKey.title')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('apiKey.subtitlePrefix')}
                <a
                  href="https://console.anthropic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground hover:underline"
                >
                  {t('apiKey.consoleLink')}
                </a>
              </p>
            </div>
          </div>

          {/* API Key Input */}
          <div className="flex flex-col gap-4">
            <div className="relative">
              <Input
                value={apiKey}
                onChange={handleApiKeyChange}
                onKeyDown={handleApiKeyKeyDown}
                placeholder={t('apiKey.placeholder')}
                className="font-mono text-center pr-10"
                autoFocus
                disabled={isSubmitting}
              />
              {isSubmitting && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <IconSpinner className="h-4 w-4" />
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {t('apiKey.hint')}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Custom model mode with all fields
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
      {/* Draggable title bar area */}
      <div
        className="fixed top-0 left-0 right-0 h-10"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {/* Back button - fixed in top left corner below traffic lights */}
      <button
        onClick={handleBack}
        className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>

      {/* Quit button - fixed in top right corner */}
      <button
        onClick={handleQuit}
        className="fixed top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <X className="h-3.5 w-3.5" />
        {t('common.quit')}
      </button>

      <div className="w-full max-w-[440px] flex flex-col gap-8 px-4">
        {/* Header with dual icons */}
        <div className="text-center flex flex-col gap-4">
          <div className="flex items-center justify-center gap-2 p-2 mx-auto w-max rounded-full border border-border">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <Logo className="w-5 h-5" fill="white" />
            </div>
            <div className="w-10 h-10 rounded-full bg-foreground flex items-center justify-center">
              <SettingsFilledIcon className="w-5 h-5 text-background" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold tracking-tight">
              {t('customModel.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('customModel.subtitle')}
            </p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="flex flex-col gap-4">
          {/* Model Name */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('customModel.modelLabel')}</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={t('customModel.modelPlaceholder')}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              {t('customModel.modelHint')}
            </p>
          </div>

          {/* API Token */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('customModel.tokenLabel')}</Label>
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={t('apiKey.placeholder')}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              {t('customModel.tokenHint')}
            </p>
          </div>

          {/* Base URL */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">{t('customModel.baseUrlLabel')}</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t('customModel.baseUrlPlaceholder')}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">{t('customModel.baseUrlHint')}</p>
          </div>
        </div>

        {/* Continue Button */}
        <button
          onClick={submitCustomModel}
          disabled={!canSubmitCustomModel || isSubmitting}
          className={cn(
            "w-full h-8 px-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center",
            (!canSubmitCustomModel || isSubmitting) &&
              "opacity-50 cursor-not-allowed"
          )}
        >
          {isSubmitting ? <IconSpinner className="h-4 w-4" /> : t('common.continue')}
        </button>
      </div>
    </div>
  )
}
