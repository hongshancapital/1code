import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useMemo, useState } from "react"
import { toast, Toaster } from "sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { TRPCProvider } from "./contexts/TRPCProvider"
import { WindowProvider, getInitialWindowParams } from "./contexts/WindowContext"
import { selectedProjectAtom, selectedAgentChatIdAtom } from "./features/agents/atoms"
import { useAgentSubChatStore } from "./features/agents/stores/sub-chat-store"
import { AgentsLayout } from "./features/layout/agents-layout"
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
  litellmOnboardingCompletedAtom,
  overrideModelModeAtom,
} from "./lib/atoms"
import { appStore } from "./lib/jotai-store"
import { VSCodeThemeProvider } from "./lib/themes/theme-provider"
import { trpc } from "./lib/trpc"

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
 * Main content router - decides which page to show based on onboarding state
 */
function AppContent() {
  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const anthropicOnboardingCompleted = useAtomValue(
    anthropicOnboardingCompletedAtom
  )
  const setAnthropicOnboardingCompleted = useSetAtom(anthropicOnboardingCompletedAtom)
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom)
  const setApiKeyOnboardingCompleted = useSetAtom(apiKeyOnboardingCompletedAtom)
  const litellmOnboardingCompleted = useAtomValue(litellmOnboardingCompletedAtom)
  const setLitellmOnboardingCompleted = useSetAtom(litellmOnboardingCompletedAtom)
  const setOverrideModelMode = useSetAtom(overrideModelModeAtom)
  const setAuthSkipped = useSetAtom(authSkippedAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const { setActiveSubChat, addToOpenSubChats, setChatId } = useAgentSubChatStore()

  // Track if auth check has completed
  const [authCheckCompleted, setAuthCheckCompleted] = useState(false)

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
  useEffect(() => {
    if (litellmConfig?.available && !billingMethod) {
      console.log("[App] Detected LiteLLM env config, auto-completing onboarding")
      setBillingMethod("litellm")
      setLitellmOnboardingCompleted(true)
      setOverrideModelMode("litellm")
    }
  }, [litellmConfig?.available, billingMethod, setBillingMethod, setLitellmOnboardingCompleted, setOverrideModelMode])

  // Fetch projects to validate selectedProject exists
  const { data: projects, isLoading: isLoadingProjects } =
    trpc.projects.list.useQuery()

  // Validated project - only valid if exists in DB
  const validatedProject = useMemo(() => {
    if (!selectedProject) return null
    // While loading, trust localStorage value to prevent flicker
    if (isLoadingProjects) return selectedProject
    // After loading, validate against DB
    if (!projects) return null
    const exists = projects.some((p) => p.id === selectedProject.id)
    return exists ? selectedProject : null
  }, [selectedProject, projects, isLoadingProjects])

  // ============================================================================
  // Auth/Onboarding Flow
  // ============================================================================

  // Wait for auth check to complete before rendering to prevent flash
  if (!authCheckCompleted) {
    return null // Or a loading spinner if preferred
  }

  // Determine which page to show:
  // 1. No billing method selected -> BillingMethodPage
  // 2. Claude subscription selected but not completed -> AnthropicOnboardingPage
  // 3. API key or custom model selected but not completed -> ApiKeyOnboardingPage
  // 4. LiteLLM selected but not completed -> LiteLLMOnboardingPage
  // 5. Otherwise -> AgentsLayout (handles "no project" state with folder selection UI)
  if (!billingMethod) {
    return <BillingMethodPage />
  }

  if (billingMethod === "claude-subscription" && !anthropicOnboardingCompleted) {
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

  // No more SelectRepoPage - AgentsLayout handles the "no project" state
  // with the new-chat-form showing "Select a folder to get started"
  return <AgentsLayout />
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

    // Cleanup on unmount
    return () => {
      shutdown()
      unsubscribeSessionExpired?.()
    }
  }, [])

  return (
    <WindowProvider>
      <JotaiProvider store={appStore}>
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
      </JotaiProvider>
    </WindowProvider>
  )
}
