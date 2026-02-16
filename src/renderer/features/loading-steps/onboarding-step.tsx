import { useEffect, useState, useRef } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  useLoadingPipeline,
  LoadingStepPriority,
  type LoadingStep,
} from "../../lib/loading-pipeline"
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  authSkippedAtom,
  billingMethodAtom,
  litellmOnboardingCompletedAtom,
  litellmSelectedModelAtom,
  overrideModelModeAtom,
  activeProviderIdAtom,
  activeModelIdAtom,
} from "../../lib/atoms"
import { trpc } from "../../lib/trpc"
import {
  AnthropicOnboardingPage,
  ApiKeyOnboardingPage,
  BillingMethodPage,
  LiteLLMOnboardingPage,
} from "../../features/onboarding"
import { createLogger } from "../../lib/logger"

const log = createLogger("OnboardingStep")

// ---------------------------------------------------------------------------
// Helper: check if onboarding is complete
// ---------------------------------------------------------------------------

function isOnboardingComplete(
  billingMethod: string | null,
  anthropicCompleted: boolean,
  apiKeyCompleted: boolean,
  litellmCompleted: boolean,
): boolean {
  if (!billingMethod) return false
  if (billingMethod === "claude-subscription") return anthropicCompleted
  if (billingMethod === "api-key" || billingMethod === "custom-model")
    return apiKeyCompleted
  if (billingMethod === "litellm") return litellmCompleted
  return false
}

// ---------------------------------------------------------------------------
// OnboardingFlow — renders the appropriate onboarding page
// ---------------------------------------------------------------------------

