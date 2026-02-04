"use client"

import { useAtomValue, useSetAtom } from "jotai"
import { useState } from "react"
import { Check, Lock, X } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { ClaudeCodeIcon, KeyFilledIcon, SettingsFilledIcon, LiteLLMIcon } from "../../components/ui/icons"
import { authSkippedAtom, billingMethodAtom, type BillingMethod } from "../../lib/atoms"
import { cn } from "../../lib/utils"

type BillingOption = {
  id: Exclude<BillingMethod, null>
  title: string
  subtitle: string
  recommended?: boolean
  icon: React.ReactNode
}

const getBillingOptions = (t: (key: string) => string): BillingOption[] => [
  {
    id: "claude-subscription",
    title: t('billing.claudeSubscription.title'),
    subtitle: t('billing.claudeSubscription.subtitle'),
    recommended: true,
    icon: <ClaudeCodeIcon className="w-5 h-5" />,
  },
  {
    id: "api-key",
    title: t('billing.apiKey.title'),
    subtitle: t('billing.apiKey.subtitle'),
    icon: <KeyFilledIcon className="w-5 h-5" />,
  },
  {
    id: "litellm",
    title: t('billing.litellm.title'),
    subtitle: t('billing.litellm.subtitle'),
    icon: <LiteLLMIcon className="w-5 h-5" />,
  },
  {
    id: "custom-model",
    title: t('billing.customModel.title'),
    subtitle: t('billing.customModel.subtitle'),
    icon: <SettingsFilledIcon className="w-5 h-5" />,
  },
]

export function BillingMethodPage() {
  const { t } = useTranslation('onboarding')
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const isAuthSkipped = useAtomValue(authSkippedAtom)

  const billingOptions = getBillingOptions(t)

  // Default to api-key if auth was skipped, otherwise claude-subscription
  const [selectedOption, setSelectedOption] =
    useState<Exclude<BillingMethod, null>>(isAuthSkipped ? "api-key" : "claude-subscription")

  const handleOptionClick = (optionId: Exclude<BillingMethod, null>) => {
    // Claude subscription requires login
    if (optionId === "claude-subscription" && isAuthSkipped) {
      toast.error(t('billing.requiresLogin'), {
        action: {
          label: t('common.connect'),
          onClick: () => window.desktopApi?.startAuthFlow()
        }
      })
      return
    }
    setSelectedOption(optionId)
  }

  const handleContinue = () => {
    setBillingMethod(selectedOption)
  }

  const handleQuit = () => {
    window.desktopApi?.windowClose()
  }

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

      <div className="w-full max-w-[440px] flex flex-col gap-8 px-4">
        {/* Header */}
        <div className="text-center flex flex-col gap-1">
          <h1 className="text-base font-semibold tracking-tight">
            {t('billing.title')}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t('billing.subtitle')}
          </p>
        </div>

        {/* Billing Options */}
        <div className="space-y-3">
          {billingOptions.map((option) => {
            const isDisabled = option.id === "claude-subscription" && isAuthSkipped
            return (
              <button
                key={option.id}
                onClick={() => handleOptionClick(option.id)}
                disabled={isDisabled}
                className={cn(
                  "relative w-full p-4 rounded-xl text-left transition-[transform,box-shadow] duration-150 ease-out",
                  "shadow-[0_0_0_0.5px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.3)]",
                  isDisabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:shadow-[0_0_0_0.5px_rgba(0,0,0,0.2),0_2px_4px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_0_0_0.5px_rgba(255,255,255,0.15),0_2px_4px_rgba(0,0,0,0.4)] active:scale-[0.99]",
                  selectedOption === option.id
                    ? "bg-primary/5"
                    : "bg-background"
                )}
              >
                {/* Checkmark or Lock in top right corner */}
                {isDisabled ? (
                  <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                    <Lock className="w-3 h-3 text-muted-foreground" />
                  </div>
                ) : selectedOption === option.id && (
                  <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)]">
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                      option.id === "claude-subscription"
                        ? isDisabled ? "bg-[#D97757]/50 text-white/70" : "bg-[#D97757] text-white"
                        : selectedOption === option.id
                          ? "bg-foreground text-background"
                          : "bg-muted text-muted-foreground"
                    )}
                  >
                    {option.icon}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-sm font-medium", isDisabled && "text-muted-foreground")}>{option.title}</span>
                      {option.recommended && !isDisabled && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {t('billing.recommended')}
                        </span>
                      )}
                      {isDisabled && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {t('billing.requiresLogin')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {option.subtitle}
                    </p>
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* Continue Button */}
        <button
          onClick={handleContinue}
          className="w-full h-8 px-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center"
        >
          {t('common.continue')}
        </button>
      </div>
    </div>
  )
}
