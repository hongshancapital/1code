import { Provider as JotaiProvider, useAtom, useAtomValue, useSetAtom } from "jotai"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { I18nextProvider } from "react-i18next"
import { toast, Toaster } from "sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { TRPCProvider } from "./contexts/TRPCProvider"
import { WindowProvider, getInitialWindowParams } from "./contexts/WindowContext"
import { PlatformProvider } from "./contexts/PlatformContext"
import { selectedAgentChatIdAtom } from "./features/agents/atoms"
import { ChatInputProvider } from "./features/agents/context/chat-input-context"
import { ChatViewLayoutProvider } from "./features/agents/layout"
import { useAgentSubChatStore } from "./features/agents/stores/sub-chat-store"
import { useNavigate } from "./lib/router"
import { AgentsLayout } from "./features/layout/agents-layout"
import { useTrafficLightSync } from "./lib/hooks/use-traffic-light-sync"
import {
  AnthropicOnboardingPage,
  ApiKeyOnboardingPage,
  BillingMethodPage,
  LiteLLMOnboardingPage,
} from "./features/onboarding"
import {
  initSensors,
  login as sensorsLogin,
  registerCommonProps,
  shutdown as shutdownSensors,
  trackAppDuration,
} from "./lib/sensors-analytics"
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  authSkippedAtom,
  billingMethodAtom,
  languagePreferenceAtom,
  litellmOnboardingCompletedAtom,
  litellmSelectedModelAtom,
  overrideModelModeAtom,
  welcomeNameInputCompletedAtom,
} from "./lib/atoms"
import i18n from "./lib/i18n"
import { appStore } from "./lib/jotai-store"
import { VSCodeThemeProvider } from "./lib/themes/theme-provider"
import { trpc } from "./lib/trpc"
import { LoadingScene } from "./components/loading-scene"
import { GlobalErrorBoundary } from "./components/ui/global-error-boundary"

/**
 * Custom Toaster that adapts to theme
 */
function ThemedToaster() {
  const { resolvedTheme } = useTheme()

  return (
    <Toaster
      position="bottom-right"
      theme={resolvedTheme as "light" | "dark" | "system"}
      closeButton
    />
  )
}

/**
 * Syncs the language preference atom with i18next
 */
function LanguageSync() {
  const languagePreference = useAtomValue(languagePreferenceAtom)

  useEffect(() => {
    if (languagePreference === "system") {
      const systemLocale = navigator.language
      const lang = systemLocale.startsWith("zh") ? "zh" : "en"
      i18n.changeLanguage(lang)
    } else {
      i18n.changeLanguage(languagePreference)
    }
  }, [languagePreference])

  return null
}

/**
 * Main content router - decides which page to show based on onboarding state
 */