function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const [billingMethod, setBillingMethod] = useAtom(billingMethodAtom)
  const anthropicOnboardingCompleted = useAtomValue(
    anthropicOnboardingCompletedAtom,
  )
  const [apiKeyOnboardingCompleted, setApiKeyOnboardingCompleted] = useAtom(
    apiKeyOnboardingCompletedAtom,
  )
  const [litellmOnboardingCompleted, setLitellmOnboardingCompleted] = useAtom(
    litellmOnboardingCompletedAtom,
  )
  const setOverrideModelMode = useSetAtom(overrideModelModeAtom)
  const setLitellmSelectedModel = useSetAtom(litellmSelectedModelAtom)
  const setAuthSkipped = useSetAtom(authSkippedAtom)

  // Unified provider system
  const setActiveProviderId = useSetAtom(activeProviderIdAtom)
  const setActiveModelId = useSetAtom(activeModelIdAtom)

  // Auth check
  const [authCheckCompleted, setAuthCheckCompleted] = useState(false)
  const [initialDataLoaded, setInitialDataLoaded] = useState(false)
  const [litellmAutoDetected, setLitellmAutoDetected] = useState(false)

  // Auth check
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const isAuthenticated = await window.desktopApi?.isAuthenticated()
        const isSkipped = await window.desktopApi?.isSkipped()
        setAuthSkipped(isSkipped ?? false)
        if (!isAuthenticated && !isSkipped) {
          log.info("Not authenticated and not skipped, triggering logout")
          window.desktopApi?.logout()
          return
        }
      } catch (error) {
        log.warn("Failed to check auth status:", error)
      }
      setAuthCheckCompleted(true)
    }
    checkAuth()
  }, [setAuthSkipped])

  // CLI config auto-detect
  const { data: cliConfig, isLoading: isLoadingCliConfig } =
    trpc.claudeCode.hasExistingCliConfig.useQuery()

  // LiteLLM auto-detect
  const {
    data: litellmModels,
    isLoading: isLoadingLitellmModels,
    error: litellmModelsError,
  } = trpc.litellm.getModels.useQuery(undefined, {
    retry: false,
    staleTime: 0,
  })

  // Projects preload
  const { isLoading: isLoadingProjects } = trpc.projects.list.useQuery()

  // Migration: legacy users without billing method
  useEffect(() => {
    if (!billingMethod && anthropicOnboardingCompleted) {
      setBillingMethod("claude-subscription")
    }
  }, [billingMethod, anthropicOnboardingCompleted, setBillingMethod])

  // Auto-skip onboarding if CLI config exists
  useEffect(() => {
    if (cliConfig?.hasConfig && !billingMethod) {
      log.info("Detected existing CLI config, auto-completing onboarding")
      setBillingMethod("api-key")
      setApiKeyOnboardingCompleted(true)
    }
  }, [
    cliConfig?.hasConfig,
    billingMethod,
    setBillingMethod,
    setApiKeyOnboardingCompleted,
  ])

  // LiteLLM auto-detect
  useEffect(() => {
    if (billingMethod || litellmAutoDetected) return
    if (isLoadingLitellmModels) return

    if (
      litellmModels?.models &&
      litellmModels.models.length > 0 &&
      litellmModels.defaultModel
    ) {
      log.info(
        "Auto-detected LiteLLM with model:",
        litellmModels.defaultModel,
        `(${litellmModels.models.length} models)`,
      )
      setLitellmAutoDetected(true)
      setBillingMethod("litellm")
      setLitellmOnboardingCompleted(true)

      // Unified provider system
      setActiveProviderId("litellm")
      setActiveModelId(litellmModels.defaultModel)

      // Backward compat (TODO: remove after consumers migrate to unified provider system)
      setOverrideModelMode("litellm")
      setLitellmSelectedModel(litellmModels.defaultModel)
    }
  }, [
    billingMethod,
    litellmAutoDetected,
    isLoadingLitellmModels,
    litellmModels,
    litellmModelsError,
    setBillingMethod,
    setLitellmOnboardingCompleted,
    setActiveProviderId,
    setActiveModelId,
    setOverrideModelMode,
    setLitellmSelectedModel,
  ])

  // Track data loading completion
  useEffect(() => {
    const allQueriesComplete =
      authCheckCompleted &&
      !isLoadingCliConfig &&
      !isLoadingLitellmModels &&
      !isLoadingProjects

    if (allQueriesComplete && !initialDataLoaded) {
      const timer = setTimeout(() => {
        setInitialDataLoaded(true)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [
    authCheckCompleted,
    isLoadingCliConfig,
    isLoadingLitellmModels,
    isLoadingProjects,
    initialDataLoaded,
  ])

  // Check completion whenever atoms change
  useEffect(() => {
    if (!initialDataLoaded) return

    if (
      isOnboardingComplete(
        billingMethod,
        anthropicOnboardingCompleted,
        apiKeyOnboardingCompleted,
        litellmOnboardingCompleted,
      )
    ) {
      log.info("Onboarding complete, moving on")
      onDone()
    }
  }, [
    billingMethod,
    anthropicOnboardingCompleted,
    apiKeyOnboardingCompleted,
    litellmOnboardingCompleted,
    initialDataLoaded,
    onDone,
  ])

  // Still loading initial data — show nothing (pipeline's default loading UI will show)
  if (!initialDataLoaded) {
    return null
  }

  // Determine page
  if (!billingMethod) {
    return <BillingMethodPage />
  }
  if (
    billingMethod === "claude-subscription" &&
    !anthropicOnboardingCompleted
  ) {
    return <AnthropicOnboardingPage />
  }
  if (
    (billingMethod === "api-key" || billingMethod === "custom-model") &&
    !apiKeyOnboardingCompleted
  ) {
    return <ApiKeyOnboardingPage />
  }
  if (billingMethod === "litellm" && !litellmOnboardingCompleted) {
    return <LiteLLMOnboardingPage />
  }

  // All complete — should have triggered onDone above, but just in case
  return null
}

// ---------------------------------------------------------------------------
// Hook: useOnboardingStep
// ---------------------------------------------------------------------------

export function useOnboardingStep() {
  const { register, complete } = useLoadingPipeline()
  const completeRef = useRef(complete)
  completeRef.current = complete

  const billingMethod = useAtomValue(billingMethodAtom)
  const anthropicOnboardingCompleted = useAtomValue(
    anthropicOnboardingCompletedAtom,
  )
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom)
  const litellmOnboardingCompleted = useAtomValue(
    litellmOnboardingCompletedAtom,
  )

  // 用 ref 捕获最新值，避免闭包过期
  const stateRef = useRef({
    billingMethod,
    anthropicOnboardingCompleted,
    apiKeyOnboardingCompleted,
    litellmOnboardingCompleted,
  })
  stateRef.current = {
    billingMethod,
    anthropicOnboardingCompleted,
    apiKeyOnboardingCompleted,
    litellmOnboardingCompleted,
  }

  useEffect(() => {
    const step: LoadingStep = {
      id: "onboarding",
      priority: LoadingStepPriority.Auth,
      shouldActivate: () => {
        const s = stateRef.current
        // 如果已经完成了 onboarding，跳过
        return !isOnboardingComplete(
          s.billingMethod,
          s.anthropicOnboardingCompleted,
          s.apiKeyOnboardingCompleted,
          s.litellmOnboardingCompleted,
        )
      },
      ui: {
        renderLogo: () => null,
        renderSlogan: () => null,
        renderBottom: () => (
          <OnboardingFlow
            onDone={() => completeRef.current("onboarding")}
          />
        ),
      },
    }
    register(step)
  }, [register])
}
