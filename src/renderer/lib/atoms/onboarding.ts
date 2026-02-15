import { atom } from "jotai"
import { atomWithStorage } from "jotai/utils"

// Billing method selected during onboarding
export type BillingMethod = "claude-subscription" | "api-key" | "custom-model" | "litellm" | null

// LiteLLM configuration
export type LiteLLMConfig = {
  baseUrl: string
  apiKey: string
  selectedModel: string
}

export const litellmConfigAtom = atomWithStorage<LiteLLMConfig>(
  "agents:litellm-config",
  {
    baseUrl: "",
    apiKey: "",
    selectedModel: "",
  },
  undefined,
  { getOnInit: true },
)

// LiteLLM onboarding completed flag
export const litellmOnboardingCompletedAtom = atomWithStorage<boolean>(
  "onboarding:litellm-completed",
  false,
  undefined,
  { getOnInit: true },
)

export const billingMethodAtom = atomWithStorage<BillingMethod>(
  "onboarding:billing-method",
  null,
  undefined,
  { getOnInit: true },
)

// Whether user has completed Anthropic OAuth during onboarding
export const anthropicOnboardingCompletedAtom = atomWithStorage<boolean>(
  "onboarding:anthropic-completed",
  false,
  undefined,
  { getOnInit: true },
)

// Whether user has completed API key configuration during onboarding
export const apiKeyOnboardingCompletedAtom = atomWithStorage<boolean>(
  "onboarding:api-key-completed",
  false,
  undefined,
  { getOnInit: true },
)

// Whether auth was skipped
export const authSkippedAtom = atom<boolean>(false)

// Whether user has completed or skipped the welcome name input
export const welcomeNameInputCompletedAtom = atomWithStorage<boolean>(
  "onboarding:welcome-name-completed",
  false,
  undefined,
  { getOnInit: true },
)

// Runtime init banner
export const runtimeInitBannerDismissedAtom = atomWithStorage<boolean>(
  "onboarding:runtime-init-banner-dismissed",
  false,
  undefined,
  { getOnInit: true },
)

export const runtimeSimulatedModeAtom = atom<boolean>(false)
