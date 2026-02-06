"use client"

import { useAtom, useSetAtom } from "jotai"
import { Copy, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { pendingAuthRetryMessageAtom } from "../../features/agents/atoms"
import {
  agentsLoginModalOpenAtom,
  agentsSettingsDialogActiveTabAtom,
  agentsSettingsDialogOpenAtom,
  type SettingsTab,
} from "../../lib/atoms"
import { appStore } from "../../lib/jotai-store"
import { trpc } from "../../lib/trpc"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
} from "../ui/alert-dialog"
import { Button } from "../ui/button"
import { ClaudeCodeIcon, IconSpinner } from "../ui/icons"
import { Input } from "../ui/input"
import { Logo } from "../ui/logo"

/**
 * Auth flow state machine:
 *
 * Modal opens → checking
 *   → found token → has_system_token (STOP & ASK USER)
 *       → User "Use Existing" → importing → success → close
 *       → User "Re-authenticate" → setup_token (CLI) or sandbox
 *   → no token → setup_token (CLI) or sandbox OAuth fallback
 */
type AuthFlowState =
  | { step: "checking" }
  | { step: "has_system_token"; token: string }
  | { step: "importing" }
  | { step: "setup_token" }
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

export function ClaudeLoginModal() {
  const [open, setOpen] = useAtom(agentsLoginModalOpenAtom)
  const setSettingsOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const [flowState, setFlowState] = useState<AuthFlowState>({ step: "checking" })
  const [authCode, setAuthCode] = useState("")
  const [savedOauthUrl, setSavedOauthUrl] = useState<string | null>(null)
  const urlOpenedRef = useRef(false)

  // Track if we have already run the initial check sequence
  const initialCheckDoneRef = useRef(false)

  // tRPC mutations and utils
  const utils = trpc.useUtils()
  const startAuthMutation = trpc.claudeCode.startAuth.useMutation()
  const submitCodeMutation = trpc.claudeCode.submitCode.useMutation()
  const openOAuthUrlMutation = trpc.claudeCode.openOAuthUrl.useMutation()
  const importSystemTokenMutation = trpc.claudeCode.importSystemToken.useMutation()
  const runSetupTokenMutation = trpc.claudeCode.runSetupToken.useMutation()

  // Queries (only enabled when modal is open)
  const systemTokenQuery = trpc.claudeCode.getSystemToken.useQuery(undefined, {
    enabled: open,
    refetchOnMount: true,
  })
  const cliInstalledQuery = trpc.claudeCode.checkCliInstalled.useQuery(undefined, {
    enabled: open,
  })

  // Poll for OAuth URL (sandbox flow only)
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

  // Helper to trigger retry after successful auth
  const triggerAuthRetry = useCallback(() => {
    const pending = appStore.get(pendingAuthRetryMessageAtom)
    if (pending) {
      console.log("[ClaudeLoginModal] Auth success - triggering retry for subChatId:", pending.subChatId)
      appStore.set(pendingAuthRetryMessageAtom, { ...pending, readyToRetry: true })
    }
  }, [])

  // Helper to clear pending retry (on cancel/close without success)
  const clearPendingRetry = useCallback(() => {
    const pending = appStore.get(pendingAuthRetryMessageAtom)
    if (pending && !pending.readyToRetry) {
      console.log("[ClaudeLoginModal] Modal closed without success - clearing pending retry")
      appStore.set(pendingAuthRetryMessageAtom, null)
    }
  }, [])

  // Verify account stored in DB, then trigger retry and close
  const handleAuthSuccess = useCallback(async () => {
    await utils.anthropicAccounts.getActive.invalidate()
    const activeAccount = await utils.anthropicAccounts.getActive.fetch()
    if (!activeAccount) {
      throw new Error("Account not found after authentication. Please try again.")
    }
    triggerAuthRetry()
    setOpen(false)
  }, [utils, triggerAuthRetry, setOpen])

  // Start sandbox OAuth flow (may fail if no Hong Desktop token)
  const startSandboxAuth = useCallback(async () => {
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
      const message = err instanceof Error ? err.message : "Failed to start authentication"
      // Provide helpful error message for users without Hong Desktop login
      if (message.includes("Not authenticated with Hóng")) {
        setFlowState({
          step: "error",
          message: "Please run `claude login` in your terminal to authenticate your Claude Code subscription.",
        })
      } else {
        setFlowState({ step: "error", message })
      }
    }
  }, [startAuthMutation])

  // Start CLI setup-token flow
  const startCliAuth = useCallback(async () => {
    setFlowState({ step: "setup_token" })
    try {
      await runSetupTokenMutation.mutateAsync()
      await handleAuthSuccess()
    } catch (err) {
      // CLI failed, try sandbox fallback
      console.warn("[ClaudeLoginModal] setup-token failed, trying sandbox:", err)
      startSandboxAuth()
    }
  }, [runSetupTokenMutation, handleAuthSuccess, startSandboxAuth])

  // Determine next step after checking system token (if ignored or not found)
  const proceedToAuth = useCallback(() => {
    if (cliInstalledQuery.data?.installed) {
      startCliAuth()
    } else {
      startSandboxAuth()
    }
  }, [cliInstalledQuery.data?.installed, startCliAuth, startSandboxAuth])

  // === Initial Check Sequence ===
  useEffect(() => {
    if (!open || initialCheckDoneRef.current) return
    if (!systemTokenQuery.isFetched || !cliInstalledQuery.isFetched) return

    initialCheckDoneRef.current = true

    // Priority 1: System token exists → SHOW IT (Do not auto-import to avoid loops)
    if (systemTokenQuery.data?.token) {
      setFlowState({
        step: "has_system_token",
        token: systemTokenQuery.data.token
      })
      return
    }

    // Priority 2: Auto-start auth if no token found
    proceedToAuth()
  }, [open, systemTokenQuery.isFetched, cliInstalledQuery.isFetched, systemTokenQuery.data?.token, proceedToAuth])

  // Update flow state when we get the OAuth URL from sandbox
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

  // Auto-open browser when sandbox URL is ready
  useEffect(() => {
    if (flowState.step === "has_url" && !urlOpenedRef.current) {
      urlOpenedRef.current = true
      openOAuthUrlMutation.mutate(flowState.oauthUrl)
    }
  }, [flowState, openOAuthUrlMutation])

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setFlowState({ step: "checking" })
      setAuthCode("")
      setSavedOauthUrl(null)
      urlOpenedRef.current = false
      initialCheckDoneRef.current = false
    }
  }, [open])

  // Handle "Use Existing" click
  const handleUseExistingToken = async () => {
    setFlowState({ step: "importing" })
    try {
      await importSystemTokenMutation.mutateAsync()
      await handleAuthSuccess()
    } catch (err) {
      setFlowState({
        step: "error",
        message: err instanceof Error ? err.message : "Failed to import token",
      })
    }
  }

  // Handle "Re-authenticate" click
  const handleReauthenticate = () => {
    proceedToAuth()
  }

  // Check if the code looks like a valid Claude auth code
  const isValidCodeFormat = (code: string) => {
    const trimmed = code.trim()
    return trimmed.length > 50 && trimmed.includes("#")
  }

  const handleSubmitCode = async () => {
    if (!authCode.trim() || flowState.step !== "has_url") return

    const { sandboxUrl, sessionId } = flowState
    setFlowState({ step: "submitting" })

    try {
      await submitCodeMutation.mutateAsync({
        sandboxUrl,
        sessionId,
        code: authCode.trim(),
      })
      await handleAuthSuccess()
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

    if (isValidCodeFormat(value) && flowState.step === "has_url") {
      const { sandboxUrl, sessionId } = flowState
      setTimeout(async () => {
        setFlowState({ step: "submitting" })
        try {
          await submitCodeMutation.mutateAsync({
            sandboxUrl,
            sessionId,
            code: value.trim(),
          })
          await handleAuthSuccess()
        } catch (err) {
          setFlowState({
            step: "error",
            message: err instanceof Error ? err.message : "Failed to submit code",
          })
        }
      }, 100)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && authCode.trim()) {
      handleSubmitCode()
    }
  }

  const handleOpenFallbackUrl = () => {
    if (savedOauthUrl) {
      openOAuthUrlMutation.mutate(savedOauthUrl)
    }
  }

  const handleRetry = () => {
    initialCheckDoneRef.current = false
    urlOpenedRef.current = false
    setSavedOauthUrl(null)
    setAuthCode("")
    systemTokenQuery.refetch()
    cliInstalledQuery.refetch()
    setFlowState({ step: "checking" })
  }

  const handleCopyCommand = () => {
    navigator.clipboard.writeText("claude login")
  }

  const handleOpenModelsSettings = () => {
    clearPendingRetry()
    setSettingsActiveTab("models" as SettingsTab)
    setSettingsOpen(true)
    setOpen(false)
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      clearPendingRetry()
    }
    setOpen(newOpen)
  }

  const isLoading =
    flowState.step === "checking" ||
    flowState.step === "importing" ||
    flowState.step === "setup_token" ||
    flowState.step === "starting" ||
    flowState.step === "waiting_url"

  const isSubmitting = flowState.step === "submitting"

  const getLoadingMessage = () => {
    switch (flowState.step) {
      case "checking":
        return "Checking credentials..."
      case "importing":
        return "Importing credentials..."
      case "setup_token":
        return "Authenticating in browser..."
      case "starting":
      case "waiting_url":
        return "Connecting..."
      default:
        return ""
    }
  }

  const formatTokenPreview = (token: string) => {
    const trimmed = token.trim()
    if (trimmed.length <= 16) return trimmed
    return `${trimmed.slice(0, 19)}...${trimmed.slice(-6)}`
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent className="w-[380px] p-6">
        <AlertDialogCancel className="absolute right-4 top-4 h-6 w-6 p-0 border-0 bg-transparent hover:bg-muted rounded-sm opacity-70 hover:opacity-100">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </AlertDialogCancel>

        <div className="flex flex-col gap-8">
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
                Claude Code
              </h1>
              <p className="text-sm text-muted-foreground">
                Connect your Claude Code subscription
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {/* Loading states */}
            {isLoading && (
              <div className="flex flex-col items-center gap-3 py-2">
                <IconSpinner className="h-5 w-5" />
                <p className="text-sm text-muted-foreground">{getLoadingMessage()}</p>
              </div>
            )}

            {/* Found System Token State - USER DECISION REQUIRED */}
            {flowState.step === "has_system_token" && (
              <div className="flex flex-col gap-4">
                <div className="p-4 bg-muted/50 border border-border rounded-lg">
                  <p className="text-sm font-medium mb-2">Existing credentials found</p>
                  <pre className="px-2.5 py-2 text-xs text-foreground whitespace-pre-wrap break-all font-mono bg-background/60 rounded border border-border/60">
                    {formatTokenPreview(flowState.token)}
                  </pre>
                </div>
                <div className="flex flex-col gap-2">
                  <Button onClick={handleUseExistingToken} className="w-full">
                    Use Existing Credentials
                  </Button>
                  <Button variant="secondary" onClick={handleReauthenticate} className="w-full">
                    Re-authenticate
                  </Button>
                </div>
              </div>
            )}

            {/* Code Input (Sandbox Flow) */}
            {(flowState.step === "has_url" || isSubmitting) && (
              <div className="flex flex-col gap-4">
                <Input
                  value={authCode}
                  onChange={handleCodeChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Paste your authentication code here..."
                  className="font-mono text-center"
                  autoFocus
                  disabled={isSubmitting}
                />
                <Button
                  onClick={handleSubmitCode}
                  className="w-full"
                  disabled={!authCode.trim() || isSubmitting}
                >
                  {isSubmitting ? <IconSpinner className="h-4 w-4" /> : "Continue"}
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  A new tab has opened for authentication.
                  {savedOauthUrl && (
                    <>
                      {" "}
                      <button
                        onClick={handleOpenFallbackUrl}
                        className="text-primary hover:underline"
                      >
                        Didn't open? Click here
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

                {flowState.message.includes("claude login") && (
                  <button
                    onClick={handleCopyCommand}
                    className="flex items-center justify-center gap-2 p-3 bg-muted/50 border border-border rounded-lg text-sm font-mono hover:bg-muted transition-colors"
                  >
                    <span>claude login</span>
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}

                <Button
                  variant="secondary"
                  onClick={handleRetry}
                  className="w-full"
                >
                  Try Again
                </Button>
              </div>
            )}

            <div className="text-center mt-2!">
              <button
                type="button"
                onClick={handleOpenModelsSettings}
                className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              >
                Set a custom model in Settings
              </button>
            </div>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
