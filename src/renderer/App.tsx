import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { I18nextProvider } from "react-i18next"
import { toast, Toaster } from "sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { TRPCProvider } from "./contexts/TRPCProvider"
import { WindowProvider, getInitialWindowParams } from "./contexts/WindowContext"
import { selectedAgentChatIdAtom } from "./features/agents/atoms"
import { useAgentSubChatStore } from "./features/agents/stores/sub-chat-store"
import { AgentsLayout } from "./features/layout/agents-layout"
import { useTrafficLightSync } from "./lib/hooks/use-traffic-light-sync"
import {
  AnthropicOnboardingPage,
  ApiKeyOnboardingPage,
  BillingMethodPage,
  LiteLLMOnboardingPage,
} from "./features/onboarding"
import { identify, initAnalytics, shutdown } from "./lib/analytics"
import {
  anthropicOnboardingCompletedAtom,
  apiKeyOnboardingCompletedAtom,
  authSkippedAtom,
  billingMethodAtom,
  languagePreferenceAtom,
  litellmOnboardingCompletedAtom,
  litellmSelectedModelAtom,
  overrideModelModeAtom,
} from "./lib/atoms"
import i18n from "./lib/i18n"
import { appStore } from "./lib/jotai-store"
import { VSCodeThemeProvider } from "./lib/themes/theme-provider"
import { trpc } from "./lib/trpc"
import { LoadingScene } from "./components/loading-scene"

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
  const { setActiveSubChat, addToOpenSubChats, setChatId } = useAgentSubChatStore()

  // Track if auth check has completed
  const [authCheckCompleted, setAuthCheckCompleted] = useState(false)
  // Track if initial data is loaded (for loading scene)
  const [initialDataLoaded, setInitialDataLoaded] = useState(false)
  // Track if loading scene exit animation is complete
  const [loadingSceneComplete, setLoadingSceneComplete] = useState(false)

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
      setSelectedChatId(params.chatId)
      setChatId(params.chatId)
      if (params.subChatId) {
        addToOpenSubChats(params.subChatId)
        setActiveSubChat(params.subChatId)
      }
    }
  }, [setSelectedChatId, setChatId, addToOpenSubChats, setActiveSubChat])

  // Check if user has existing CLI config (API key or proxy)
  // Based on PR #29 by @sa4hnd
  const { data: cliConfig, isLoading: isLoadingCliConfig } =
    trpc.claudeCode.hasExistingCliConfig.useQuery()

  // Check if LiteLLM is configured via env
  const { data: litellmConfig, isLoading: isLoadingLitellmConfig } =
    trpc.litellm.getConfig.useQuery()

  // Fetch LiteLLM models to get default model when auto-completing onboarding
  const { data: litellmModels } = trpc.litellm.getModels.useQuery(undefined, {
    enabled: litellmConfig?.available === true,
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

  // Auto-skip onboarding if LiteLLM is configured via env (MAIN_VITE_LITELLM_BASE_URL)
  // Also set the default model from LiteLLM backend
  useEffect(() => {
    if (litellmConfig?.available && litellmModels?.defaultModel && !billingMethod) {
      console.log("[App] Detected LiteLLM env config, auto-completing onboarding with default model:", litellmModels.defaultModel)
      setBillingMethod("litellm")
      setLitellmOnboardingCompleted(true)
      setOverrideModelMode("litellm")
      setLitellmSelectedModel(litellmModels.defaultModel)
    }
  }, [litellmConfig?.available, litellmModels?.defaultModel, billingMethod, setBillingMethod, setLitellmOnboardingCompleted, setOverrideModelMode, setLitellmSelectedModel])

  // Fetch projects to validate selectedProject exists
  const { isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Track when all initial data queries are completed
  useEffect(() => {
    console.log("[LoadingScene] Status:", {
      authCheckCompleted,
      isLoadingCliConfig,
      isLoadingLitellmConfig,
      isLoadingProjects,
      initialDataLoaded
    })

    const allQueriesComplete =
      authCheckCompleted &&
      !isLoadingCliConfig &&
      !isLoadingLitellmConfig &&
      !isLoadingProjects

    if (allQueriesComplete && !initialDataLoaded) {
      console.log("[LoadingScene] All queries complete, starting exit timer")
      // Add a minimum display time for the loading scene (500ms)
      const timer = setTimeout(() => {
        console.log("[LoadingScene] Setting initialDataLoaded to true")
        setInitialDataLoaded(true)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [
    authCheckCompleted,
    isLoadingCliConfig,
    isLoadingLitellmConfig,
    isLoadingProjects,
    initialDataLoaded
  ])

  // ============================================================================
  // Auth/Onboarding Flow
  // ============================================================================

  // Show loading scene while initial data is loading or exit animation is playing
  const showLoadingScene = !loadingSceneComplete
  const isLoading = !initialDataLoaded

  // Loading scene 作为覆盖层，后面的内容正常渲染
  const loadingOverlay = showLoadingScene ? (
    <LoadingScene
      isLoading={isLoading}
      onLoadingComplete={() => setLoadingSceneComplete(true)}
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
  // Initialize analytics on mount
  useEffect(() => {
    initAnalytics()

    // Sync analytics opt-out status to main process
    const syncOptOutStatus = async () => {
      try {
        const optOut =
          localStorage.getItem("preferences:analytics-opt-out") === "true"
        await window.desktopApi?.setAnalyticsOptOut(optOut)
      } catch (error) {
        console.warn("[Analytics] Failed to sync opt-out status:", error)
      }
    }
    syncOptOutStatus()

    // Identify user if already authenticated
    const identifyUser = async () => {
      try {
        const user = await window.desktopApi?.getUser()
        if (user?.id) {
          identify(user.id, { email: user.email, name: user.name })
        }
      } catch (error) {
        console.warn("[Analytics] Failed to identify user:", error)
      }
    }
    identifyUser()

    // Listen for session expiration (when refresh token fails)
    const unsubscribeSessionExpired = window.desktopApi?.onSessionExpired?.(() => {
      toast.error("会话已过期，请重新登录", {
        duration: 5000,
        action: {
          label: "重新登录",
          onClick: () => {
            // Reload the page to trigger re-authentication
            window.location.reload()
          },
        },
      })
    })

    // Listen for re-authentication in progress (returning users with expired tokens)
    const unsubscribeReauthenticating = window.desktopApi?.onReauthenticating?.(() => {
      toast.info("正在重新验证身份...", { duration: 3000 })
    })

    // Cleanup on unmount
    return () => {
      shutdown()
      unsubscribeSessionExpired?.()
      unsubscribeReauthenticating?.()
    }
  }, [])

  return (
    <WindowProvider>
      <JotaiProvider store={appStore}>
        <I18nextProvider i18n={i18n}>
          <LanguageSync />
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <VSCodeThemeProvider>
              <TooltipProvider delayDuration={100}>
                <TRPCProvider>
                  <div
                    data-agents-page
                    className="h-screen w-screen bg-background text-foreground overflow-hidden"
                  >
                    <AppContent />
                  </div>
                  <ThemedToaster />
                </TRPCProvider>
              </TooltipProvider>
            </VSCodeThemeProvider>
          </ThemeProvider>
        </I18nextProvider>
      </JotaiProvider>
    </WindowProvider>
  )
}
