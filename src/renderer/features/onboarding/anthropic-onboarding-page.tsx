"use client"

import { useSetAtom } from "jotai"
import { ChevronLeft, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { ClaudeCodeIcon, IconSpinner } from "../../components/ui/icons"
import { Input } from "../../components/ui/input"
import { Logo } from "../../components/ui/logo"
import {
  anthropicOnboardingCompletedAtom,
  billingMethodAtom,
} from "../../lib/atoms"
import { trpc } from "../../lib/trpc"

type AuthFlowState =
  | { step: "idle" }
  | { step: "starting" }
  | {
      step: "waiting_url"
      sandboxId: string
      sandboxUrl: string
      sessionId: string
    }
  | {
      step: "has_url"
      sandboxId: string
      oauthUrl: string
      sandboxUrl: string
      sessionId: string
    }
  | { step: "submitting" }
  | { step: "error"; message: string }

export function AnthropicOnboardingPage() {
  const { t } = useTranslation('onboarding')
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: "idle" })
  const [authCode, setAuthCode] = useState("")
  const [userClickedConnect, setUserClickedConnect] = useState(false)
  const [urlOpened, setUrlOpened] = useState(false)
  const [savedOauthUrl, setSavedOauthUrl] = useState<string | null>(null)
  const [ignoredExistingToken, setIgnoredExistingToken] = useState(false)
  const [isUsingExistingToken, setIsUsingExistingToken] = useState(false)
  const [existingTokenError, setExistingTokenError] = useState<string | null>(null)
  const urlOpenedRef = useRef(false)
  const setAnthropicOnboardingCompleted = useSetAtom(
    anthropicOnboardingCompletedAtom
  )
  const setBillingMethod = useSetAtom(billingMethodAtom)

  const handleBack = () => {
    setBillingMethod(null)
  }

  const handleQuit = () => {
    window.desktopApi?.windowClose()
  }

  const formatTokenPreview = (token: string) => {
    const trimmed = token.trim()
    if (trimmed.length <= 16) return trimmed
    return `${trimmed.slice(0, 19)}...${trimmed.slice(-6)}`
  }

  // tRPC mutations and utils
  const utils = trpc.useUtils()
  const startAuthMutation = trpc.claudeCode.startAuth.useMutation()
  const submitCodeMutation = trpc.claudeCode.submitCode.useMutation()
  const openOAuthUrlMutation = trpc.claudeCode.openOAuthUrl.useMutation()
  const importSystemTokenMutation = trpc.claudeCode.importSystemToken.useMutation()
  const existingTokenQuery = trpc.claudeCode.getSystemToken.useQuery()
  const existingToken = existingTokenQuery.data?.token ?? null
  const hasExistingToken = !!existingToken
  const checkedExistingToken = existingTokenQuery.isFetched
  const shouldOfferExistingToken =
    checkedExistingToken && hasExistingToken && !ignoredExistingToken

  // Poll for OAuth URL
  const pollStatusQuery = trpc.claudeCode.pollStatus.useQuery(
    {
      sandboxUrl: flowState.step === "waiting_url" ? flowState.sandboxUrl : "",
      sessionId: flowState.step === "waiting_url" ? flowState.sessionId : "",
    },
    {
      enabled: flowState.step === "waiting_url",
      refetchInterval: 1500,
    }
  )

  // Auto-start auth on mount
  useEffect(() => {
    if (!checkedExistingToken || shouldOfferExistingToken) return

    if (flowState.step === "idle") {
      setFlowState({ step: "starting" })
      startAuthMutation.mutate(undefined, {
        onSuccess: (result) => {
          setFlowState({
            step: "waiting_url",
            sandboxId: result.sandboxId,
            sandboxUrl: result.sandboxUrl,
            sessionId: result.sessionId,
          })
        },
        onError: (err) => {
          setFlowState({
            step: "error",
            message: err.message || "Failed to start authentication",
          })
        },
      })
    }
  }, [flowState.step, startAuthMutation, checkedExistingToken, shouldOfferExistingToken])

  // Update flow state when we get the OAuth URL
  useEffect(() => {
    if (flowState.step === "waiting_url" && pollStatusQuery.data?.oauthUrl) {
      setSavedOauthUrl(pollStatusQuery.data.oauthUrl)
      setFlowState({
        step: "has_url",
        sandboxId: flowState.sandboxId,
        oauthUrl: pollStatusQuery.data.oauthUrl,
        sandboxUrl: flowState.sandboxUrl,
        sessionId: flowState.sessionId,
      })
    } else if (
      flowState.step === "waiting_url" &&
      pollStatusQuery.data?.state === "error"
    ) {
      setFlowState({
        step: "error",
        message: pollStatusQuery.data.error || "Failed to get OAuth URL",
      })
    }
  }, [pollStatusQuery.data, flowState])

  // Open URL in browser when ready (after user clicked Connect)
  useEffect(() => {
    if (
      flowState.step === "has_url" &&
      userClickedConnect &&
      !urlOpenedRef.current
    ) {
      urlOpenedRef.current = true
      setUrlOpened(true)
      // Use Electron's shell.openExternal via tRPC
      openOAuthUrlMutation.mutate(flowState.oauthUrl)
    }
  }, [flowState, userClickedConnect, openOAuthUrlMutation])

  // Check if the code looks like a valid Claude auth code (format: XXX#YYY)
  const isValidCodeFormat = (code: string) => {
    const trimmed = code.trim()
    return trimmed.length > 50 && trimmed.includes("#")
  }

  const handleConnectClick = async () => {
    setUserClickedConnect(true)

    if (flowState.step === "has_url") {
      // URL is ready, open it immediately
      urlOpenedRef.current = true
      setUrlOpened(true)
      openOAuthUrlMutation.mutate(flowState.oauthUrl)
    } else if (flowState.step === "error") {
      // Retry on error
      urlOpenedRef.current = false
      setUrlOpened(false)
      setFlowState({ step: "starting" })
      try {
        const result = await startAuthMutation.mutateAsync()
        setFlowState({
          step: "waiting_url",
          sandboxId: result.sandboxId,
          sandboxUrl: result.sandboxUrl,
          sessionId: result.sessionId,
        })
      } catch (err) {
        setFlowState({
          step: "error",
          message:
            err instanceof Error ? err.message : "Failed to start authentication",
        })
      }
    }
    // For idle, starting, waiting_url states - the useEffect will handle opening the URL
    // when it becomes ready (userClickedConnect is now true)
  }

  const handleUseExistingToken = async () => {
    if (!hasExistingToken || isUsingExistingToken) return

    setIsUsingExistingToken(true)
    setExistingTokenError(null)

    try {
      await importSystemTokenMutation.mutateAsync()
      setAnthropicOnboardingCompleted(true)
    } catch (err) {
      setExistingTokenError(
        err instanceof Error ? err.message : "Failed to use existing token"
      )
      setIsUsingExistingToken(false)
    }
  }

  const handleRejectExistingToken = () => {
    setIgnoredExistingToken(true)
    setExistingTokenError(null)
    handleConnectClick()
  }

  // Submit code - reusable for both auto-submit and manual Enter
  const submitCode = async (code: string) => {
    if (!code.trim() || flowState.step !== "has_url") return

    const { sandboxUrl, sessionId } = flowState
    setFlowState({ step: "submitting" })

    try {
      await submitCodeMutation.mutateAsync({
        sandboxUrl,
        sessionId,
        code: code.trim(),
      })

      // 验证账号是否真的被存储到数据库
      await utils.anthropicAccounts.getActive.invalidate()
      const activeAccount = await utils.anthropicAccounts.getActive.fetch()

      if (!activeAccount) {
        throw new Error("Account not found after authentication. Please try again.")
      }

      // 只有在数据库验证成功后才标记完成
      setAnthropicOnboardingCompleted(true)
    } catch (err) {
      setFlowState({
        step: "error",
        message: err instanceof Error ? err.message : "Failed to submit code",
      })
    }
  }

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setAuthCode(value)

    // Auto-submit if the pasted value looks like a valid auth code
    if (isValidCodeFormat(value) && flowState.step === "has_url") {
      // Small delay to let the UI update before submitting
      setTimeout(() => submitCode(value), 100)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && authCode.trim()) {
      submitCode(authCode)
    }
  }

  const handleOpenFallbackUrl = () => {
    if (savedOauthUrl) {
      openOAuthUrlMutation.mutate(savedOauthUrl)
    }
  }

  const isLoadingAuth =
    flowState.step === "starting" || flowState.step === "waiting_url"
  const isSubmitting = flowState.step === "submitting"

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
            <div className="w-10 h-10 rounded-full bg-[#D97757] flex items-center justify-center">
              <ClaudeCodeIcon className="w-6 h-6 text-white" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <h1 className="text-base font-semibold tracking-tight">
              {t('anthropic.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('anthropic.subtitle')}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="gap-6 flex flex-col items-center">
          {/* Existing token prompt */}
          {shouldOfferExistingToken && flowState.step === "idle" && (
            <div className="flex flex-col gap-4 w-full">
              <div className="p-4 bg-muted/50 border border-border rounded-lg">
                <p className="text-sm font-medium">
                  {t('anthropic.existingCredentials')}
                </p>
                {existingToken && (
                  <pre className="mt-2 px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap wrap-break-word font-mono bg-background/60 rounded border border-border/60">
                    {formatTokenPreview(existingToken)}
                  </pre>
                )}
              </div>
              {existingTokenError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive">
                    {existingTokenError}
                  </p>
                </div>
              )}
              <div className="flex w-full gap-2">
                <button
                  onClick={handleRejectExistingToken}
                  disabled={isUsingExistingToken}
                  className="h-8 px-3 flex-1 bg-muted text-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-muted/80 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {t('anthropic.authButton')}
                </button>
                <button
                  onClick={handleUseExistingToken}
                  disabled={isUsingExistingToken}
                  className="h-8 px-3 flex-1 bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  {isUsingExistingToken ? (
                    <IconSpinner className="h-4 w-4" />
                  ) : (
                    t('anthropic.useExistingToken')
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Connect Button - shows loader only if user clicked AND loading */}
          {checkedExistingToken &&
            !shouldOfferExistingToken &&
            !urlOpened &&
            flowState.step !== "has_url" &&
            flowState.step !== "error" && (
              <button
                onClick={handleConnectClick}
                disabled={userClickedConnect && isLoadingAuth}
                className="h-8 px-4 min-w-[85px] bg-primary text-primary-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {userClickedConnect && isLoadingAuth ? (
                  <IconSpinner className="h-4 w-4" />
                ) : (
                  t('common.connect')
                )}
              </button>
            )}

          {/* Code Input - Show after URL is opened, if has_url (after redirect), or if submitting */}
          {/* No Continue button - auto-submit on valid code paste */}
          {(urlOpened ||
            flowState.step === "has_url" ||
            flowState.step === "submitting") && (
            <div className="flex flex-col gap-4">
              <div className="relative">
                <Input
                  value={authCode}
                  onChange={handleCodeChange}
                  onKeyDown={handleKeyDown}
                  placeholder={t('anthropic.codePlaceholder')}
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
                {t('anthropic.tabOpened')}
                {savedOauthUrl && (
                  <>
                    {" "}
                    <button
                      onClick={handleOpenFallbackUrl}
                      className="text-primary hover:underline"
                    >
                      {t('anthropic.didntOpen')}
                    </button>
                  </>
                )}
              </p>
            </div>
          )}

          {/* Error State */}
          {flowState.step === "error" && (
            <div className="flex flex-col gap-4">
              <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                <p className="text-sm text-destructive">{flowState.message}</p>
              </div>
              <button
                onClick={handleConnectClick}
                className="w-full h-8 px-3 bg-muted text-foreground rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 hover:bg-muted/80 active:scale-[0.97] flex items-center justify-center"
              >
                {t('anthropic.tryAgain')}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
