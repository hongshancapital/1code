"use client"

import { useSetAtom } from "jotai"
import { useState } from "react"
import { Check, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ClaudeCodeIcon, KeyFilledIcon, SettingsFilledIcon, LiteLLMIcon } from "../../icons/icons"
import { billingMethodAtom, type BillingMethod } from "../../lib/atoms"
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

export function WelcomePage() {
  const { t } = useTranslation('onboarding')
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const [selectedOption, setSelectedOption] =
    useState<Exclude<BillingMethod, null>>("litellm")

  const billingOptions = getBillingOptions(t)

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
        {/* Brand Header */}
        <div className="text-center flex flex-col gap-4">
          <div className="flex items-center justify-center">
            <img
              src="icon.png"
              alt="Hóng Logo"
              className="w-64 h-64 rounded-2xl -mb-20"
            />
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold tracking-tight">
              {t('welcome.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('welcome.subtitle')}
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground">{t('welcome.divider')}</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Billing Options */}
        <div className="flex flex-col gap-3">
          {billingOptions.map((option) => (
            <button
              key={option.id}
              onClick={() => setSelectedOption(option.id)}
              className={cn(
                "relative w-full p-4 rounded-xl text-left transition-[transform,box-shadow] duration-150 ease-out",
                "shadow-[0_0_0_0.5px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_0.5px_rgba(255,255,255,0.1),0_1px_2px_rgba(0,0,0,0.3)]",
                "hover:shadow-[0_0_0_0.5px_rgba(0,0,0,0.2),0_2px_4px_rgba(0,0,0,0.15)] dark:hover:shadow-[0_0_0_0.5px_rgba(255,255,255,0.15),0_2px_4px_rgba(0,0,0,0.4)]",
                "active:scale-[0.99]",
                selectedOption === option.id
                  ? "bg-primary/5"
                  : "bg-background"
              )}
            >
              {/* Checkmark in top right corner */}
              {selectedOption === option.id && (
                <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-primary flex items-center justify-center shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)]">
                  <Check className="w-3 h-3 text-primary-foreground" />
                </div>
              )}
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    option.id === "claude-subscription"
                      ? "bg-[#D97757] text-white"
                      : selectedOption === option.id
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {option.icon}
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{option.title}</span>
                    {option.recommended && (
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {t('billing.recommended')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {option.subtitle}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Continue Button */}
        <button
          onClick={handleContinue}
          className="w-full h-10 px-4 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] flex items-center justify-center"
        >
          {t('welcome.continueButton')}
        </button>
      </div>
    </div>
  )
}
