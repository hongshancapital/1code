import { Provider as JotaiProvider, useAtomValue } from "jotai"
import { ThemeProvider, useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { I18nextProvider } from "react-i18next"
import { Toaster } from "sonner"
import { TooltipProvider } from "./components/ui/tooltip"
import { TRPCProvider } from "./contexts/TRPCProvider"
import { WindowProvider, getInitialWindowParams } from "./contexts/WindowContext"
import { PlatformProvider } from "./contexts/PlatformContext"
import { ChatInputProvider } from "./features/agents/context/chat-input-context"
import { ChatViewLayoutProvider } from "./features/agents/layout"
import { useNavigate } from "./lib/router"
import { AgentsLayout } from "./features/layout/agents-layout"
import { useTrafficLightSync } from "./lib/hooks/use-traffic-light-sync"
import {
  initSensors,
  login as sensorsLogin,
  registerCommonProps,
  shutdown as shutdownSensors,
  trackAppDuration,
} from "./lib/sensors-analytics"
import { languagePreferenceAtom } from "./lib/atoms"
import i18n from "./lib/i18n"
import { appStore } from "./lib/jotai-store"
import { VSCodeThemeProvider } from "./lib/themes/theme-provider"
import { LoadingPipelineScene } from "./components/loading-scene"
import { GlobalErrorBoundary } from "./components/ui/global-error-boundary"
import { createLogger } from "./lib/logger"
import {
  pipelinePhaseAtom,
  useLoadingPipelineStart,
} from "./lib/loading-pipeline"
import {
  useEnvCheckStep,
  useOnboardingStep,
  useMigrationStep,
} from "./features/loading-steps"

const appLog = createLogger("App")
const sensorsLog = createLogger("Sensors")

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
 * Main content router — uses Loading Pipeline to manage startup flow
 */
function AppContent() {
  useTrafficLightSync()

  const pipelinePhase = useAtomValue(pipelinePhaseAtom)
  const [pipelineExited, setPipelineExited] = useState(false)
  const { navigateTo } = useNavigate()

  // Register loading steps (order doesn't matter — priority controls execution order)
  useEnvCheckStep()
  useMigrationStep()
  useOnboardingStep()

  // Start the pipeline after all steps are registered
  useLoadingPipelineStart()

  // Apply initial window params when opening via "Open in new window"
  useEffect(() => {
    const params = getInitialWindowParams()
    if (params.chatId) {
      appLog.info("Opening chat from window params:", params.chatId, params.subChatId)
      navigateTo({
        chatId: params.chatId,
        subChatId: params.subChatId,
        timestamp: Date.now(),
      })
    }
  }, [navigateTo])

  // Show loading overlay until pipeline done + exit animation complete
  const showOverlay = !pipelineExited

  return (
    <>
      {/* Main app — always rendered, hidden behind overlay until pipeline finishes */}
      {pipelinePhase === "done" && (
        <ChatInputProvider>
          <ChatViewLayoutProvider>
            <AgentsLayout />
          </ChatViewLayoutProvider>
        </ChatInputProvider>
      )}

      {/* Loading pipeline overlay */}
      {showOverlay && (
        <LoadingPipelineScene
          onExitComplete={() => setPipelineExited(true)}
        />
      )}
    </>
  )
}

export function App() {
  // Initialize Sensors Analytics on mount
  useEffect(() => {
    initSensors()

    registerCommonProps({
      source: "desktop",
    })

    const loginUser = async () => {
      try {
        const user = await window.desktopApi?.getUser()
        if (user?.email) {
          sensorsLogin(user.email)
        }
      } catch (error) {
        sensorsLog.warn("Failed to login user:", error)
      }
    }
    loginUser()

    const appStartTime = Date.now()
    const handleUnload = () => {
      trackAppDuration(Date.now() - appStartTime)
    }
    window.addEventListener("pagehide", handleUnload)
    window.addEventListener("beforeunload", handleUnload)

    const unsubscribeSessionExpired = window.desktopApi?.onSessionExpired?.(() => {
      import("sonner").then(({ toast }) => {
        toast.error(i18n.t("info.sessionExpired", { ns: "toast" }), {
          duration: 5000,
          action: {
            label: i18n.t("auth.tryAgain", { ns: "dialogs" }),
            onClick: () => {
              window.location.reload()
            },
          },
        })
      })
    })

    const unsubscribeReauthenticating = window.desktopApi?.onReauthenticating?.(() => {
      import("sonner").then(({ toast }) => {
        toast.info(i18n.t("info.revalidatingAuth", { ns: "toast" }), { duration: 3000 })
      })
    })

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
        </PlatformProvider>
      </WindowProvider>
    </GlobalErrorBoundary>
  )
}