function AppContent() {
  // 同步红绿灯状态到原生窗口
  useTrafficLightSync()

  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const anthropicOnboardingCompleted = useAtomValue(
    anthropicOnboardingCompletedAtom
  )
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)
  const litellmOnboardingCompleted = useAtomValue(litellmOnboardingCompletedAtom)
  const setLitellmOnboardingCompleted = useSetAtom(litellmOnboardingCompletedAtom)
  const setOverrideModelMode = useSetAtom(overrideModelModeAtom)
  const setLitellmSelectedModel = useSetAtom(litellmSelectedModelAtom)
  const setAuthSkipped = useSetAtom(authSkippedAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const [welcomeNameInputCompleted, setWelcomeNameInputCompleted] = useAtom(welcomeNameInputCompletedAtom)
  const { setActiveSubChat, addToOpenSubChats, setChatId } = useAgentSubChatStore()
  const { navigateTo } = useNavigate()

  // Track if auth check has completed
  const [authCheckCompleted, setAuthCheckCompleted] = useState(false)
  // Track if initial data is loaded (for loading scene)
  const [initialDataLoaded, setInitialDataLoaded] = useState(false)
  // Track if loading scene exit animation is complete
  const [loadingSceneComplete, setLoadingSceneComplete] = useState(false)
  // Track current loading status for display
  const [loadingStatus, setLoadingStatus] = useState<'initializing' | 'detecting' | 'configuring' | 'ready'>('initializing')
  // Track if LiteLLM auto-detection succeeded (to skip billing page)
  const [litellmAutoDetected, setLitellmAutoDetected] = useState(false)

  // Check auth status and sync skipped state
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const isAuthenticated = await window.desktopApi?.isAuthenticated()
        const isSkipped = await window.desktopApi?.isSkipped()

        // Sync skipped state to atom
        setAuthSkipped(isSkipped ?? false)

        if (!isAuthenticated && !isSkipped) {
          console.log("[App] Not authenticated and not skipped, triggering logout to show login page")
          // Trigger logout to show login page
          window.desktopApi?.logout()
          return // Don't set authCheckCompleted, page will reload
        }
      } catch (error) {
        console.warn("[App] Failed to check auth status:", error)
      }
      setAuthCheckCompleted(true)
    }
    checkAuth()
  }, [setAuthSkipped])

  // Apply initial window params (chatId/subChatId) when opening via "Open in new window"
  useEffect(() => {
    const params = getInitialWindowParams()
    if (params.chatId) {
      console.log("[App] Opening chat from window params:", params.chatId, params.subChatId)
      navigateTo({
        chatId: params.chatId,
        subChatId: params.subChatId,
        timestamp: Date.now(),
      })
    }
  }, [navigateTo])

  // Check if user has existing CLI config (API key or proxy)
  // Based on PR #29 by @sa4hnd
  const { data: cliConfig, isLoading: isLoadingCliConfig } =
    trpc.claudeCode.hasExistingCliConfig.useQuery()

  // Always fetch LiteLLM models to auto-detect available models
  // This runs regardless of env config - allows runtime detection
  const { data: litellmModels, isLoading: isLoadingLitellmModels, error: litellmModelsError } =
    trpc.litellm.getModels.useQuery(undefined, {
      retry: false, // Don't retry on failure - fast fail for detection
      staleTime: 0, // Always fetch fresh
    })

  // Migration: If user already completed Anthropic onboarding but has no billing method set,
  // automatically set it to "claude-subscription" (legacy users before billing method was added)
  useEffect(() => {
    if (!billingMethod && anthropicOnboardingCompleted) {
      setBillingMethod("claude-subscription")
    }
  }, [billingMethod, anthropicOnboardingCompleted, setBillingMethod])

  // Auto-skip onboarding if user has existing CLI config (API key or proxy)
  // This allows users with ANTHROPIC_API_KEY to use the app without OAuth
  useEffect(() => {
    if (cliConfig?.hasConfig && !billingMethod) {
      console.log("[App] Detected existing CLI config, auto-completing onboarding")
      setBillingMethod("api-key")
      setApiKeyOnboardingCompleted(true)
    }
  }, [cliConfig?.hasConfig, billingMethod, setBillingMethod, setApiKeyOnboardingCompleted])

  // Auto-detect LiteLLM and complete onboarding if LiteLLM is available
  // This happens during the loading scene - seamless experience for users with LiteLLM configured
  // If LiteLLM is connected with any models, automatically set to litellm mode (skip billing page)
  useEffect(() => {
    // Skip if already has billing method or already detected - keep initializing status
    if (billingMethod || litellmAutoDetected) {
      return
    }
    // Skip if still loading
    if (isLoadingLitellmModels) {
      setLoadingStatus('detecting')
      return
    }

    // Check if LiteLLM is available and has any models
    if (litellmModels?.models && litellmModels.models.length > 0 && litellmModels.defaultModel) {
      // LiteLLM is connected - auto-configure regardless of model type
      console.log("[App] Auto-detected LiteLLM with model:", litellmModels.defaultModel, `(${litellmModels.models.length} models available)`)
      setLoadingStatus('configuring')
      setLitellmAutoDetected(true)
      setBillingMethod("litellm")
      setLitellmOnboardingCompleted(true)
      setOverrideModelMode("litellm")
      setLitellmSelectedModel(litellmModels.defaultModel)
    } else if (litellmModelsError || litellmModels?.error || (litellmModels && litellmModels.models?.length === 0)) {
      // LiteLLM not available or no models - proceed to billing page
      console.log("[App] LiteLLM not available or no models:", litellmModels?.error || litellmModelsError)
      setLoadingStatus('ready')
    }
  }, [
    billingMethod,
    litellmAutoDetected,
    isLoadingLitellmModels,
    litellmModels,
    litellmModelsError,
    loadingStatus,
    setBillingMethod,
    setLitellmOnboardingCompleted,
    setOverrideModelMode,
    setLitellmSelectedModel,
  ])

  // Fetch projects to validate selectedProject exists
  const { isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Track when all initial data queries are completed
  useEffect(() => {
    console.log("[LoadingScene] Status:", {
      authCheckCompleted,
      isLoadingCliConfig,
      isLoadingLitellmModels,
      isLoadingProjects,
      loadingStatus,
      initialDataLoaded
    })

    const allQueriesComplete =
      authCheckCompleted &&
      !isLoadingCliConfig &&
      !isLoadingLitellmModels &&
      !isLoadingProjects &&
      // Ready when: has billing method, or LiteLLM auto-detected, or detection finished (ready/configuring)
      (billingMethod || litellmAutoDetected || loadingStatus === 'ready' || loadingStatus === 'configuring')

    if (allQueriesComplete && !initialDataLoaded) {
      console.log("[LoadingScene] All queries complete, starting exit timer")
      // Add a minimum display time for the loading scene (1.5s for welcome animation)
      const timer = setTimeout(() => {
        console.log("[LoadingScene] Setting initialDataLoaded to true")
        setInitialDataLoaded(true)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [
    authCheckCompleted,
    isLoadingCliConfig,
    isLoadingLitellmModels,
    isLoadingProjects,
    loadingStatus,
    billingMethod,
    litellmAutoDetected,
    initialDataLoaded
  ])

  // ============================================================================
  // Auth/Onboarding Flow
  // ============================================================================

  // Show loading scene while initial data is loading or exit animation is playing
  const showLoadingScene = !loadingSceneComplete
  const isLoading = !initialDataLoaded

  // Show name input on first launch (name not yet asked)
  // This is independent of billingMethod - we always want to ask for name on first launch
  const showNameInput = !welcomeNameInputCompleted

  // Loading scene 作为覆盖层，后面的内容正常渲染
  const loadingOverlay = showLoadingScene ? (
    <LoadingScene
      isLoading={isLoading}
      loadingStatus={loadingStatus}
      showNameInput={showNameInput}
      onNameInputComplete={() => setWelcomeNameInputCompleted(true)}
      onLoadingComplete={() => setLoadingSceneComplete(true)}
      onEnvCheckComplete={() => {
        // Environment check complete - could be used for analytics or logging
        console.log('[App] Environment check complete')
      }}
    />
  ) : null

  // Determine which page to show:
  // 1. No billing method selected -> BillingMethodPage
  // 2. Claude subscription selected but not completed -> AnthropicOnboardingPage
  // 3. API key or custom model selected but not completed -> ApiKeyOnboardingPage
  // 4. LiteLLM selected but not completed -> LiteLLMOnboardingPage
  // 5. Otherwise -> AgentsLayout (handles "no project" state with folder selection UI)

  let content: React.ReactNode = null

  if (!billingMethod) {
    content = <BillingMethodPage />
  } else if (billingMethod === "claude-subscription" && !anthropicOnboardingCompleted) {
    content = <AnthropicOnboardingPage />
  } else if (
    (billingMethod === "api-key" || billingMethod === "custom-model") &&
    !apiKeyOnboardingCompleted
  ) {
    content = <ApiKeyOnboardingPage />
  } else if (billingMethod === "litellm" && !litellmOnboardingCompleted) {
    content = <LiteLLMOnboardingPage />
  } else {
    // No more SelectRepoPage - AgentsLayout handles the "no project" state
    // with the new-chat-form showing "Select a folder to get started"
    content = <AgentsLayout />
  }

  return (
    <>
      {content}
      {loadingOverlay}
    </>
  )
}

export function App() {
  // Initialize Sensors Analytics on mount
  useEffect(() => {
    initSensors()

    // 注册神策公共属性
    registerCommonProps({
      source: "desktop",
    })

    // Login user for Sensors Analytics if already authenticated
    // Use email as distinctId to match Web SDK's sensors.login(email)
    const loginUser = async () => {
      try {
        const user = await window.desktopApi?.getUser()
        if (user?.email) {
          sensorsLogin(user.email)
        }
      } catch (error) {
        console.warn("[Sensors] Failed to login user:", error)
      }
    }
    loginUser()

    // Track app usage duration on page unload (beacon send survives page close)
    const appStartTime = Date.now()
    const handleUnload = () => {
      trackAppDuration(Date.now() - appStartTime)
    }
    window.addEventListener("pagehide", handleUnload)
    window.addEventListener("beforeunload", handleUnload)

    // Listen for session expiration (when refresh token fails)
    const unsubscribeSessionExpired = window.desktopApi?.onSessionExpired?.(() => {
      toast.error(i18n.t("info.sessionExpired", { ns: "toast" }), {
        duration: 5000,
        action: {
          label: i18n.t("auth.tryAgain", { ns: "dialogs" }),
          onClick: () => {
            // Reload the page to trigger re-authentication
            window.location.reload()
          },
        },
      })
    })

    // Listen for re-authentication in progress (returning users with expired tokens)
    const unsubscribeReauthenticating = window.desktopApi?.onReauthenticating?.(() => {
      toast.info(i18n.t("info.revalidatingAuth", { ns: "toast" }), { duration: 3000 })
    })

    // Cleanup on unmount
    return () => {
      window.removeEventListener("pagehide", handleUnload)
      window.removeEventListener("beforeunload", handleUnload)
      shutdownSensors()
      unsubscribeSessionExpired?.()
      unsubscribeReauthenticating?.()
    }
  }, [])

  return (
    <GlobalErrorBoundary>
      <WindowProvider>
        <PlatformProvider>
          <JotaiProvider store={appStore}>
            <I18nextProvider i18n={i18n}>
              <LanguageSync />
              <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
                <VSCodeThemeProvider>
                  <TooltipProvider delayDuration={100}>
                    <TRPCProvider>
                      <ChatInputProvider>
                        <ChatViewLayoutProvider>
                          <div
                            data-agents-page
                            className="h-screen w-screen bg-background text-foreground overflow-hidden"
                          >
                            <AppContent />
                          </div>
                          <ThemedToaster />
                        </ChatViewLayoutProvider>
                      </ChatInputProvider>
                    </TRPCProvider>
                  </TooltipProvider>
                </VSCodeThemeProvider>
              </ThemeProvider>
            </I18nextProvider>
          </JotaiProvider>
        </PlatformProvider>
      </WindowProvider>
    </GlobalErrorBoundary>
  )
}
