import { Provider as JotaiProvider, useAtomValue, useSetAtom } from "jotai"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useMemo } from "react"
import { Toaster } from "sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { TRPCProvider } from "./contexts/TRPCProvider"
import { selectedProjectAtom, currentProjectModeAtom } from "./features/agents/atoms"
import { AgentsLayout } from "./features/layout/agents-layout"
import { CoworkLayout } from "./features/cowork/cowork-layout"
import { isCoworkModeAtom } from "./features/cowork/atoms" // Legacy fallback for no-project state
import {
  AnthropicOnboardingPage,
  ApiKeyOnboardingPage,
  BillingMethodPage,
  SelectRepoPage,
  WelcomePage,
} from "./features/onboarding"
import { identify, initAnalytics, shutdown } from "./lib/analytics"
import {
  anthropicOnboardingCompletedAtom, apiKeyOnboardingCompletedAtom,
  billingMethodAtom
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
  // Project mode: "cowork" (simplified) or "coding" (full git features)
  // Uses project-level mode if project selected, otherwise falls back to global setting
  const projectMode = useAtomValue(currentProjectModeAtom)
  const globalCoworkMode = useAtomValue(isCoworkModeAtom) // Fallback for no-project state
  const selectedProject = useAtomValue(selectedProjectAtom)

  // Determine effective mode: project mode takes precedence, fallback to global
  const isCoworkMode = selectedProject ? projectMode === "cowork" : globalCoworkMode

  const billingMethod = useAtomValue(billingMethodAtom)
  const setBillingMethod = useSetAtom(billingMethodAtom)
  const anthropicOnboardingCompleted = useAtomValue(
    anthropicOnboardingCompletedAtom
  )
  const apiKeyOnboardingCompleted = useAtomValue(apiKeyOnboardingCompletedAtom)

  // Migration: If user already completed Anthropic onboarding but has no billing method set,
  // automatically set it to "claude-subscription" (legacy users before billing method was added)
  useEffect(() => {
    if (!billingMethod && anthropicOnboardingCompleted) {
      setBillingMethod("claude-subscription")
    }
  }, [billingMethod, anthropicOnboardingCompleted, setBillingMethod])

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
  // Onboarding Flow (applies to ALL modes)
  // First-time users must configure Claude before using the app
  // ============================================================================

  // Step 1: No billing method selected -> Show Welcome Page
  if (!billingMethod) {
    return <WelcomePage />
  }

  // Step 2: Claude subscription selected but not completed -> Anthropic OAuth
  if (billingMethod === "claude-subscription" && !anthropicOnboardingCompleted) {
    return <AnthropicOnboardingPage />
  }

  // Step 3: API key or custom model selected but not completed -> API Key config
  if (
    (billingMethod === "api-key" || billingMethod === "custom-model") &&
    !apiKeyOnboardingCompleted
  ) {
    return <ApiKeyOnboardingPage />
  }

  // ============================================================================
  // Cowork Mode: After onboarding, go directly to CoworkLayout
  // The layout handles project selection internally
  // ============================================================================
  if (isCoworkMode) {
    return <CoworkLayout />
  }

  // ============================================================================
  // Coding Mode (Agents): Full layout with project selection
  // ============================================================================
  if (!validatedProject && !isLoadingProjects) {
    return <SelectRepoPage />
  }

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

    // Identify device for analytics (no user auth required)
    const identifyDevice = async () => {
      try {
        const deviceId = await window.desktopApi?.getDeviceId()
        if (deviceId) {
          identify(deviceId, { type: "device" })
        }
      } catch (error) {
        console.warn("[Analytics] Failed to identify device:", error)
      }
    }
    identifyDevice()

    // Cleanup on unmount
    return () => {
      shutdown()
    }
  }, [])

  return (
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
  )
}
