import { useEffect, useState, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "motion/react"
import { useTranslation } from "react-i18next"
import { useAtom } from "jotai"
import confetti from "canvas-confetti"
import { CheckCircle2, Circle, Loader2, XCircle, ExternalLink } from "lucide-react"
import { userPersonalizationAtom } from "../../lib/atoms"
import { cn } from "../../lib/utils"
import { trpc } from "../../lib/trpc"
import { createLogger } from "../../lib/logger"
import {
  useLoadingPipeline,
  LoadingStepPriority,
  type LoadingStep,
} from "../../lib/loading-pipeline"
import { welcomeNameInputCompletedAtom } from "../../lib/atoms"
import { useAtomValue } from "jotai"

const log = createLogger("EnvCheckStep")

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnvPhase =
  | "silent_check"
  | "checking"
  | "installing_pm"
  | "installing_git"
  | "install_failed"
  | "recommend"
  | "installing_recommended"
  | "name_input"
  | "done"

type CheckStatus = "pending" | "checking" | "success" | "failed"

interface CheckItem {
  id: string
  label: string
  status: CheckStatus
}

interface StepDef {
  id: string
  label: string
  status: "pending" | "active" | "completed"
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StepIndicator({ steps }: { steps: StepDef[] }) {
  return (
    <div className="flex items-center justify-center mb-6">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center">
          <div className="flex flex-col items-center">
            <div
              className={cn(
                "w-3 h-3 rounded-full transition-all duration-300",
                step.status === "completed" && "bg-primary",
                step.status === "active" && "bg-primary animate-pulse",
                step.status === "pending" && "bg-muted-foreground/30",
              )}
            />
            <span
              className={cn(
                "text-xs mt-2 transition-colors text-center whitespace-nowrap",
                step.status === "completed" && "text-primary",
                step.status === "active" && "text-foreground",
                step.status === "pending" && "text-muted-foreground/50",
              )}
            >
              {step.label}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={cn(
                "w-12 h-[2px] -mt-6 transition-colors",
                step.status === "completed"
                  ? "bg-primary"
                  : "bg-muted-foreground/20",
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function CheckListItem({ item }: { item: CheckItem }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {item.status === "pending" && (
        <Circle className="w-4 h-4 text-muted-foreground/40" />
      )}
      {item.status === "checking" && (
        <Loader2 className="w-4 h-4 text-primary animate-spin" />
      )}
      {item.status === "success" && (
        <CheckCircle2 className="w-4 h-4 text-green-500" />
      )}
      {item.status === "failed" && (
        <XCircle className="w-4 h-4 text-destructive" />
      )}
      <span
        className={cn(
          "transition-colors",
          item.status === "success" && "text-foreground",
          item.status === "checking" && "text-foreground",
          item.status === "failed" && "text-destructive",
          item.status === "pending" && "text-muted-foreground/60",
        )}
      >
        {item.label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// EnvCheckUI — the bottom-half content rendered by the step
// ---------------------------------------------------------------------------

function EnvCheckUI({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation("common")
  const [userPersonalization, setUserPersonalization] = useAtom(
    userPersonalizationAtom,
  )
  const welcomeNameInputCompleted = useAtomValue(welcomeNameInputCompletedAtom)
  const showNameInput = !welcomeNameInputCompleted

  const [envPhase, setEnvPhase] = useState<EnvPhase>(
    showNameInput ? "checking" : "silent_check",
  )
  const [checkItems, setCheckItems] = useState<CheckItem[]>([
    { id: "pm", label: t("loading.env.checkingPM"), status: "pending" },
    { id: "git", label: t("loading.env.checkingGit"), status: "pending" },
  ])
  const [missingRecommended, setMissingRecommended] = useState<string[]>([])
  const [installingToolName, setInstallingToolName] = useState<string>("")
  const [gitInstalled, setGitInstalled] = useState(false)
  const envCheckRan = useRef(false)

  const [nameValue, setNameValue] = useState("")
  const [nameInputDone, setNameInputDone] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const utils = trpc.useUtils()
  const installPMMutation = trpc.runner.installPackageManager.useMutation()
  const installToolMutation = trpc.runner.installTool.useMutation()

  const detectTools = useCallback(async () => {
    await utils.runner.detectTools.invalidate()
    return utils.runner.detectTools.fetch()
  }, [utils])

  const updateCheckItem = useCallback((id: string, status: CheckStatus) => {
    setCheckItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status } : item)),
    )
  }, [])

  // 当 envPhase 变成 done，通知 pipeline
  useEffect(() => {
    if (envPhase === "done") {
      onDone()
    }
  }, [envPhase, onDone])

  const markDone = useCallback(() => {
    setEnvPhase("done")
  }, [])

  const runEnvCheck = useCallback(
    async (isSilent: boolean) => {
      try {
        updateCheckItem("pm", "checking")
        const result = await detectTools()

        const pmCategory = result.categories.find(
          (c: { category: string; satisfied: boolean }) =>
            c.category === "package_manager",
        )
        const pmAvailable =
          pmCategory?.satisfied ?? result.platform === "linux"
        updateCheckItem("pm", pmAvailable ? "success" : "pending")

        updateCheckItem("git", "checking")
        const gitTool = result.tools.find(
          (t: { name: string; installed: boolean }) => t.name === "git",
        )
        const hasGit = gitTool?.installed ?? false

        if (hasGit) {
          updateCheckItem("git", "success")
          setGitInstalled(true)

          if (isSilent) {
            markDone()
            return
          }

          confetti({
            particleCount: 100,
            spread: 70,
            origin: { x: 0.5, y: 0.5 },
          })

          const missing: string[] = []
          const pythonTool = result.tools.find(
            (t: { name: string; installed: boolean }) =>
              t.name === "python3" || t.name === "python",
          )
          const nodeTool = result.tools.find(
            (t: { name: string; installed: boolean }) => t.name === "node",
          )
          if (!pythonTool?.installed) missing.push("Python")
          if (!nodeTool?.installed) missing.push("Node.js")
          setMissingRecommended(missing)

          if (missing.length > 0) {
            setEnvPhase("recommend")
          } else if (showNameInput && !nameInputDone) {
            setEnvPhase("name_input")
          } else {
            markDone()
          }
          return
        }

        updateCheckItem("git", "failed")

        if (isSilent) {
          setEnvPhase("checking")
          return runEnvCheck(false)
        }

        if (!pmAvailable) {
          setEnvPhase("installing_pm")
          try {
            await installPMMutation.mutateAsync()
            updateCheckItem("pm", "success")
          } catch {
            updateCheckItem("pm", "failed")
          }
        }

        setEnvPhase("installing_git")
        setInstallingToolName("Git")
        try {
          await installToolMutation.mutateAsync({
            toolName: "git",
            command: "git",
          })
          updateCheckItem("git", "success")
          setGitInstalled(true)
          confetti({
            particleCount: 100,
            spread: 70,
            origin: { x: 0.5, y: 0.5 },
          })

          const refreshResult = await detectTools()
          const missing: string[] = []
          const pythonTool = refreshResult.tools.find(
            (t: { name: string; installed: boolean }) =>
              t.name === "python3" || t.name === "python",
          )
          const nodeTool = refreshResult.tools.find(
            (t: { name: string; installed: boolean }) => t.name === "node",
          )
          if (!pythonTool?.installed) missing.push("Python")
          if (!nodeTool?.installed) missing.push("Node.js")
          setMissingRecommended(missing)

          if (missing.length > 0 && showNameInput) {
            setEnvPhase("recommend")
          } else if (showNameInput && !nameInputDone) {
            setEnvPhase("name_input")
          } else {
            markDone()
          }
        } catch {
          setEnvPhase("install_failed")
        }
      } catch (error) {
        log.error("Env check error:", error)
        markDone()
      }
    },
    [
      detectTools,
      installPMMutation,
      installToolMutation,
      updateCheckItem,
      showNameInput,
      nameInputDone,
      markDone,
    ],
  )

  useEffect(() => {
    if (envCheckRan.current) return
    envCheckRan.current = true
    const isSilent = envPhase === "silent_check"
    runEnvCheck(isSilent)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = useCallback(() => {
    setCheckItems([
      { id: "pm", label: t("loading.env.checkingPM"), status: "pending" },
      { id: "git", label: t("loading.env.checkingGit"), status: "pending" },
    ])
    setEnvPhase("checking")
    envCheckRan.current = false
    runEnvCheck(false)
  }, [t, runEnvCheck])

  const handleDownloadGit = useCallback(() => {
    const platform = window.desktopApi?.platform
    const url =
      platform === "win32"
        ? "https://git-scm.com/download/win"
        : "https://git-scm.com/downloads"
    window.desktopApi?.openExternal?.(url)
  }, [])

  const handleSkipEnv = useCallback(() => {
    markDone()
  }, [markDone])

  const handleInstallRecommended = useCallback(async () => {
    setEnvPhase("installing_recommended")
    for (const toolName of missingRecommended) {
      setInstallingToolName(toolName)
      try {
        const actualName = toolName === "Python" ? "python3" : "node"
        await installToolMutation.mutateAsync({
          toolName: actualName,
          command: actualName,
        })
      } catch {
        // Ignore errors, continue
      }
    }
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { x: 0.5, y: 0.5 },
    })
    if (showNameInput && !nameInputDone) {
      setEnvPhase("name_input")
    } else {
      markDone()
    }
  }, [
    missingRecommended,
    installToolMutation,
    showNameInput,
    nameInputDone,
    markDone,
  ])

  const handleSkipRecommended = useCallback(() => {
    if (showNameInput && !nameInputDone) {
      setEnvPhase("name_input")
    } else {
      markDone()
    }
  }, [showNameInput, nameInputDone, markDone])

  useEffect(() => {
    if (envPhase === "name_input" && inputRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 300)
      return () => clearTimeout(timer)
    }
  }, [envPhase])

  const handleConfirmName = useCallback(() => {
    if (nameValue.trim()) {
      setUserPersonalization({
        ...userPersonalization,
        preferredName: nameValue.trim().slice(0, 50),
      })
    }
    setNameInputDone(true)
    markDone()
  }, [nameValue, userPersonalization, setUserPersonalization, markDone])

  const handleSkipName = useCallback(() => {
    setNameInputDone(true)
    markDone()
  }, [markDone])

  // Build step indicator
  const steps = (() => {
    const list: StepDef[] = []

    const pmCompleted =
      envPhase !== "checking" && envPhase !== "installing_pm"
    const pmActive = envPhase === "checking" || envPhase === "installing_pm"
    list.push({
      id: "env",
      label: t("loading.env.stepEnv"),
      status: pmCompleted ? "completed" : pmActive ? "active" : "pending",
    })

    const requiredCompleted =
      gitInstalled ||
      envPhase === "install_failed" ||
      envPhase === "recommend" ||
      envPhase === "installing_recommended" ||
      envPhase === "name_input" ||
      envPhase === "done"
    const requiredActive = envPhase === "installing_git"
    list.push({
      id: "required",
      label: t("loading.env.stepRequired"),
      status: requiredCompleted
        ? "completed"
        : requiredActive
          ? "active"
          : "pending",
    })

    if (showNameInput) {
      const recommendCompleted =
        envPhase === "name_input" || envPhase === "done"
      const recommendActive =
        envPhase === "recommend" || envPhase === "installing_recommended"
      list.push({
        id: "recommend",
        label: t("loading.env.stepRecommend"),
        status: recommendCompleted
          ? "completed"
          : recommendActive
            ? "active"
            : "pending",
      })

      const nameCompleted = nameInputDone || envPhase === "done"
      const nameActive = envPhase === "name_input"
      list.push({
        id: "name",
        label: t("loading.env.stepName"),
        status: nameCompleted
          ? "completed"
          : nameActive
            ? "active"
            : "pending",
      })
    }

    return list
  })()

  const showGuidedUI =
    envPhase !== "done" && envPhase !== "silent_check"

  // Silent or done: loading indicator
  if (!showGuidedUI) {
    return (
      <motion.div
        key="env-loading"
        className="flex flex-col items-center gap-6"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
      >
        <div className="flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <motion.div
              key={i}
              className="w-2.5 h-2.5 rounded-full bg-primary"
              animate={{
                scale: [1, 1.3, 1],
                opacity: [0.5, 1, 0.5],
              }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.2,
              }}
            />
          ))}
        </div>
        <motion.p
          className="text-sm md:text-base text-muted-foreground font-medium"
          animate={{ opacity: [0.6, 1, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          {t("loading.initializing")}
        </motion.p>
      </motion.div>
    )
  }

  // Guided UI
  return (
    <motion.div
      key="env-guided"
      className="flex flex-col items-center gap-4 w-full"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
    >
      <StepIndicator steps={steps} />

      {/* Checking / Installing PM / Installing Git */}
      {(envPhase === "checking" ||
        envPhase === "installing_pm" ||
        envPhase === "installing_git") && (
        <div className="flex flex-col items-center gap-4">
          <div className="flex flex-col gap-2">
            {checkItems.map((item) => (
              <CheckListItem key={item.id} item={item} />
            ))}
          </div>
          {(envPhase === "installing_pm" ||
            envPhase === "installing_git") && (
            <p className="text-xs text-muted-foreground">
              {t("loading.env.mayTakeMinutes")}
            </p>
          )}
        </div>
      )}

      {/* Install failed */}
      {envPhase === "install_failed" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-destructive">
              {t("loading.env.failed")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("loading.env.failedDesc")}
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full max-w-xs">
            <button
              onClick={handleDownloadGit}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              {t("loading.env.downloadGit")}
            </button>
            <button
              onClick={handleRetry}
              className="px-4 py-2.5 rounded-lg border border-border text-foreground font-medium hover:bg-accent transition-colors"
            >
              {t("loading.env.recheck")}
            </button>
            <button
              onClick={handleSkipEnv}
              className="px-4 py-2.5 rounded-lg border border-border text-muted-foreground font-medium hover:bg-accent transition-colors"
            >
              {t("loading.env.skip")}
            </button>
          </div>
        </div>
      )}

      {/* Recommend */}
      {envPhase === "recommend" && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {t("loading.env.recommend")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("loading.env.recommendDesc")}
            </p>
          </div>
          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={handleInstallRecommended}
              className="flex-1 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors text-sm"
            >
              {t("loading.env.installRecommended")}
            </button>
            <button
              onClick={handleSkipRecommended}
              className="flex-1 px-4 py-2.5 rounded-lg border border-border text-foreground font-medium hover:bg-accent transition-colors text-sm"
            >
              {t("loading.env.skipRecommended")}
            </button>
          </div>
        </div>
      )}

      {/* Installing recommended */}
      {envPhase === "installing_recommended" && (
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">
            {t("loading.env.installingRecommended", {
              name: installingToolName,
            })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("loading.env.mayTakeMinutes")}
          </p>
        </div>
      )}

      {/* Name input */}
      {envPhase === "name_input" && (
        <div className="flex flex-col items-center gap-5 w-full">
          <div className="flex flex-col items-center gap-2">
            <p className="text-base text-foreground">
              {t("loading.nameInput.question")}
            </p>
            <p className="text-lg md:text-xl text-foreground font-medium">
              {t("loading.nameInput.subtitle")}
            </p>
          </div>

          <input
            ref={inputRef}
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === "Enter" && nameValue.trim()) {
                handleConfirmName()
              }
            }}
            placeholder={t("loading.nameInput.placeholder")}
            maxLength={50}
            className="w-full max-w-xs px-4 py-2.5 rounded-lg border border-border bg-background/80 backdrop-blur-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-center"
          />

          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={handleConfirmName}
              disabled={!nameValue.trim()}
              className={cn(
                "flex-1 px-4 py-2.5 rounded-lg font-medium transition-all",
                nameValue.trim()
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            >
              {t("loading.nameInput.letsGo")}
            </button>
            <button
              onClick={handleSkipName}
              className="flex-1 px-4 py-2.5 rounded-lg border border-border text-foreground font-medium hover:bg-accent transition-colors"
            >
              {t("loading.nameInput.skip")}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Hook: useEnvCheckStep — registers the step into the pipeline
// ---------------------------------------------------------------------------

export function useEnvCheckStep() {
  const { register, complete } = useLoadingPipeline()
  const completeRef = useRef(complete)
  completeRef.current = complete

  useEffect(() => {
    const step: LoadingStep = {
      id: "env-check",
      priority: LoadingStepPriority.Critical,
      shouldActivate: () => true,
      ui: {
        renderBottom: () => (
          <EnvCheckUI onDone={() => completeRef.current("env-check")} />
        ),
      },
    }
    register(step)
  }, [register])
}
